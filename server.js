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
const io = new Server(server, {
  cors: { origin: "*" }
});

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

/* ---------------------- UTILITIES ---------------------- */

function readData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    return { rooms: [], payments: {}, customers: [], notifications: [] };
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

/* ---------------------- AUTH MIDDLEWARE ---------------------- */

function verifyToken(req, res, next) {
  const token = req.headers["authorization"]?.split(" ")[1];

  if (!token) return res.status(401).json({ error: "No token" });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid token" });
    req.user = user;
    next();
  });
}

/* ---------------------- LOGIN ---------------------- */

app.post("/api/login", (req, res) => {
  const { username, password } = req.body;

  const USERS = {
    owner: { username: "owner", password: "owner123", role: "owner" },
    manager: { username: "manager", password: "manager123", role: "manager" }
  };

  const found = Object.values(USERS).find(
    u => u.username === username && u.password === password
  );

  if (!found) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign(
    { username: found.username, role: found.role },
    JWT_SECRET,
    { expiresIn: "12h" }
  );

  res.json({ token, role: found.role });
});

/* ---------------------- GET ROUTES ---------------------- */

app.get("/api/rooms", verifyToken, (req, res) => {
  const data = readData();
  res.json(data.rooms);
});

app.get("/api/payments", verifyToken, (req, res) => {
  const data = readData();
  res.json(data.payments);
});

app.get("/api/customers", verifyToken, (req, res) => {
  const data = readData();
  res.json(data.customers);
});

app.get("/api/notifications", verifyToken, (req, res) => {
  const data = readData();
  res.json(data.notifications);
});

/* ---------------------- ROOM UPDATE (FIXED) ---------------------- */

app.put("/api/rooms/:id", verifyToken, (req, res) => {
  const roomId = parseInt(req.params.id);
  const changes = req.body;

  const data = readData();
  const roomIndex = data.rooms.findIndex(r => r.id === roomId);

  if (roomIndex === -1)
    return res.status(404).json({ error: "Room not found" });

  const oldPaid = Number(data.rooms[roomIndex].paidAmount) || 0;
  const newPaid = Number(changes.paidAmount ?? oldPaid) || 0;

  const payDiff = newPaid - oldPaid;
  const mode = (changes.paymentMode || "").toLowerCase();

  /* ----- UPDATE THE ROOM FIELDS ----- */
  Object.keys(changes).forEach(k => {
    data.rooms[roomIndex][k] = changes[k];
  });

  /* ----- FIX: UPDATE PAYMENT COUNTERS ----- */
  if (payDiff > 0) {
    if (!data.payments) {
      data.payments = { cash: 0, upi: 0, dayRevenue: 0, monthRevenue: 0 };
    }

    // monthly & daily revenue always increase
    data.payments.dayRevenue += payDiff;
    data.payments.monthRevenue += payDiff;

    // payment mode determines cash/upi increment
    if (mode === "upi") data.payments.upi += payDiff;
    else data.payments.cash += payDiff;

    data.payments.lastUpdated = new Date().toISOString();
  }

  writeData(data);

  // Send updates to all clients
  io.emit("roomsUpdated", data.rooms);
  io.emit("paymentsUpdated", data.payments);

  res.json({ success: true, room: data.rooms[roomIndex] });
});

/* ---------------------- PAYMENTS API (unchanged) ---------------------- */

app.post("/api/payments", verifyToken, (req, res) => {
  const { amount, mode } = req.body;

  const data = readData();

  if (!data.payments) {
    data.payments = { cash: 0, upi: 0, dayRevenue: 0, monthRevenue: 0 };
  }

  const val = Number(amount) || 0;

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
