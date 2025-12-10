/************************************
 * HOTEL MANAGEMENT – FIXED FRONTEND
 * JWT Login + API + Socket.IO Ready
 ************************************/

// ------------------- CONFIG --------------------
const API = `${location.origin}/api`;   // Auto-detect correct Render URL

function getToken() { return localStorage.getItem("authToken") || ""; }
function setToken(t) { localStorage.setItem("authToken", t); }
function removeToken() { localStorage.removeItem("authToken"); }

function getRole() { return localStorage.getItem("userRole") || ""; }
function setRole(r) { localStorage.setItem("userRole", r); }

// Global Socket
let socket = null;

// Build auth header for all API calls
function authHeader() {
    return { "Authorization": "Bearer " + getToken(), "Content-Type": "application/json" };
}

// Unified Fetch Wrapper
async function fetchWithAuth(url, opt = {}) {
    opt.headers = { ...(opt.headers || {}), ...authHeader() };
    let res = await fetch(url, opt);
    if (res.status === 401 || res.status === 403) {
        logout();
        throw new Error("Unauthorized");
    }
    return res;
}

// ------------------------------------------------
//                LOGIN FUNCTION
// ------------------------------------------------
document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value.trim();

    try {
        const response = await fetch(`${API}/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (!response.ok) {
            showNotification(data.error || "Invalid credentials", "error");
            return;
        }

        // Save token
        setToken(data.token);
        setRole(data.role);
        // set currentUser for frontend role checks
        try { currentUser = { username: username, role: data.role }; } catch(e){}

        // Setup socket
        connectSocket();

        // Show dashboard
        document.getElementById("loginScreen").classList.add("hidden");
        document.getElementById("dashboardScreen").classList.remove("hidden");
        document.getElementById("userRole").textContent = data.role;

        if (data.role === "Owner") {
            document.getElementById("dashboardScreen").classList.add("owner-visible");
        }

        // Load data after login
        await loadInitialData();
        showNotification("Login successful!", "success");

    } catch (err) {
        console.error(err);
        showNotification("Server unreachable.", "error");
    }
});

// ------------------------------------------------
//                SOCKET CONNECTION
// ------------------------------------------------
function connectSocket() {
    if (socket && socket.connected) socket.disconnect();

    socket = io(location.origin, {
        auth: { token: getToken() }
    });

    socket.on("connect", () => console.log("Socket connected"));

    socket.on("roomsUpdated", (data) => {
        rooms = data;
        saveToLocalFallback();
        renderRooms();
        updateStats();
        updateDuePaymentsTable();
        updateTotalDue();
    });

    socket.on("paymentsUpdated", (data) => {
        payments = data;
        saveToLocalFallback();
        updatePaymentCounters();
    });

    socket.on("customersUpdated", (data) => {
        customersDB = data;
        saveToLocalFallback();
    });

    socket.on("notificationsUpdated", (data) => {
        notifications = data;
        saveToLocalFallback();
        updateNotificationBadge();
        loadNotifications();
    });
}

// ------------------------------------------------
//              LOGOUT FUNCTION
// ------------------------------------------------
function logout() {
    removeToken();
    localStorage.removeItem("userRole");

    if (socket) socket.disconnect();

    document.getElementById("dashboardScreen").classList.add("hidden");
    document.getElementById("loginScreen").classList.remove("hidden");
}

// ------------------------------------------------
//              DATA LOADING (API)
// ------------------------------------------------

let rooms = [];
let payments = [];
let customersDB = [];
let notifications = [];

function saveToLocalFallback() {
    localStorage.setItem("hotelRooms", JSON.stringify(rooms));
    localStorage.setItem("hotelPayments", JSON.stringify(payments));
    localStorage.setItem("hotelCustomersDB", JSON.stringify(customersDB));
    localStorage.setItem("hotelNotifications", JSON.stringify(notifications));
}


async function loadInitialData() {
    try {
        // fetch individually to allow partial success
        try { let r = await fetchWithAuth(`${API}/rooms`); if (r.ok) rooms = await r.json(); } catch(e){ console.warn('rooms fetch failed', e); }
        try { let p = await fetchWithAuth(`${API}/payments`); if (p.ok) payments = await p.json(); } catch(e){ console.warn('payments fetch failed', e); }
        try { let c = await fetchWithAuth(`${API}/customers`); if (c.ok) customersDB = await c.json(); } catch(e){ console.warn('customers fetch failed', e); }
        try { let n = await fetchWithAuth(`${API}/notifications`); if (n.ok) notifications = await n.json(); } catch(e){ console.warn('notifications fetch failed', e); }

        // fallbacks
        if (!Array.isArray(rooms) || rooms.length === 0) rooms = JSON.parse(localStorage.getItem('hotelRooms')) || generateDefaultRooms();
        if (!payments || typeof payments !== 'object') payments = JSON.parse(localStorage.getItem('hotelPayments')) || { cash:0, upi:0, dayRevenue:0, monthRevenue:0 };
        if (!Array.isArray(customersDB)) customersDB = JSON.parse(localStorage.getItem('hotelCustomersDB')) || [];
        if (!Array.isArray(notifications)) notifications = JSON.parse(localStorage.getItem('hotelNotifications')) || [];

        renderRooms();
        updateStats();
        updatePaymentCounters();
        updateDuePaymentsTable();
        updateTotalDue();
        updateNotificationBadge();

        saveToLocalFallback();
        // connect socket after initial data load
        connectSocket();
    } catch (e) {
        console.warn('API load failed, using localStorage fallback.', e);
        rooms = JSON.parse(localStorage.getItem('hotelRooms')) || generateDefaultRooms();
        payments = JSON.parse(localStorage.getItem('hotelPayments')) || { cash:0, upi:0, dayRevenue:0, monthRevenue:0 };
        customersDB = JSON.parse(localStorage.getItem('hotelCustomersDB')) || [];
        notifications = JSON.parse(localStorage.getItem('hotelNotifications')) || [];
        renderRooms();
        updateStats();
        updatePaymentCounters();
        updateDuePaymentsTable();
        updateTotalDue();
        updateNotificationBadge();
        // still connect socket
        connectSocket();
    }
}


// ------------------------------------------------
//      REST OF YOUR ORIGINAL FUNCTIONS BELOW
// ------------------------------------------------
const API = 'https://srinikamalnkb.onrender.com';
const socket = io('https://srinikamalnkb.onrender.com');
// script.js - Frontend logic rewritten to use API + Socket.IO while preserving original UI and behavior

const API = location.origin + '/api';
const socket = (typeof io !== 'undefined') ? io() : null;

// User credentials (kept for demo; move to secure auth in production)
const users = { owner: { password: 'msn2021$', role: 'Owner' }, manager: { password: 'manager2025', role: 'Manager' } };
let currentUser = null;
let rooms = [];
let payments = { cash: 0, upi: 0, dayRevenue: 0, monthRevenue: 0, lastUpdated: null };
let notifications = [];
let customersDB = [];

// ---------- Initialization & Data Loading ----------
async function loadInitialData() {
  try {
    const [roomsRes, paymentsRes, customersRes, notifsRes] = await Promise.all([
      fetch(`${API}/rooms`),
      fetch(`${API}/payments`),
      fetch(`${API}/customers`),
      fetch(`${API}/notifications`)
    ]);

    if (!roomsRes.ok || !paymentsRes.ok) throw new Error('API not available');

    rooms = await roomsRes.json();
    payments = await paymentsRes.json();
    customersDB = await customersRes.json();
    notifications = await notifsRes.json();

    saveToLocalFallback(); // update local fallback copies
    applyDataToUI();
  } catch (e) {
    console.warn('API load failed, using localStorage fallback.', e);
    rooms = JSON.parse(localStorage.getItem('hotelRooms')) || generateDefaultRooms();
    payments = JSON.parse(localStorage.getItem('hotelPayments')) || payments;
    customersDB = JSON.parse(localStorage.getItem('hotelCustomersDB')) || [];
    notifications = JSON.parse(localStorage.getItem('hotelNotifications')) || [];
    applyDataToUI();
  }
}

function saveToLocalFallback() {
  localStorage.setItem('hotelRooms', JSON.stringify(rooms));
  localStorage.setItem('hotelPayments', JSON.stringify(payments));
  localStorage.setItem('hotelCustomersDB', JSON.stringify(customersDB));
  localStorage.setItem('hotelNotifications', JSON.stringify(notifications));
}

function generateDefaultRooms() {
  const arr = [];
  for (let i = 1; i <= 29; i++) arr.push({
    id: i,
    status: 'available',
    price: 1000 + Math.floor(Math.random() * 2000),
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
  });
  localStorage.setItem('hotelRooms', JSON.stringify(arr));
  return arr;
}

function applyDataToUI() {
  renderRooms();
  updateStats();
  updatePaymentCounters();
  updateDuePaymentsTable();
  updateTotalDue();
  updateNotificationBadge();
}

// ---------- Socket Listeners (Realtime updates) ----------
if (socket) {
  socket.on('roomsUpdated', updatedRooms => {
    if (Array.isArray(updatedRooms)) {
      rooms = updatedRooms;
      saveToLocalFallback();
      renderRooms();
      updateStats();
      updateDuePaymentsTable();
      updateTotalDue();
    }
  });

  socket.on('paymentsUpdated', updatedPayments => {
    if (updatedPayments) {
      payments = updatedPayments;
      saveToLocalFallback();
      updatePaymentCounters();
    }
  });

  socket.on('customersUpdated', updatedCustomers => {
    if (Array.isArray(updatedCustomers)) {
      customersDB = updatedCustomers;
      saveToLocalFallback();
    }
  });

  socket.on('notificationsUpdated', updatedNotifications => {
    if (Array.isArray(updatedNotifications)) {
      notifications = updatedNotifications;
      saveToLocalFallback();
      updateNotificationBadge();
      loadNotifications();
    }
  });
}

// ---------- Auth ----------
document.getElementById('loginForm').addEventListener('submit', function(e) {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;

  if (users[username] && users[username].password === password) {
    currentUser = { username, role: users[username].role };
    document.getElementById('userRole').textContent = currentUser.role;
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('dashboardScreen').classList.remove('hidden');

    if (currentUser.role === 'Owner') {
      document.getElementById('dashboardScreen').classList.add('owner-visible');
      updateNotificationBadge();
      updateDuePaymentsTable();
      updateTotalDue();
      if (notifications.length > 0) showNotification(`You have ${notifications.length} new notification(s)`, 'success');
    }

    // ensure data is loaded for the dashboard
    loadInitialData();
  } else {
    showNotification('Invalid credentials!', 'error');
  }
});

function logout() {
  currentUser = null;
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('dashboardScreen').classList.add('hidden');
  document.getElementById('dashboardScreen').classList.remove('owner-visible');
  document.getElementById('loginForm').reset();
}

// ---------- Customer DB helpers ----------
function findCustomerByAadhar(aadhar) {
  return customersDB.find(customer => customer.aadhar === aadhar);
}

function addCustomer(customer) {
  customer.id = Date.now().toString(36) + Math.random().toString(36).substr(2);
  customer.createdAt = new Date().toISOString();
  customer.history = [];
  customersDB.push(customer);
  saveCustomersToServer();
  saveToLocalFallback();
  return customer;
}

function updateCustomerHistory(aadhar, bookingInfo) {
  const customerIndex = customersDB.findIndex(c => c.aadhar === aadhar);
  if (customerIndex !== -1) {
    customersDB[customerIndex].history = customersDB[customerIndex].history || [];
    customersDB[customerIndex].history.push(bookingInfo);
    saveCustomersToServer();
    saveToLocalFallback();
  }
}

async function saveCustomersToServer() {
  // Currently server has no bulk save endpoint for customers; customers are created via room updates.
  // Keep local fallback only.
  localStorage.setItem('hotelCustomersDB', JSON.stringify(customersDB));
}

// ---------- Render Rooms ----------
function renderRooms() {
  const roomGrid = document.getElementById('roomGrid');
  if (!roomGrid) return;
  roomGrid.innerHTML = '';

  rooms.forEach(room => {
    const roomBox = document.createElement('div');
    roomBox.className = `room-box rounded-lg p-4 text-white cursor-pointer ${getRoomClass(room.status)}`;
    roomBox.onclick = () => openRoomModal(room.id);

    let customerInfo = '';
    if (room.status === 'occupied' && room.customerName) {
      customerInfo = `<p class="text-xs mt-1 truncate">${room.customerName}</p>`;
      if (room.numberOfPersons) {
        customerInfo += `<p class="text-xs mt-1">${room.numberOfPersons} ${room.numberOfPersons > 1 ? 'persons' : 'person'}</p>`;
      }
      if (room.dueAmount > 0) {
        customerInfo += `<p class="text-xs mt-1 font-bold">Due: ₹${room.dueAmount}</p>`;
      }
    }

    roomBox.innerHTML = `
      <div class="text-center">
        <i class="fas fa-bed text-2xl mb-2"></i>
        <p class="font-bold">Room ${room.id}</p>
        <p class="text-xs mt-1 capitalize">${room.status}</p>
        <p class="text-xs mt-1">₹${room.price}/day</p>
        ${customerInfo}
      </div>
    `;
    roomGrid.appendChild(roomBox);
  });
}

function getRoomClass(status) {
  switch(status) {
    case 'available': return 'room-available';
    case 'occupied': return 'room-occupied';
    case 'maintenance': return 'room-maintenance';
    default: return 'room-available';
  }
}

// ---------- Stats & Payments UI ----------
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
  const cashCounter = document.getElementById('cashCounter');
  const upiCounter = document.getElementById('upiCounter');
  const dayRevenue = document.getElementById('dayRevenue');
  const monthRevenue = document.getElementById('monthRevenue');
  
  if (cashCounter) cashCounter.textContent = `₹${payments.cash || 0}`;
  if (upiCounter) upiCounter.textContent = `₹${payments.upi || 0}`;
  if (dayRevenue) dayRevenue.textContent = `₹${payments.dayRevenue || 0}`;
  if (monthRevenue) monthRevenue.textContent = `₹${payments.monthRevenue || 0}`;
}

function updateTotalDue() {
  if (currentUser && currentUser.role === 'Owner') {
    const totalDue = rooms.reduce((sum, room) => sum + (room.dueAmount || 0), 0);
    const totalDueElement = document.getElementById('totalDue');
    if (totalDueElement) totalDueElement.textContent = `₹${totalDue}`;
  }
}

// ---------- Due Payments Table ----------
function updateDuePaymentsTable() {
  if (currentUser && currentUser.role !== 'Owner') return;
  const duePaymentsTable = document.getElementById('duePaymentsTable');
  const noDuePayments = document.getElementById('noDuePayments');
  if (!duePaymentsTable || !noDuePayments) return;

  duePaymentsTable.innerHTML = '';
  const dueRooms = rooms.filter(room => room.status === 'occupied' && room.dueAmount > 0);

  if (dueRooms.length === 0) {
    noDuePayments.style.display = 'block';
    return;
  }
  noDuePayments.style.display = 'none';

  dueRooms.forEach(room => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${room.id}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${room.customerName || '-'}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">₹${room.totalAmount || 0}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">₹${room.paidAmount || 0}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-red-600">₹${room.dueAmount || 0}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
        <button onclick="openPaymentModal(${room.id})" class="text-blue-600 hover:text-blue-900">Update Payment</button>
      </td>
    `;
    duePaymentsTable.appendChild(row);
  });
}

// ---------- Notifications ----------
function clearAllNotifications() {
  if (currentUser && currentUser.role !== 'Owner') {
    showNotification('Only owner can clear notifications!', 'error');
    return;
  }
  showConfirmModal('Are you sure you want to clear all notifications?', async () => {
    // request server to clear notifications if possible
    try {
      const res = await fetch(`${API}/notifications`, { method: 'DELETE' });
      if (res.ok) {
        notifications = [];
        saveToLocalFallback();
        updateNotificationBadge();
        loadNotifications();
        showNotification('All notifications cleared', 'success');
      } else {
        throw new Error('server error');
      }
    } catch (e) {
      // fallback local
      notifications = [];
      localStorage.setItem('hotelNotifications', JSON.stringify(notifications));
      updateNotificationBadge();
      loadNotifications();
      showNotification('All notifications cleared (local)', 'success');
    }
  });
}

function showConfirmModal(message, onConfirm) {
  const confirmModal = document.getElementById('confirmModal');
  const confirmMessage = document.getElementById('confirmMessage');
  const confirmYes = document.getElementById('confirmYes');
  const confirmNo = document.getElementById('confirmNo');

  confirmMessage.textContent = message;
  confirmModal.classList.remove('hidden');

  // replace listeners
  const newYes = confirmYes.cloneNode(true);
  confirmYes.parentNode.replaceChild(newYes, confirmYes);
  const newNo = confirmNo.cloneNode(true);
  confirmNo.parentNode.replaceChild(newNo, confirmNo);

  newYes.addEventListener('click', () => {
    onConfirm && onConfirm();
    confirmModal.classList.add('hidden');
  });
  newNo.addEventListener('click', () => confirmModal.classList.add('hidden'));
}

function toggleNotifications() {
  const dropdown = document.getElementById('notificationDropdown');
  if (!dropdown) return;
  dropdown.classList.toggle('hidden');
  if (!dropdown.classList.contains('hidden')) loadNotifications();
}

function loadNotifications() {
  const notificationList = document.getElementById('notificationList');
  if (!notificationList) return;
  notificationList.innerHTML = '';
  if (!notifications || notifications.length === 0) {
    notificationList.innerHTML = '<p class="p-4 text-gray-500 text-center">No notifications</p>';
    return;
  }
  notifications.forEach(n => {
    const item = document.createElement('div');
    item.className = 'p-4 border-b hover:bg-gray-50';
    item.innerHTML = `<p class="text-gray-800">${n.message}</p><p class="text-xs text-gray-500 mt-2">${new Date(n.timestamp).toLocaleString()}</p>`;
    notificationList.appendChild(item);
  });
}

function updateNotificationBadge() {
  const badge = document.getElementById('notificationBadge');
  if (!badge) return;
  if (notifications.length > 0) {
    badge.textContent = notifications.length;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function addNotification(message) {
  const n = { message, timestamp: new Date().toISOString() };
  notifications.push(n);
  localStorage.setItem('hotelNotifications', JSON.stringify(notifications));

  // notify server by creating a payment or via a custom endpoint (we'll use payments endpoint with message)
  // This matches server.js earlier where POST /api/payments accepted message to push notifications.
  (async () => {
    try {
      await fetch(`${API}/payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 0, mode: '', message })
      });
    } catch (e) {
      // ignore; local fallback already saved
    }
  })();

  updateNotificationBadge();
}

// ---------- Room modal & editing ----------
document.getElementById('aadharNumber').addEventListener('input', function(e) {
  const aadharNumber = e.target.value;
  const customerRecognition = document.getElementById('customerRecognition');
  if (aadharNumber.length >= 4) {
    const customer = findCustomerByAadhar(aadharNumber);
    if (customer) {
      customerRecognition.innerHTML = `<i class="fas fa-check-circle text-green-600 mr-2"></i>Customer found: <strong>${customer.name}</strong>`;
      document.getElementById('customerName').value = customer.name;
      document.getElementById('phoneNumber').value = customer.phoneNumber || '';
      showCustomerHistory(customer);
    } else {
      customerRecognition.innerHTML = `<i class="fas fa-search text-blue-600 mr-2"></i>Searching for customer...`;
      document.getElementById('customerHistorySection').classList.add('hidden');
    }
  } else {
    customerRecognition.innerHTML = `<i class="fas fa-info-circle text-blue-600 mr-2"></i>Enter Aadhar number to check if customer exists in our database`;
    document.getElementById('customerHistorySection').classList.add('hidden');
  }
});

function showCustomerHistory(customer) {
  const historySection = document.getElementById('customerHistorySection');
  const historyTable = document.getElementById('customerHistoryTable');
  const noHistory = document.getElementById('noCustomerHistory');

  historySection.classList.remove('hidden');
  historyTable.innerHTML = '';

  if (customer.history && customer.history.length > 0) {
    noHistory.classList.add('hidden');
    customer.history.forEach(booking => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-900">${booking.roomId}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-500">${new Date(booking.checkinTime).toLocaleDateString()}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-500">${new Date(booking.checkoutTime).toLocaleDateString()}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm text-gray-500">₹${booking.totalAmount}</td>
        <td class="px-4 py-2 whitespace-nowrap text-sm">
          <span class="px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${booking.dueAmount > 0 ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}">
            ${booking.dueAmount > 0 ? 'Due' : 'Paid'}
          </span>
        </td>
      `;
      historyTable.appendChild(row);
    });
  } else {
    noHistory.classList.remove('hidden');
  }
}

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

  if (currentUser && currentUser.role === 'Manager') {
    document.getElementById('roomPrice').setAttribute('readonly', true);
  } else {
    document.getElementById('roomPrice').removeAttribute('readonly');
  }

  if (room.status !== 'occupied') {
    document.getElementById('customerDetails').style.display = 'none';
  } else {
    document.getElementById('customerDetails').style.display = 'block';
    calculateTotalAmount();
    if (room.aadharNumber) {
      const cust = findCustomerByAadhar(room.aadharNumber);
      if (cust) showCustomerHistory(cust);
    }
  }

  document.getElementById('roomModal').classList.remove('hidden');
}


function closeModal() {
  ['roomModal','paymentModal','customerModal','allCustomersModal','confirmModal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
  const history = document.getElementById('customerHistorySection');
  if (history) history.classList.add('hidden');
}


function calculateTotalAmount() {
  const roomPrice = parseInt(document.getElementById('roomPrice').value) || 0;
  const checkinTimeVal = document.getElementById('checkinTime').value;
  const checkoutTimeVal = document.getElementById('checkoutTime').value;
  const checkinTime = checkinTimeVal ? new Date(checkinTimeVal) : null;
  const checkoutTime = checkoutTimeVal ? new Date(checkoutTimeVal) : null;

  if (checkinTime && checkoutTime && checkinTime < checkoutTime) {
    const days = Math.max(1, Math.ceil((checkoutTime - checkinTime) / (1000 * 60 * 60 * 24)));
    const totalAmount = roomPrice * days;
    document.getElementById('totalAmount').textContent = `₹${totalAmount}`;
    const paidAmount = parseInt(document.getElementById('paidAmount').value) || 0;
    const dueAmount = Math.max(0, totalAmount - paidAmount);
    document.getElementById('dueAmount').textContent = `₹${dueAmount}`;
  } else {
    document.getElementById('totalAmount').textContent = '₹0';
    document.getElementById('dueAmount').textContent = '₹0';
  }
}

document.getElementById('paidAmount').addEventListener('input', calculateTotalAmount);
document.getElementById('roomPrice').addEventListener('input', calculateTotalAmount);
document.getElementById('checkinTime').addEventListener('change', calculateTotalAmount);
document.getElementById('checkoutTime').addEventListener('change', calculateTotalAmount);

// Room form submission -> try to persist to server, else fallback to local
document.getElementById('roomForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  const roomId = parseInt(document.getElementById('roomId').value);
  const idx = rooms.findIndex(r => r.id === roomId);
  if (idx === -1) return;

  const oldStatus = rooms[idx].status;
  const newStatus = document.getElementById('roomStatus').value;
  const newPaymentMode = document.getElementById('paymentMode').value;
  const roomPrice = parseInt(document.getElementById('roomPrice').value) || 0;

  let totalAmount = 0;
  if (newStatus === 'occupied') {
    const checkinTimeVal = document.getElementById('checkinTime').value;
    const checkoutTimeVal = document.getElementById('checkoutTime').value;
    if (checkinTimeVal && checkoutTimeVal) {
      const checkinTime = new Date(checkinTimeVal);
      const checkoutTime = new Date(checkoutTimeVal);
      if (checkinTime < checkoutTime) {
        const days = Math.max(1, Math.ceil((checkoutTime - checkinTime) / (1000 * 60 * 60 * 24)));
        totalAmount = roomPrice * days;
      }
    }
  }

  const paidAmount = parseInt(document.getElementById('paidAmount').value) || 0;
  const dueAmount = Math.max(0, totalAmount - paidAmount);

  const customerName = document.getElementById('customerName').value;
  const aadharNumber = document.getElementById('aadharNumber').value;
  const numberOfPersons = parseInt(document.getElementById('numberOfPersons').value) || 1;
  const phoneNumber = document.getElementById('phoneNumber').value;
  const checkinTime = document.getElementById('checkinTime').value;
  const checkoutTime = document.getElementById('checkoutTime').value;

  // Create or update customer locally
  let customer = aadharNumber ? findCustomerByAadhar(aadharNumber) : null;
  if (!customer && aadharNumber) {
    customer = addCustomer({ name: customerName, aadhar: aadharNumber, phoneNumber });
  }

  // Update room object
  const updatedRoom = {
    ...rooms[idx],
    status: newStatus,
    price: roomPrice,
    customerName,
    numberOfPersons,
    aadharNumber,
    phoneNumber,
    checkinTime,
    checkoutTime,
    paymentMode: newPaymentMode,
    totalAmount,
    paidAmount,
    dueAmount
  };

  // If room becomes occupied, add history
  if (newStatus === 'occupied' && aadharNumber) {
    updateCustomerHistory(aadharNumber, {
      roomId,
      checkinTime,
      checkoutTime,
      totalAmount,
      paidAmount,
      dueAmount
    });
  }

  // Persist to server if possible
  try {
    const body = { ...updatedRoom };
    // include a small paymentEvent if paidAmount > previous paidAmount (server increments payments)
    const prevPaid = rooms[idx].paidAmount || 0;
    if (paidAmount > prevPaid) {
      body.paymentEvent = { amount: paidAmount - prevPaid, mode: newPaymentMode || '' };
    }
    const res = await fetch(`${API}/rooms/${roomId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('Failed to update on server');
    const result = await res.json();
    // server will broadcast via socket; we still update local copy so UI is snappy
    rooms[idx] = result.room || updatedRoom;
    // If the update included a paymentEvent, also record it with payments endpoint
    try {
      if (body && body.paymentEvent && body.paymentEvent.amount) {
        await fetch(`${API}/payments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: body.paymentEvent.amount, mode: body.paymentEvent.mode || 'cash', roomId })
        });
        // optimistically update local payments too
        try {
          if (!payments || typeof payments !== 'object') payments = { cash:0, upi:0, dayRevenue:0, monthRevenue:0 };
          const inc = Number(body.paymentEvent.amount) || 0;
          if ((body.paymentEvent.mode || '').toLowerCase() === 'upi') payments.upi = (payments.upi||0) + inc;
          else payments.cash = (payments.cash||0) + inc;
          payments.dayRevenue = (payments.dayRevenue||0) + inc;
          payments.monthRevenue = (payments.monthRevenue||0) + inc;
          payments.lastUpdated = new Date().toISOString();
        } catch(e){ }
      }
    } catch(e) { /* ignore payment sync errors */ }
    saveToLocalFallback();
    renderRooms();
    updateStats();
    updatePaymentCounters();
    updateDuePaymentsTable();
    updateTotalDue();
    closeModal();
    showNotification('Room updated successfully!', 'success');
  } catch (err) {
    // fallback: local only
    rooms[idx] = updatedRoom;
    localStorage.setItem('hotelRooms', JSON.stringify(rooms));

    // update payments locally if needed
    if (oldStatus !== 'occupied' && updatedRoom.paymentMode && paidAmount > 0) {
      if (updatedRoom.paymentMode === 'cash') payments.cash += paidAmount;
      else if (updatedRoom.paymentMode === 'UPI') payments.upi += paidAmount;

      const today = new Date().toDateString();
      const currentMonth = new Date().getMonth();
      const currentYear = new Date().getFullYear();
      if (!payments.lastUpdated || new Date(payments.lastUpdated).toDateString() !== today) payments.dayRevenue = paidAmount;
      else payments.dayRevenue += paidAmount;
      if (!payments.lastUpdated || new Date(payments.lastUpdated).getMonth() !== currentMonth || new Date(payments.lastUpdated).getFullYear() !== currentYear) payments.monthRevenue = paidAmount;
      else payments.monthRevenue += paidAmount;
      payments.lastUpdated = new Date().toISOString();
      localStorage.setItem('hotelPayments', JSON.stringify(payments));
    }

    saveToLocalFallback();
    renderRooms();
    updateStats();
    updatePaymentCounters();
    updateDuePaymentsTable();
    updateTotalDue();
    closeModal();
    showNotification('Room updated locally (server unavailable).', 'error');
  }
});

// ---------- All Customers modal ----------
function openAllCustomersModal() {
  if (currentUser && currentUser.role !== 'Owner') {
    showNotification('Only owner can view all customers!', 'error');
    return;
  }
  document.getElementById('allCustomersModal').classList.remove('hidden');
  renderAllCustomers();
}

function closeAllCustomersModal() {
  document.getElementById('allCustomersModal').classList.add('hidden');
}

function renderAllCustomers() {
  const customersTable = document.getElementById('allCustomersTable');
  const noCustomers = document.getElementById('noCustomersFound');
  if (!customersTable || !noCustomers) return;
  customersTable.innerHTML = '';

  if (!customersDB || customersDB.length === 0) {
    noCustomers.classList.remove('hidden');
    return;
  }
  noCustomers.classList.add('hidden');

  customersDB.forEach(customer => {
    const row = document.createElement('tr');
    const lastVisit = customer.history && customer.history.length > 0 ? new Date(customer.history[customer.history.length - 1].checkinTime).toLocaleDateString() : 'No visits';
    row.innerHTML = `
      <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${customer.name}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${customer.aadhar}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${customer.phoneNumber || '-'}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${customer.history ? customer.history.length : 0}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${lastVisit}</td>
      <td class="px-6 py-4 whitespace-nowrap text-sm font-medium">
        <button onclick="viewCustomerDetails('${customer.aadhar}')" class="text-blue-600 hover:text-blue-900">View Details</button>
      </td>
    `;
    customersTable.appendChild(row);
  });
}

function viewCustomerDetails(aadhar) {
  const customer = findCustomerByAadhar(aadhar);
  if (!customer) return;
  closeAllCustomersModal();
  const availableRoom = rooms.find(r => r.status === 'available');
  if (availableRoom) {
    openRoomModal(availableRoom.id);
    setTimeout(() => {
      document.getElementById('customerName').value = customer.name;
      document.getElementById('aadharNumber').value = customer.aadhar;
      document.getElementById('phoneNumber').value = customer.phoneNumber || '';
      showCustomerHistory(customer);
    }, 120);
  } else {
    showNotification('No available rooms to assign customer!', 'error');
  }
}

document.getElementById('customerSearch').addEventListener('input', function(e) {
  const searchTerm = e.target.value.toLowerCase();
  const rows = document.querySelectorAll('#allCustomersTable tr');
  rows.forEach(row => {
    const name = row.cells[0].textContent.toLowerCase();
    const aadhar = row.cells[1].textContent.toLowerCase();
    row.style.display = (name.includes(searchTerm) || aadhar.includes(searchTerm)) ? '' : 'none';
  });
});

// ---------- Payment modal ----------
function openPaymentModal(roomId) {
  if (!currentUser || currentUser.role !== 'Owner') return;
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

function closePaymentModal() {
  document.getElementById('paymentModal').classList.add('hidden');
}

document.getElementById('paymentForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  const roomId = parseInt(document.getElementById('paymentRoomId').value);
  const idx = rooms.findIndex(r => r.id === roomId);
  if (idx === -1) return;

  const additionalPayment = parseInt(document.getElementById('additionalPayment').value) || 0;
  const paymentMode = document.getElementById('additionalPaymentMode').value;
  if (additionalPayment <= 0 || !paymentMode) {
    showNotification('Please enter a valid payment amount and select payment mode!', 'error');
    return;
  }

  // Update locally
  rooms[idx].paidAmount = (rooms[idx].paidAmount || 0) + additionalPayment;
  rooms[idx].dueAmount = Math.max(0, (rooms[idx].dueAmount || 0) - additionalPayment);

  // Persist payment to server
  try {
    const res = await fetch(`${API}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: additionalPayment, mode: paymentMode, roomId, message: `Additional payment of ₹${additionalPayment} received via ${paymentMode} for Room ${roomId}` })
    });
    if (!res.ok) throw new Error('Payment API failed');
    // Server broadcasts paymentsUpdated & notificationsUpdated
    // Update local rooms on server update; for now save local fallback
    localStorage.setItem('hotelRooms', JSON.stringify(rooms));
    saveToLocalFallback();
    renderRooms();
    updatePaymentCounters();
    updateDuePaymentsTable();
    updateTotalDue();
    closePaymentModal();
    showNotification(`Payment of ₹${additionalPayment} received via ${paymentMode} for Room ${roomId}!`, 'success');
    addNotification(`Additional payment of ₹${additionalPayment} received via ${paymentMode} for Room ${roomId}`);
  } catch (err) {
    // fallback local
    localStorage.setItem('hotelRooms', JSON.stringify(rooms));
    payments[paymentMode === 'cash' ? 'cash' : 'upi'] += additionalPayment;
    const today = new Date().toDateString();
    const cm = new Date().getMonth();
    const cy = new Date().getFullYear();
    if (!payments.lastUpdated || new Date(payments.lastUpdated).toDateString() !== today) payments.dayRevenue = additionalPayment;
    else payments.dayRevenue += additionalPayment;
    if (!payments.lastUpdated || new Date(payments.lastUpdated).getMonth() !== cm || new Date(payments.lastUpdated).getFullYear() !== cy) payments.monthRevenue = additionalPayment;
    else payments.monthRevenue += additionalPayment;
    payments.lastUpdated = new Date().toISOString();
    localStorage.setItem('hotelPayments', JSON.stringify(payments));
    saveToLocalFallback();
    renderRooms();
    updatePaymentCounters();
    updateDuePaymentsTable();
    updateTotalDue();
    closePaymentModal();
    showNotification('Payment recorded locally (server unavailable).', 'error');
  }
});

// ---------- Utility: notifications UI ----------
function showNotification(message, type) {
  const notification = document.createElement('div');
  notification.className = `fixed top-4 right-4 px-6 py-3 rounded-lg shadow-lg text-white fade-in z-50 ${type === 'success' ? 'bg-green-500' : 'bg-red-500'}`;
  notification.innerHTML = `<div class="flex items-center"><i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'} mr-2"></i>${message}</div>`;
  document.body.appendChild(notification);
  setTimeout(() => notification.remove(), 3000);
}

// ---------- Input handlers ----------
document.getElementById('roomStatus').addEventListener('change', function(e) {
  const customerDetails = document.getElementById('customerDetails');
  if (e.target.value === 'occupied') {
    customerDetails.style.display = 'block';
    calculateTotalAmount();
  } else {
    customerDetails.style.display = 'none';
  }
});

// ---------- Initialization on page load ----------
document.addEventListener('DOMContentLoaded', function() {
  // set default checkin/checkout
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  const checkin = document.getElementById('checkinTime');
  const checkout = document.getElementById('checkoutTime');
  if (checkin) checkin.value = now.toISOString().slice(0, 16);
  if (checkout) {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    checkout.value = tomorrow.toISOString().slice(0, 16);
  }

  // load data (if user logs in later, this will refresh)
  loadInitialData();
});

// close notification dropdown when clicking outside
document.addEventListener('click', function(e) {
  const notificationContainer = document.getElementById('notificationContainer');
  const notificationDropdown = document.getElementById('notificationDropdown');
  if (notificationContainer && notificationDropdown && !notificationContainer.contains(e.target)) {
    notificationDropdown.classList.add('hidden');
  }
});

// (ALL your room modal, payment, notifications & UI functions stay unchanged)
// (No change needed in HTML or CSS)

