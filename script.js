/* Cleaned script.js — JWT-only frontend for Render backend
   Backend base: https://srinikamalnkb.onrender.com
   Token stored in localStorage: authToken
   Role stored in localStorage: userRole
*/

// ========== CONFIG ==========
const API_BASE = "https://srinikamalnkb.onrender.com";
const API = API_BASE + "/api";
const SOCKET_URL = API_BASE;

// ========== AUTH HELPERS ==========
function getToken() { return localStorage.getItem("authToken") || ""; }
function setToken(t) { if (t) localStorage.setItem("authToken", t); else localStorage.removeItem("authToken"); }
function getRole() { return localStorage.getItem("userRole") || ""; }
function setRole(r) { if (r) localStorage.setItem("userRole", r); else localStorage.removeItem("userRole"); }

function authHeader() {
  const token = getToken();
  return token ? { "Authorization": "Bearer " + token, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

async function fetchWithAuth(url, opts = {}) {
  opts.headers = { ...(opts.headers || {}), ...authHeader() };
  const res = await fetch(url, opts);
  if (res.status === 401 || res.status === 403) {
    // token invalid or expired — force logout
    logout(true);
    throw new Error("Unauthorized");
  }
  return res;
}

// ========== SOCKET.IO ==========
let socket = null;
function connectSocket() {
  try {
    if (socket && socket.connected) socket.disconnect();
  } catch(e){}

  const token = getToken();
  // pass token in auth payload
  socket = io(SOCKET_URL, { auth: { token } });

  socket.on("connect", () => {
    console.log("Socket connected", socket.id);
  });

  socket.on("disconnect", (reason) => {
    console.log("Socket disconnected", reason);
  });

  socket.on("roomsUpdated", (updatedRooms) => {
    if (Array.isArray(updatedRooms)) {
      rooms = updatedRooms;
      saveToLocalFallback();
      renderRooms();
      updateStats();
      updateDuePaymentsTable();
      updateTotalDue();
    }
  });

  socket.on("paymentsUpdated", (paymentsData) => {
    if (paymentsData) {
      payments = paymentsData;
      saveToLocalFallback();
      updatePaymentCounters();
    }
  });

  socket.on("customersUpdated", (cust) => {
    if (Array.isArray(cust)) {
      customersDB = cust;
      saveToLocalFallback();
    }
  });

  socket.on("notificationsUpdated", (notifs) => {
    if (Array.isArray(notifs)) {
      notifications = notifs;
      saveToLocalFallback();
      updateNotificationBadge();
      loadNotifications();
    }
  });
}

// ========== LOCAL FALLBACK & DATA ==========
const defaultPayments = { cash: 0, upi: 0, dayRevenue: 0, monthRevenue: 0 };
let rooms = JSON.parse(localStorage.getItem('hotelRooms')) || [];
let payments = JSON.parse(localStorage.getItem('hotelPayments')) || defaultPayments;
let customersDB = JSON.parse(localStorage.getItem('hotelCustomersDB')) || [];
let notifications = JSON.parse(localStorage.getItem('hotelNotifications')) || [];

function saveToLocalFallback() {
  try {
    localStorage.setItem('hotelRooms', JSON.stringify(rooms));
    localStorage.setItem('hotelPayments', JSON.stringify(payments));
    localStorage.setItem('hotelCustomersDB', JSON.stringify(customersDB));
    localStorage.setItem('hotelNotifications', JSON.stringify(notifications));
  } catch (e) {
    console.warn("localStorage save failed", e);
  }
}

function generateDefaultRooms() {
  const arr = [];
  for (let i = 1; i <= 29; i++) {
    arr.push({
      id: i, status: 'available', price: 1500,
      customerName: '', numberOfPersons: 1, aadharNumber: '', phoneNumber: '',
      checkinTime: '', checkoutTime: '', paymentMode: '', totalAmount: 0, paidAmount: 0, dueAmount: 0
    });
  }
  rooms = arr;
  saveToLocalFallback();
  return arr;
}

// ========== LOGIN FLOW ==========
document.getElementById('loginForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();
  if (!username || !password) { showNotification("Enter username and password", "error"); return; }

  try {
    const res = await fetch(`${API}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    if (!res.ok) {
      showNotification(data.error || "Login failed", "error");
      return;
    }

    setToken(data.token);
    setRole(data.role || "");
    connectSocket();

    // Update UI
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('dashboardScreen').classList.remove('hidden');
    if (data.role === 'Owner') document.getElementById('dashboardScreen').classList.add('owner-visible');
    document.getElementById('userRole').textContent = data.role || '';

    // Load data
    await loadInitialData();
    showNotification("Login successful", "success");
  } catch (err) {
    console.error("Login error", err);
    showNotification("Server unreachable", "error");
  }
});

// Auto-login if token present
if (getToken()) {
  // Show dashboard and connect socket; we'll load data after verifying token via API calls
  connectSocket();
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('dashboardScreen').classList.remove('hidden');
  const role = getRole();
  if (role === 'Owner') document.getElementById('dashboardScreen').classList.add('owner-visible');
  document.getElementById('userRole').textContent = role;
  loadInitialData().catch(e => console.warn("Initial load failed", e));
}

// ========== DATA LOAD ==========
async function loadInitialData() {
  // Rooms
  try {
    const r = await fetchWithAuth(`${API}/rooms`);
    if (r.ok) rooms = await r.json();
    else rooms = rooms.length ? rooms : generateDefaultRooms();
  } catch (e) {
    console.warn("rooms API failed, using local", e);
    if (!rooms.length) generateDefaultRooms();
  }

  // Payments
  try {
    const p = await fetchWithAuth(`${API}/payments`);
    if (p.ok) payments = await p.json();
  } catch (e) { console.warn("payments API failed:", e); }

  // Customers
  try {
    const c = await fetchWithAuth(`${API}/customers`);
    if (c.ok) customersDB = await c.json();
  } catch (e) { console.warn("customers API failed:", e); }

  // Notifications
  try {
    const n = await fetchWithAuth(`${API}/notifications`);
    if (n.ok) notifications = await n.json();
  } catch (e) { console.warn("notifications API failed:", e); }

  saveToLocalFallback();
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

// ========== UI: Render Rooms & Stats ==========
function renderRooms() {
  const roomGrid = document.getElementById('roomGrid');
  if (!roomGrid) return;
  roomGrid.innerHTML = '';
  rooms.forEach(room => {
    const box = document.createElement('div');
    box.className = `room-box rounded-lg p-4 text-white cursor-pointer ${getRoomClass(room.status)}`;
    box.onclick = () => openRoomModal(room.id);
    const customerInfo = (room.status === 'occupied' && room.customerName) ?
      `<p class="text-xs mt-1 truncate">${escapeHtml(room.customerName)}</p>
       <p class="text-xs mt-1">${room.numberOfPersons} ${room.numberOfPersons > 1 ? 'persons' : 'person'}</p>
       ${room.dueAmount > 0 ? `<p class="text-xs mt-1 font-bold">Due: ₹${room.dueAmount}</p>` : ''}`
      : '';
    box.innerHTML = `
      <div class="text-center">
        <i class="fas fa-bed text-2xl mb-2"></i>
        <p class="font-bold">Room ${room.id}</p>
        <p class="text-xs mt-1 capitalize">${escapeHtml(room.status)}</p>
        <p class="text-xs mt-1">₹${room.price}/day</p>
        ${customerInfo}
      </div>`;
    roomGrid.appendChild(box);
  });
}

function getRoomClass(status) {
  if (status === 'available') return 'room-available';
  if (status === 'occupied') return 'room-occupied';
  if (status === 'maintenance') return 'room-maintenance';
  return 'room-available';
}

function updateStats() {
  const available = rooms.filter(r => r.status === 'available').length;
  const occupied = rooms.filter(r => r.status === 'occupied').length;
  const maintenance = rooms.filter(r => r.status === 'maintenance').length;
  const elAvailable = document.getElementById('availableCount');
  const elOccupied = document.getElementById('occupiedCount');
  const elMaintenance = document.getElementById('maintenanceCount');
  if (elAvailable) elAvailable.textContent = available;
  if (elOccupied) elOccupied.textContent = occupied;
  if (elMaintenance) elMaintenance.textContent = maintenance;
}

function updatePaymentCounters() {
  const cashEl = document.getElementById('cashCounter');
  const upiEl = document.getElementById('upiCounter');
  const dayEl = document.getElementById('dayRevenue');
  const monthEl = document.getElementById('monthRevenue');
  if (cashEl) cashEl.textContent = `₹${payments.cash || 0}`;
  if (upiEl) upiEl.textContent = `₹${payments.upi || 0}`;
  if (dayEl) dayEl.textContent = `₹${payments.dayRevenue || 0}`;
  if (monthEl) monthEl.textContent = `₹${payments.monthRevenue || 0}`;
}

function updateTotalDue() {
  if (getRole() !== 'Owner') return;
  const totalDue = rooms.reduce((s, r) => s + (Number(r.dueAmount) || 0), 0);
  const el = document.getElementById('totalDue');
  if (el) el.textContent = `₹${totalDue}`;
}

function updateDuePaymentsTable() {
  if (getRole() !== 'Owner') return;
  const table = document.getElementById('duePaymentsTable');
  const noDue = document.getElementById('noDuePayments');
  if (!table || !noDue) return;
  table.innerHTML = '';
  const dueRooms = rooms.filter(r => r.status === 'occupied' && (Number(r.dueAmount) || 0) > 0);
  if (!dueRooms.length) {
    noDue.style.display = 'block';
    return;
  }
  noDue.style.display = 'none';
  dueRooms.forEach(room => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td class="px-6 py-4">${room.id}</td>
      <td class="px-6 py-4">${escapeHtml(room.customerName || '-')}</td>
      <td class="px-6 py-4">₹${room.totalAmount || 0}</td>
      <td class="px-6 py-4">₹${room.paidAmount || 0}</td>
      <td class="px-6 py-4 text-red-600">₹${room.dueAmount || 0}</td>
      <td class="px-6 py-4"><button onclick="openPaymentModal(${room.id})" class="text-blue-600">Update Payment</button></td>
    `;
    table.appendChild(row);
  });
}

// ========== ROOM MODAL & EDIT ==========
function openRoomModal(roomId) {
  const room = rooms.find(r => r.id === roomId);
  if (!room) return;
  document.getElementById('roomId').value = room.id;
  document.getElementById('roomStatus').value = room.status;
  document.getElementById('roomPrice').value = room.price;
  document.getElementById('customerName').value = room.customerName || '';
  document.getElementById('numberOfPersons').value = room.numberOfPersons || 1;
  document.getElementById('aadharNumber').value = room.aadharNumber || '';
  document.getElementById('phoneNumber').value = room.phoneNumber || '';
  document.getElementById('checkinTime').value = room.checkinTime || '';
  document.getElementById('checkoutTime').value = room.checkoutTime || '';
  document.getElementById('paymentMode').value = room.paymentMode || '';
  document.getElementById('paidAmount').value = room.paidAmount || 0;

  if (room.status !== 'occupied') document.getElementById('customerDetails').style.display = 'none';
  else document.getElementById('customerDetails').style.display = 'block';

  // Role based readonly
  if (getRole() === 'Manager') document.getElementById('roomPrice').setAttribute('readonly', true);
  else document.getElementById('roomPrice').removeAttribute('readonly');

  calculateTotalAmount();
  document.getElementById('roomModal').classList.remove('hidden');
}

function closeModal() { document.getElementById('roomModal').classList.add('hidden'); }

function calculateTotalAmount() {
  const roomPrice = parseInt(document.getElementById('roomPrice').value) || 0;
  const checkinVal = document.getElementById('checkinTime').value;
  const checkoutVal = document.getElementById('checkoutTime').value;
  const ci = checkinVal ? new Date(checkinVal) : null;
  const co = checkoutVal ? new Date(checkoutVal) : null;
  if (ci && co && ci < co) {
    const days = Math.max(1, Math.ceil((co - ci) / (1000 * 60 * 60 * 24)));
    const total = roomPrice * days;
    document.getElementById('totalAmount').textContent = `₹${total}`;
    const paid = parseInt(document.getElementById('paidAmount').value) || 0;
    document.getElementById('dueAmount').textContent = `₹${Math.max(0, total - paid)}`;
  } else {
    document.getElementById('totalAmount').textContent = '₹0';
    document.getElementById('dueAmount').textContent = '₹0';
  }
}

document.getElementById('paidAmount').addEventListener('input', calculateTotalAmount);
document.getElementById('roomPrice').addEventListener('input', calculateTotalAmount);
document.getElementById('checkinTime').addEventListener('change', calculateTotalAmount);
document.getElementById('checkoutTime').addEventListener('change', calculateTotalAmount);

// Room form submit handler
document.getElementById('roomForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  const roomId = Number(document.getElementById('roomId').value);
  const idx = rooms.findIndex(r => r.id === roomId);
  if (idx === -1) return;

  const newStatus = document.getElementById('roomStatus').value;
  const roomPrice = parseInt(document.getElementById('roomPrice').value) || 0;
  const customerName = document.getElementById('customerName').value;
  const numberOfPersons = parseInt(document.getElementById('numberOfPersons').value) || 1;
  const aadharNumber = document.getElementById('aadharNumber').value;
  const phoneNumber = document.getElementById('phoneNumber').value;
  const checkinTime = document.getElementById('checkinTime').value;
  const checkoutTime = document.getElementById('checkoutTime').value;
  const paidAmount = parseInt(document.getElementById('paidAmount').value) || 0;

  let totalAmount = 0;
  if (newStatus === 'occupied' && checkinTime && checkoutTime) {
    const ci = new Date(checkinTime), co = new Date(checkoutTime);
    if (ci < co) {
      const days = Math.max(1, Math.ceil((co - ci) / (1000*60*60*24)));
      totalAmount = roomPrice * days;
    }
  }

  const dueAmount = Math.max(0, totalAmount - paidAmount);

  const updatedRoom = {
    ...rooms[idx],
    status: newStatus,
    price: roomPrice,
    customerName, numberOfPersons, aadharNumber, phoneNumber,
    checkinTime, checkoutTime,
    totalAmount, paidAmount, dueAmount,
    paymentMode: document.getElementById('paymentMode').value || ''
  };

  // Update customer DB locally
  if (aadharNumber) {
    let cust = customersDB.find(c => c.aadhar === aadharNumber);
    if (!cust) {
      cust = { id: Date.now().toString(36), name: customerName, aadhar: aadharNumber, phoneNumber, history: [] };
      customersDB.push(cust);
    }
    cust.history = cust.history || [];
    if (updatedRoom.status === 'occupied') {
      cust.history.push({ roomId, checkinTime, checkoutTime, totalAmount, paidAmount, dueAmount });
    }
  }

  // Attempt server update
  try {
    const res = await fetchWithAuth(`${API}/rooms/${roomId}`, {
      method: 'PUT',
      body: JSON.stringify(updatedRoom)
    });
    if (!res.ok) throw new Error('Room update failed');
    // optimistic local update
    rooms[idx] = updatedRoom;
    saveToLocalFallback();
    renderRooms();
    updateStats();
    updatePaymentCounters();
    updateDuePaymentsTable();
    updateTotalDue();
    closeModal();
    showNotification('Room updated', 'success');
  } catch (err) {
    console.warn('Server update failed, saved locally', err);
    rooms[idx] = updatedRoom;
    saveToLocalFallback();
    renderRooms();
    updateStats();
    updateDuePaymentsTable();
    updateTotalDue();
    closeModal();
    showNotification('Updated locally (server offline)', 'error');
  }
});

// ========== PAYMENTS ==========
function openPaymentModal(roomId) {
  if (getRole() !== 'Owner') { showNotification('Only owner can update payments', 'error'); return; }
  const room = rooms.find(r => r.id === roomId);
  if (!room) return;
  document.getElementById('paymentRoomId').value = room.id;
  document.getElementById('paymentRoomNumber').textContent = room.id;
  document.getElementById('paymentCustomerName').textContent = room.customerName || '-';
  document.getElementById('paymentTotalAmount').textContent = `₹${room.totalAmount || 0}`;
  document.getElementById('paymentAlreadyPaid').textContent = `₹${room.paidAmount || 0}`;
  document.getElementById('paymentDueAmount').textContent = `₹${room.dueAmount || 0}`;
  document.getElementById('additionalPayment').value = '';
  document.getElementById('additionalPaymentMode').value = '';
  document.getElementById('paymentModal').classList.remove('hidden');
}

function closePaymentModal() { document.getElementById('paymentModal').classList.add('hidden'); }

document.getElementById('paymentForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  if (getRole() !== 'Owner') { showNotification('Only owner can update payments', 'error'); return; }
  const roomId = Number(document.getElementById('paymentRoomId').value);
  const idx = rooms.findIndex(r => r.id === roomId);
  if (idx === -1) return;

  const amount = Number(document.getElementById('additionalPayment').value) || 0;
  const mode = document.getElementById('additionalPaymentMode').value || 'cash';
  if (amount <= 0) { showNotification('Enter amount', 'error'); return; }

  // Update local
  rooms[idx].paidAmount = (rooms[idx].paidAmount || 0) + amount;
  rooms[idx].dueAmount = Math.max(0, (rooms[idx].totalAmount || 0) - rooms[idx].paidAmount);

  try {
    const res = await fetchWithAuth(`${API}/payments`, {
      method: 'POST',
      body: JSON.stringify({ amount, mode, roomId })
    });
    if (!res.ok) throw new Error('Payments API failed');
    // try to update room on server too
    try {
      await fetchWithAuth(`${API}/rooms/${roomId}`, { method: 'PUT', body: JSON.stringify(rooms[idx]) });
    } catch(e){ /* ignore */ }
    saveToLocalFallback();
    renderRooms();
    updatePaymentCounters();
    updateDuePaymentsTable();
    updateTotalDue();
    closePaymentModal();
    showNotification(`Payment ₹${amount} recorded`, 'success');
    addNotification(`Payment of ₹${amount} received for Room ${roomId} via ${mode}`);
  } catch (err) {
    console.warn('Payment failed', err);
    saveToLocalFallback();
    renderRooms();
    updatePaymentCounters();
    updateDuePaymentsTable();
    updateTotalDue();
    closePaymentModal();
    showNotification('Payment recorded locally (server offline)', 'error');
  }
});

// ========== CUSTOMERS ==========
function openAllCustomersModal() {
  if (getRole() !== 'Owner') { showNotification('Only owner can view customers', 'error'); return; }
  document.getElementById('allCustomersModal').classList.remove('hidden');
  renderAllCustomers();
}
function closeAllCustomersModal() { document.getElementById('allCustomersModal').classList.add('hidden'); }

function renderAllCustomers() {
  const table = document.getElementById('allCustomersTable');
  const noEl = document.getElementById('noCustomersFound');
  if (!table || !noEl) return;
  table.innerHTML = '';
  if (!customersDB || customersDB.length === 0) { noEl.classList.remove('hidden'); return; }
  noEl.classList.add('hidden');
  customersDB.forEach(c => {
    const row = document.createElement('tr');
    const lastVisit = c.history && c.history.length ? new Date(c.history[c.history.length-1].checkinTime).toLocaleDateString() : 'No visits';
    row.innerHTML = `
      <td class="px-6 py-4">${escapeHtml(c.name)}</td>
      <td class="px-6 py-4">${escapeHtml(c.aadhar)}</td>
      <td class="px-6 py-4">${escapeHtml(c.phoneNumber || '-')}</td>
      <td class="px-6 py-4">${c.history ? c.history.length : 0}</td>
      <td class="px-6 py-4">${lastVisit}</td>
      <td class="px-6 py-4"><button onclick="viewCustomerDetails('${c.aadhar}')" class="text-blue-600">View</button></td>`;
    table.appendChild(row);
  });
}

function viewCustomerDetails(aadhar) {
  const c = customersDB.find(x => x.aadhar === aadhar);
  if (!c) return;
  closeAllCustomersModal();
  const avail = rooms.find(r => r.status === 'available');
  if (avail) {
    openRoomModal(avail.id);
    setTimeout(() => {
      document.getElementById('customerName').value = c.name;
      document.getElementById('aadharNumber').value = c.aadhar;
      document.getElementById('phoneNumber').value = c.phoneNumber || '';
      showCustomerHistory(c);
    }, 150);
  } else showNotification('No available rooms', 'error');
}

document.getElementById('customerSearch').addEventListener('input', function (e) {
  const term = e.target.value.toLowerCase();
  const rows = document.querySelectorAll('#allCustomersTable tr');
  rows.forEach(row => {
    const name = row.cells[0].textContent.toLowerCase();
    const aadhar = row.cells[1].textContent.toLowerCase();
    row.style.display = (name.includes(term) || aadhar.includes(term)) ? '' : 'none';
  });
});

// ========== NOTIFICATIONS ==========
function updateNotificationBadge() {
  const badge = document.getElementById('notificationBadge');
  if (!badge) return;
  if (notifications && notifications.length) {
    badge.textContent = notifications.length;
    badge.classList.remove('hidden');
  } else badge.classList.add('hidden');
}

function loadNotifications() {
  const list = document.getElementById('notificationList');
  if (!list) return;
  list.innerHTML = '';
  if (!notifications || !notifications.length) {
    list.innerHTML = '<p class="p-4 text-gray-500 text-center">No notifications</p>';
    return;
  }
  notifications.forEach(n => {
    const el = document.createElement('div');
    el.className = 'p-4 border-b hover:bg-gray-50';
    el.innerHTML = `<p class="text-gray-800">${escapeHtml(n.message)}</p><p class="text-xs text-gray-500 mt-2">${new Date(n.timestamp).toLocaleString()}</p>`;
    list.appendChild(el);
  });
}

function addNotification(message) {
  const n = { message, timestamp: new Date().toISOString() };
  notifications.push(n);
  saveToLocalFallback();
  updateNotificationBadge();
  // try to notify server via payments endpoint (owner)
  fetchWithAuth(`${API}/payments`, {
    method: 'POST',
    body: JSON.stringify({ amount: 0, mode: '', message })
  }).catch(()=>{});
}

// clear notifications (owner)
function clearAllNotifications() {
  if (getRole() !== 'Owner') { showNotification('Only owner can clear notifications', 'error'); return; }
  showConfirmModal('Clear all notifications?', async () => {
    try {
      const res = await fetchWithAuth(`${API}/notifications`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed');
      notifications = [];
      saveToLocalFallback();
      updateNotificationBadge();
      loadNotifications();
      showNotification('Notifications cleared', 'success');
    } catch (e) {
      notifications = [];
      saveToLocalFallback();
      updateNotificationBadge();
      loadNotifications();
      showNotification('Notifications cleared locally', 'success');
    }
  });
}

// ========== HELPERS ==========
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/[&<>"'`=\/]/g, function (s) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D;'})[s]; });
}

function showNotification(message, type = 'success') {
  const container = document.createElement('div');
  container.className = `fixed top-4 right-4 px-6 py-3 rounded-lg shadow-lg text-white z-50 ${type === 'success' ? 'bg-green-500' : 'bg-red-500'}`;
  container.innerHTML = `<div class="flex items-center"><i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'} mr-2"></i>${escapeHtml(message)}</div>`;
  document.body.appendChild(container);
  setTimeout(()=> container.remove(), 3000);
}

function showConfirmModal(message, onConfirm) {
  const m = document.getElementById('confirmModal');
  const msg = document.getElementById('confirmMessage');
  const yes = document.getElementById('confirmYes');
  const no = document.getElementById('confirmNo');
  if (!m) { if (onConfirm) onConfirm(); return; }
  msg.textContent = message;
  m.classList.remove('hidden');

  // replace listeners
  const yesNew = yes.cloneNode(true);
  yes.parentNode.replaceChild(yesNew, yes);
  const noNew = no.cloneNode(true);
  no.parentNode.replaceChild(noNew, no);

  yesNew.addEventListener('click', () => { onConfirm && onConfirm(); m.classList.add('hidden'); });
  noNew.addEventListener('click', () => m.classList.add('hidden'));
}

// ========== LOGOUT ==========
document.getElementById('logoutBtn') && document.getElementById('logoutBtn').addEventListener('click', () => { logout(); showNotification('Logged out', 'success'); });

function logout() {
  setToken('');
  setRole('');
  try { if (socket) socket.disconnect(); } catch(e){}
  document.getElementById('dashboardScreen').classList.add('hidden');
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('dashboardScreen').classList.remove('owner-visible');
}

// ========== INIT ON LOAD ==========
document.addEventListener('DOMContentLoaded', () => {
  // set default times if elements exist
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  const ci = document.getElementById('checkinTime');
  const co = document.getElementById('checkoutTime');
  if (ci) ci.value = now.toISOString().slice(0,16);
  if (co) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    co.value = tomorrow.toISOString().slice(0,16);
  }

  // Show/hide based on token
  const token = getToken();
  if (token) {
    connectSocket();
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('dashboardScreen').classList.remove('hidden');
    const role = getRole();
    if (role === 'Owner') document.getElementById('dashboardScreen').classList.add('owner-visible');
    document.getElementById('userRole').textContent = role;
  } else {
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('dashboardScreen').classList.add('hidden');
  }

  // initial render from local storage (until API loads)
  if (!rooms || !rooms.length) generateDefaultRooms();
  applyDataToUI();
});
