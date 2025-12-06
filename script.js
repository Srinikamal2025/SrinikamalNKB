/* script.js — FULL FIXED (Part 1 of 3)
   - Immediate customer fields when status=occupied
   - Robust customersDB handling
   - Counters and payments fixed
   - Uses backend at https://srinikamalnkb.onrender.com
*/

const API_BASE = "https://srinikamalnkb.onrender.com";
const API = API_BASE + "/api";
const SOCKET_URL = API_BASE;

// --- Auth helpers ---
function getToken(){ return localStorage.getItem("authToken") || ""; }
function setToken(t){ if(t) localStorage.setItem("authToken", t); else localStorage.removeItem("authToken"); }
function getRole(){ return localStorage.getItem("userRole") || ""; }
function setRole(r){ if(r) localStorage.setItem("userRole", r); else localStorage.removeItem("userRole"); }

function authHeader() {
  const token = getToken();
  return token ? { "Authorization": "Bearer " + token, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

async function fetchWithAuth(url, opts = {}) {
  opts.headers = { ...(opts.headers || {}), ...authHeader() };
  if (opts.body && typeof opts.body !== "string") opts.body = JSON.stringify(opts.body);
  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    // network error
    const e = new Error("NetworkError");
    e._network = true;
    throw e;
  }
  if (res.status === 401 || res.status === 403) {
    // invalid token: logout
    logout(true);
    const err = new Error("Unauthorized");
    err._status = res.status;
    throw err;
  }
  return res;
}

// --- Socket.IO setup ---
let socket = null;
function connectSocket() {
  try { if (socket && socket.connected) socket.disconnect(); } catch(e){}
  socket = io(SOCKET_URL, { auth: { token: getToken() } });

  socket.on("connect", () => console.log("socket connected", socket.id));
  socket.on("disconnect", (r) => console.log("socket disconnected", r));

  socket.on("roomsUpdated", (arr) => {
    if (Array.isArray(arr)) {
      rooms = arr;
      saveLocal();
      renderRooms();
      updateStats();
      updateDuePaymentsTable();
      updateTotalDue();
    }
  });
  socket.on("paymentsUpdated", (p) => {
    if (p && typeof p === "object") { payments = p; saveLocal(); updatePaymentCounters(); }
  });
  socket.on("customersUpdated", (c) => {
    if (Array.isArray(c)) { customersDB = c; saveLocal(); }
  });
  socket.on("notificationsUpdated", (n) => {
    if (Array.isArray(n)) { notifications = n; saveLocal(); updateNotificationBadge(); loadNotifications(); }
  });
}

// --- Local fallback storage & initial state ---
let rooms = [];
let payments = { cash:0, upi:0, dayRevenue:0, monthRevenue:0 };
let customersDB = [];
let notifications = [];

function loadLocalState() {
  try {
    const r = JSON.parse(localStorage.getItem("hotelRooms") || "null");
    rooms = Array.isArray(r) ? r : [];
  } catch { rooms = []; }

  try {
    const p = JSON.parse(localStorage.getItem("hotelPayments") || "null");
    payments = (p && typeof p === "object") ? p : { cash:0, upi:0, dayRevenue:0, monthRevenue:0 };
  } catch { payments = { cash:0, upi:0, dayRevenue:0, monthRevenue:0 }; }

  try {
    const c = JSON.parse(localStorage.getItem("hotelCustomersDB") || "null");
    customersDB = Array.isArray(c) ? c : [];
  } catch { customersDB = []; }

  try {
    const n = JSON.parse(localStorage.getItem("hotelNotifications") || "null");
    notifications = Array.isArray(n) ? n : [];
  } catch { notifications = []; }
}

function saveLocal() {
  try {
    localStorage.setItem("hotelRooms", JSON.stringify(rooms));
    localStorage.setItem("hotelPayments", JSON.stringify(payments));
    localStorage.setItem("hotelCustomersDB", JSON.stringify(customersDB));
    localStorage.setItem("hotelNotifications", JSON.stringify(notifications));
  } catch(e) { console.warn("saveLocal failed", e); }
}

function generateDefaultRooms() {
  if (rooms && rooms.length) return;
  rooms = [];
  for (let i=1;i<=29;i++){
    rooms.push({
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
  saveLocal();
}
loadLocalState();
generateDefaultRooms();
applyDataToUIIfExists(); // helper defined later to only apply UI if DOM present
/* script.js — FULL FIXED (Part 2 of 3)
   Continued: UI rendering, login, data load, modals
*/

// ---------- AUTH FLOW & LOGIN ----------
document.getElementById("loginForm") && document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = (document.getElementById("username")||{}).value || "";
  const password = (document.getElementById("password")||{}).value || "";
  if (!username || !password) { showNotification("Enter username and password", "error"); return; }

  try {
    const res = await fetchWithAuth(`${API}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: { username, password }
    });
    const data = await res.json();
    if (!res.ok) { showNotification(data.error || "Login failed", "error"); return; }
    setToken(data.token);
    setRole(data.role || "");
    connectSocket();
    document.getElementById("loginScreen") && document.getElementById("loginScreen").classList.add("hidden");
    document.getElementById("dashboardScreen") && document.getElementById("dashboardScreen").classList.remove("hidden");
    if (data.role === "Owner") document.getElementById("dashboardScreen").classList.add("owner-visible");
    document.getElementById("userRole") && (document.getElementById("userRole").textContent = data.role || "");
    await loadInitialData();
    showNotification("Login successful", "success");
  } catch (err) {
    if (err._network) showNotification("Cannot reach server", "error");
    else showNotification("Login error", "error");
    console.error("login error", err);
  }
});

// Auto-login if token exists on load
if (getToken()) {
  connectSocket();
  document.getElementById("loginScreen") && document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("dashboardScreen") && document.getElementById("dashboardScreen").classList.remove("hidden");
  const role = getRole();
  if (role === "Owner") document.getElementById("dashboardScreen").classList.add("owner-visible");
  document.getElementById("userRole") && (document.getElementById("userRole").textContent = role);
  loadInitialData().catch(()=>{});
}

// ---------- LOAD INITIAL DATA ----------
async function loadInitialData() {
  // rooms
  try {
    const r = await fetchWithAuth(`${API}/rooms`);
    if (r.ok) {
      const arr = await r.json();
      if (Array.isArray(arr)) rooms = arr;
      else console.warn("rooms not array from API");
      saveLocal();
    }
  } catch (e) { console.warn("rooms fetch failed", e); }

  // payments
  try {
    const p = await fetchWithAuth(`${API}/payments`);
    if (p.ok) {
      const pd = await p.json();
      if (pd && typeof pd === "object") payments = pd;
      saveLocal();
    }
  } catch(e){ console.warn("payments fetch failed", e); }

  // customers
  try {
    const c = await fetchWithAuth(`${API}/customers`);
    if (c.ok) {
      const cd = await c.json();
      customersDB = Array.isArray(cd) ? cd : customersDB;
      saveLocal();
    }
  } catch (e) { console.warn("customers fetch failed", e); }

  // notifications
  try {
    const n = await fetchWithAuth(`${API}/notifications`);
    if (n.ok) {
      const nd = await n.json();
      notifications = Array.isArray(nd) ? nd : notifications;
      saveLocal();
    }
  } catch(e){ console.warn("notifications fetch failed", e); }

  // apply to UI
  applyDataToUI();
}

// ---------- RENDER / UI UPDATE ----------
function applyDataToUI() {
  renderRooms();
  updateStats();
  updatePaymentCounters();
  updateDuePaymentsTable();
  updateTotalDue();
  updateNotificationBadge();
  loadNotifications();
}

function renderRooms(){
  const grid = document.getElementById("roomGrid");
  if (!grid) return;
  grid.innerHTML = "";
  rooms.forEach(room => {
    const div = document.createElement("div");
    div.className = `room-box rounded-lg p-4 text-white cursor-pointer ${room.status==='available'?'room-available':room.status==='occupied'?'room-occupied':'room-maintenance'}`;
    div.onclick = ()=> openRoomModal(room.id);
    div.innerHTML = `
      <div class="text-center">
        <i class="fas fa-bed text-2xl mb-2"></i>
        <p class="font-bold">Room ${room.id}</p>
        <p class="text-xs mt-1 capitalize">${escapeHtml(room.status)}</p>
        <p class="text-xs mt-1">₹${room.price}/day</p>
        ${room.status==='occupied' && room.customerName ? `<p class="text-xs mt-1 truncate">${escapeHtml(room.customerName)}</p>`: ''}
        ${Number(room.dueAmount || 0) > 0 ? `<p class="text-xs mt-1 font-bold text-yellow-200">Due: ₹${room.dueAmount}</p>` : ''}
      </div>
    `;
    grid.appendChild(div);
  });
}

function updateStats(){
  const avail = rooms.filter(r=>r.status==='available').length;
  const occ = rooms.filter(r=>r.status==='occupied').length;
  const maint = rooms.filter(r=>r.status==='maintenance').length;
  const elAvail = document.getElementById("availableCount");
  const elOcc = document.getElementById("occupiedCount");
  const elMaint = document.getElementById("maintenanceCount");
  if (elAvail) elAvail.textContent = avail;
  if (elOcc) elOcc.textContent = occ;
  if (elMaint) elMaint.textContent = maint;
}

function updatePaymentCounters(){
  const cashEl = document.getElementById("cashCounter");
  const upiEl = document.getElementById("upiCounter");
  const dayEl = document.getElementById("dayRevenue");
  const monthEl = document.getElementById("monthRevenue");
  if (cashEl) cashEl.textContent = `₹${payments.cash||0}`;
  if (upiEl) upiEl.textContent = `₹${payments.upi||0}`;
  if (dayEl) dayEl.textContent = `₹${payments.dayRevenue||0}`;
  if (monthEl) monthEl.textContent = `₹${payments.monthRevenue||0}`;
}

function updateTotalDue(){
  if (getRole() !== "Owner") return;
  const totalDue = rooms.reduce((s,r)=> s + (Number(r.dueAmount)||0), 0);
  const el = document.getElementById("totalDue");
  if (el) el.textContent = `₹${totalDue}`;
}

function updateDuePaymentsTable(){
  const table = document.getElementById("duePaymentsTable");
  if (!table) return;
  table.innerHTML = "";
  const dues = rooms.filter(r => r.status==='occupied' && Number(r.dueAmount || 0) > 0);
  if (!dues.length) {
    const noEl = document.getElementById("noDuePayments");
    if (noEl) noEl.style.display = "block";
    return;
  }
  const noEl = document.getElementById("noDuePayments");
  if (noEl) noEl.style.display = "none";
  dues.forEach(r=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="px-6 py-4">${r.id}</td>
      <td class="px-6 py-4">${escapeHtml(r.customerName||'-')}</td>
      <td class="px-6 py-4">₹${r.totalAmount||0}</td>
      <td class="px-6 py-4">₹${r.paidAmount||0}</td>
      <td class="px-6 py-4 text-red-600">₹${r.dueAmount||0}</td>
      <td class="px-6 py-4"><button onclick="openPaymentModal(${r.id})" class="text-blue-600">Update</button></td>`;
    table.appendChild(tr);
  });
}
/* script.js — FULL FIXED (Part 3 of 3)
   Continued: room modal submit, payments, customers, notifications, helpers
*/

// ---------- OPEN ROOM MODAL & IMMEDIATE CUSTOMER FIELDS ----------
function openRoomModal(roomId){
  const room = rooms.find(r=>r.id===roomId);
  if (!room) return;
  // populate values
  document.getElementById("roomId").value = room.id;
  document.getElementById("roomStatus").value = room.status || "available";
  document.getElementById("roomPrice").value = room.price || 1500;
  document.getElementById("customerName").value = room.customerName || "";
  document.getElementById("numberOfPersons").value = room.numberOfPersons || 1;
  document.getElementById("aadharNumber").value = room.aadharNumber || "";
  document.getElementById("phoneNumber").value = room.phoneNumber || "";
  document.getElementById("checkinTime").value = room.checkinTime || "";
  document.getElementById("checkoutTime").value = room.checkoutTime || "";
  document.getElementById("paymentMode").value = room.paymentMode || "";
  document.getElementById("paidAmount").value = room.paidAmount || 0;

  // immediate show/hide of customer block depending on status
  const customerBlock = document.getElementById("customerDetails");
  if (room.status === "occupied") customerBlock.style.display = "block"; else customerBlock.style.display = "none";

  // role based UI
  if (getRole() === "Manager") document.getElementById("roomPrice").setAttribute("readonly", true);
  else document.getElementById("roomPrice").removeAttribute("readonly");

  calculateTotalAmount();
  document.getElementById("roomModal").classList.remove("hidden");
}

// show customer fields immediately when dropdown changes
document.getElementById("roomStatus") && document.getElementById("roomStatus").addEventListener("change", function(){
  const block = document.getElementById("customerDetails");
  if (this.value === "occupied") block.style.display = "block";
  else block.style.display = "none";
});

// ---------- ROOM FORM SUBMIT ----------
document.getElementById("roomForm") && document.getElementById("roomForm").addEventListener("submit", async function(e){
  e.preventDefault();
  const roomId = Number(document.getElementById("roomId").value);
  const idx = rooms.findIndex(r=>r.id===roomId);
  if (idx === -1) return showNotification("Room not found", "error");

  const status = document.getElementById("roomStatus").value;
  const price = Number(document.getElementById("roomPrice").value) || 0;
  const customerName = (document.getElementById("customerName")||{}).value.trim();
  const numberOfPersons = Number((document.getElementById("numberOfPersons")||{}).value) || 1;
  const aadharNumber = (document.getElementById("aadharNumber")||{}).value.trim();
  const phoneNumber = (document.getElementById("phoneNumber")||{}).value.trim();
  const checkinTime = (document.getElementById("checkinTime")||{}).value || "";
  const checkoutTime = (document.getElementById("checkoutTime")||{}).value || "";
  const paymentMode = (document.getElementById("paymentMode")||{}).value || "";
  const paidAmount = Number((document.getElementById("paidAmount")||{}).value) || 0;

  // compute total/due
  let totalAmount = 0;
  if (status === "occupied" && checkinTime && checkoutTime) {
    const ci = new Date(checkinTime), co = new Date(checkoutTime);
    if (ci < co) {
      const days = Math.max(1, Math.ceil((co - ci)/(1000*60*60*24)));
      totalAmount = days * price;
    }
  }
  const dueAmount = Math.max(0, totalAmount - paidAmount);

  const updated = {
    ...rooms[idx],
    status, price, customerName, numberOfPersons, aadharNumber, phoneNumber,
    checkinTime, checkoutTime, paymentMode, totalAmount, paidAmount, dueAmount
  };

  // update local customer DB when occupied
  if (status === "occupied" && aadharNumber) {
    let cust = customersDB.find(c => c.aadhar === aadharNumber);
    if (!cust) {
      cust = { id: Date.now().toString(36), name: customerName, aadhar: aadharNumber, phoneNumber, history: [] };
      customersDB.push(cust);
    } else {
      // update name/phone if changed
      cust.name = customerName || cust.name;
      cust.phoneNumber = phoneNumber || cust.phoneNumber;
    }
    cust.history = cust.history || [];
    cust.history.push({ roomId, checkinTime, checkoutTime, totalAmount, paidAmount, dueAmount });
    saveLocal();
    // attempt to persist customer to server
    fetchWithAuth(`${API}/customers`, { method: "POST", body: { id: cust.id, name: cust.name, aadhar: cust.aadhar, phoneNumber: cust.phoneNumber, history: cust.history } })
      .then(r => { if (!r.ok) throw new Error("cust save failed"); return r.json(); })
      .catch(err => console.warn("persist customer failed", err));
  }

  // attempt to update room on server
  try {
    const res = await fetchWithAuth(`${API}/rooms/${roomId}`, { method: "PUT", body: updated });
    if (!res.ok) throw new Error("room update failed");
    // optimistic update handled by server broadcast; but update local as well
    rooms[idx] = updated;
    saveLocal();
    renderRooms(); updateStats(); updatePaymentCounters(); updateDuePaymentsTable(); updateTotalDue();
    document.getElementById("roomModal").classList.add("hidden");
    showNotification("Room updated", "success");
  } catch (err) {
    console.warn("Room update failed, saved locally", err);
    rooms[idx] = updated;
    saveLocal();
    renderRooms(); updateStats(); updateDuePaymentsTable(); updateTotalDue();
    document.getElementById("roomModal").classList.add("hidden");
    showNotification("Updated locally (server offline)", "error");
  }
});

// ---------- PAYMENTS ----------
function openPaymentModal(roomId){
  if (getRole() !== "Owner") return showNotification("Only owner can update payments", "error");
  const room = rooms.find(r=>r.id===roomId);
  if (!room) return;
  document.getElementById("paymentRoomId").value = room.id;
  document.getElementById("paymentRoomNumber").textContent = room.id;
  document.getElementById("paymentCustomerName").textContent = room.customerName || "-";
  document.getElementById("paymentTotalAmount").textContent = `₹${room.totalAmount||0}`;
  document.getElementById("paymentAlreadyPaid").textContent = `₹${room.paidAmount||0}`;
  document.getElementById("paymentDueAmount").textContent = `₹${room.dueAmount||0}`;
  document.getElementById("additionalPayment").value = "";
  document.getElementById("additionalPaymentMode").value = "cash";
  document.getElementById("paymentModal").classList.remove("hidden");
}
function closePaymentModal(){ document.getElementById("paymentModal").classList.add("hidden"); }

document.getElementById("paymentForm") && document.getElementById("paymentForm").addEventListener("submit", async function(e){
  e.preventDefault();
  if (getRole() !== "Owner") return showNotification("Only owner can accept payments", "error");
  const roomId = Number(document.getElementById("paymentRoomId").value);
  const idx = rooms.findIndex(r=>r.id===roomId);
  if (idx === -1) return;

  const amount = Number(document.getElementById("additionalPayment").value) || 0;
  const mode = document.getElementById("additionalPaymentMode").value || "cash";
  if (amount <= 0) return showNotification("Enter amount", "error");

  // update local and try to persist
  rooms[idx].paidAmount = (rooms[idx].paidAmount||0) + amount;
  rooms[idx].dueAmount = Math.max(0, (rooms[idx].totalAmount||0) - rooms[idx].paidAmount);

  try {
    const res = await fetchWithAuth(`${API}/payments`, { method: "POST", body: { amount, mode, roomId } });
    if (!res.ok) throw new Error("payments API failed");
    // update remote room as well
    try { await fetchWithAuth(`${API}/rooms/${roomId}`, { method: "PUT", body: rooms[idx] }); } catch(e){}
    saveLocal();
    renderRooms(); updatePaymentCounters(); updateDuePaymentsTable(); updateTotalDue();
    closePaymentModal();
    showNotification(`Payment ₹${amount} recorded`, "success");
    addNotification(`Payment of ₹${amount} received for Room ${roomId} via ${mode}`);
  } catch (err) {
    console.warn("Payment persist failed", err);
    saveLocal();
    renderRooms(); updatePaymentCounters(); updateDuePaymentsTable(); updateTotalDue();
    closePaymentModal();
    showNotification("Payment saved locally (server offline)", "error");
  }
});

// ---------- CUSTOMERS UI ----------
function openAllCustomersModal(){
  if (getRole() !== "Owner") return showNotification("Only owner can view customers", "error");
  document.getElementById("allCustomersModal").classList.remove("hidden");
  renderAllCustomers();
}
function closeAllCustomersModal(){ document.getElementById("allCustomersModal").classList.add("hidden"); }

function renderAllCustomers(){
  const table = document.getElementById("allCustomersTable");
  if (!table) return;
  table.innerHTML = "";
  if (!customersDB || customersDB.length === 0) {
    document.getElementById("noCustomersFound") && document.getElementById("noCustomersFound").classList.remove("hidden");
    return;
  }
  document.getElementById("noCustomersFound") && document.getElementById("noCustomersFound").classList.add("hidden");
  customersDB.forEach(c=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `<td class="px-6 py-4">${escapeHtml(c.name||"-")}</td>
      <td class="px-6 py-4">${escapeHtml(c.aadhar||"-")}</td>
      <td class="px-6 py-4">${escapeHtml(c.phoneNumber||"-")}</td>
      <td class="px-6 py-4">${c.history?c.history.length:0}</td>
      <td class="px-6 py-4">${c.history && c.history.length ? new Date(c.history[c.history.length-1].checkinTime).toLocaleDateString() : "-"}</td>
      <td class="px-6 py-4"><button class="text-blue-600" onclick="viewCustomerDetails('${c.aadhar}')">View</button></td>`;
    table.appendChild(tr);
  });
}

function viewCustomerDetails(aadhar){
  const c = customersDB.find(x=>x.aadhar === aadhar);
  if (!c) return showNotification("Customer not found", "error");
  closeAllCustomersModal();
  const avail = rooms.find(r=>r.status==="available");
  if (avail) {
    openRoomModal(avail.id);
    setTimeout(()=> {
      document.getElementById("customerName").value = c.name;
      document.getElementById("aadharNumber").value = c.aadhar;
      document.getElementById("phoneNumber").value = c.phoneNumber || '';
      showCustomerHistory(c);
    }, 150);
  } else showNotification("No available rooms", "error");
}

// ---------- NOTIFICATIONS ----------
function updateNotificationBadge(){
  const b = document.getElementById("notificationBadge");
  if (!b) return;
  if (notifications && notifications.length){ b.textContent = notifications.length; b.classList.remove("hidden"); }
  else b.classList.add("hidden");
}
function loadNotifications(){
  const list = document.getElementById("notificationList");
  if (!list) return;
  list.innerHTML = "";
  if (!notifications || notifications.length === 0) { list.innerHTML = '<p class="p-4 text-gray-500 text-center">No notifications</p>'; return; }
  notifications.forEach(n=>{
    const d = document.createElement("div");
    d.className = 'p-4 border-b hover:bg-gray-50';
    d.innerHTML = `<p class="text-gray-800">${escapeHtml(n.message)}</p><p class="text-xs text-gray-500 mt-2">${new Date(n.timestamp).toLocaleString()}</p>`;
    list.appendChild(d);
  });
}
function addNotification(msg){
  notifications.push({ message: msg, timestamp: new Date().toISOString() });
  saveLocal();
  updateNotificationBadge();
  // attempt server notify
  fetchWithAuth(`${API}/payments`, { method: "POST", body: { amount:0, mode:'', message: msg } }).catch(()=>{});
}

// ---------- HELPERS ----------
function escapeHtml(s){ if (s===undefined || s===null) return ""; return String(s).replace(/[&<>"'`=\/]/g, function(ch){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D;'})[ch]; }); }

function showNotification(message, type="success"){
  const el = document.createElement("div");
  el.className = `fixed top-4 right-4 px-6 py-3 rounded-lg shadow-lg text-white z-50 ${type==='success'?'bg-green-500':'bg-red-500'}`;
  el.innerHTML = `<div class="flex items-center"><i class="fas ${type==='success'?'fa-check-circle':'fa-exclamation-circle'} mr-2"></i>${escapeHtml(message)}</div>`;
  document.body.appendChild(el);
  setTimeout(()=> el.remove(), 3000);
}

function showConfirmModal(message, onConfirm){
  const modal = document.getElementById("confirmModal");
  if (!modal) { if (onConfirm) onConfirm(); return; }
  const msg = document.getElementById("confirmMessage");
  const yes = document.getElementById("confirmYes");
  const no = document.getElementById("confirmNo");
  msg.textContent = message;
  modal.classList.remove("hidden");
  const yes2 = yes.cloneNode(true); yes.parentNode.replaceChild(yes2, yes);
  const no2 = no.cloneNode(true); no.parentNode.replaceChild(no2, no);
  yes2.addEventListener("click", ()=>{ onConfirm && onConfirm(); modal.classList.add("hidden"); });
  no2.addEventListener("click", ()=> modal.classList.add("hidden"));
}

// ---------- LOGOUT ----------
document.getElementById("logoutBtn") && document.getElementById("logoutBtn").addEventListener("click", ()=>{
  setToken(""); setRole("");
  try{ if (socket) socket.disconnect(); } catch(e){}
  document.getElementById("dashboardScreen") && document.getElementById("dashboardScreen").classList.add("hidden");
  document.getElementById("loginScreen") && document.getElementById("loginScreen").classList.remove("hidden");
  document.getElementById("dashboardScreen") && document.getElementById("dashboardScreen").classList.remove("owner-visible");
});

// ---------- INIT ----------
function applyDataToUIIfExists(){
  // call applyDataToUI only if DOM is ready (some deploy flows call earlier)
  if (document.readyState === "complete" || document.readyState === "interactive") {
    applyDataToUI();
  } else {
    document.addEventListener("DOMContentLoaded", applyDataToUI);
  }
}
applyDataToUIIfExists();

