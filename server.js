// server.js - Render / Cyclic / Fly / local ready
// Simple file-backed hotel backend with JWT + Socket.IO
// Updated: set explicit default room names & prices per mapping provided

const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Socket.IO: will be attached after server creation
const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST']
  }
});

// CONFIG
const DATA_FILE = path.join(__dirname, 'data.json');
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_in_production';
const TOKEN_EXPIRES_IN = '8h';

// Simple in-memory user list for demo.
const USERS = {
  owner: { password: 'msn2021$', role: 'Owner' },
  manager: { password: 'badal25', role: 'Manager' }
};

// Mapping provided by user: app id (1..29) -> displayed room number
const ROOM_NUMBER_MAP = {
  1: 102,
  2: 103,
  3: 104,
  4: 105,
  5: 106,
  6: 201,
  7: 202,
  8: 203,
  9: 204,
  10: 205,
  11: 206,
  12: 207,
  13: 208,
  14: 301,
  15: 302,
  16: 303,
  17: 304,
  18: 305,
  19: 306,
  20: 307,
  21: 308,
  22: 401,
  23: 402,
  24: 403,
  25: 404,
  26: 405,
  27: 406,
  28: 407,
  29: 408
};

// Default price rules (per user's list)
function getDefaultPriceForRoomNumber(roomNumber) {
  if (!roomNumber) return 1500;
  const price350 = new Set([
    // Rooms to be 350
    102,103,104,105,106,
    201,202,203,204,205,206,207,
    301,302,303,304,305,306,307,
    401,402,403,404,405,406,407
  ]);
  const price500 = new Set([208, 308, 408]);
  if (price350.has(roomNumber)) return 350;
  if (price500.has(roomNumber)) return 500;
  return 1500;
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '/')));

// Ensure rooms in data have name/price defaults
function ensureRoomDefaults(data) {
  if (!data.rooms || !Array.isArray(data.rooms)) data.rooms = [];
  data.rooms = data.rooms.map((r, idx) => {
    const id = Number(r.id) || idx + 1;
    const room = Object.assign({}, r);
    room.id = id;
    const mappedNumber = ROOM_NUMBER_MAP[id] || (100 + id);
    room.name = room.name || String(mappedNumber);
    // If no price or invalid, use default mapping price
    const existingPrice = Number(room.price);
    room.price = existingPrice > 0 ? existingPrice : getDefaultPriceForRoomNumber(mappedNumber);
    room.status = room.status || 'available';
    room.totalAmount = Number(room.totalAmount) || 0;
    room.paidAmount = Number(room.paidAmount) || 0;
    room.dueAmount = Number(room.dueAmount) || 0;
    room.numberOfPersons = Number(room.numberOfPersons) || 1;
    room.aadharNumber = room.aadharNumber || '';
    room.customerName = room.customerName || '';
    room.phoneNumber = room.phoneNumber || '';
    room.checkinTime = room.checkinTime || '';
    room.checkoutTime = room.checkoutTime || '';
    room.paymentMode = room.paymentMode || '';
    return room;
  });

  data.payments = data.payments || { cash: 0, upi: 0, dayRevenue: 0, monthRevenue: 0 };
  data.customers = data.customers || [];
  data.notifications = data.notifications || [];
}

// Atomic write helper
function writeData(data) {
  try {
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, DATA_FILE);
    return true;
  } catch (e) {
    console.error('Error writing data.json', e);
    return false;
  }
}

function readData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    ensureRoomDefaults(data);
    return data;
  } catch (e) {
    console.error('Error reading data.json, returning default structure.', e);
    // Build default data using mapping & price rules
    const defaultRooms = Array.from({ length: 29 }, (_, i) => {
      const id = i + 1;
      const mappedNumber = ROOM_NUMBER_MAP[id] || (100 + id);
      return {
        id,
        name: String(mappedNumber),
        status: 'available',
        price: getDefaultPriceForRoomNumber(mappedNumber),
        customerName: '',
        numberOfPersons: 1,
        aadharNumber: '',
        phoneNumber: '',
        checkinTime: '',
        checkoutTime: '',
        paymentMode: '',
        totalAmount: 0,
        paidAmount: 0,
        dueAmount: 0
      };
    });

    const defaultData = {
      rooms: defaultRooms,
      payments: { cash: 0, upi: 0, dayRevenue: 0, monthRevenue: 0 },
      customers: [],
      notifications: []
    };

    try {
      writeData(defaultData);
      console.info('Created default data.json with provided room mapping & prices');
    } catch (writeErr) {
      console.warn('Could not create default data.json', writeErr);
    }

    return defaultData;
  }
}

// Auth helpers
function createToken(username, role) {
  return jwt.sign({ username, role }, JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN });
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Missing token' });
  const token = auth.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(role) {
  return function (req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    if (req.user.role !== role) return res.status(403).json({ error: 'Forbidden: insufficient role' });
    next();
  };
}

// ----------- API routes -----------

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username & password required' });

  const user = USERS[username];
  if (!user || user.password !== password) return res.status(401).json({ error: 'Invalid credentials' });

  const token = createToken(username, user.role);
  return res.json({ token, role: user.role });
});

// Get rooms
app.get('/api/rooms', authMiddleware, (req, res) => {
  const data = readData();
  ensureRoomDefaults(data);
  return res.json(data.rooms || []);
});

// Update room
app.put('/api/rooms/:id', authMiddleware, (req, res) => {
  const roomId = parseInt(req.params.id);
  if (Number.isNaN(roomId)) return res.status(400).json({ error: 'Invalid room id' });

  const payload = req.body || {};
  const data = readData();
  const idx = (data.rooms || []).findIndex(r => r.id === roomId);
  if (idx === -1) return res.status(404).json({ error: 'Room not found' });

  // Owner-only fields protection
  if (payload.hasOwnProperty('name') && req.user.role !== 'Owner') delete payload.name;
  if (payload.hasOwnProperty('price') && req.user.role !== 'Owner') delete payload.price;

  const allowed = ['name','status','price','customerName','numberOfPersons','aadharNumber','phoneNumber','checkinTime','checkoutTime','paymentMode','totalAmount','paidAmount','dueAmount'];
  allowed.forEach(k => {
    if (k in payload) {
      if (['price','numberOfPersons','totalAmount','paidAmount','dueAmount'].includes(k)) {
        data.rooms[idx][k] = Number(payload[k]) || 0;
      } else {
        data.rooms[idx][k] = payload[k];
      }
    }
  });

  // Ensure defaults after update
  const mappedNumber = ROOM_NUMBER_MAP[roomId] || (100 + roomId);
  data.rooms[idx].name = data.rooms[idx].name || String(mappedNumber);
  data.rooms[idx].price = Number(data.rooms[idx].price) || getDefaultPriceForRoomNumber(mappedNumber);

  const ok = writeData(data);
  if (!ok) {
    console.warn('Failed to persist room update to disk');
    io.emit('roomsUpdated', data.rooms);
    return res.status(500).json({ ok: false, error: 'Failed to persist data' });
  }

  io.emit('roomsUpdated', data.rooms);
  return res.json({ ok: true, room: data.rooms[idx] });
});

// Payments endpoints
app.get('/api/payments', authMiddleware, (req, res) => {
  const data = readData();
  if (req.user.role === 'Owner') return res.json(data.payments || {});
  const p = data.payments || {};
  return res.json({ dayRevenue: p.dayRevenue || 0, monthRevenue: p.monthRevenue || 0 });
});

app.post('/api/payments', authMiddleware, (req, res) => {
  if (!req.user || (req.user.role !== 'Owner' && req.user.role !== 'Manager')) {
    return res.status(403).json({ error: 'Forbidden: insufficient role' });
  }

  const { amount = 0, mode = 'cash', roomId = null, message = null } = req.body || {};
  const data = readData();

  data.payments = data.payments || { cash:0, upi:0, dayRevenue:0, monthRevenue:0 };
  const amt = Number(amount) || 0;

  if (mode && String(mode).toLowerCase() === 'upi') data.payments.upi = (data.payments.upi || 0) + amt;
  else data.payments.cash = (data.payments.cash || 0) + amt;

  data.payments.dayRevenue = (data.payments.dayRevenue || 0) + amt;
  data.payments.monthRevenue = (data.payments.monthRevenue || 0) + amt;
  data.payments.lastUpdated = new Date().toISOString();

  if (message) {
    data.notifications = data.notifications || [];
    data.notifications.push({ message, timestamp: new Date().toISOString() });
  }

  if (roomId) {
    const rIdx = (data.rooms || []).findIndex(r => r.id === Number(roomId));
    if (rIdx !== -1) {
      data.rooms[rIdx].paidAmount = (data.rooms[rIdx].paidAmount || 0) + amt;
      data.rooms[rIdx].dueAmount = Math.max(0, (data.rooms[rIdx].totalAmount || 0) - data.rooms[rIdx].paidAmount);
    }
  }

  const ok = writeData(data);
  if (!ok) {
    console.warn('Failed to persist payment to disk');
    io.emit('paymentsUpdated', data.payments);
    io.emit('roomsUpdated', data.rooms || []);
    io.emit('notificationsUpdated', data.notifications || []);
    return res.status(500).json({ ok: false, error: 'Failed to persist data' });
  }

  io.emit('paymentsUpdated', data.payments);
  io.emit('roomsUpdated', data.rooms || []);
  io.emit('notificationsUpdated', data.notifications || []);
  return res.json({ ok: true, payments: data.payments });
});

// Customers
app.get('/api/customers', authMiddleware, (req, res) => {
  const data = readData();
  if (req.user.role === 'Owner') return res.json(data.customers || []);
  return res.json({ count: (data.customers || []).length });
});

app.post('/api/customers', authMiddleware, (req, res) => {
  const payload = req.body || {};
  const data = readData();
  data.customers = data.customers || [];

  const id = Date.now().toString(36);
  const customer = { id, ...payload, createdAt: new Date().toISOString() };
  data.customers.push(customer);

  const ok = writeData(data);
  if (!ok) {
    io.emit('customersUpdated', data.customers);
    return res.status(500).json({ ok: false, error: 'Failed to persist data' });
  }

  io.emit('customersUpdated', data.customers);
  return res.json({ ok: true, customer });
});

// Notifications
app.get('/api/notifications', authMiddleware, (req, res) => {
  const data = readData();
  return res.json(data.notifications || []);
});

app.delete('/api/notifications', authMiddleware, requireRole('Owner'), (req, res) => {
  const data = readData();
  data.notifications = [];
  const ok = writeData(data);
  if (!ok) {
    io.emit('notificationsUpdated', data.notifications);
    return res.status(500).json({ ok: false, error: 'Failed to persist data' });
  }
  io.emit('notificationsUpdated', data.notifications);
  return res.json({ ok: true });
});

// Health check
app.get('/health', (req, res) => res.json({ ok: true, now: new Date().toISOString() }));

// Fallback
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  return res.status(404).send('Not found');
});

// Socket auth
io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.user = payload;
    return next();
  } catch (e) {
    console.warn('Socket auth failed', e.message);
    return next();
  }
});

io.on('connection', (socket) => {
  console.log('Socket connected', socket.id, socket.user ? socket.user.username : 'anonymous');

  const data = readData();
  socket.emit('roomsUpdated', data.rooms || []);
  socket.emit('paymentsUpdated', data.payments || {});
  socket.emit('customersUpdated', data.customers || []);
  socket.emit('notificationsUpdated', data.notifications || []);

  socket.on('disconnect', (reason) => {
    console.log('Socket disconnected', socket.id, reason);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
