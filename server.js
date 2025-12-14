// server.js - Render / Cyclic / Fly / local ready
// Simple file-backed hotel backend with JWT + Socket.IO
// Updated: ensure room name/price persist reliably across restarts (atomic writes + defaults)

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
  // default options - allow same-origin requests
  cors: {
    origin: true,
    methods: ['GET', 'POST']
  }
});

// CONFIG
const DATA_FILE = path.join(__dirname, 'data.json');
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_in_production';
const TOKEN_EXPIRES_IN = '8h'; // adjust as needed

// Simple in-memory user list for demo. Change as needed or load from env/db.
const USERS = {
  owner: { password: 'msn2021$', role: 'Owner' },
  manager: { password: 'badal25', role: 'Manager' }
};

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files from project root
app.use(express.static(path.join(__dirname, '/')));

// Utility: ensure rooms have sensible defaults (name, numeric price)
function ensureRoomDefaults(data) {
  if (!data.rooms || !Array.isArray(data.rooms)) data.rooms = [];
  data.rooms = data.rooms.map((r, idx) => {
    const id = Number(r.id) || idx + 1;
    const room = Object.assign({}, r);
    room.id = id;
    // preserve existing name, otherwise default to "Room <id>"
    room.name = room.name || `Room ${id}`;
    // ensure price is a number and not missing
    room.price = Number(room.price) || 1500;
    // Ensure numeric amounts exist
    room.totalAmount = Number(room.totalAmount) || 0;
    room.paidAmount = Number(room.paidAmount) || 0;
    room.dueAmount = Number(room.dueAmount) || 0;
    room.numberOfPersons = Number(room.numberOfPersons) || 1;
    room.status = room.status || 'available';
    // keep other fields as-is
    return room;
  });

  // payments default shape
  data.payments = data.payments || { cash: 0, upi: 0, dayRevenue: 0, monthRevenue: 0 };
  data.customers = data.customers || [];
  data.notifications = data.notifications || [];
}

// Atomic write helper (write to temp then rename)
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

// Utility: read/write data.json safely
function readData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const data = JSON.parse(raw);
    ensureRoomDefaults(data);
    return data;
  } catch (e) {
    console.error('Error reading data.json, returning default structure.', e);
    // default structure (keeps compatibility)
    const defaultData = {
      rooms: Array.from({ length: 29 }, (_, i) => ({
        id: i + 1,
        name: `Room ${i + 1}`,
        status: "available",
        price: 1500,
        customerName: "",
        numberOfPersons: 1,
        aadharNumber: "",
        phoneNumber: "",
        checkinTime: "",
        checkoutTime: "",
        paymentMode: "",
        totalAmount: 0,
        paidAmount: 0,
        dueAmount: 0
      })),
      payments: { cash: 0, upi: 0, dayRevenue: 0, monthRevenue: 0 },
      customers: [],
      notifications: []
    };

    // If file missing or malformed, try to create a valid data.json so changes persist across restarts
    try {
      writeData(defaultData);
      console.info('Created default data.json');
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

// Login: returns JWT
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username & password required' });

  const user = USERS[username];
  if (!user || user.password !== password) return res.status(401).json({ error: 'Invalid credentials' });

  const token = createToken(username, user.role);
  return res.json({ token, role: user.role });
});

// Get all rooms (authenticated)
app.get('/api/rooms', authMiddleware, (req, res) => {
  const data = readData();
  // Ensure every room has a name/price before sending
  ensureRoomDefaults(data);
  return res.json(data.rooms || []);
});

// Update a room (authenticated)
// Manager and Owner can update rooms; server trusts auth to decide further logic if needed.
app.put('/api/rooms/:id', authMiddleware, (req, res) => {
  const roomId = parseInt(req.params.id);
  if (Number.isNaN(roomId)) return res.status(400).json({ error: 'Invalid room id' });

  const payload = req.body || {};
  const data = readData();
  const idx = (data.rooms || []).findIndex(r => r.id === roomId);
  if (idx === -1) return res.status(404).json({ error: 'Room not found' });

  // Basic sanitation: only accept fields we expect
  const allowed = ['name','status','price','customerName','numberOfPersons','aadharNumber','phoneNumber','checkinTime','checkoutTime','paymentMode','totalAmount','paidAmount','dueAmount'];
  allowed.forEach(k => {
    if (k in payload) {
      // coerce numeric fields to Number
      if (['price','numberOfPersons','totalAmount','paidAmount','dueAmount'].includes(k)) {
        data.rooms[idx][k] = Number(payload[k]) || 0;
      } else {
        data.rooms[idx][k] = payload[k];
      }
    }
  });

  // Ensure defaults for updated room
  data.rooms[idx].name = data.rooms[idx].name || `Room ${data.rooms[idx].id}`;
  data.rooms[idx].price = Number(data.rooms[idx].price) || 1500;

  const ok = writeData(data);
  if (!ok) {
    console.warn('Failed to persist room update to disk — changes will be lost on restart');
    // still broadcast in-memory state so connected clients see updates
    io.emit('roomsUpdated', data.rooms);
    return res.status(500).json({ ok: false, error: 'Failed to persist data' });
  }

  // Broadcast roomsUpdated
  io.emit('roomsUpdated', data.rooms);
  return res.json({ ok: true, room: data.rooms[idx] });
});

// Payments endpoints
app.get('/api/payments', authMiddleware, (req, res) => {
  const data = readData();
  // Only owner should access full payments; manager gets a subset
  if (req.user.role === 'Owner') return res.json(data.payments || {});
  // manager gets totals without breakdown
  const p = data.payments || {};
  return res.json({ dayRevenue: p.dayRevenue || 0, monthRevenue: p.monthRevenue || 0 });
});

// Add a payment (Owner or Manager)
app.post('/api/payments', authMiddleware, (req, res) => {
  // Allow both Owner and Manager to add payments
  if (!req.user || (req.user.role !== 'Owner' && req.user.role !== 'Manager')) {
    return res.status(403).json({ error: 'Forbidden: insufficient role' });
  }

  const { amount = 0, mode = 'cash', roomId = null, message = null } = req.body || {};
  const data = readData();

  data.payments = data.payments || { cash:0, upi:0, dayRevenue:0, monthRevenue:0 };
  const amt = Number(amount) || 0;

  if (mode && String(mode).toLowerCase() === 'upi') data.payments.upi = (data.payments.upi || 0) + amt;
  else data.payments.cash = (data.payments.cash || 0) + amt;

  // update day/month revenue roughly
  data.payments.dayRevenue = (data.payments.dayRevenue || 0) + amt;
  data.payments.monthRevenue = (data.payments.monthRevenue || 0) + amt;
  data.payments.lastUpdated = new Date().toISOString();

  // Optionally add a notification (if message present)
  if (message) {
    data.notifications = data.notifications || [];
    data.notifications.push({ message, timestamp: new Date().toISOString() });
  }

  // If roomId provided, update that room's paid/due amounts
  if (roomId) {
    const rIdx = (data.rooms || []).findIndex(r => r.id === Number(roomId));
    if (rIdx !== -1) {
      data.rooms[rIdx].paidAmount = (data.rooms[rIdx].paidAmount || 0) + amt;
      data.rooms[rIdx].dueAmount = Math.max(0, (data.rooms[rIdx].totalAmount || 0) - data.rooms[rIdx].paidAmount);
    }
  }

  const ok = writeData(data);
  if (!ok) {
    console.warn('Failed to persist payment to disk — changes will be lost on restart');
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

// Customers: Owner only for full DB
app.get('/api/customers', authMiddleware, (req, res) => {
  const data = readData();
  if (req.user.role === 'Owner') return res.json(data.customers || []);
  // manager gets count only
  return res.json({ count: (data.customers || []).length });
});

// Create/update a customer (Owner or Manager via room updates) - optional endpoint
app.post('/api/customers', authMiddleware, (req, res) => {
  const payload = req.body || {};
  const data = readData();
  data.customers = data.customers || [];

  // basic create
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

// Owner can clear notifications
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

// Fallback: serve index.html for any other GET (SPA)
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  return res.status(404).send('Not found');
});

// Socket.IO: authenticate on connection using token in auth payload
io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next(); // allow anonymous read-only socket if you want
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.user = payload;
    return next();
  } catch (e) {
    console.warn('Socket auth failed', e.message);
    return next(); // allow connect but no user info
  }
});

io.on('connection', (socket) => {
  console.log('Socket connected', socket.id, socket.user ? socket.user.username : 'anonymous');

  // Send current state on connect
  const data = readData();
  socket.emit('roomsUpdated', data.rooms || []);
  socket.emit('paymentsUpdated', data.payments || {});
  socket.emit('customersUpdated', data.customers || []);
  socket.emit('notificationsUpdated', data.notifications || []);

  socket.on('disconnect', (reason) => {
    console.log('Socket disconnected', socket.id, reason);
  });
});

// Start server (Render / Fly / Cyclic compatible)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
