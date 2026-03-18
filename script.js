const API_BASE = window.location.origin;
const API = API_BASE + '/api';

let authToken = localStorage.getItem('authToken');
let userRole = localStorage.getItem('userRole');
let rooms = [];
let payments = {};

document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('username')?.value; 
  const passcode = document.getElementById('passcode')?.value;

  try {
    const res = await fetch(`${API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, passcode })
    });

    const data = await res.json();
    if (res.ok) {
      authToken = data.token;
      userRole = data.role; 
      localStorage.setItem('authToken', authToken);
      localStorage.setItem('userRole', userRole);
      showDashboard();
    } else alert(data.error || 'Login failed');
  } catch (err) { alert('Server error: ' + err.message); }
});

function authHeader() {
  return { Authorization: 'Bearer ' + (authToken || ''), 'Content-Type': 'application/json' };
}

function showDashboard() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('dashboardScreen').classList.remove('hidden');
  document.getElementById('userRole').textContent = userRole;
  document.getElementById('dashboardActions').classList.remove('hidden');

  if (userRole === 'Owner') {
    document.getElementById('ownerPanel').classList.remove('hidden');
    document.getElementById('shiftRoomBtn').classList.remove('hidden');
    document.getElementById('pdfBtnBalances').classList.remove('hidden');
    document.getElementById('pdfBtnDaily').classList.remove('hidden');
    document.getElementById('pdfBtnMonthly').classList.remove('hidden');
  } else {
    // Hide Owner-exclusive features from Manager
    document.getElementById('ownerPanel').classList.add('hidden');
    document.getElementById('shiftRoomBtn').classList.add('hidden');
    document.getElementById('pdfBtnBalances').classList.add('hidden');
    document.getElementById('pdfBtnDaily').classList.add('hidden');
    document.getElementById('pdfBtnMonthly').classList.add('hidden');
  }

  loadRooms();
}

async function loadRooms() {
  try {
    const res = await fetch(`${API}/rooms`, { headers: authHeader() });
    rooms = await res.json();
    renderRooms();
    updateStats();
    if (userRole === 'Owner') loadPayments();
  } catch (err) { console.error(err); }
}

async function loadPayments() {
  try {
    const res = await fetch(`${API}/payments`, { headers: authHeader() });
    payments = await res.json();
    document.getElementById('dayRevenue').textContent = '₹' + (payments.dayRevenue || 0);
    document.getElementById('monthRevenue').textContent = '₹' + (payments.monthRevenue || 0);
    document.getElementById('totalBalance').textContent = '₹' + (rooms.reduce((sum, r) => sum + (r.balance > 0 ? r.balance : 0), 0));
  } catch (err) { console.error(err); }
}

function renderRooms() {
  const grid = document.getElementById('roomGrid');
  grid.innerHTML = '';
  rooms.forEach(room => {
    const div = document.createElement('div');
    div.className = `room-box rounded-lg p-4 text-white cursor-pointer room-${room.status}`;
    div.innerHTML = `
      <div class="text-center">
        <p class="font-bold text-lg">${room.name}</p>
        <p class="text-xs mt-1 capitalize">${room.status}</p>
        ${room.customerName ? `<p class="text-xs mt-1 truncate">${room.customerName}</p>` : ''}
        ${room.balance > 0 ? `<p class="text-xs mt-1 font-bold">Due: ₹${room.balance}</p>` : ''}
      </div>
    `;
    div.onclick = () => openRoomModal(room.id);
    grid.appendChild(div);
  });
}

function updateStats() {
  document.getElementById('availableCount').textContent = rooms.filter(r => r.status === 'available').length;
  document.getElementById('occupiedCount').textContent = rooms.filter(r => r.status === 'occupied').length;
  document.getElementById('maintenanceCount').textContent = rooms.filter(r => r.status === 'maintenance').length;
}

function openRoomModal(roomId) {
  const room = rooms.find(r => r.id === roomId);
  if (!room) return;

  document.getElementById('roomId').value = roomId;

  if (room.status === 'available') {
    document.getElementById('checkinForm').classList.remove('hidden');
    document.getElementById('occupiedInfo').classList.add('hidden');
    document.getElementById('rent').value = '';
    document.getElementById('advance').value = '';
    document.getElementById('customerName').value = '';
    document.getElementById('aadharNumber').value = '';
    document.getElementById('checkinTime').value = '';
    document.getElementById('numberOfPersons').value = 1;
    document.getElementById('phoneNumber').value = '';
  } else {
    document.getElementById('checkinForm').classList.add('hidden');
    document.getElementById('occupiedInfo').classList.remove('hidden');
    document.getElementById('dispCustomer').textContent = room.customerName || '-';
    document.getElementById('dispAdvance').textContent = '₹' + (room.advance || 0);
    document.getElementById('dispDue').textContent = '₹' + (room.balance || 0);
    document.getElementById('subPayment').value = '';
    document.getElementById('checkoutBtn').disabled = room.balance > 0;
  }

  document.getElementById('roomModal').classList.remove('hidden');
}

async function checkIn() {
  const roomId = Number(document.getElementById('roomId').value);
  const rent = Number(document.getElementById('rent').value);
  const advance = Number(document.getElementById('advance').value);
  const customerName = document.getElementById('customerName').value;
  const aadharNumber = document.getElementById('aadharNumber').value;
  const checkinTime = document.getElementById('checkinTime').value;
  const numberOfPersons = Number(document.getElementById('numberOfPersons').value);
  const phoneNumber = document.getElementById('phoneNumber').value;

  if (!rent || !customerName || !aadharNumber || !checkinTime || !phoneNumber) {
    alert('All required fields must be filled');
    return;
  }

  try {
    const res = await fetch(`${API}/rooms/${roomId}`, {
      method: 'PUT',
      headers: authHeader(),
      body: JSON.stringify({
        status: 'occupied', rent, advance, customerName, aadharNumber, phoneNumber, numberOfPersons, checkinTime
      })
    });

    if (res.ok) {
      alert('Check-in successful');
      closeRoomModal();
      loadRooms();
    } else alert('Check-in failed');
  } catch (err) { alert('Error: ' + err.message); }
}

async function addPayment() {
  const roomId = Number(document.getElementById('roomId').value);
  const amount = Number(document.getElementById('subPayment').value);

  if (!amount) { alert('Enter payment amount'); return; }

  try {
    const res = await fetch(`${API}/payment`, {
      method: 'POST',
      headers: authHeader(),
      body: JSON.stringify({ roomId, amount })
    });

    if (res.ok) {
      alert('Payment added');
      loadRooms();
      openRoomModal(roomId);
    }
  } catch (err) { alert('Error: ' + err.message); }
}

async function checkout() {
  const roomId = Number(document.getElementById('roomId').value);
  const room = rooms.find(r => r.id === roomId);

  if (room.balance > 0) {
    alert(`Cannot checkout. Pending balance of ₹${room.balance}`);
    return;
  }

  try {
    const res = await fetch(`${API}/checkout/${roomId}`, { method: 'POST', headers: authHeader() });
    if (res.ok) {
      alert('Checkout successful');
      closeRoomModal();
      loadRooms();
    } else {
        const errData = await res.json();
        alert('Error: ' + errData.error);
    }
  } catch (err) { alert('Error: ' + err.message); }
}

function openPDFModal() { document.getElementById('pdfModal').classList.remove('hidden'); }
function closePDFModal() { document.getElementById('pdfModal').classList.add('hidden'); }

async function exportPDF(type) {
  try {
    const res = await fetch(`${API}/export/${type}`, { method: 'GET', headers: authHeader() });
    if (!res.ok) throw new Error((await res.json()).error || 'Failed to generate PDF');

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${type}-report.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
    closePDFModal();
  } catch (err) { alert('Error: ' + err.message); }
}

function closeRoomModal() { document.getElementById('roomModal').classList.add('hidden'); }
function logout() { localStorage.removeItem('authToken'); localStorage.removeItem('userRole'); location.reload(); }

if (authToken && userRole) showDashboard();
