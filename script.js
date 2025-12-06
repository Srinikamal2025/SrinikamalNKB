/* Clean, corrected script.js for Hotel System
   Features:
   - JWT Login only
   - Customer-details block appears when room = occupied
   - Socket.IO real-time update
   - Safe customerDB + rooms fallback
   Backend: https://srinikamalnkb.onrender.com
*/

/* -------------------- CONFIG -------------------- */
const API_BASE = "https://srinikamalnkb.onrender.com";
const API = API_BASE + "/api";
const SOCKET_URL = API_BASE;

/* -------------------- AUTH HELPERS -------------------- */
function getToken() { return localStorage.getItem("authToken") || ""; }
function setToken(t) { t ? localStorage.setItem("authToken", t) : localStorage.removeItem("authToken"); }
function getRole() { return localStorage.getItem("userRole") || ""; }
function setRole(r) { r ? localStorage.setItem("userRole", r) : localStorage.removeItem("userRole"); }

function authHeader() {
  const token = getToken();
  return token
    ? { "Authorization": "Bearer " + token, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

async function fetchWithAuth(url, opts = {}) {
  opts.headers = { ...(opts.headers || {}), ...authHeader() };
  const res = await fetch(url, opts);
  if (res.status === 401 || res.status === 403) logout(true);
  return res;
}

/* -------------------- SOCKET.IO -------------------- */
let socket = null;

function connectSocket() {
  try { if (socket && socket.connected) socket.disconnect(); } catch {}

  socket = io(SOCKET_URL, { auth: { token: getToken() } });

  socket.on("roomsUpdated", arr => { if (Array.isArray(arr)) { rooms = arr; saveLocal(); renderRooms(); updateStats(); updateDuePaymentsTable(); updateTotalDue(); }});
  socket.on("paymentsUpdated", p => { payments = p; saveLocal(); updatePaymentCounters(); });
  socket.on("customersUpdated", c => { customersDB = c; saveLocal(); });
  socket.on("notificationsUpdated", n => { notifications = n; saveLocal(); updateNotificationBadge(); loadNotifications(); });
}

/* -------------------- LOCAL FALLBACK -------------------- */
let rooms = JSON.parse(localStorage.getItem("hotelRooms") || "[]");
let payments = JSON.parse(localStorage.getItem("hotelPayments") || "{}");
let customersDB = JSON.parse(localStorage.getItem("hotelCustomersDB") || "[]");
let notifications = JSON.parse(localStorage.getItem("hotelNotifications") || "[]");

if (!Array.isArray(customersDB)) customersDB = [];

function saveLocal() {
  localStorage.setItem("hotelRooms", JSON.stringify(rooms));
  localStorage.setItem("hotelPayments", JSON.stringify(payments));
  localStorage.setItem("hotelCustomersDB", JSON.stringify(customersDB));
  localStorage.setItem("hotelNotifications", JSON.stringify(notifications));
}

function generateDefaultRooms() {
  const arr = [];
  for (let i = 1; i <= 29; i++) {
    arr.push({
      id: i,
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
    });
  }
  rooms = arr;
  saveLocal();
  return arr;
}

/* -------------------- LOGIN -------------------- */
document.getElementById("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const u = document.getElementById("username").value.trim();
  const p = document.getElementById("password").value.trim();

  if (!u || !p) return showNotification("Enter username/password", "error");

  try {
    const res = await fetch(`${API}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: u, password: p })
    });

    const data = await res.json();
    if (!res.ok) return showNotification(data.error || "Login failed", "error");

    setToken(data.token);
    setRole(data.role);

    document.getElementById("loginScreen").classList.add("hidden");
    document.getElementById("dashboardScreen").classList.remove("hidden");

    if (data.role === "Owner")
      document.getElementById("dashboardScreen").classList.add("owner-visible");

    document.getElementById("userRole").textContent = data.role;
    connectSocket();

    await loadInitialData();
    showNotification("Login successful", "success");
  } catch {
    showNotification("Server unreachable", "error");
  }
});

/* Auto-login if token exists */
if (getToken()) {
  connectSocket();
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("dashboardScreen").classList.remove("hidden");
  const role = getRole();
  if (role === "Owner")
    document.getElementById("dashboardScreen").classList.add("owner-visible");
  document.getElementById("userRole").textContent = role;
  loadInitialData();
}

/* -------------------- LOAD DATA -------------------- */
async function loadInitialData() {
  try {
    const r = await fetchWithAuth(`${API}/rooms`);
    if (r.ok) rooms = await r.json();
  } catch { if (!rooms.length) generateDefaultRooms(); }

  try {
    const p = await fetchWithAuth(`${API}/payments`);
    if (p.ok) payments = await p.json();
  } catch {}

  try {
    const c = await fetchWithAuth(`${API}/customers`);
    if (c.ok) customersDB = await c.json();
    if (!Array.isArray(customersDB)) customersDB = [];
  } catch {}

  try {
    const n = await fetchWithAuth(`${API}/notifications`);
    if (n.ok) notifications = await n.json();
  } catch {}

  saveLocal();
  applyDataToUI();
}

function applyDataToUI() {
  renderRooms();
  updateStats();
  updatePaymentCounters();
  updateDuePaymentsTable();
  updateTotalDue();
  updateNotificationBadge();
  loadNotifications();
}

/* -------------------- RENDER ROOMS -------------------- */
function renderRooms() {
  const grid = document.getElementById("roomGrid");
  grid.innerHTML = "";

  rooms.forEach(room => {
    const box = document.createElement("div");
    box.className = `room-box p-4 text-white cursor-pointer ${room.status}`;
    box.onclick = () => openRoomModal(room.id);

    box.innerHTML = `
      <div class="text-center">
        <i class="fas fa-bed text-2xl mb-2"></i>
        <p class="font-bold">Room ${room.id}</p>
        <p class="text-xs capitalize">${room.status}</p>
        <p class="text-xs mt-1">₹${room.price}/day</p>
        ${room.customerName ? `<p class="text-xs mt-1">${room.customerName}</p>` : ""}
        ${room.dueAmount > 0 ? `<p class="text-xs text-red-300 font-bold">Due: ₹${room.dueAmount}</p>` : ""}
      </div>
    `;

    grid.appendChild(box);
  });
}

/* -------------------- UPDATE STATS -------------------- */
function updateStats() {
  document.getElementById("availableCount").textContent =
    rooms.filter(r => r.status === "available").length;
  document.getElementById("occupiedCount").textContent =
    rooms.filter(r => r.status === "occupied").length;
  document.getElementById("maintenanceCount").textContent =
    rooms.filter(r => r.status === "maintenance").length;
}

/* -------------------- OPEN ROOM MODAL -------------------- */
function openRoomModal(roomId) {
  const room = rooms.find(r => r.id === roomId);
  if (!room) return;

  document.getElementById("roomId").value = room.id;
  document.getElementById("roomStatus").value = room.status;
  document.getElementById("roomPrice").value = room.price;

  document.getElementById("customerName").value = room.customerName || "";
  document.getElementById("numberOfPersons").value = room.numberOfPersons || 1;
  document.getElementById("aadharNumber").value = room.aadharNumber || "";
  document.getElementById("phoneNumber").value = room.phoneNumber || "";
  document.getElementById("checkinTime").value = room.checkinTime || "";
  document.getElementById("checkoutTime").value = room.checkoutTime || "";
  document.getElementById("paymentMode").value = room.paymentMode || "";
  document.getElementById("paidAmount").value = room.paidAmount || 0;

  /* FIX: Show customer details when occupied */
  const customerBlock = document.getElementById("customerDetails");
  customerBlock.style.display = room.status === "occupied" ? "block" : "none";

  calculateTotalAmount();

  document.getElementById("roomModal").classList.remove("hidden");
}

/* -------------------- ROOM STATUS CHANGE SHOW/HIDE CUSTOMER BLOCK -------------------- */
document.getElementById("roomStatus").addEventListener("change", function () {
  document.getElementById("customerDetails").style.display =
    this.value === "occupied" ? "block" : "none";
});

/* -------------------- CALCULATE AMOUNT -------------------- */
function calculateTotalAmount() {
  const roomPrice = parseInt(document.getElementById("roomPrice").value) || 0;
  const ci = new Date(document.getElementById("checkinTime").value);
  const co = new Date(document.getElementById("checkoutTime").value);

  let total = 0;

  if (ci && co && co > ci) {
    const days = Math.max(1, Math.ceil((co - ci) / (1000 * 60 * 60 * 24)));
    total = days * roomPrice;
  }

  const paid = parseInt(document.getElementById("paidAmount").value) || 0;
  const due = Math.max(0, total - paid);

  document.getElementById("totalAmount").textContent = `₹${total}`;
  document.getElementById("dueAmount").textContent = `₹${due}`;
}

document.getElementById("paidAmount").addEventListener("input", calculateTotalAmount);
document.getElementById("roomPrice").addEventListener("input", calculateTotalAmount);
document.getElementById("checkinTime").addEventListener("change", calculateTotalAmount);
document.getElementById("checkoutTime").addEventListener("change", calculateTotalAmount);
/* -------------------- ROOM FORM SUBMIT -------------------- */
document.getElementById("roomForm").addEventListener("submit", async function (e) {
  e.preventDefault();

  const roomId = Number(document.getElementById("roomId").value);
  const idx = rooms.findIndex(r => r.id === roomId);
  if (idx === -1) return showNotification("Room not found", "error");

  const status = document.getElementById("roomStatus").value;
  const price = parseInt(document.getElementById("roomPrice").value) || 0;
  const customerName = document.getElementById("customerName").value.trim();
  const numberOfPersons = Number(document.getElementById("numberOfPersons").value) || 1;
  const aadharNumber = document.getElementById("aadharNumber").value.trim();
  const phoneNumber = document.getElementById("phoneNumber").value.trim();
  const checkinTime = document.getElementById("checkinTime").value;
  const checkoutTime = document.getElementById("checkoutTime").value;
  const paymentMode = document.getElementById("paymentMode").value || "";
  const paidAmount = Number(document.getElementById("paidAmount").value) || 0;

  // compute total/due
  let totalAmount = 0;
  if (status === "occupied" && checkinTime && checkoutTime) {
    const ci = new Date(checkinTime), co = new Date(checkoutTime);
    if (ci < co) {
      const days = Math.max(1, Math.ceil((co - ci) / (1000 * 60 * 60 * 24)));
      totalAmount = days * price;
    }
  }
  const dueAmount = Math.max(0, totalAmount - paidAmount);

  // prepare updated room object
  const updated = {
    ...rooms[idx],
    status, price, customerName, numberOfPersons, aadharNumber, phoneNumber,
    checkinTime, checkoutTime, paymentMode, totalAmount, paidAmount, dueAmount
  };

  // update customer DB locally
  if (aadharNumber) {
    let cust = customersDB.find(c => c.aadhar === aadharNumber);
    if (!cust) {
      cust = { id: Date.now().toString(36), name: customerName, aadhar: aadharNumber, phoneNumber, history: [] };
      customersDB.push(cust);
    }
    if (status === "occupied") {
      cust.history = cust.history || [];
      cust.history.push({ roomId, checkinTime, checkoutTime, totalAmount, paidAmount, dueAmount });
    }
  }

  // try to persist to server
  try {
    const res = await fetchWithAuth(`${API}/rooms/${roomId}`, {
      method: "PUT",
      body: JSON.stringify(updated)
    });
    if (!res.ok) throw new Error("Server PUT failed");

    // optimistic update (server will broadcast too)
    rooms[idx] = updated;
    saveLocal();
    renderRooms();
    updateStats();
    updatePaymentCounters();
    updateDuePaymentsTable();
    updateTotalDue();
    document.getElementById("roomModal").classList.add("hidden");
    showNotification("Room updated", "success");
  } catch (err) {
    console.warn("Room update failed, saved locally", err);
    rooms[idx] = updated;
    saveLocal();
    renderRooms();
    updateStats();
    updateDuePaymentsTable();
    updateTotalDue();
    document.getElementById("roomModal").classList.add("hidden");
    showNotification("Room updated locally (server offline)", "error");
  }
});

/* -------------------- PAYMENTS -------------------- */
function openPaymentModal(roomId) {
  if (getRole() !== "Owner") { showNotification("Only owner can update payments", "error"); return; }
  const room = rooms.find(r => r.id === roomId);
  if (!room) return;
  document.getElementById("paymentRoomId").value = room.id;
  document.getElementById("paymentRoomNumber").textContent = room.id;
  document.getElementById("paymentCustomerName").textContent = room.customerName || "-";
  document.getElementById("paymentTotalAmount").textContent = `₹${room.totalAmount || 0}`;
  document.getElementById("paymentAlreadyPaid").textContent = `₹${room.paidAmount || 0}`;
  document.getElementById("paymentDueAmount").textContent = `₹${room.dueAmount || 0}`;
  document.getElementById("additionalPayment").value = "";
  document.getElementById("additionalPaymentMode").value = "cash";
  document.getElementById("paymentModal").classList.remove("hidden");
}
function closePaymentModal() { document.getElementById("paymentModal").classList.add("hidden"); }

document.getElementById("paymentForm").addEventListener("submit", async function (e) {
  e.preventDefault();
  if (getRole() !== "Owner") return showNotification("Only owner can accept payments", "error");

  const roomId = Number(document.getElementById("paymentRoomId").value);
  const idx = rooms.findIndex(r => r.id === roomId);
  if (idx === -1) return;

  const amount = Number(document.getElementById("additionalPayment").value) || 0;
  const mode = document.getElementById("additionalPaymentMode").value || "cash";
  if (amount <= 0) return showNotification("Enter an amount", "error");

  // update local room
  rooms[idx].paidAmount = (rooms[idx].paidAmount || 0) + amount;
  rooms[idx].dueAmount = Math.max(0, (rooms[idx].totalAmount || 0) - rooms[idx].paidAmount);

  try {
    const res = await fetchWithAuth(`${API}/payments`, {
      method: "POST",
      body: JSON.stringify({ amount, mode, roomId })
    });
    if (!res.ok) throw new Error("Payments API failed");

    // update room on server too
    try { await fetchWithAuth(`${API}/rooms/${roomId}`, { method: "PUT", body: JSON.stringify(rooms[idx]) }); } catch {}
    saveLocal();
    renderRooms();
    updatePaymentCounters();
    updateDuePaymentsTable();
    updateTotalDue();
    closePaymentModal();
    showNotification(`Payment ₹${amount} recorded`, "success");
    addNotification(`Payment of ₹${amount} received for Room ${roomId} via ${mode}`);
  } catch (err) {
    console.warn("Payment failed, saved locally", err);
    saveLocal();
    renderRooms();
    updatePaymentCounters();
    updateDuePaymentsTable();
    updateTotalDue();
    closePaymentModal();
    showNotification("Payment saved locally (server offline)", "error");
  }
});

/* -------------------- CUSTOMERS -------------------- */
function openAllCustomersModal() {
  if (getRole() !== "Owner") { showNotification("Only owner can view customers", "error"); return; }
  document.getElementById("allCustomersModal").classList.remove("hidden");
  renderAllCustomers();
}
function closeAllCustomersModal() { document.getElementById("allCustomersModal").classList.add("hidden"); }

function renderAllCustomers() {
  const table = document.getElementById("allCustomersTable");
  if (!table) return;
  table.innerHTML = "";
  if (!customersDB || customersDB.length === 0) {
    document.getElementById("noCustomersFound").classList.remove("hidden");
    return;
  }
  document.getElementById("noCustomersFound").classList.add("hidden");
  customersDB.forEach(c => {
    const row = document.createElement("tr");
    const lastVisit = c.history && c.history.length ? new Date(c.history[c.history.length-1].checkinTime).toLocaleDateString() : 'No visits';
    row.innerHTML = `
      <td class="px-6 py-4">${escapeHtml(c.name)}</td>
      <td class="px-6 py-4">${escapeHtml(c.aadhar)}</td>
      <td class="px-6 py-4">${escapeHtml(c.phoneNumber || '-')}</td>
      <td class="px-6 py-4">${c.history ? c.history.length : 0}</td>
      <td class="px-6 py-4">${lastVisit}</td>
      <td class="px-6 py-4"><button class="text-blue-600" onclick="viewCustomerDetails('${c.aadhar}')">View</button></td>
    `;
    table.appendChild(row);
  });
}

function viewCustomerDetails(aadhar) {
  const c = customersDB.find(x => x.aadhar === aadhar);
  if (!c) return showNotification("Customer not found", "error");
  closeAllCustomersModal();
  const avail = rooms.find(r => r.status === 'available');
  if (avail) {
    openRoomModal(avail.id);
    setTimeout(() => {
      document.getElementById("customerName").value = c.name;
      document.getElementById("aadharNumber").value = c.aadhar;
      document.getElementById("phoneNumber").value = c.phoneNumber || '';
      showCustomerHistory(c);
    }, 150);
  } else showNotification("No available rooms", "error");
}

/* -------------------- CUSTOMER HISTORY DISPLAY -------------------- */
function showCustomerHistory(customer) {
  const section = document.getElementById("customerHistorySection");
  const table = document.getElementById("customerHistoryTable");
  const noHistory = document.getElementById("noCustomerHistory");
  if (!section || !table || !noHistory) return;
  section.classList.remove("hidden");
  table.innerHTML = "";
  if (!customer.history || customer.history.length === 0) {
    noHistory.classList.remove("hidden");
    return;
  }
  noHistory.classList.add("hidden");
  customer.history.forEach(b => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="px-4 py-2">${b.roomId}</td>
      <td class="px-4 py-2">${new Date(b.checkinTime).toLocaleDateString()}</td>
      <td class="px-4 py-2">${new Date(b.checkoutTime).toLocaleDateString()}</td>
      <td class="px-4 py-2">₹${b.totalAmount}</td>
      <td class="px-4 py-2">${b.dueAmount > 0 ? '<span class="text-red-600">Due</span>' : '<span class="text-green-600">Paid</span>'}</td>
    `;
    table.appendChild(tr);
  });
}

/* -------------------- NOTIFICATIONS -------------------- */
function updateNotificationBadge() {
  const badge = document.getElementById("notificationBadge");
  if (!badge) return;
  if (notifications && notifications.length) {
    badge.textContent = notifications.length;
    badge.classList.remove("hidden");
  } else badge.classList.add("hidden");
}

function loadNotifications() {
  const list = document.getElementById("notificationList");
  if (!list) return;
  list.innerHTML = "";
  if (!notifications || notifications.length === 0) {
    list.innerHTML = '<p class="p-4 text-gray-500 text-center">No notifications</p>';
    return;
  }
  notifications.forEach(n => {
    const d = document.createElement("div");
    d.className = 'p-4 border-b hover:bg-gray-50';
    d.innerHTML = `<p class="text-gray-800">${escapeHtml(n.message)}</p><p class="text-xs text-gray-500 mt-2">${new Date(n.timestamp).toLocaleString()}</p>`;
    list.appendChild(d);
  });
}

function addNotification(message) {
  const n = { message, timestamp: new Date().toISOString() };
  notifications.push(n);
  saveLocal();
  updateNotificationBadge();
  // attempt server call (owner only)
  fetchWithAuth(`${API}/payments`, {
    method: "POST",
    body: JSON.stringify({ amount: 0, mode: "", message })
  }).catch(()=>{});
}

/* -------------------- CLEAR NOTIFICATIONS (Owner) -------------------- */
function clearAllNotifications() {
  if (getRole() !== "Owner") return showNotification("Only owner can clear notifications", "error");
  showConfirmModal("Clear all notifications?", async () => {
    try {
      const res = await fetchWithAuth(`${API}/notifications`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed");
      notifications = [];
      saveLocal();
      updateNotificationBadge();
      loadNotifications();
      showNotification("Notifications cleared", "success");
    } catch (e) {
      notifications = [];
      saveLocal();
      updateNotificationBadge();
      loadNotifications();
      showNotification("Notifications cleared locally", "success");
    }
  });
}

/* -------------------- HELPERS -------------------- */
function escapeHtml(str) {
  if (str === undefined || str === null) return "";
  return String(str).replace(/[&<>"'`=\/]/g, function (s) {
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '/': '&#x2F;', '`': '&#x60;', '=': '&#x3D;' })[s];
  });
}

function showNotification(message, type = "success") {
  const n = document.createElement("div");
  n.className = `fixed top-4 right-4 px-6 py-3 rounded-lg shadow-lg text-white z-50 ${type === 'success' ? 'bg-green-500' : 'bg-red-500'}`;
  n.innerHTML = `<div class="flex items-center"><i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'} mr-2"></i>${escapeHtml(message)}</div>`;
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 3000);
}

function showConfirmModal(message, onConfirm) {
  const modal = document.getElementById("confirmModal");
  const msg = document.getElementById("confirmMessage");
  const yes = document.getElementById("confirmYes");
  const no = document.getElementById("confirmNo");
  if (!modal) { if (onConfirm) onConfirm(); return; }
  msg.textContent = message;
  modal.classList.remove("hidden");

  // replace listeners
  const yesNew = yes.cloneNode(true);
  yes.parentNode.replaceChild(yesNew, yes);
  const noNew = no.cloneNode(true);
  no.parentNode.replaceChild(noNew, no);

  yesNew.addEventListener("click", () => { onConfirm && onConfirm(); modal.classList.add("hidden"); });
  noNew.addEventListener("click", () => modal.classList.add("hidden"));
}

/* -------------------- LOGOUT -------------------- */
document.getElementById("logoutBtn") && document.getElementById("logoutBtn").addEventListener("click", () => {
  setToken("");
  setRole("");
  try { if (socket) socket.disconnect(); } catch {}
  document.getElementById("dashboardScreen").classList.add("hidden");
  document.getElementById("loginScreen").classList.remove("hidden");
  document.getElementById("dashboardScreen").classList.remove("owner-visible");
});

/* -------------------- INIT -------------------- */
document.addEventListener("DOMContentLoaded", () => {
  // set default checkin/checkout
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  const ci = document.getElementById("checkinTime");
  const co = document.getElementById("checkoutTime");
  if (ci) ci.value = now.toISOString().slice(0,16);
  if (co) {
    const t = new Date(now);
    t.setDate(t.getDate() + 1);
    co.value = t.toISOString().slice(0,16);
  }

  // initial local render
  if (!rooms || !rooms.length) generateDefaultRooms();
  applyDataToUI();
});
