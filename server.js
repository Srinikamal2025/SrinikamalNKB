const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('http');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const PDFDocument = require('pdfkit');

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

// User credentials mapping
const USERS = {
  'nkb': { role: 'Owner', passcode: '2021' },
  'm2026': { role: 'Manager', passcode: '1234' }
};

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
    room.customerName = room.customerName || '';
    room.aadharNumber = room.aadharNumber || '';
    room.phoneNumber = room.phoneNumber || '';
    room.numberOfPersons = Number(room.numberOfPersons) || 1;
    room.checkinTime = room.checkinTime || '';
    room.checkoutTime = room.checkoutTime || '';
    return room;
  });

  data.payments = data.payments || { dayRevenue: 0, monthRevenue: 0 };
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
    const defaultData = {
      rooms: Array.from({ length: 29 }, (_, i) => ({ id: i + 1 })),
      payments: { dayRevenue: 0, monthRevenue: 0 },
      customers: [],
      checkoutRecords: []
    };
    ensureRoomDefaults(defaultData);
    writeData(defaultData);
    return defaultData;
  }
}

// Helper function to dynamically calculate balance based on actual days stayed
function getRoomBalance(room) {
  if (room.status !== 'occupied' || !room.checkinTime) return 0;
  const checkin = new Date(room.checkinTime);
  const now = new Date();
  
  // Calculate days stayed (minimum 1 day)
  let days = Math.ceil((now.getTime() - checkin.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 1) days = 1;
  
  const totalRent = room.rent * days;
  return totalRent - room.advance; 
}

// Inject live balances into rooms before sending to frontend
function getDynamicRooms(data) {
  return (data.rooms || []).map(r => ({ ...r, balance: getRoomBalance(r) }));
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

app.post('/api/login', (req, res) => {
  const { username, passcode } = req.body || {};
  if (!username || !passcode) return res.status(400).json({ error: 'username & passcode required' });

  const user = USERS[username.toLowerCase()]; 
  if (!user || String(user.passcode) !== String(passcode)) {
      return res.status(401).json({ error: 'Invalid username or passcode' });
  }

  const token = createToken(user.role);
  return res.json({ token, role: user.role });
});

app.get('/api/rooms', authMiddleware, (req, res) => {
  const data = readData();
  return res.json(getDynamicRooms(data));
});

// Update room (Check-in)
app.put('/api/rooms/:id', authMiddleware, (req, res) => {
  const roomId = parseInt(req.params.id);
  const payload = req.body || {};
  const data = readData();
  const idx = data.rooms.findIndex(r => r.id === roomId);
  if (idx === -1) return res.status(404).json({ error: 'Room not found' });

  // Detect if this is a fresh check-in to apply advance to revenue immediately
  const isNewCheckin = payload.status === 'occupied' && data.rooms[idx].status === 'available';

  const allowed = ['status', 'rent', 'advance', 'customerName', 'aadharNumber', 'phoneNumber', 'numberOfPersons', 'checkinTime'];
  allowed.forEach(k => {
    if (k in payload) {
      if (['rent', 'advance', 'numberOfPersons'].includes(k)) data.rooms[idx][k] = Number(payload[k]) || 0;
      else data.rooms[idx][k] = payload[k];
    }
  });

  // Add initial advance to revenue
  if (isNewCheckin) {
    data.payments.dayRevenue = (data.payments.dayRevenue || 0) + data.rooms[idx].advance;
    data.payments.monthRevenue = (data.payments.monthRevenue || 0) + data.rooms[idx].advance;
  }

  const ok = writeData(data);
  const dynamicRooms = getDynamicRooms(data);
  io.emit('roomsUpdated', dynamicRooms);
  io.emit('paymentsUpdated', data.payments);
  
  if (!ok) return res.status(500).json({ ok: false, error: 'Failed to persist data' });
  return res.json({ ok: true, room: dynamicRooms[idx] });
});

// Checkout room
app.post('/api/checkout/:id', authMiddleware, requireRole('Owner'), (req, res) => {
  const roomId = parseInt(req.params.id);
  const data = readData();
  const idx = data.rooms.findIndex(r => r.id === roomId);
  if (idx === -1) return res.status(404).json({ error: 'Room not found' });

  const room = data.rooms[idx];
  const liveBalance = getRoomBalance(room);
  
  if (liveBalance > 0) return res.status(400).json({ error: `Cannot checkout: Balance pending (₹${liveBalance})` });

  const checkoutTime = new Date().toISOString();
  data.checkoutRecords.push({
    roomNumber: room.name,
    customerName: room.customerName,
    aadharNumber: room.aadharNumber,
    phoneNumber: room.phoneNumber,
    checkinTime: room.checkinTime,
    checkoutTime: checkoutTime,
    rent: room.rent,
    advance: room.advance
  });

  // Reset room
  data.rooms[idx] = {
    ...room,
    status: 'available',
    rent: 0,
    advance: 0,
    customerName: '',
    aadharNumber: '',
    phoneNumber: '',
    numberOfPersons: 1,
    checkinTime: '',
    checkoutTime: ''
  };

  writeData(data);
  io.emit('roomsUpdated', getDynamicRooms(data));
  return res.json({ ok: true });
});

// Add sub-payment (Adds to advance and revenue immediately)
app.post('/api/payment', authMiddleware, (req, res) => {
  const { roomId, amount } = req.body || {};
  const data = readData();
  const idx = data.rooms.findIndex(r => r.id === Number(roomId));
  if (idx === -1) return res.status(404).json({ error: 'Room not found' });

  // Subpayments add directly to the total advance paid
  data.rooms[idx].advance = (data.rooms[idx].advance || 0) + Number(amount);

  // Instantly apply to revenue
  data.payments.dayRevenue = (data.payments.dayRevenue || 0) + Number(amount);
  data.payments.monthRevenue = (data.payments.monthRevenue || 0) + Number(amount);

  writeData(data);
  
  const dynamicRooms = getDynamicRooms(data);
  io.emit('roomsUpdated', dynamicRooms);
  io.emit('paymentsUpdated', data.payments);
  
  return res.json({ ok: true, newBalance: dynamicRooms[idx].balance });
});

app.post('/api/shift-room', authMiddleware, requireRole('Owner'), (req, res) => {
  const { fromRoomId, toRoomId } = req.body || {};
  const data = readData();

  const fromIdx = data.rooms.findIndex(r => r.id === Number(fromRoomId));
  const toIdx = data.rooms.findIndex(r => r.id === Number(toRoomId));

  if (fromIdx === -1 || toIdx === -1) return res.status(404).json({ error: 'Room not found' });
  if (data.rooms[toIdx].status !== 'available') return res.status(400).json({ error: 'Destination room not available' });

  const fromRoom = data.rooms[fromIdx];
  data.rooms[toIdx] = { ...fromRoom, id: toRoomId, name: data.rooms[toIdx].name };
  data.rooms[fromIdx] = {
    ...data.rooms[fromIdx], status: 'available', rent: 0, advance: 0, customerName: '', aadharNumber: '', phoneNumber: '', numberOfPersons: 1, checkinTime: '', checkoutTime: ''
  };

  writeData(data);
  io.emit('roomsUpdated', getDynamicRooms(data));
  return res.json({ ok: true });
});

app.get('/api/payments', authMiddleware, requireRole('Owner'), (req, res) => {
  return res.json(readData().payments || {});
});

// Export PDF Reports (Manager can export Customers, Owner can export all)
app.get('/api/export/:type', authMiddleware, (req, res) => {
  const { type } = req.params;
  
  // Security Check
  if (type !== 'customers' && req.user.role !== 'Owner') {
      return res.status(403).json({ error: 'Forbidden: Owners only' });
  }

  const data = readData();
  const doc = new PDFDocument({ margin: 50 });
  const filename = `${type}-report-${Date.now()}.pdf`;
  
  res.setHeader('Content-disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-type', 'application/pdf');
  
  doc.pipe(res);
  
  doc.fontSize(20).text('Srini Kamal Residency', { align: 'center' }).moveDown(0.5);
  doc.fontSize(14).text(`Report: ${type.toUpperCase()}`, { align: 'center' });
  doc.fontSize(10).text(`Generated on: ${new Date().toLocaleString()}`, { align: 'center' }).moveDown(2);
  doc.fontSize(12);

  if (type === 'customers') {
    doc.fontSize(14).text('Current Guests (Occupied Rooms)', { underline: true }).moveDown();
    const occupied = data.rooms.filter(r => r.status === 'occupied');
    
    if (occupied.length === 0) doc.text('No current guests.');
    else {
      occupied.forEach(r => {
        doc.text(`Room ${r.name}: ${r.customerName}`);
        doc.fontSize(10).text(`Phone: ${r.phoneNumber} | Aadhar: ${r.aadharNumber} | Check-in: ${new Date(r.checkinTime).toLocaleString()}`).moveDown(0.5);
        doc.fontSize(12);
      });
    }

    // Now include past checked-out customers
    doc.moveDown(2);
    doc.fontSize(14).text('Past Guests (Checked Out)', { underline: true }).moveDown();
    const past = data.checkoutRecords || [];
    
    if (past.length === 0) doc.text('No past guest records found.');
    else {
      past.forEach(r => {
        doc.text(`Room ${r.roomNumber}: ${r.customerName}`);
        doc.fontSize(10).text(`Phone: ${r.phoneNumber} | Aadhar: ${r.aadharNumber} | Check-in: ${new Date(r.checkinTime).toLocaleString()} | Check-out: ${new Date(r.checkoutTime).toLocaleString()}`).moveDown(0.5);
        doc.fontSize(12);
      });
    }

  } else if (type === 'balances') {
    doc.fontSize(14).text('Outstanding Room Balances', { underline: true }).moveDown();
    const dueRooms = getDynamicRooms(data).filter(r => r.balance > 0);
    
    if (dueRooms.length === 0) doc.text('No outstanding balances. All clear!');
    else {
      let totalDue = 0;
      dueRooms.forEach(r => {
        totalDue += r.balance;
        doc.text(`Room ${r.name} (${r.customerName}): Rs. ${r.balance}`).moveDown(0.5);
      });
      doc.moveDown().font('Helvetica-Bold').text(`Total Outstanding: Rs. ${totalDue}`);
    }
  } else if (type === 'daily') {
    doc.fontSize(14).text('Daily Revenue Report', { underline: true }).moveDown();
    doc.text(`Total Daily Revenue: Rs. ${data.payments.dayRevenue || 0}`);
  } else if (type === 'monthly') {
    doc.fontSize(14).text('Monthly Revenue Report', { underline: true }).moveDown();
    doc.text(`Total Monthly Revenue: Rs. ${data.payments.monthRevenue || 0}`);
  }
  
  doc.end();
});

io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  if (!token) return next();
  try {
    socket.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (e) { return next(); }
});

io.on('connection', (socket) => {
  const data = readData();
  socket.emit('roomsUpdated', getDynamicRooms(data));
  socket.emit('paymentsUpdated', data.payments || {});
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
