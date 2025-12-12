const fs = require("fs");
const path = require("path");
const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

const JWT_SECRET = "hotel_management_secret";
const DATA_FILE = path.join(__dirname, "data.json");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

/* ---------------------- UTILITIES ---------------------- */

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (err) {
    return {
      rooms: [],
      payments: { cash: 0, upi: 0, dayRevenue: 0, monthRevenue: 0 },
      customers: [],
      notifications: []
    };
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token" });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid token" });
    req.user = user;
    next();
  });
}

/* ---------------------- LOGIN ---------------------- */

app.post("/api/login", (req, res) => {
  const USERS = {
    owner: { username: "owner", password: "owner123", role: "owner" },
    manager: { username: "manager", password: "manager123", role: "manager" }
  };

  const { username, password } = req.body;
  const u = USERS[username];

  if (!u || u.password !== password)
    return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign({ username: u.username, role: u.role }, JWT_SECRET, {
    expiresIn: "12h"
  });

  res.json({ token, role: u.role });
});

/* ---------------------- GET ROUTES ---------------------- */

app.get("/api/rooms", verifyToken, (req, res) => {
  res.json(readData().rooms);
});

app.get("/api/payments", verifyToken, (req, res) => {
  res.json(readData().payments);
});

app.get("/api/customers", verifyToken, (req, res) => {
  const data = readData();
  res.json(data.customers);
});

app.get("/api/notifications", verifyToken, (req, res) => {
  res.json(readData().notifications);
});

/* ---------------------- SAVE CUSTOMER ENTRY ---------------------- */

function saveOrUpdateCustomer(data, room) {
  const customers = data.customers;

  const existing = customers.find(c => c.roomNumber === room.roomNumber);

  if (existing) {
    existing.customerName = room.customerName;
    existing.totalAmount = room.totalAmount;
    existing.paidAmount = room.paidAmount;
    existing.dueAmount = room.totalAmount - room.paidAmount;
    existing.phone = room.phone || "";
    existing.checkIn = room.checkIn || "";
    existing.checkOut = room.checkOut || "";
  } else {
    customers.push({
      roomNumber: room.roomNumber,
      customerName: room.customerName,
      totalAmount: room.totalAmount,
      paidAmount: room.paidAmount,
      dueAmount: room.totalAmount - room.paidAmount,
      phone: room.phone || "",
      checkIn: room.checkIn || "",
      checkOut: room.checkOut || ""
    });
  }
}

/* ---------------------- UPDATE ROOM (FIXED + RESTORED) ---------------------- */

app.put("/api/rooms/:id", verifyToken, (req, res) => {
  const id = parseInt(req.params.id);
  const incoming = req.body;

  const data = readData();
  const roomIndex = data.rooms.findIndex(r => r.id === id);

  if (roomIndex === -1) return res.status(404).json({ error: "Room not found" });

  const room = data.rooms[roomIndex];

  /* ----- PAYDIFF (new – old) ----- */
  const oldPaid = Number(room.paidAmount) || 0;
  const newPaid = Number(incoming.paidAmount ?? oldPaid) || 0;
  const payDiff = newPaid - oldPaid;

  /* ----- APPLY ALL CHANGES ----- */
  Object.keys(incoming).forEach(k => {
    room[k] = incoming[k];
  });

  /* ----- RESTORED: CUSTOMER DATABASE HANDLING ----- */
  if (room.customerName && room.status === "occupied") {
    saveOrUpdateCustomer(data, room);
  }

  /* ----- PAYMENT FIX RESTORED + IMPROVED ----- */
  if (!data.payments) {
    data.payments = { cash: 0, upi: 0, dayRevenue: 0, monthRevenue: 0 };
  }

  if (payDiff > 0) {
    const mode = (incoming.paymentMode || room.paymentMode || "cash").toLowerCase();

    data.payments.dayRevenue += payDiff;
    data.payments.monthRevenue += payDiff;

    if (mode === "upi") data.payments.upi += payDiff;
    else data.payments.cash += payDiff;

    data.payments.lastUpdated = new Date().toISOString();
  }

  writeData(data);

  io.emit("roomsUpdated", data.rooms);
  io.emit("paymentsUpdated", data.payments);
  io.emit("customersUpdated", data.customers);

  res.json({ success: true, room });
});

/* ---------------------- PAYMENT API (unchanged & working) ---------------------- */

app.post("/api/payments", verifyToken, (req, res) => {
  const { amount, mode } = req.body;
  const val = Number(amount) || 0;

  const data = readData();

  if (!data.payments) {
    data.payments = { cash: 0, upi: 0, dayRevenue: 0, monthRevenue: 0 };
  }

  if (mode === "upi") data.payments.upi += val;
  else data.payments.cash += val;

  data.payments.dayRevenue += val;
  data.payments.monthRevenue += val;
  data.payments.lastUpdated = new Date().toISOString();

  writeData(data);
  io.emit("paymentsUpdated", data.payments);

  res.json({ success: true, payments: data.payments });
});

/* ---------------------- SERVER START ---------------------- */

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server running on port", PORT));
