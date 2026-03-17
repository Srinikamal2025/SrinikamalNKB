const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: true,
    methods: ['GET', 'POST']
  }
});

const DATA_FILE = path.join(__dirname, 'data.json');
const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret_in_production';
const TOKEN_EXPIRES_IN = '8h';
const SINGLE_PASSCODE = '1234'; // Single passcode for both Manager and Owner

// Room mapping
const ROOM_NUMBER_MAP = {
  1: 102, 2: 103, 3: 104, 4: 105, 5: 106,
  6: 201, 7: 202, 8: 203, 9: 204, 10: 205, 11: 206, 12: 207, 13: 208,
  14: 301, 15: 302, 16: 303, 17: 304, 18: 305, 19: 306, 20: 307, 21: 308,
  22: 401, 23: 402, 24: 403, 25: 404, 26: 405, 27: 406, 28: 407, 29: 408
};

function getDefaultPriceForRoomNumber(roomNumber) {
  const price350 = new Set([102,103,104,105,106, 201,202,203,204,205,206,207, 301,302,303,304,305,306,307, 401,402,403,404,405,406,407]);
  const price500 = new Set([208, 308, 408]);
  if (price350.has(roomNumber)) return 350;
  if (price500.has(roomNumber)) return 500;
  return 1500;
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '/')));

function ensureRoomDefaults(data) {
  if (!data.rooms || !Array.isArray(data.rooms)) data.rooms = [];
  data.rooms = data.rooms.map((r, idx) => {
    const id = Number(r.id) || idx + 1;
    const room = Object.assign({}, r);
    room.id = id;
    const mappedNumber = ROOM_NUMBER_MAP[id] || (100 + id);
    room.name = room.name || String(mappedNumber);
    const existingPrice = Number(room.price);
    room.price = existingPrice > 0 ? existingPrice : getDefaultPriceForRoomNumber(mappedNumber);
    room.status = room.status || 'available';
    room.rent = Number(room.rent) || 0;
    room.advance = Number(room.advance) || 0;
    room.balance = Number(room.balance) || 0;
    room.customerName = room.customerName || '';
    room.aadharNumber = room.aadharNumber || '';
    room.phoneNumber = room.phoneNumber || '';
    room.numberOfPersons = Number(room.numberOfPersons) || 1;
    room.checkinTime = room.checkinTime || '';
    room.checkoutTime = room.checkoutTime || '';
    return room;
  });

  data.payments = data.payments || { dayRevenue: 0, monthRevenue: 0, balance: 0 };
  data.customers = data.customers || [];
  data.checkoutRecords = data.checkoutRecords || [];
}

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
    const defaultRooms = Array.from({ length: 29 }, (_, i) => {
      const id = i + 1;
      const mappedNumber = ROOM_NUMBER_MAP[id] || (100 + id);
      return {
        id,
        name: String(mappedNumber),
        status: 'available',
        price: getDefaultPriceForRoomNumber(mappedNumber),
        rent: 0,
        advance: 0,
        balance: 0,
        customerName: '',
        aadharNumber: '',
        phoneNumber: '',
        numberOfPersons: 1,
        checkinTime: '',
        checkoutTime: ''
      };
    });

    const defaultData = {
      rooms: defaultRooms,
      payments: { dayRevenue: 0, monthRevenue: 0, balance: 0 },
      customers: [],
      checkoutRecords: []
    };

    try {
      writeData(defaultData);
    } catch (writeErr) {
      console.warn('Could not create default data.json', writeErr);
    }
    return defaultData;
  }
}

function createToken(role) {
  return jwt.sign({ role }, JWT_SECRET, { expiresIn: TOKEN_EXPIRES_IN });
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

// LOGIN - Single Passcode
app.post('/api/login', (req, res) => {
  const { role, passcode } = req.body || {};
  if (!role || !passcode) return res.status(400).json({ error: 'role & passcode required' });

  if (passcode !== SINGLE_PASSCODE) return res.status(401).json({ error: 'Invalid passcode' });

  const token = createToken(role);
  return res.json({ token, role });
});

// Get rooms
app.get('/api/rooms', authMiddleware, (req, res) => {
  const data = readData();
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

  const allowed = ['status', 'rent', 'advance', 'balance', 'customerName', 'aadharNumber', 'phoneNumber', 'numberOfPersons', 'checkinTime', 'checkoutTime'];
  allowed.forEach(k => {
    if (k in payload) {
      if (['rent', 'advance', 'balance', 'numberOfPersons'].includes(k)) {
        data.rooms[idx][k] = Number(payload[k]) || 0;
      } else {
        data.rooms[idx][k] = payload[k];
      }
    }
  });

  const ok = writeData(data);
  if (!ok) {
    io.emit('roomsUpdated', data.rooms);
    return res.status(500).json({ ok: false, error: 'Failed to persist data' });
  }

  io.emit('roomsUpdated', data.rooms);
  return res.json({ ok: true, room: data.rooms[idx] });
});

// Checkout room
app.post('/api/checkout/:id', authMiddleware, requireRole('Owner'), (req, res) => {
  const roomId = parseInt(req.params.id);
  const data = readData();
  const idx = (data.rooms || []).findIndex(r => r.id === roomId);
  if (idx === -1) return res.status(404).json({ error: 'Room not found' });

  const room = data.rooms[idx];
  if (room.balance > 0) return res.status(400).json({ error: 'Cannot checkout: Balance pending' });

  const checkoutTime = new Date().toISOString();
  const checkoutRecord = {
    roomNumber: room.name,
    customerName: room.customerName,
    aadharNumber: room.aadharNumber,
    phoneNumber: room.phoneNumber,
    checkinTime: room.checkinTime,
    checkoutTime: checkoutTime,
    rent: room.rent,
    advance: room.advance
  };

  data.checkoutRecords = data.checkoutRecords || [];
  data.checkoutRecords.push(checkoutRecord);

  // Update revenue
  data.payments.dayRevenue = (data.payments.dayRevenue || 0) + (room.advance + (room.rent * Math.ceil((new Date(checkoutTime) - new Date(room.checkinTime)) / (1000 * 60 * 60 * 24))));
  data.payments.monthRevenue = (data.payments.monthRevenue || 0) + (room.advance + (room.rent * Math.ceil((new Date(checkoutTime) - new Date(room.checkinTime)) / (1000 * 60 * 60 * 24))));

  data.rooms[idx] = {
    ...room,
    status: 'available',
    rent: 0,
    advance: 0,
    balance: 0,
    customerName: '',
    aadharNumber: '',
    phoneNumber: '',
    numberOfPersons: 1,
    checkinTime: '',
    checkoutTime: ''
  };

  const ok = writeData(data);
  if (!ok) {
    io.emit('roomsUpdated', data.rooms);
    return res.status(500).json({ ok: false, error: 'Failed to persist data' });
  }

  io.emit('roomsUpdated', data.rooms);
  return res.json({ ok: true, checkoutRecord });
});

// Add sub-payment
app.post('/api/payment', authMiddleware, (req, res) => {
  const { roomId, amount } = req.body || {};
  const data = readData();
  const idx = (data.rooms || []).findIndex(r => r.id === Number(roomId));
  if (idx === -1) return res.status(404).json({ error: 'Room not found' });

  const room = data.rooms[idx];
  room.balance = Math.max(0, (room.balance || 0) - Number(amount));

  data.payments.dayRevenue = (data.payments.dayRevenue || 0) + Number(amount);
  data.payments.monthRevenue = (data.payments.monthRevenue || 0) + Number(amount);

  const ok = writeData(data);
  if (!ok) {
    io.emit('roomsUpdated', data.rooms);
    return res.status(500).json({ ok: false, error: 'Failed to persist data' });
  }

  io.emit('roomsUpdated', data.rooms);
  return res.json({ ok: true, newBalance: room.balance });
});

// Shift room
app.post('/api/shift-room', authMiddleware, requireRole('Owner'), (req, res) => {
  const { fromRoomId, toRoomId } = req.body || {};
  const data = readData();

  const fromIdx = (data.rooms || []).findIndex(r => r.id === Number(fromRoomId));
  const toIdx = (data.rooms || []).findIndex(r => r.id === Number(toRoomId));

  if (fromIdx === -1 || toIdx === -1) return res.status(404).json({ error: 'Room not found' });
  if (data.rooms[toIdx].status !== 'available') return res.status(400).json({ error: 'Destination room not available' });

  const fromRoom = data.rooms[fromIdx];
  data.rooms[toIdx] = { ...fromRoom, id: toRoomId, name: data.rooms[toIdx].name };
  data.rooms[fromIdx] = {
    ...data.rooms[fromIdx],
    status: 'available',
    rent: 0,
    advance: 0,
    balance: 0,
    customerName: '',
    aadharNumber: '',
    phoneNumber: '',
    numberOfPersons: 1,
    checkinTime: '',
    checkoutTime: ''
  };

  const ok = writeData(data);
  if (!ok) {
    io.emit('roomsUpdated', data.rooms);
    return res.status(500).json({ ok: false, error: 'Failed to persist data' });
  }

  io.emit('roomsUpdated', data.rooms);
  return res.json({ ok: true });
});

// Get payments
app.get('/api/payments', authMiddleware, requireRole('Owner'), (req, res) => {
  const data = readData();
  return res.json(data.payments || {});
});

// Get customers
app.get('/api/customers', authMiddleware, requireRole('Owner'), (req, res) => {
  const data = readData();
  return res.json(data.customers || []);
});

// Get checkout records
app.get('/api/checkout-records', authMiddleware, requireRole('Owner'), (req, res) => {
  const data = readData();
  return res.json(data.checkoutRecords || []);
});

app.get('/health', (req, res) => res.json({ ok: true, now: new Date().toISOString() }));

app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
  return res.status(404).send('Not found');
});

io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    socket.user = payload;
    return next();
  } catch (e) {
    return next();
  }
});

io.on('connection', (socket) => {
  const data = readData();
  socket.emit('roomsUpdated', data.rooms || []);
  socket.emit('paymentsUpdated', data.payments || {});

  socket.on('disconnect', () => {
    console.log('Socket disconnected', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});