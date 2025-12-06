// script.js - JWT-enabled frontend for the hotel system
// Replaces the previous script.js. Expects /api/login, /api/rooms, /api/payments, /api/customers, /api/notifications

const API = location.origin + '/api';
let socket = null;

// ---------- Auth helpers ----------
function getToken() {
  return localStorage.getItem('token');
}

function setToken(token) {
  localStorage.setItem('token', token);
}

function removeToken() {
  localStorage.removeItem('token');
  localStorage.removeItem('role');
}

function setRole(role) {
  localStorage.setItem('role', role);
}
function getRole() {
  return localStorage.getItem('role');
}

function parseJwt(token) {
  try {
    const payload = token.split('.')[1];
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decodeURIComponent(escape(decoded)));
  } catch (e) {
    return null;
  }
}

let autoLogoutTimer = null;
function scheduleAutoLogout(token) {
  if (!token) return;
  const payload = parseJwt(token);
  if (!payload || !payload.exp) return;
  const expMs = payload.exp * 1000;
  const now = Date.now();
  const msLeft = expMs - now;
  if (autoLogoutTimer) {
    clearTimeout(autoLogoutTimer);
    autoLogoutTimer = null;
  }
  if (msLeft <= 0) {
    // already expired
    logout(true);
  } else {
    autoLogoutTimer = setTimeout(() => {
      logout(true);
    }, msLeft + 1000); // give small slack
  }
}

// Called to create header object for authenticated requests
function authHeader() {
  const token = getToken();
  if (!token) return {};
  return { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
}

// simple wrapper for fetch to always include auth header and handle 401/403
async function fetchWithAuth(url, opts = {}) {
  opts.headers = { ...(opts.headers || {}), ...authHeader() };
  try {
    const res = await fetch(url, opts);
    if (res.status === 401 || res.status === 403) {
      // token invalid or expired
      showNotification('Session expired or unauthorized. Please login again.', 'error');
      logout(true);
      throw new Error('Unauthorized');
    }
    return res;
  } catch (e) {
    throw e;
  }
}

// ---------- Socket connection (attach token in auth) ----------
function connectSocket() {
  // disconnect existing socket if present
  if (socket && socket.connected) {
    try { socket.disconnect(); } catch (e) {}
    socket = null;
  }

  const token = getToken();
  // only connect if socket.io client library is loaded
  if (typeof io === 'undefined') return;
  // pass token in auth payload
  socket = io({ auth: { token } });

  socket.on('connect', () => {
    console.log('Socket connected', socket.id);
  });

  socket.on('disconnect', (reason) => {
    console.log('Socket disconnected', reason);
  });

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

// ---------- Data & Local fallback ----------
const defaultPayments = { cash: 0, upi: 0, dayRevenue: 0, monthRevenue: 0, lastUpdated: null };
let rooms = [];
let payments = JSON.parse(localStorage.getItem('hotelPayments')) || defaultPayments;
let notifications = JSON.parse(localStorage.getItem('hotelNotifications')) || [];
let customersDB = JSON.parse(localStorage.getItem('hotelCustomersDB')) || [];

function saveToLocalFallback() {
  localStorage.setItem('hotelRooms', JSON.stringify(rooms));
  localStorage.setItem('hotelPayments', JSON.stringify(payments));
  localStorage.setItem('hotelCustomersDB', JSON.stringify(customersDB));
  localStorage.setItem('hotelNotifications', JSON.stringify(notifications));
}

// ---------- Initial data load ----------
async function loadInitialData() {
  const token = getToken();
  if (!token) {
    // No token: we can still show local fallback
    rooms = JSON.parse(localStorage.getItem('hotelRooms')) || generateDefaultRooms();
    payments = JSON.parse(localStorage.getItem('hotelPayments')) || defaultPayments;
    customersDB = JSON.parse(localStorage.getItem('hotelCustomersDB')) || [];
    notifications = JSON.parse(localStorage.getItem('hotelNotifications')) || [];
    applyDataToUI();
    return;
  }

  try {
    const [roomsRes, paymentsRes, customersRes, notifsRes] = await Promise.all([
      fetchWithAuth(`${API}/rooms`),
      fetchWithAuth(`${API}/payments`),
      fetchWithAuth(`${API}/customers`),
      fetchWithAuth(`${API}/notifications`)
    ]);

    // payments/customers/notifications endpoints are owner-only; the server may respond 403 for manager
    // so handle each individually:
    if (roomsRes && roomsRes.ok) rooms = await roomsRes.json();
    else rooms = JSON.parse(localStorage.getItem('hotelRooms')) || generateDefaultRooms();

    if (paymentsRes && paymentsRes.ok) payments = await paymentsRes.json();
    else payments = JSON.parse(localStorage.getItem('hotelPayments')) || defaultPayments;

    if (customersRes && customersRes.ok) customersDB = await customersRes.json();
    else customersDB = JSON.parse(localStorage.getItem('hotelCustomersDB')) || [];

    if (notifsRes && notifsRes.ok) notifications = await notifsRes.json();
    else notifications = JSON.parse(localStorage.getItem('hotelNotifications')) || [];

    saveToLocalFallback();
    applyDataToUI();
  } catch (e) {
    console.warn('API load failed, using localStorage fallback.', e);
    rooms = JSON.parse(localStorage.getItem('hotelRooms')) || generateDefaultRooms();
    payments = JSON.parse(localStorage.getItem('hotelPayments')) || defaultPayments;
    customersDB = JSON.parse(localStorage.getItem('hotelCustomersDB')) || [];
    notifications = JSON.parse(localStorage.getItem('hotelNotifications')) || [];
    applyDataToUI();
  }
}

function applyDataToUI() {
  renderRooms();
  updateStats();
  updatePaymentCounters();
  updateDuePaymentsTable();
  updateTotalDue();
  updateNotificationBadge();
}

// ---------- Utility: generate default rooms ----------
function generateDefaultRooms() {
  const arr = [];
  for (let i = 1; i <= 29; i++) arr.push({
    id: i, status: 'available',
    price: 1000 + Math.floor(Math.random() * 2000),
    customerName: '', numberOfPersons: 1, aadharNumber: '', phoneNumber: '',
    checkinTime: '', checkoutTime: '', paymentMode: '', totalAmount: 0, paidAmount: 0, dueAmount: 0
  });
  localStorage.setItem('hotelRooms', JSON.stringify(arr));
  return arr;
}

// ---------- Login flow ----------
document.getElementById('loginForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value.trim();
  try {
    const res = await fetch(`${API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    if (!res.ok) {
      showNotification('Invalid username or password', 'error');
      return;
    }
    const data = await res.json();
    if (data && data.token) {
      setToken(data.token);
      setRole(data.role || '');
      scheduleAutoLogout(data.token);
      connectSocket();
      // show dashboard
      document.getElementById('loginScreen').classList.add('hidden');
      document.getElementById('dashboardScreen').classList.remove('hidden');
      if (data.role === 'Owner') document.getElementById('dashboardScreen').classList.add('owner-visible');
      // load data
      await loadInitialData();
      showNotification('Login successful', 'success');
    } else {
      showNotification('Login failed', 'error');
    }
  } catch (err) {
    console.error(err);
    showNotification('Login failed (server unreachable)', 'error');
  }
});

function logout(silent = false) {
  removeToken();
  if (socket && socket.connected) socket.disconnect();
  if (!silent) showNotification('Logged out', 'success');
  document.getElementById('dashboardScreen').classList.add('hidden');
  document.getElementById('loginScreen').classList.remove('hidden');
  document.getElementById('dashboardScreen').classList.remove('owner-visible');
  // clear UI state if needed
  rooms = JSON.parse(localStorage.getItem('hotelRooms')) || generateDefaultRooms();
  payments = JSON.parse(localStorage.getItem('hotelPayments')) || defaultPayments;
  notifications = JSON.parse(localStorage.getItem('hotelNotifications')) || [];
  customersDB = JSON.parse(localStorage.getItem('hotelCustomersDB')) || [];
  applyDataToUI();
}

// ---------- Render Rooms & UI helpers (unchanged logic from original) ----------
function renderRooms() {
  const roomGrid = document.getElementById('roomGrid');
  roomGrid.innerHTML = '';
  rooms.forEach(room => {
    const roomBox = document.createElement('div');
    roomBox.className = `room-box rounded-lg p-4 text-white cursor-pointer ${getRoomClass(room.status)}`;
    roomBox.onclick = () => openRoomModal(room.id);

    let customerInfo = '';
    if (room.status === 'occupied' && room.customerName) {
      customerInfo = `<p class="text-xs mt-1 truncate">${room.customerName}</p>`;
      if (room.numberOfPersons) customerInfo += `<p class="text-xs mt-1">${room.numberOfPersons} ${room.numberOfPersons > 1 ? 'persons' : 'person'}</p>`;
      if (room.dueAmount > 0) customerInfo += `<p class="text-xs mt-1 font-bold">Due: ₹${room.dueAmount}</p>`;
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
  if (getRole() === 'Owner') {
    const totalDue = rooms.reduce((sum, room) => sum + (room.dueAmount || 0), 0);
    const totalDueElement = document.getElementById('totalDue');
    if (totalDueElement) totalDueElement.textContent = `₹${totalDue}`;
  }
}

function updateDuePaymentsTable() {
  if (getRole() !== 'Owner') return;
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
function updateNotificationBadge() {
  const badge = document.getElementById('notificationBadge');
  if (!badge) return;
  if (notifications && notifications.length > 0) {
    badge.textContent = notifications.length;
    badge.classList.remove('hidden');
  } else badge.classList.add('hidden');
}

function loadNotifications() {
  const list = document.getElementById('notificationList');
  if (!list) return;
  list.innerHTML = '';
  if (!notifications || notifications.length === 0) {
    list.innerHTML = '<p class="p-4 text-gray-500 text-center">No notifications</p>';
    return;
  }
  notifications.forEach(n => {
    const d = document.createElement('div');
    d.className = 'p-4 border-b hover:bg-gray-50';
    d.innerHTML = `<p class="text-gray-800">${n.message}</p><p class="text-xs text-gray-500 mt-2">${new Date(n.timestamp).toLocaleString()}</p>`;
    list.appendChild(d);
  });
}

function addNotification(message) {
  const n = { message, timestamp: new Date().toISOString() };
  notifications.push(n);
  saveToLocalFallback();
  updateNotificationBadge();
  // Try to notify server (POST /api/payments with message is allowed for Owner only in backend)
  (async () => {
    try {
      await fetchWithAuth(`${API}/payments`, {
        method: 'POST',
        body: JSON.stringify({ amount: 0, mode: '', message })
      });
    } catch (e) { /* ignore */ }
  })();
}

// ---------- customer DB helpers ----------
function findCustomerByAadhar(aadhar) {
  return customersDB.find(c => c.aadhar === aadhar);
}

function addCustomer(customer) {
  customer.id = Date.now().toString(36) + Math.random().toString(36).substr(2);
  customer.createdAt = new Date().toISOString();
  customer.history = customer.history || [];
  customersDB.push(customer);
  saveToLocalFallback();
  return customer;
}

function updateCustomerHistory(aadhar, bookingInfo) {
  const idx = customersDB.findIndex(c => c.aadhar === aadhar);
  if (idx !== -1) {
    customersDB[idx].history = customersDB[idx].history || [];
    customersDB[idx].history.push(bookingInfo);
    saveToLocalFallback();
  }
}

// ---------- Room modal & editing ----------
document.getElementById('aadharNumber').addEventListener('input', function (e) {
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

  if (getRole() === 'Manager') document.getElementById('roomPrice').setAttribute('readonly', true);
  else document.getElementById('roomPrice').removeAttribute('readonly');

  if (room.status !== 'occupied') document.getElementById('customerDetails').style.display = 'none';
  else {
    document.getElementById('customerDetails').style.display = 'block';
    calculateTotalAmount();
    if (room.aadharNumber) {
      const cust = findCustomerByAadhar(room.aadharNumber);
      if (cust) showCustomerHistory(cust);
    }
  }

  document.getElementById('roomModal').classList.remove('hidden');
}

function closeModal() { document.getElementById('roomModal').classList.add('hidden'); }

function calculateTotalAmount() {
  const roomPrice = parseInt(document.getElementById('roomPrice').value) || 0;
  const checkinVal = document.getElementById('checkinTime').value;
  const checkoutVal = document.getElementById('checkoutTime').value;
  const checkinTime = checkinVal ? new Date(checkinVal) : null;
  const checkoutTime = checkoutVal ? new Date(checkoutVal) : null;

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

// Room form submit: PUT /api/rooms/:id (requires token); if owner and payment occurred, POST /api/payments
document.getElementById('roomForm').addEventListener('submit', async function (e) {
  e.preventDefault();
  const roomId = parseInt(document.getElementById('roomId').value);
  const idx = rooms.findIndex(r => r.id === roomId);
  if (idx === -1) return;

  const oldPaid = rooms[idx].paidAmount || 0;
  const oldStatus = rooms[idx].status;
  const newStatus = document.getElementById('roomStatus').value;
  const newPaymentMode = document.getElementById('paymentMode').value;
  const roomPrice = parseInt(document.getElementById('roomPrice').value) || 0;

  let totalAmount = 0;
  if (newStatus === 'occupied') {
    const ci = document.getElementById('checkinTime').value;
    const co = document.getElementById('checkoutTime').value;
    if (ci && co) {
      const checkin = new Date(ci), checkout = new Date(co);
      if (checkin < checkout) {
        const days = Math.max(1, Math.ceil((checkout - checkin) / (1000 * 60 * 60 * 24)));
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

  // update customer DB locally (server updates customers only via PUT in server version)
  if (aadharNumber) {
    let c = findCustomerByAadhar(aadharNumber);
    if (!c) c = addCustomer({ name: customerName, aadhar: aadharNumber, phoneNumber });
  }

  const updatedRoom = {
    ...rooms[idx],
    status: newStatus,
    price: roomPrice,
    customerName, numberOfPersons, aadharNumber, phoneNumber,
    checkinTime, checkoutTime, paymentMode: newPaymentMode,
    totalAmount, paidAmount, dueAmount
  };

  // update customer history locally
  if (newStatus === 'occupied' && aadharNumber) {
    updateCustomerHistory(aadharNumber, { roomId, checkinTime, checkoutTime, totalAmount, paidAmount, dueAmount });
  }

  // Attempt to persist to server
  const token = getToken();
  if (!token) {
    // local fallback
    rooms[idx] = updatedRoom;
    saveToLocalFallback();
    renderRooms();
    updateStats();
    updatePaymentCounters();
    updateDuePaymentsTable();
    updateTotalDue();
    closeModal();
    showNotification('Updated locally (login required to sync).', 'error');
    return;
  }

  try {
    // prepare body; do NOT include huge or extraneous fields
    const body = { ...updatedRoom };
    // send PUT to update room
    const res = await fetchWithAuth(`${API}/rooms/${roomId}`, {
      method: 'PUT',
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('Room update failed');
    // If owner and paid amount increased, call payments endpoint to register revenue/notifications
    const payInc = paidAmount - (oldPaid || 0);
    if (payInc > 0 && getRole() === 'Owner') {
      // call /api/payments (owner-only)
      try {
        await fetchWithAuth(`${API}/payments`, {
          method: 'POST',
          body: JSON.stringify({ amount: payInc, mode: newPaymentMode || 'cash' })
        });
      } catch (e) {
        // ignore; server may be temporarily unavailable
      }
    }
    // optimistic update locally; server will broadcast via socket
    rooms[idx] = updatedRoom;
    saveToLocalFallback();
    renderRooms();
    updateStats();
    updatePaymentCounters();
    updateDuePaymentsTable();
    updateTotalDue();
    closeModal();
    showNotification('Room updated on server.', 'success');
  } catch (err) {
    console.warn('Server update failed, saving local', err);
    rooms[idx] = updatedRoom;
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

// ---------- Payments modal ----------
function openPaymentModal(roomId) {
  if (getRole() !== 'Owner') return;
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
  const roomId = parseInt(document.getElementById('paymentRoomId').value);
  const idx = rooms.findIndex(r => r.id === roomId);
  if (idx === -1) return;
  const additionalPayment = parseInt(document.getElementById('additionalPayment').value) || 0;
  const paymentMode = document.getElementById('additionalPaymentMode').value;
  if (additionalPayment <= 0 || !paymentMode) { showNotification('Enter amount & mode', 'error'); return; }

  // Update local room
  rooms[idx].paidAmount = (rooms[idx].paidAmount || 0) + additionalPayment;
  rooms[idx].dueAmount = Math.max(0, (rooms[idx].dueAmount || 0) - additionalPayment);

  // Persist payment to server (owner-only)
  try {
    const res = await fetchWithAuth(`${API}/payments`, {
      method: 'POST',
      body: JSON.stringify({ amount: additionalPayment, mode: paymentMode, roomId })
    });
    if (!res.ok) throw new Error('Payment API failed');
    // update local state; server will broadcast
    saveToLocalFallback();
    renderRooms();
    updatePaymentCounters();
    updateDuePaymentsTable();
    updateTotalDue();
    closePaymentModal();
    showNotification(`Payment of ₹${additionalPayment} recorded.`, 'success');
    addNotification(`Additional payment of ₹${additionalPayment} received via ${paymentMode} for Room ${roomId}`);
    // also update room on server (roomsUpdated emission from server PUT will handle final sync)
    try {
      await fetchWithAuth(`${API}/rooms/${roomId}`, {
        method: 'PUT',
        body: JSON.stringify(rooms[idx])
      });
    } catch (e) { /* ignore */ }
  } catch (err) {
    // fallback local
    saveToLocalFallback();
    renderRooms();
    updatePaymentCounters();
    updateDuePaymentsTable();
    updateTotalDue();
    closePaymentModal();
    showNotification('Payment recorded locally (server unavailable).', 'error');
  }
});

// ---------- Customers modal ----------
function openAllCustomersModal() {
  if (getRole() !== 'Owner') { showNotification('Only owner can view all customers!', 'error'); return; }
  document.getElementById('allCustomersModal').classList.remove('hidden');
  renderAllCustomers();
}
function closeAllCustomersModal() { document.getElementById('allCustomersModal').classList.add('hidden'); }

function renderAllCustomers() {
  const customersTable = document.getElementById('allCustomersTable');
  const noCustomers = document.getElementById('noCustomersFound');
  if (!customersTable || !noCustomers) return;
  customersTable.innerHTML = '';
  if (!customersDB || customersDB.length === 0) { noCustomers.classList.remove('hidden'); return; }
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
  } else showNotification('No available rooms to assign customer!', 'error');
}

document.getElementById('customerSearch').addEventListener('input', function (e) {
  const searchTerm = e.target.value.toLowerCase();
  const rows = document.querySelectorAll('#allCustomersTable tr');
  rows.forEach(row => {
    const name = row.cells[0].textContent.toLowerCase();
    const aadhar = row.cells[1].textContent.toLowerCase();
    row.style.display = (name.includes(searchTerm) || aadhar.includes(searchTerm)) ? '' : 'none';
  });
});

// ---------- Notifications clear ----------
function clearAllNotifications() {
  if (getRole() !== 'Owner') { showNotification('Only owner can clear notifications!', 'error'); return; }
  showConfirmModal('Are you sure you want to clear all notifications?', async () => {
    try {
      const res = await fetchWithAuth(`${API}/notifications`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to clear notifications on server');
      notifications = [];
      saveToLocalFallback();
      updateNotificationBadge();
      loadNotifications();
      showNotification('All notifications cleared', 'success');
    } catch (e) {
      // fallback local
      notifications = [];
      saveToLocalFallback();
      updateNotificationBadge();
      loadNotifications();
      showNotification('All notifications cleared (local)', 'success');
    }
  });
}

// ---------- Helpers: confirm & notifications ----------
function showConfirmModal(message, onConfirm) {
  const confirmModal = document.getElementById('confirmModal');
  const confirmMessage = document.getElementById('confirmMessage');
  const confirmYes = document.getElementById('confirmYes');
  const confirmNo = document.getElementById('confirmNo');

  confirmMessage.textContent = message;
  confirmModal.classList.remove('hidden');

  const newYes = confirmYes.cloneNode(true);
  confirmYes.parentNode.replaceChild(newYes, confirmYes);
  const newNo = confirmNo.cloneNode(true);
  confirmNo.parentNode.replaceChild(newNo, confirmNo);

  newYes.addEventListener('click', () => { onConfirm && onConfirm(); confirmModal.classList.add('hidden'); });
  newNo.addEventListener('click', () => confirmModal.classList.add('hidden'));
}

function showNotification(message, type) {
  const notification = document.createElement('div');
  notification.className = `fixed top-4 right-4 px-6 py-3 rounded-lg shadow-lg text-white fade-in z-50 ${type === 'success' ? 'bg-green-500' : 'bg-red-500'}`;
  notification.innerHTML = `<div class="flex items-center"><i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'} mr-2"></i>${message}</div>`;
  document.body.appendChild(notification);
  setTimeout(() => notification.remove(), 3000);
}

// ---------- Init on load ----------
document.addEventListener('DOMContentLoaded', function () {
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

  // If token exists, schedule auto logout and connect socket
  const token = getToken();
  if (token) {
    scheduleAutoLogout(token);
    connectSocket();
    // show dashboard if user was previously logged in
    const role = getRole();
    if (role) {
      document.getElementById('loginScreen').classList.add('hidden');
      document.getElementById('dashboardScreen').classList.remove('hidden');
      if (role === 'Owner') document.getElementById('dashboardScreen').classList.add('owner-visible');
    }
  }

  loadInitialData();
});

// close notification dropdown when clicking outside
document.addEventListener('click', function (e) {
  const notificationContainer = document.getElementById('notificationContainer');
  const notificationDropdown = document.getElementById('notificationDropdown');
  if (notificationContainer && notificationDropdown && !notificationContainer.contains(e.target)) {
    notificationDropdown.classList.add('hidden');
  }
});
