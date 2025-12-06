/* ---------------------------------------------------
   FINAL COMBINED SCRIPT.JS (updated)
   - Base: final fixed script.js you approved
   - Change: Managers are allowed to update due payments
   - No other features changed
   Backend: https://srinikamalnkb.onrender.com
--------------------------------------------------- */

const API_BASE = "https://srinikamalnkb.onrender.com";
const API = API_BASE + "/api";
const SOCKET_URL = API_BASE;

/* ---------------- AUTH HELPERS ---------------- */
function getToken(){ return localStorage.getItem("authToken") || ""; }
function setToken(t){ t ? localStorage.setItem("authToken", t) : localStorage.removeItem("authToken"); }
function getRole(){ return localStorage.getItem("userRole") || ""; }
function setRole(r){ r ? localStorage.setItem("userRole", r) : localStorage.removeItem("userRole"); }

function authHeader() {
  const t = getToken();
  return t ? { "Authorization":"Bearer " + t, "Content-Type":"application/json" }
           : { "Content-Type":"application/json" };
}

async function fetchWithAuth(url, opts={}) {
  opts.headers = { ...(opts.headers||{}), ...authHeader() };
  if (opts.body && typeof opts.body !== "string") opts.body = JSON.stringify(opts.body);
  let res;
  try { res = await fetch(url, opts); }
  catch(e){ let err=new Error("Network"); err.net=true; throw err; }
  if (res.status===401||res.status===403){ logout(); throw new Error("Unauthorized"); }
  return res;
}

/* ---------------- SOCKET ---------------- */
let socket=null;
function connectSocket(){
  try{ if(socket&&socket.connected) socket.disconnect(); }catch(e){}
  socket = io(SOCKET_URL,{auth:{token:getToken()}});
  socket.on("roomsUpdated",(r)=>{ if(Array.isArray(r)){ rooms=r; saveLocal(); applyDataToUI(); }});
  socket.on("paymentsUpdated",(p)=>{ if(p&&typeof p==='object'){ payments=p; saveLocal(); applyDataToUI(); }});
  socket.on("customersUpdated",(c)=>{ if(Array.isArray(c)){ customersDB=c; saveLocal(); }});
  socket.on("notificationsUpdated",(n)=>{ if(Array.isArray(n)){ notifications=n; saveLocal(); applyDataToUI(); }});
}

/* ----------- LOCAL STORAGE ----------- */
let rooms=[], payments={}, customersDB=[], notifications=[];

function loadLocal(){
  try{ rooms = JSON.parse(localStorage.getItem("hotelRooms")||"[]"); }catch{ rooms=[]; }
  try{ payments = JSON.parse(localStorage.getItem("hotelPayments")||"{}") || {}; }catch{ payments={}; }
  try{ customersDB = JSON.parse(localStorage.getItem("hotelCustomersDB")||"[]"); if(!Array.isArray(customersDB)) customersDB=[]; }catch{ customersDB=[]; }
  try{ notifications = JSON.parse(localStorage.getItem("hotelNotifications")||"[]"); }catch{ notifications=[]; }
}

function saveLocal(){
  localStorage.setItem("hotelRooms",JSON.stringify(rooms));
  localStorage.setItem("hotelPayments",JSON.stringify(payments));
  localStorage.setItem("hotelCustomersDB",JSON.stringify(customersDB));
  localStorage.setItem("hotelNotifications",JSON.stringify(notifications));
}

loadLocal();
if(!rooms.length){
  rooms = Array.from({length:29},(_,i)=>({
    id:i+1,status:"available",price:1500,
    customerName:"",numberOfPersons:1,aadharNumber:"",phoneNumber:"",
    checkinTime:"",checkoutTime:"",paymentMode:"",totalAmount:0,paidAmount:0,dueAmount:0
  }));
  saveLocal();
}

/* ---------------- LOGIN ---------------- */
document.getElementById("loginForm")?.addEventListener("submit",async(e)=>{
  e.preventDefault();
  const u=(document.getElementById("username")||{}).value?.trim();
  const p=(document.getElementById("password")||{}).value?.trim();
  if(!u||!p){ showNotification("Enter username & password","error"); return; }

  try{
    const r = await fetch(`${API}/login`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:u,password:p})});
    const d = await r.json();
    if(!r.ok){ showNotification(d.error||"Login failed","error"); return; }
    setToken(d.token); setRole(d.role||"");
    connectSocket();
    document.getElementById("loginScreen")?.classList.add("hidden");
    document.getElementById("dashboardScreen")?.classList.remove("hidden");
    if(d.role==="Owner") document.getElementById("dashboardScreen")?.classList.add("owner-visible");
    document.getElementById("userRole") && (document.getElementById("userRole").textContent = d.role || "");
    await loadInitialData();
    showNotification("Login successful","success");
  }catch(err){
    console.error("login error",err);
    showNotification("Server unreachable","error");
  }
});

/* Auto-login if token present */
if(getToken()){
  connectSocket();
  document.getElementById("loginScreen")?.classList.add("hidden");
  document.getElementById("dashboardScreen")?.classList.remove("hidden");
  const role=getRole();
  if(role==="Owner") document.getElementById("dashboardScreen")?.classList.add("owner-visible");
  document.getElementById("userRole") && (document.getElementById("userRole").textContent = role);
  loadInitialData().catch(()=>{});
}

/* ---------------- LOAD INITIAL DATA ---------------- */
async function loadInitialData(){
  try{ const r = await fetchWithAuth(`${API}/rooms`); if(r.ok){ const arr=await r.json(); if(Array.isArray(arr)) rooms=arr; } } catch(e){}
  try{ const p = await fetchWithAuth(`${API}/payments`); if(p.ok){ const pb=await p.json(); if(pb&&typeof pb==='object') payments=pb; } } catch(e){}
  try{ const c = await fetchWithAuth(`${API}/customers`); if(c.ok){ const cd=await c.json(); customersDB = Array.isArray(cd)?cd:customersDB; } } catch(e){}
  try{ const n = await fetchWithAuth(`${API}/notifications`); if(n.ok){ const nd=await n.json(); notifications = Array.isArray(nd)?nd:notifications; } } catch(e){}
  saveLocal();
  applyDataToUI();
}

/* ---------------- UI / RENDER ---------------- */
function applyDataToUI(){
  renderRooms();
  updateStats();
  updatePaymentCounters();
  updateDueTable();
  updateTotalDue();
  updateNotificationBadge();
  loadNotifications();
}

/* Room rendering with A-style icons/colors */
function renderRooms(){
  const grid = document.getElementById("roomGrid");
  if(!grid) return;
  grid.innerHTML = "";
  rooms.forEach(room=>{
    const box = document.createElement("div");
    box.className = `room-box rounded-lg p-4 text-white cursor-pointer room-${room.status}`;
    box.onclick = ()=>openRoomModal(room.id);

    let icon = '<i class="fas fa-door-open text-2xl mb-2"></i>';
    if(room.status==="occupied") icon = '<i class="fas fa-user text-2xl mb-2"></i>';
    if(room.status==="maintenance") icon = '<i class="fas fa-tools text-2xl mb-2"></i>';

    const statusLabel = `<p class="text-xs mt-1 capitalize">${escapeHtml(room.status)}</p>`;
    const custInfo = (room.status==="occupied" && room.customerName) ? `<p class="text-xs mt-1 truncate">${escapeHtml(room.customerName)}</p>` : "";
    const dueInfo = (Number(room.dueAmount)||0) > 0 ? `<p class="text-xs mt-1 font-bold">Due: ₹${room.dueAmount}</p>` : "";

    box.innerHTML = `
      <div class="text-center">
        ${icon}
        <p class="font-bold">Room ${room.id}</p>
        ${statusLabel}
        <p class="text-xs mt-1">₹${room.price}/day</p>
        ${custInfo}
        ${dueInfo}
      </div>
    `;
    grid.appendChild(box);
  });
}

/* update stats */
function updateStats(){
  const available = rooms.filter(r=>r.status==="available").length;
  const occupied = rooms.filter(r=>r.status==="occupied").length;
  const maintenance = rooms.filter(r=>r.status==="maintenance").length;
  document.getElementById("availableCount") && (document.getElementById("availableCount").textContent = available);
  document.getElementById("occupiedCount") && (document.getElementById("occupiedCount").textContent = occupied);
  document.getElementById("maintenanceCount") && (document.getElementById("maintenanceCount").textContent = maintenance);
}

/* payments counters */
function updatePaymentCounters(){
  payments = payments && typeof payments === "object" ? payments : { cash:0, upi:0, dayRevenue:0, monthRevenue:0 };
  document.getElementById("cashCounter") && (document.getElementById("cashCounter").textContent = `₹${payments.cash||0}`);
  document.getElementById("upiCounter") && (document.getElementById("upiCounter").textContent = `₹${payments.upi||0}`);
  document.getElementById("dayRevenue") && (document.getElementById("dayRevenue").textContent = `₹${payments.dayRevenue||0}`);
  document.getElementById("monthRevenue") && (document.getElementById("monthRevenue").textContent = `₹${payments.monthRevenue||0}`);
}

function updateTotalDue(){
  if(getRole()!=="Owner") return;
  const total = rooms.reduce((s,r)=> s + (Number(r.dueAmount)||0), 0);
  document.getElementById("totalDue") && (document.getElementById("totalDue").textContent = `₹${total}`);
}

function updateDueTable(){
  const table = document.getElementById("duePaymentsTable");
  if(!table) return;
  table.innerHTML = "";
  const dues = rooms.filter(r => r.status==="occupied" && (Number(r.dueAmount)||0) > 0);
  const noEl = document.getElementById("noDuePayments");
  if(!dues.length){ if(noEl) noEl.style.display = "block"; return; }
  if(noEl) noEl.style.display = "none";
  dues.forEach(r=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="px-6 py-4">${r.id}</td>
      <td class="px-6 py-4">${escapeHtml(r.customerName||"-")}</td>
      <td class="px-6 py-4">₹${r.totalAmount||0}</td>
      <td class="px-6 py-4">₹${r.paidAmount||0}</td>
      <td class="px-6 py-4 text-red-600">₹${r.dueAmount||0}</td>
      <td class="px-6 py-4"><button onclick="openPaymentModal(${r.id})" class="text-blue-600">Update</button></td>
    `;
    table.appendChild(tr);
  });
}

/* ---------------- ROOM MODAL ---------------- */
function openRoomModal(roomId){
  const room = rooms.find(r=>r.id===roomId);
  if(!room) return;
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

  const block = document.getElementById("customerDetails");
  if(block) block.style.display = room.status==="occupied" ? "block" : "none";

  if(getRole()==="Manager") document.getElementById("roomPrice")?.setAttribute("readonly", true);
  else document.getElementById("roomPrice")?.removeAttribute("readonly");

  calculateTotalAmount();
  document.getElementById("roomModal")?.classList.remove("hidden");
}

document.getElementById("roomStatus")?.addEventListener("change", function(){ const block=document.getElementById("customerDetails"); if(block) block.style.display = this.value==="occupied" ? "block" : "none"; });

/* calculate total/due */
function calculateTotalAmount(){
  const price = Number(document.getElementById("roomPrice")?.value)||0;
  const ciVal = document.getElementById("checkinTime")?.value;
  const coVal = document.getElementById("checkoutTime")?.value;
  const paid = Number(document.getElementById("paidAmount")?.value)||0;

  let total = 0;
  if(ciVal && coVal){
    const ci=new Date(ciVal), co=new Date(coVal);
    if(co>ci){
      const days = Math.max(1, Math.ceil((co-ci)/(1000*60*60*24)));
      total = days * price;
    }
  }
  const due = Math.max(0, total - paid);
  document.getElementById("totalAmount") && (document.getElementById("totalAmount").textContent = `₹${total}`);
  document.getElementById("dueAmount") && (document.getElementById("dueAmount").textContent = `₹${due}`);
}
document.getElementById("roomPrice")?.addEventListener("input", calculateTotalAmount);
document.getElementById("checkinTime")?.addEventListener("change", calculateTotalAmount);
document.getElementById("checkoutTime")?.addEventListener("change", calculateTotalAmount);
document.getElementById("paidAmount")?.addEventListener("input", calculateTotalAmount);

/* submit room form */
document.getElementById("roomForm")?.addEventListener("submit", async (e)=>{
  e.preventDefault();
  const roomId = Number(document.getElementById("roomId")?.value);
  const idx = rooms.findIndex(r=>r.id===roomId);
  if(idx===-1) return;
  const status = document.getElementById("roomStatus")?.value || "available";
  const price = Number(document.getElementById("roomPrice")?.value) || 0;
  const customerName = (document.getElementById("customerName")?.value || "").trim();
  const numberOfPersons = Number(document.getElementById("numberOfPersons")?.value) || 1;
  const aadharNumber = (document.getElementById("aadharNumber")?.value || "").trim();
  const phoneNumber = (document.getElementById("phoneNumber")?.value || "").trim();
  const checkinTime = document.getElementById("checkinTime")?.value || "";
  const checkoutTime = document.getElementById("checkoutTime")?.value || "";
  const paymentMode = document.getElementById("paymentMode")?.value || "";
  const paidAmount = Number(document.getElementById("paidAmount")?.value) || 0;

  let totalAmount = 0;
  if(status==="occupied" && checkinTime && checkoutTime){
    const ci=new Date(checkinTime), co=new Date(checkoutTime);
    if(co>ci){
      const days = Math.max(1, Math.ceil((co-ci)/(1000*60*60*24)));
      totalAmount = days * price;
    }
  }
  const dueAmount = Math.max(0, totalAmount - paidAmount);

  const updatedRoom = { ...rooms[idx], status, price, customerName, numberOfPersons, aadharNumber, phoneNumber, checkinTime, checkoutTime, paymentMode, totalAmount, paidAmount, dueAmount };

  if(status==="occupied" && aadharNumber){
    let cust = customersDB.find(c=>c.aadhar===aadharNumber);
    if(!cust){
      cust = { id: Date.now().toString(36), name: customerName, aadhar: aadharNumber, phoneNumber, history: [] };
      customersDB.push(cust);
    } else { cust.name = customerName || cust.name; cust.phoneNumber = phoneNumber || cust.phoneNumber; }
    cust.history = cust.history || [];
    cust.history.push({ roomId, checkinTime, checkoutTime, totalAmount, paidAmount, dueAmount });
    saveLocal();
    fetchWithAuth(`${API}/customers`, { method: "POST", body: cust }).catch(()=>{});
  }

  try{
    const res = await fetchWithAuth(`${API}/rooms/${roomId}`, { method: "PUT", body: updatedRoom });
    if(!res.ok) throw new Error("room update failed");
    rooms[idx] = updatedRoom;
    saveLocal();
    applyDataToUI();
    document.getElementById("roomModal")?.classList.add("hidden");
    showNotification("Room updated","success");
  }catch(err){
    console.warn("room update failed, saved locally", err);
    rooms[idx] = updatedRoom;
    saveLocal();
    applyDataToUI();
    document.getElementById("roomModal")?.classList.add("hidden");
    showNotification("Saved locally (server offline)","error");
  }
});

/* ---------------- PAYMENTS (MANAGER & OWNER ALLOWED) ---------------- */
function openPaymentModal(roomId) {
  const r = rooms.find(x=>x.id===roomId);
  if(!r) return;
  document.getElementById("paymentRoomId").value = r.id;
  document.getElementById("paymentRoomNumber").textContent = r.id;
  document.getElementById("paymentCustomerName").textContent = r.customerName || "-";
  document.getElementById("paymentTotalAmount").textContent = `₹${r.totalAmount || 0}`;
  document.getElementById("paymentAlreadyPaid").textContent = `₹${r.paidAmount || 0}`;
  document.getElementById("paymentDueAmount").textContent = `₹${r.dueAmount || 0}`;
  document.getElementById("additionalPayment").value = "";
  document.getElementById("additionalPaymentMode").value = "cash";
  document.getElementById("paymentModal")?.classList.remove("hidden");
}

document.getElementById("paymentForm")?.addEventListener("submit", async (e)=>{
  e.preventDefault();

  const roomId = Number(document.getElementById("paymentRoomId")?.value);
  const idx = rooms.findIndex(r=>r.id===roomId);
  if(idx===-1) return;

  const amount = Number(document.getElementById("additionalPayment")?.value) || 0;
  const mode = document.getElementById("additionalPaymentMode")?.value || "cash";
  if(amount <= 0) return showNotification("Enter amount","error");

  // Update room's paid/due locally
  rooms[idx].paidAmount = (rooms[idx].paidAmount || 0) + amount;
  rooms[idx].dueAmount = Math.max(0, (rooms[idx].totalAmount || 0) - rooms[idx].paidAmount);

  // Update payments summary
  payments.cash = payments.cash || 0;
  payments.upi = payments.upi || 0;
  if(mode.toLowerCase() === "upi") payments.upi += amount; else payments.cash += amount;
  payments.dayRevenue = (payments.dayRevenue || 0) + amount;
  payments.monthRevenue = (payments.monthRevenue || 0) + amount;

  try{
    const res = await fetchWithAuth(`${API}/payments`, { method: "POST", body: { amount, mode, roomId } });
    if(!res.ok) throw new Error("payments API failed");
    try{ await fetchWithAuth(`${API}/rooms/${roomId}`, { method: "PUT", body: rooms[idx] }); } catch {}
    saveLocal();
    applyDataToUI();
    document.getElementById("paymentModal")?.classList.add("hidden");
    showNotification(`Payment ₹${amount} recorded`,"success");
    addNotification(`Payment of ₹${amount} received for Room ${roomId} via ${mode}`);
  }catch(err){
    console.warn("payment persist failed", err);
    saveLocal();
    applyDataToUI();
    document.getElementById("paymentModal")?.classList.add("hidden");
    showNotification("Payment saved locally (server offline)","error");
  }
});

/* ---------------- CUSTOMERS (View) ---------------- */
function openAllCustomersModal(){ document.getElementById("allCustomersModal")?.classList.remove("hidden"); renderAllCustomers(); }
function closeAllCustomersModal(){ document.getElementById("allCustomersModal")?.classList.add("hidden"); }

function renderAllCustomers(){
  const table = document.getElementById("allCustomersTable");
  if(!table) return;
  table.innerHTML = "";
  if(!customersDB || !customersDB.length){ document.getElementById("noCustomersFound")?.classList.remove("hidden"); return; }
  document.getElementById("noCustomersFound")?.classList.add("hidden");
  customersDB.forEach(c=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="px-6 py-4">${escapeHtml(c.name||"-")}</td>
      <td class="px-6 py-4">${escapeHtml(c.aadhar||"-")}</td>
      <td class="px-6 py-4">${escapeHtml(c.phoneNumber||"-")}</td>
      <td class="px-6 py-4">${c.history?c.history.length:0}</td>
      <td class="px-6 py-4">${c.history && c.history.length ? new Date(c.history[c.history.length-1].checkinTime).toLocaleDateString() : "-"}</td>
      <td class="px-6 py-4"><button class="text-blue-600" onclick="viewCustomerDetails('${c.aadhar}')">View</button></td>
    `;
    table.appendChild(tr);
  });
}

function viewCustomerDetails(aadhar){
  const c = customersDB.find(x=>x.aadhar===aadhar);
  if(!c) return showNotification("Customer not found","error");
  closeAllCustomersModal();
  const avail = rooms.find(r=>r.status==="available");
  if(avail){
    openRoomModal(avail.id);
    setTimeout(()=>{ document.getElementById("customerName").value = c.name; document.getElementById("aadharNumber").value = c.aadhar; document.getElementById("phoneNumber").value = c.phoneNumber || ""; showCustomerHistory(c); },150);
  } else showNotification("No available rooms","error");
}

function showCustomerHistory(customer){
  const section = document.getElementById("customerHistorySection");
  const table = document.getElementById("customerHistoryTable");
  const noHist = document.getElementById("noCustomerHistory");
  if(!section||!table||!noHist) return;
  section.classList.remove("hidden");
  table.innerHTML = "";
  if(!customer.history||!customer.history.length){ noHist.classList.remove("hidden"); return; }
  noHist.classList.add("hidden");
  customer.history.forEach(h=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${h.roomId}</td><td>${new Date(h.checkinTime).toLocaleDateString()}</td><td>${new Date(h.checkoutTime).toLocaleDateString()}</td><td>₹${h.totalAmount}</td><td>${h.dueAmount>0?'<span class="text-red-600">Due</span>':'<span class="text-green-600">Paid</span>'}</td>`;
    table.appendChild(tr);
  });
}

/* ---------------- Notifications ---------------- */
function updateNotificationBadge(){ const b=document.getElementById("notificationBadge"); if(!b) return; if(notifications&&notifications.length){ b.textContent = notifications.length; b.classList.remove("hidden"); } else b.classList.add("hidden"); }
function loadNotifications(){ const list=document.getElementById("notificationList"); if(!list) return; list.innerHTML=""; if(!notifications||!notifications.length){ list.innerHTML='<p class="p-4 text-gray-500 text-center">No notifications</p>'; return; } notifications.forEach(n=>{ const el=document.createElement("div"); el.className='p-4 border-b hover:bg-gray-50'; el.innerHTML=`<p class="text-gray-800">${escapeHtml(n.message)}</p><p class="text-xs text-gray-500 mt-2">${new Date(n.timestamp).toLocaleString()}</p>`; list.appendChild(el); }); }
function addNotification(msg){ notifications.push({message:msg,timestamp:new Date().toISOString()}); saveLocal(); updateNotificationBadge(); fetchWithAuth(`${API}/payments`,{method:"POST",body:{amount:0,mode:'',message:msg}}).catch(()=>{}); }

/* ---------------- Close modal ---------------- */
function closeModal(){ document.getElementById("roomModal")?.classList.add("hidden"); document.getElementById("paymentModal")?.classList.add("hidden"); document.getElementById("allCustomersModal")?.classList.add("hidden"); document.getElementById("customerHistorySection")?.classList.add("hidden"); }

/* ---------------- Logout ---------------- */
function logout(){ setToken(""); setRole(""); try{ socket?.disconnect(); }catch{} document.getElementById("dashboardScreen")?.classList.add("hidden"); document.getElementById("loginScreen")?.classList.remove("hidden"); document.getElementById("dashboardScreen")?.classList.remove("owner-visible"); }
document.querySelectorAll("#logoutBtn,#logout,#logoutButton,.logout-btn").forEach(btn=>btn?.addEventListener("click", logout));

/* ---------------- Helpers ---------------- */
function escapeHtml(s){ if(s===undefined||s===null) return ""; return String(s).replace(/[&<>"'`=\/]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#x60;','=':'&#x3D;'}[ch])); }
function showNotification(msg,type="success"){ const n=document.createElement("div"); n.className=`fixed top-4 right-4 px-6 py-3 rounded-lg shadow-lg text-white z-50 ${type==='success'?'bg-green-500':'bg-red-500'}`; n.innerHTML=`<div class="flex items-center"><i class="fas ${type==='success'?'fa-check-circle':'fa-exclamation-circle'} mr-2"></i>${escapeHtml(msg)}</div>`; document.body.appendChild(n); setTimeout(()=>n.remove(),3000); }

/* ---------------- Init ---------------- */
(function init(){
  applyDataToUI();
  document.querySelectorAll("[data-close-modal]").forEach(btn=>btn.addEventListener("click", closeModal));
  document.getElementById("viewCustomersBtn")?.addEventListener("click", openAllCustomersModal);
})();
