/* ---------------------------------------------------
   FINAL UPDATED SCRIPT.JS 
   Base: Your final fixed version
   Added: Room Modal Payments → counters update (UPI/Cash/Day/Month)
   Managers allowed to update payments
   PaymentMode values matched exactly ("UPI" and "cash")
   NOTHING ELSE CHANGED
--------------------------------------------------- */

const API_BASE = "https://srinikamalnkb.onrender.com";
const API = API_BASE + "/api";
const SOCKET_URL = API_BASE;

/* ---------------- AUTH HELPERS ---------------- */
function getToken() {
  return localStorage.getItem("authToken") || "";
}
function setToken(t) {
  if (t) localStorage.setItem("authToken", t);
  else localStorage.removeItem("authToken");
}
function getRole() {
  return localStorage.getItem("userRole") || "";
}
function setRole(r) {
  if (r) localStorage.setItem("userRole", r);
  else localStorage.removeItem("userRole");
}

function authHeader() {
  const t = getToken();
  return t
    ? { Authorization: "Bearer " + t, "Content-Type": "application/json" }
    : { "Content-Type": "application/json" };
}

async function fetchWithAuth(url, opts = {}) {
  opts.headers = { ...(opts.headers || {}), ...authHeader() };

  if (opts.body && typeof opts.body !== "string") {
    opts.body = JSON.stringify(opts.body);
  }

  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    const e = new Error("Network");
    e.net = true;
    throw e;
  }

  if (res.status === 401 || res.status === 403) {
    logout();
    throw new Error("Unauthorized");
  }
  return res;
}

/* ---------------- SOCKET ---------------- */
let socket = null;

function connectSocket() {
  try {
    if (socket && socket.connected) socket.disconnect();
  } catch {}

  socket = io(SOCKET_URL, {
    auth: { token: getToken() },
  });

  socket.on("roomsUpdated", (r) => {
    if (Array.isArray(r)) {
      rooms = r;
      saveLocal();
      applyDataToUI();
    }
  });

  socket.on("paymentsUpdated", (p) => {
    if (p && typeof p === "object") {
      payments = p;
      saveLocal();
      applyDataToUI();
    }
  });

  socket.on("customersUpdated", (c) => {
    if (Array.isArray(c)) {
      customersDB = c;
      saveLocal();
    }
  });

  socket.on("notificationsUpdated", (n) => {
    if (Array.isArray(n)) {
      notifications = n;
      saveLocal();
      applyDataToUI();
    }
  });
}

/* ---------------- LOCAL STORAGE ---------------- */
let rooms = [],
  payments = {},
  customersDB = [],
  notifications = [];

function loadLocal() {
  try {
    rooms = JSON.parse(localStorage.getItem("hotelRooms") || "[]");
  } catch {
    rooms = [];
  }
  try {
    payments = JSON.parse(localStorage.getItem("hotelPayments") || "{}") || {};
  } catch {
    payments = {};
  }
  try {
    customersDB =
      JSON.parse(localStorage.getItem("hotelCustomersDB") || "[]") || [];
    if (!Array.isArray(customersDB)) customersDB = [];
  } catch {
    customersDB = [];
  }
  try {
    notifications =
      JSON.parse(localStorage.getItem("hotelNotifications") || "[]") || [];
  } catch {
    notifications = [];
  }
}

function saveLocal() {
  localStorage.setItem("hotelRooms", JSON.stringify(rooms));
  localStorage.setItem("hotelPayments", JSON.stringify(payments));
  localStorage.setItem("hotelCustomersDB", JSON.stringify(customersDB));
  localStorage.setItem("hotelNotifications", JSON.stringify(notifications));
}

loadLocal();

/* Initialize rooms if empty */
if (!rooms.length) {
  rooms = Array.from({ length: 29 }, (_, i) => ({
    id: i + 1,
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
    dueAmount: 0,
  }));
  saveLocal();
}

/* ---------------- LOGIN ---------------- */
document.getElementById("loginForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("username")?.value?.trim();
  const password = document.getElementById("password")?.value?.trim();

  if (!username || !password) {
    showNotification("Enter username & password", "error");
    return;
  }

  try {
    const r = await fetch(`${API}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });

    const d = await r.json();

    if (!r.ok) {
      showNotification(d.error || "Login failed", "error");
      return;
    }

    setToken(d.token);
    setRole(d.role || "");

    connectSocket();

    document.getElementById("loginScreen")?.classList.add("hidden");
    document.getElementById("dashboardScreen")?.classList.remove("hidden");

    if (d.role === "Owner")
      document.getElementById("dashboardScreen")?.classList.add("owner-visible");

    const roleDisplay = document.getElementById("userRole");
    if (roleDisplay) roleDisplay.textContent = d.role;

    await loadInitialData();

    showNotification("Login successful", "success");
  } catch (err) {
    showNotification("Server unreachable", "error");
  }
});

/* Auto-login if token exists */
if (getToken()) {
  connectSocket();
  document.getElementById("loginScreen")?.classList.add("hidden");
  document.getElementById("dashboardScreen")?.classList.remove("hidden");

  if (getRole() === "Owner")
    document
      .getElementById("dashboardScreen")
      ?.classList.add("owner-visible");

  const roleDisplay = document.getElementById("userRole");
  if (roleDisplay) roleDisplay.textContent = getRole();

  loadInitialData().catch(() => {});
}

/* ---------------- LOAD INITIAL DATA ---------------- */
async function loadInitialData() {
  try {
    const r = await fetchWithAuth(`${API}/rooms`);
    if (r.ok) rooms = await r.json();
  } catch {}

  try {
    const p = await fetchWithAuth(`${API}/payments`);
    if (p.ok) payments = await p.json();
  } catch {}

  try {
    const c = await fetchWithAuth(`${API}/customers`);
    if (c.ok) customersDB = await c.json();
  } catch {}

  try {
    const n = await fetchWithAuth(`${API}/notifications`);
    if (n.ok) notifications = await n.json();
  } catch {}

  if (!Array.isArray(customersDB)) customersDB = [];

  saveLocal();
  applyDataToUI();
}

/* ---------------- APPLY UI ---------------- */
function applyDataToUI() {
  renderRooms();
  updateStats();
  updatePaymentCounters();
  updateDueTable();
  updateTotalDue();
  updateNotificationBadge();
  loadNotifications();
}

/* ---------------- RENDER ROOMS ---------------- */
function renderRooms() {
  const roomGrid = document.getElementById("roomGrid");
  if (!roomGrid) return;

  roomGrid.innerHTML = "";

  rooms.forEach((room) => {
    const div = document.createElement("div");
    div.className = `room-box rounded-lg p-4 text-white cursor-pointer room-${room.status}`;

    div.onclick = () => openRoomModal(room.id);

    let icon = '<i class="fas fa-door-open text-2xl mb-2"></i>';
    if (room.status === "occupied") icon = '<i class="fas fa-user text-2xl mb-2"></i>';
    if (room.status === "maintenance") icon = '<i class="fas fa-tools text-2xl mb-2"></i>';

    div.innerHTML = `
      <div class="text-center">
        ${icon}
        <p class="font-bold">Room ${room.id}</p>
        <p class="text-xs mt-1 capitalize">${room.status}</p>
        <p class="text-xs mt-1">₹${room.price}/day</p>
        ${room.customerName ? `<p class="text-xs mt-1 truncate">${escapeHtml(room.customerName)}</p>` : ""}
        ${room.dueAmount > 0 ? `<p class="text-xs mt-1 font-bold">Due: ₹${room.dueAmount}</p>` : ""}
      </div>
    `;

    roomGrid.appendChild(div);
  });
}

/* ---------------- ROOM STATS ---------------- */
function updateStats() {
  const available = rooms.filter((r) => r.status === "available").length;
  const occupied = rooms.filter((r) => r.status === "occupied").length;
  const maintenance = rooms.filter((r) => r.status === "maintenance").length;

  const availableCount = document.getElementById("availableCount");
  const occupiedCount = document.getElementById("occupiedCount");
  const maintenanceCount = document.getElementById("maintenanceCount");

  if (availableCount) availableCount.textContent = available;
  if (occupiedCount) occupiedCount.textContent = occupied;
  if (maintenanceCount) maintenanceCount.textContent = maintenance;
}

/* ---------------- PAYMENT COUNTERS ---------------- */
function updatePaymentCounters() {
  payments = payments && typeof payments === "object" ? payments : {
    cash: 0,
    upi: 0,
    dayRevenue: 0,
    monthRevenue: 0,
  };

  const cashEl = document.getElementById("cashCounter");
  const upiEl = document.getElementById("upiCounter");
  const dayEl = document.getElementById("dayRevenue");
  const monthEl = document.getElementById("monthRevenue");

  if (cashEl) cashEl.textContent = `₹${payments.cash || 0}`;
  if (upiEl) upiEl.textContent = `₹${payments.upi || 0}`;
  if (dayEl) dayEl.textContent = `₹${payments.dayRevenue || 0}`;
  if (monthEl) monthEl.textContent = `₹${payments.monthRevenue || 0}`;
}

/* ---------------------------------------------------
   END OF PART 1 — SEND “PART 2” WHEN READY
--------------------------------------------------- */
/* ---------------- TOTAL DUE (OWNER ONLY) ---------------- */
function updateTotalDue() {
  if (getRole() !== "Owner") return;

  const total = rooms.reduce(
    (sum, r) => sum + (Number(r.dueAmount) || 0),
    0
  );

  const totalDue = document.getElementById("totalDue");
  if (totalDue) totalDue.textContent = `₹${total}`;
}

/* ---------------- DUE TABLE ---------------- */
function updateDueTable() {
  const table = document.getElementById("duePaymentsTable");
  if (!table) return;

  table.innerHTML = "";

  const dues = rooms.filter(
    (r) => r.status === "occupied" && (Number(r.dueAmount) || 0) > 0
  );

  const noDueEl = document.getElementById("noDuePayments");
  if (!dues.length) {
    if (noDueEl) noDueEl.style.display = "block";
    return;
  }

  if (noDueEl) noDueEl.style.display = "none";

  dues.forEach((r) => {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td class="px-6 py-4">${r.id}</td>
      <td class="px-6 py-4">${escapeHtml(r.customerName || "-")}</td>
      <td class="px-6 py-4">₹${r.totalAmount || 0}</td>
      <td class="px-6 py-4">₹${r.paidAmount || 0}</td>
      <td class="px-6 py-4 text-red-600">₹${r.dueAmount || 0}</td>
      <td class="px-6 py-4">
        <button onclick="openPaymentModal(${r.id})" class="text-blue-600">Update</button>
      </td>
    `;

    table.appendChild(tr);
  });
}

/* ---------------- ROOM MODAL ---------------- */
function openRoomModal(roomId) {
  const room = rooms.find((r) => r.id === roomId);
  if (!room) return;

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

  const customerDetails = document.getElementById("customerDetails");
  if (customerDetails)
    customerDetails.style.display =
      room.status === "occupied" ? "block" : "none";

  if (getRole() === "Manager")
    document.getElementById("roomPrice")?.setAttribute("readonly", true);
  else document.getElementById("roomPrice")?.removeAttribute("readonly");

  calculateTotalAmount();

  document.getElementById("roomModal")?.classList.remove("hidden");
}

document
  .getElementById("roomStatus")
  ?.addEventListener("change", function () {
    const block = document.getElementById("customerDetails");
    if (block)
      block.style.display = this.value === "occupied" ? "block" : "none";
  });

/* ---------------- CALCULATE TOTAL ---------------- */
function calculateTotalAmount() {
  const price =
    Number(document.getElementById("roomPrice")?.value) || 0;

  const ci = document.getElementById("checkinTime")?.value;
  const co = document.getElementById("checkoutTime")?.value;
  const paid =
    Number(document.getElementById("paidAmount")?.value) || 0;

  let total = 0;

  if (ci && co) {
    const d1 = new Date(ci);
    const d2 = new Date(co);

    if (d2 > d1) {
      const days = Math.max(
        1,
        Math.ceil((d2 - d1) / (1000 * 60 * 60 * 24))
      );
      total = days * price;
    }
  }

  const due = Math.max(0, total - paid);

  const ta = document.getElementById("totalAmount");
  if (ta) ta.textContent = "₹" + total;

  const du = document.getElementById("dueAmount");
  if (du) du.textContent = "₹" + due;
}

["roomPrice", "checkinTime", "checkoutTime", "paidAmount"].forEach((id) =>
  document.getElementById(id)?.addEventListener("input", calculateTotalAmount)
);

/* ---------------- ROOM FORM SUBMIT ---------------- */
document
  .getElementById("roomForm")
  ?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const roomId = Number(document.getElementById("roomId")?.value);
    const idx = rooms.findIndex((r) => r.id === roomId);
    if (idx === -1) return;

    const status = document.getElementById("roomStatus")?.value || "available";
    const price =
      Number(document.getElementById("roomPrice")?.value) || 0;

    const customerName =
      document.getElementById("customerName")?.value?.trim() || "";
    const numberOfPersons =
      Number(document.getElementById("numberOfPersons")?.value) || 1;
    const aadharNumber =
      document.getElementById("aadharNumber")?.value?.trim() || "";
    const phoneNumber =
      document.getElementById("phoneNumber")?.value?.trim() || "";
    const checkinTime =
      document.getElementById("checkinTime")?.value || "";
    const checkoutTime =
      document.getElementById("checkoutTime")?.value || "";
    const paymentMode =
      document.getElementById("paymentMode")?.value || "";
    const paidAmount =
      Number(document.getElementById("paidAmount")?.value) || 0;

    /* -------------------------------
       NEW PAYMENT COUNTER FIX ADDED
       (Based exactly on "UPI" and "cash")
       ------------------------------- */

    let previousPaid = rooms[idx].paidAmount || 0;
    let newPaid = paidAmount;
    let addedAmount = newPaid - previousPaid;

    if (addedAmount > 0) {
      payments.cash = payments.cash || 0;
      payments.upi = payments.upi || 0;
      payments.dayRevenue = payments.dayRevenue || 0;
      payments.monthRevenue = payments.monthRevenue || 0;

      if (paymentMode === "UPI") {
        payments.upi += addedAmount;
      } else {
        payments.cash += addedAmount;
      }

      payments.dayRevenue += addedAmount;
      payments.monthRevenue += addedAmount;
    }

    /* -------------------------------
       END PAYMENT FIX
       ------------------------------- */

    let totalAmount = 0;

    if (status === "occupied" && checkinTime && checkoutTime) {
      const d1 = new Date(checkinTime);
      const d2 = new Date(checkoutTime);

      if (d2 > d1) {
        const days = Math.max(
          1,
          Math.ceil((d2 - d1) / (1000 * 60 * 60 * 24))
        );
        totalAmount = days * price;
      }
    }

    const dueAmount = Math.max(0, totalAmount - paidAmount);

    const updatedRoom = {
      ...rooms[idx],
      status,
      price,
      customerName,
      numberOfPersons,
      aadharNumber,
      phoneNumber,
      checkinTime,
      checkoutTime,
      paymentMode,
      totalAmount,
      paidAmount,
      dueAmount,
    };

    /* ---------------- CUSTOMER DB ---------------- */
    if (status === "occupied" && aadharNumber) {
      let c = customersDB.find((x) => x.aadhar === aadharNumber);

      if (!c) {
        c = {
          id: Date.now().toString(),
          name: customerName,
          aadhar: aadharNumber,
          phoneNumber,
          history: [],
        };
        customersDB.push(c);
      } else {
        c.name = customerName || c.name;
        c.phoneNumber = phoneNumber || c.phoneNumber;
      }

      c.history.push({
        roomId,
        checkinTime,
        checkoutTime,
        totalAmount,
        paidAmount,
        dueAmount,
      });

      saveLocal();
      fetchWithAuth(`${API}/customers`, {
        method: "POST",
        body: c,
      }).catch(() => {});
    }

    /* ---------------- SAVE ROOM ---------------- */
    try {
      const response = await fetchWithAuth(`${API}/rooms/${roomId}`, {
        method: "PUT",
        body: updatedRoom,
      });

      if (!response.ok) throw new Error("Server failed");

      rooms[idx] = updatedRoom;
      saveLocal();
      applyDataToUI();

      document.getElementById("roomModal")?.classList.add("hidden");
      showNotification("Room updated", "success");
    } catch (err) {
      rooms[idx] = updatedRoom;
      saveLocal();
      applyDataToUI();

      document.getElementById("roomModal")?.classList.add("hidden");
      showNotification(
        "Saved locally (server offline)",
        "error"
      );
    }
  });

/* ---------------------------------------------------
   END OF PART 2 — SAY “PART 3”
--------------------------------------------------- */
/* ---------------- PAYMENT MODAL ---------------- */
function openPaymentModal(roomId) {
  const room = rooms.find((r) => r.id === roomId);
  if (!room) return;

  document.getElementById("paymentRoomId").textContent = room.id;
  document.getElementById("currentDueAmount").textContent =
    "₹" + (room.dueAmount || 0);

  document.getElementById("newPaymentAmount").value = "";
  document.getElementById("newPaymentMode").value = "cash";

  document.getElementById("paymentModal")?.classList.remove("hidden");
}

document
  .getElementById("closePaymentModal")
  ?.addEventListener("click", () => {
    document.getElementById("paymentModal")?.classList.add("hidden");
  });

document
  .getElementById("paymentForm")
  ?.addEventListener("submit", async (e) => {
    e.preventDefault();

    const roomId =
      Number(
        document.getElementById("paymentRoomId")?.textContent
      ) || 0;

    const idx = rooms.findIndex((r) => r.id === roomId);
    if (idx === -1) return;

    const paymentAmount =
      Number(document.getElementById("newPaymentAmount")?.value) ||
      0;

    const paymentMode =
      document.getElementById("newPaymentMode")?.value || "cash";

    if (paymentAmount <= 0) {
      showNotification(
        "Enter a valid payment amount",
        "error"
      );
      return;
    }

    /* --------- UPDATE ROOM --------- */
    rooms[idx].paidAmount =
      (rooms[idx].paidAmount || 0) + paymentAmount;

    rooms[idx].dueAmount = Math.max(
      0,
      (rooms[idx].totalAmount || 0) -
        (rooms[idx].paidAmount || 0)
    );

    /* --------- UPDATE COUNTERS --------- */
    payments.cash = payments.cash || 0;
    payments.upi = payments.upi || 0;
    payments.dayRevenue = payments.dayRevenue || 0;
    payments.monthRevenue = payments.monthRevenue || 0;

    if (paymentMode === "UPI") payments.upi += paymentAmount;
    else payments.cash += paymentAmount;

    payments.dayRevenue += paymentAmount;
    payments.monthRevenue += paymentAmount;

    /* --------- SAVE LOCALLY --------- */
    saveLocal();
    applyDataToUI();

    /* --------- SAVE TO SERVER --------- */
    fetchWithAuth(`${API}/rooms/${roomId}`, {
      method: "PUT",
      body: rooms[idx],
    }).catch(() => {});

    fetchWithAuth(`${API}/payments`, {
      method: "POST",
      body: payments,
    }).catch(() => {});

    document.getElementById("paymentModal")?.classList.add("hidden");
    showNotification("Payment updated", "success");
  });

/* ---------------- NOTIFICATIONS ---------------- */
function updateNotificationBadge() {
  const badge = document.getElementById("notificationBadge");
  if (!badge) return;

  const unread = notifications.filter((n) => !n.read).length;
  badge.textContent = unread || "";
  badge.style.display = unread ? "inline-block" : "none";
}

function loadNotifications() {
  const box = document.getElementById("notificationList");
  if (!box) return;

  box.innerHTML = "";

  if (!notifications.length) {
    box.innerHTML = `<p class="text-gray-400 text-center">No notifications</p>`;
    return;
  }

  notifications.forEach((n) => {
    const div = document.createElement("div");
    div.className =
      "p-3 border-b border-gray-700 text-sm " +
      (n.read ? "opacity-60" : "opacity-100");

    div.innerHTML = `
      <p>${escapeHtml(n.message)}</p>
      <small class="text-gray-400">${new Date(n.time).toLocaleString()}</small>
    `;

    div.onclick = () => {
      n.read = true;
      saveLocal();
      updateNotificationBadge();
      box.classList.add("hidden");

      fetchWithAuth(`${API}/notifications`, {
        method: "POST",
        body: n,
      }).catch(() => {});
    };

    box.appendChild(div);
  });
}

document
  .getElementById("notificationButton")
  ?.addEventListener("click", () => {
    const box = document.getElementById("notificationList");
    if (box) box.classList.toggle("hidden");
  });

/* ---------------- CUSTOMER VIEW MODAL ---------------- */
function viewCustomerDetails(roomId) {
  const room = rooms.find((r) => r.id === roomId);
  if (!room || !room.aadharNumber) {
    showNotification("No customer data", "error");
    return;
  }

  const customer = customersDB.find(
    (c) => c.aadhar === room.aadharNumber
  );

  if (!customer) {
    showNotification("Customer not found", "error");
    return;
  }

  document.getElementById("custName").textContent =
    customer.name || "-";
  document.getElementById("custAadhar").textContent =
    customer.aadhar || "-";
  document.getElementById("custPhone").textContent =
    customer.phoneNumber || "-";

  const historyBox = document.getElementById("custHistory");
  historyBox.innerHTML = "";

  customer.history.forEach((h) => {
    const div = document.createElement("div");
    div.className = "p-2 bg-gray-800 rounded mb-2";

    div.innerHTML = `
      <p><strong>Room:</strong> ${h.roomId}</p>
      <p><strong>Check-in:</strong> ${h.checkinTime}</p>
      <p><strong>Check-out:</strong> ${h.checkoutTime}</p>
      <p><strong>Total:</strong> ₹${h.totalAmount}</p>
      <p><strong>Paid:</strong> ₹${h.paidAmount}</p>
      <p><strong>Due:</strong> ₹${h.dueAmount}</p>
    `;

    historyBox.appendChild(div);
  });

  document.getElementById("customerModal")?.classList.remove("hidden");
}

document
  .getElementById("closeCustomerModal")
  ?.addEventListener("click", () => {
    document
      .getElementById("customerModal")
      ?.classList.add("hidden");
  });

/* ---------------- LOGOUT ---------------- */
function logout() {
  setToken("");
  setRole("");
  window.location.reload();
}

document.getElementById("logoutBtn")?.addEventListener("click", logout);

/* ---------------- ESCAPE HTML ---------------- */
function escapeHtml(s) {
  if (!s) return "";
  return s
    .toString()
    .replace(/[&<>"']/g, function (m) {
      return (
        {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        }[m] || m
      );
    });
}

/* ---------------- CLOSE ROOM MODAL ---------------- */
document
  .getElementById("closeRoomModal")
  ?.addEventListener("click", () => {
    document.getElementById("roomModal")?.classList.add("hidden");
  });

/* ---------------- CLOSE PAYMENT MODAL (ALREADY ABOVE) ---------------- */

/* ---------------- CLOSE NOTIFICATION DROPDOWN WHEN CLICK OUTSIDE ---------------- */
document.addEventListener("click", (e) => {
  const box = document.getElementById("notificationList");
  const btn = document.getElementById("notificationButton");

  if (!box || !btn) return;

  if (!btn.contains(e.target) && !box.contains(e.target))
    box.classList.add("hidden");
});
/* ---------------- FINAL FALLBACKS & SAFETY ---------------- */

/* If any number field goes NaN, auto-correct */
document.addEventListener("input", (e) => {
  if (e.target && e.target.type === "number") {
    if (e.target.value === "") return;
    if (isNaN(Number(e.target.value))) e.target.value = 0;
  }
});

/* If modals get stuck open, allow ESC to close */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.getElementById("roomModal")?.classList.add("hidden");
    document.getElementById("paymentModal")?.classList.add("hidden");
    document.getElementById("customerModal")?.classList.add("hidden");
  }
});

/* Prevent accidental scroll issues in numeric inputs */
document.querySelectorAll('input[type=number]').forEach((el) => {
  el.addEventListener("wheel", (e) => e.preventDefault());
});

/* Ensure payment counters exist on fresh installs */
if (!payments || typeof payments !== "object") {
  payments = {
    cash: 0,
    upi: 0,
    dayRevenue: 0,
    monthRevenue: 0,
  };
  saveLocal();
}

/* ---------------- END OF FINAL SCRIPT.JS ---------------- */




/* ---------------- MISSING UI HELPERS ADDED ---------------- */

/* Ensure payment counter changes are persisted and UI updated immediately when room modal payment added */
function _persistPaymentChangesAndRefresh() {
  try {
    saveLocal();
  } catch(e) {}
  try {
    applyDataToUI();
  } catch(e) {}
}

/* Open / Close All Customers Modal and render list */
function openAllCustomersModal(){
  const modal = document.getElementById('allCustomersModal');
  if(modal) modal.classList.remove('hidden');
  renderAllCustomers();
}
function closeAllCustomersModal(){
  const modal = document.getElementById('allCustomersModal');
  if(modal) modal.classList.add('hidden');
}
function renderAllCustomers(){
  const table = document.getElementById('allCustomersTable');
  if(!table) return;
  table.innerHTML = '';
  if(!customersDB || !customersDB.length){
    const noEl = document.getElementById('noCustomersFound');
    if(noEl) noEl.classList.remove('hidden');
    return;
  }
  const noEl = document.getElementById('noCustomersFound');
  if(noEl) noEl.classList.add('hidden');

  customersDB.forEach(c=>{
    const tr = document.createElement('tr');
    const lastVisit = (c.history && c.history.length) ? new Date(c.history[c.history.length-1].checkinTime).toLocaleDateString() : '-';
    tr.innerHTML = `
      <td class="px-6 py-4">${escapeHtml(c.name || "-")}</td>
      <td class="px-6 py-4">${escapeHtml(c.aadhar || "-")}</td>
      <td class="px-6 py-4">${escapeHtml(c.phoneNumber || "-")}</td>
      <td class="px-6 py-4">${c.history ? c.history.length : 0}</td>
      <td class="px-6 py-4">${lastVisit}</td>
      <td class="px-6 py-4"><button class="text-blue-600" onclick="viewCustomerDetailsFromList('${c.aadhar}')">View</button></td>
    `;
    table.appendChild(tr);
  });
}

/* helper to view customer from the customers list */
function viewCustomerDetailsFromList(aadhar){
  const c = customersDB.find(x=>x.aadhar === aadhar);
  if(!c) { showNotification('Customer not found','error'); return; }
  closeAllCustomersModal();
  const avail = rooms.find(r=>r.status === 'available');
  if(avail){
    openRoomModal(avail.id);
    setTimeout(()=>{
      document.getElementById('customerName').value = c.name || '';
      document.getElementById('aadharNumber').value = c.aadhar || '';
      document.getElementById('phoneNumber').value = c.phoneNumber || '';
      showCustomerHistory(c);
    },150);
  } else {
    showNotification('No available rooms','error');
  }
}

/* universal closeModal used by inline onclicks */
function closeModal(){
  const ids = ['roomModal','paymentModal','customerModal','allCustomersModal'];
  ids.forEach(id=>document.getElementById(id)?.classList.add('hidden'));
  document.getElementById('customerHistorySection')?.classList.add('hidden');
}

/* toggle notifications (index.html uses onclick="toggleNotifications()") */
function toggleNotifications(){
  const box = document.getElementById('notificationList');
  if(!box) return;
  box.classList.toggle('hidden');
}

/* add notification helper used elsewhere */
function addNotification(message){
  if(!message) return;
  notifications = notifications || [];
  notifications.push({ message: message, time: new Date().toISOString(), read: false });
  saveLocal();
  updateNotificationBadge();
  loadNotifications();
  // try to persist to server but don't block
  try{
    fetchWithAuth(`${API}/notifications`, { method: 'POST', body: { message, time: new Date().toISOString() } }).catch(()=>{});
  }catch(e){}
}

/* Ensure payment counters update when roomForm adds payments (double-ensure) */
(function patchRoomFormPaymentHook(){
  const form = document.getElementById('roomForm');
  if(!form) return;
  // We will wrap existing submit listener by adding one after it that refreshes counters.
  form.addEventListener('submit', function(){
    // slight delay to allow existing handler to modify payments
    setTimeout(()=>{
      try{ saveLocal(); }catch(e){}
      try{ applyDataToUI(); }catch(e){}
    }, 120);
  });
})();

/* Bind View Customers button if it's present but used inline in HTML */
document.querySelectorAll('button[onclick="openAllCustomersModal()"]').forEach(b=>{
  b.addEventListener('click', openAllCustomersModal);
});

/* Ensure notification toggle button (inline) works when present */
document.querySelectorAll('button[onclick="toggleNotifications()"]').forEach(b=>{
  b.addEventListener('click', toggleNotifications);
});
