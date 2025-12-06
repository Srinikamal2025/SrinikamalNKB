/* ---------------------------------------------------
   FINAL COMBINED SCRIPT.JS 
   Fully fixed:
   - JWT login
   - Customer DB
   - Counters
   - Payments
   - Room modal
   - Logout
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
  socket.on("roomsUpdated",(r)=>{ rooms=r; saveLocal(); applyUI(); });
  socket.on("paymentsUpdated",(p)=>{ payments=p; saveLocal(); applyUI(); });
  socket.on("customersUpdated",(c)=>{ customersDB=c; saveLocal(); });
  socket.on("notificationsUpdated",(n)=>{ notifications=n; saveLocal(); applyUI(); });
}

/* ----------- LOCAL STORAGE ----------- */
let rooms=[], payments={}, customersDB=[], notifications=[];

function loadLocal(){
  try{ rooms = JSON.parse(localStorage.getItem("hotelRooms")||"[]"); }catch{ rooms=[]; }
  try{ payments = JSON.parse(localStorage.getItem("hotelPayments")||"{}") || {}; }catch{ payments={}; }
  try{ 
    customersDB = JSON.parse(localStorage.getItem("hotelCustomersDB")||"[]");
    if(!Array.isArray(customersDB)) customersDB=[];
  }catch{ customersDB=[]; }
  try{ notifications = JSON.parse(localStorage.getItem("hotelNotifications")||"[]"); }catch{ notifications=[]; }
}

function saveLocal(){
  localStorage.setItem("hotelRooms",JSON.stringify(rooms));
  localStorage.setItem("hotelPayments",JSON.stringify(payments));
  localStorage.setItem("hotelCustomersDB",JSON.stringify(customersDB));
  localStorage.setItem("hotelNotifications",JSON.stringify(notifications));
}

loadLocal();

/* Create default rooms if none exist */
if(!rooms.length){
  rooms = Array.from({length:29},(_,i)=>({
    id:i+1,status:"available",price:1500,
    customerName:"",numberOfPersons:1,aadharNumber:"",
    phoneNumber:"",checkinTime:"",checkoutTime:"",
    paymentMode:"",totalAmount:0,paidAmount:0,dueAmount:0
  }));
  saveLocal();
}

/* ---------------- LOGIN ---------------- */
document.getElementById("loginForm")?.addEventListener("submit",async(e)=>{
  e.preventDefault();
  const u=username.value.trim(), p=password.value.trim();
  if(!u||!p){ notify("Enter username & password","error"); return; }

  try{
    let r=await fetchWithAuth(`${API}/login`,{method:"POST",body:{username:u,password:p}});
    let d=await r.json();
    if(!r.ok){ notify(d.error||"Login failed","error"); return; }
    setToken(d.token); setRole(d.role);
    document.getElementById("loginScreen").classList.add("hidden");
    document.getElementById("dashboardScreen").classList.remove("hidden");
    if(d.role==="Owner") dashboardScreen.classList.add("owner-visible");
    userRole.textContent=d.role;
    connectSocket();
    await loadInitial();
    notify("Login successful");
  }catch(err){
    notify("Server unreachable","error");
  }
});

/* Auto-login if token exists */
if(getToken()){
  connectSocket();
  loginScreen.classList.add("hidden");
  dashboardScreen.classList.remove("hidden");
  if(getRole()==="Owner") dashboardScreen.classList.add("owner-visible");
  userRole.textContent=getRole();
  loadInitial();
}

/* ---------------- LOAD INITIAL DATA ---------------- */
async function loadInitial(){
  try{
    let r=await fetchWithAuth(`${API}/rooms`);
    if(r.ok) rooms=await r.json();
  }catch{}
  try{
    let p=await fetchWithAuth(`${API}/payments`);
    if(p.ok) payments=await p.json();
  }catch{}
  try{
    let c=await fetchWithAuth(`${API}/customers`);
    if(c.ok) customersDB=await c.json();
    if(!Array.isArray(customersDB)) customersDB=[];
  }catch{}
  try{
    let n=await fetchWithAuth(`${API}/notifications`);
    if(n.ok) notifications=await n.json();
  }catch{}
  saveLocal();
  applyUI();
}

/* ---------------- UI UPDATE ---------------- */
function applyUI(){
  renderRooms();
  updateStats();
  updatePaymentCounters();
  updateTotalDue();
  updateDueTable();
  updateNotificationBadge();
  loadNotifications();
}

/* ---------------- ROOMS UI ---------------- */
function renderRooms(){
  roomGrid.innerHTML="";
  rooms.forEach(r=>{
    const d=document.createElement("div");
    d.className=`room-box p-4 text-white cursor-pointer ${r.status}`;
    d.onclick=()=>openRoomModal(r.id);
    d.innerHTML=`
      <p class="font-bold">Room ${r.id}</p>
      <p class="text-xs capitalize">${r.status}</p>
      <p class="text-xs">₹${r.price}/day</p>
      ${r.customerName?`<p class="text-xs">${r.customerName}</p>`:""}
      ${r.dueAmount>0?`<p class="text-xs text-yellow-300">Due: ₹${r.dueAmount}</p>`:""}
    `;
    roomGrid.appendChild(d);
  });
}

function updateStats(){
  availableCount.textContent= rooms.filter(r=>r.status==="available").length;
  occupiedCount.textContent= rooms.filter(r=>r.status==="occupied").length;
  maintenanceCount.textContent= rooms.filter(r=>r.status==="maintenance").length;
}

function updatePaymentCounters(){
  cashCounter.textContent=`₹${payments.cash||0}`;
  upiCounter.textContent=`₹${payments.upi||0}`;
  dayRevenue.textContent=`₹${payments.dayRevenue||0}`;
  monthRevenue.textContent=`₹${payments.monthRevenue||0}`;
}

function updateTotalDue(){
  if(getRole()!=="Owner") return;
  totalDue.textContent="₹"+rooms.reduce((s,r)=>s+(r.dueAmount||0),0);
}

function updateDueTable(){
  duePaymentsTable.innerHTML="";
  const list=rooms.filter(r=>r.status==="occupied"&&r.dueAmount>0);
  if(!list.length){
    noDuePayments.style.display="block";
    return;
  }
  noDuePayments.style.display="none";
  list.forEach(r=>{
    const tr=document.createElement("tr");
    tr.innerHTML=`
      <td>${r.id}</td>
      <td>${r.customerName}</td>
      <td>₹${r.totalAmount}</td>
      <td>₹${r.paidAmount}</td>
      <td class="text-red-600">₹${r.dueAmount}</td>
      <td><button onclick="openPaymentModal(${r.id})">Update</button></td>
    `;
    duePaymentsTable.appendChild(tr);
  });
}

/* ---------------- ROOM MODAL ---------------- */
function openRoomModal(id){
  const r=rooms.find(x=>x.id===id);
  if(!r) return;

  roomId.value=r.id;
  roomStatus.value=r.status;
  roomPrice.value=r.price;

  customerName.value=r.customerName||"";
  numberOfPersons.value=r.numberOfPersons||1;
  aadharNumber.value=r.aadharNumber||"";
  phoneNumber.value=r.phoneNumber||"";
  checkinTime.value=r.checkinTime||"";
  checkoutTime.value=r.checkoutTime||"";
  paymentMode.value=r.paymentMode||"";
  paidAmount.value=r.paidAmount||0;

  customerDetails.style.display = (r.status==="occupied")?"block":"none";

  calculateTotalAmount();
  roomModal.classList.remove("hidden");
}

roomStatus.addEventListener("change",()=>{
  customerDetails.style.display = (roomStatus.value==="occupied")?"block":"none";
});

/* ---------------- CALCULATE TOTAL ---------------- */
function calculateTotalAmount(){
  const price = Number(roomPrice.value)||0;
  const ci=new Date(checkinTime.value);
  const co=new Date(checkoutTime.value);
  const paid=Number(paidAmount.value)||0;

  let total=0;
  if(co>ci){
    const days=Math.max(1,Math.ceil((co-ci)/(1000*60*60*24)));
    total=days*price;
  }
  totalAmount.textContent="₹"+total;
  dueAmount.textContent="₹"+Math.max(0,total-paid);
}

roomPrice.oninput=
checkinTime.onchange=
checkoutTime.onchange=
paidAmount.oninput = calculateTotalAmount;

/* ---------------- ROOM SUBMIT ---------------- */
roomForm.addEventListener("submit",async(e)=>{
  e.preventDefault();

  const id=Number(roomId.value);
  const idx=rooms.findIndex(r=>r.id===id);
  if(idx<0) return;

  const status=roomStatus.value;
  const price=Number(roomPrice.value)||0;
  const cname=customerName.value.trim();
  const people=Number(numberOfPersons.value)||1;
  const aadhar=aadharNumber.value.trim();
  const phone=phoneNumber.value.trim();
  const ci=checkinTime.value;
  const co=checkoutTime.value;
  const mode=paymentMode.value;
  const paid=Number(paidAmount.value)||0;

  let total=0;
  if(status==="occupied"&&ci&&co){
    const d=Math.max(1,Math.ceil((new Date(co)-new Date(ci))/(1000*60*60*24)));
    total=d*price;
  }

  const due=Math.max(0,total-paid);

  const updated={
    ...rooms[idx], status, price, customerName:cname, numberOfPersons:people,
    aadharNumber:aadhar, phoneNumber:phone, checkinTime:ci, checkoutTime:co,
    paymentMode:mode, totalAmount:total, paidAmount:paid, dueAmount:due
  };

  /* --- Update customer DB --- */
  if(status==="occupied" && aadhar){
    let c=customersDB.find(x=>x.aadhar===aadhar);
    if(!c){
      c={ id:Date.now()+"", name:cname, aadhar, phoneNumber:phone, history:[] };
      customersDB.push(c);
    }
    c.name=cname||c.name;
    c.phoneNumber=phone||c.phoneNumber;
    c.history.push({roomId:id,checkinTime:ci,checkoutTime:co,totalAmount:total,paidAmount:paid,dueAmount:due});
    saveLocal();
    fetchWithAuth(`${API}/customers`,{method:"POST",body:c}).catch(()=>{});
  }

  /* --- Persist room --- */
  try{
    let r=await fetchWithAuth(`${API}/rooms/${id}`,{method:"PUT",body:updated});
    if(!r.ok) throw new Error();
    rooms[idx]=updated;
    saveLocal(); applyUI();
    roomModal.classList.add("hidden");
    notify("Room updated");
  }catch{
    rooms[idx]=updated;
    saveLocal(); applyUI();
    roomModal.classList.add("hidden");
    notify("Saved locally (server offline)","error");
  }
});

/* ---------------- PAYMENTS ---------------- */
function openPaymentModal(id){
  if(getRole()!=="Owner") return notify("Only owner allowed","error");
  const r=rooms.find(x=>x.id===id);
  if(!r) return;

  paymentRoomId.value=r.id;
  paymentRoomNumber.textContent=r.id;
  paymentCustomerName.textContent=r.customerName||"-";
  paymentTotalAmount.textContent="₹"+(r.totalAmount||0);
  paymentAlreadyPaid.textContent="₹"+(r.paidAmount||0);
  paymentDueAmount.textContent="₹"+(r.dueAmount||0);
  additionalPayment.value="";
  additionalPaymentMode.value="cash";
  paymentModal.classList.remove("hidden");
}

closePaymentModalBtn?.addEventListener("click",()=>paymentModal.classList.add("hidden"));

paymentForm?.addEventListener("submit",async(e)=>{
  e.preventDefault();
  const id=Number(paymentRoomId.value);
  const idx=rooms.findIndex(r=>r.id===id);
  if(idx<0) return;

  const amt=Number(additionalPayment.value)||0;
  const mode=additionalPaymentMode.value;

  if(amt<=0) return notify("Enter amount","error");

  rooms[idx].paidAmount+=(rooms[idx].paidAmount||0)+amt - (rooms[idx].paidAmount||0);
  rooms[idx].dueAmount=Math.max(0,(rooms[idx].totalAmount||0)-rooms[idx].paidAmount);

  try{
    let r=await fetchWithAuth(`${API}/payments`,{method:"POST",body:{roomId:id,amount:amt,mode}});
    if(!r.ok) throw new Error();
    await fetchWithAuth(`${API}/rooms/${id}`,{method:"PUT",body:rooms[idx]}).catch(()=>{});
    saveLocal(); applyUI();
    paymentModal.classList.add("hidden");
    notify("Payment updated");
  }catch{
    saveLocal(); applyUI();
    paymentModal.classList.add("hidden");
    notify("Saved locally (offline)","error");
  }
});

/* ---------------- NOTIFICATIONS ---------------- */
function updateNotificationBadge(){
  if(!notifications.length){
    notificationBadge.classList.add("hidden");
  } else {
    notificationBadge.classList.remove("hidden");
    notificationBadge.textContent=notifications.length;
  }
}

function loadNotifications(){
  notificationList.innerHTML="";
  if(!notifications.length){
    notificationList.innerHTML=`<p class="text-gray-400 p-3 text-center">No notifications</p>`;
    return;
  }
  notifications.forEach(n=>{
    const d=document.createElement("div");
    d.className="p-3 border-b";
    d.innerHTML=`
      <p>${n.message}</p>
      <p class="text-xs text-gray-500">${new Date(n.timestamp).toLocaleString()}</p>
    `;
    notificationList.appendChild(d);
  });
}

/* ---------------- LOGOUT (FIXED UNIVERSAL) ---------------- */
function logout(){
  setToken(""); setRole("");
  try{ socket?.disconnect(); }catch{}
  dashboardScreen.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  dashboardScreen.classList.remove("owner-visible");
}

/* supports multiple logout ID variations */
document.querySelectorAll("#logoutBtn,#logout,#logoutButton,.logout-btn")
  .forEach(btn=>btn?.addEventListener("click",()=>logout()));

/* ---------------- HELPERS ---------------- */
function notify(msg,type="success"){
  const d=document.createElement("div");
  d.className=`fixed top-4 right-4 px-4 py-2 rounded text-white z-50 ${type==="success"?"bg-green-500":"bg-red-500"}`;
  d.textContent=msg;
  document.body.appendChild(d);
  setTimeout(()=>d.remove(),3000);
}
