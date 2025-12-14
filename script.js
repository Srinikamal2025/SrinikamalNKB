/* ---------------------------------------------------
   script.js - Full client script
   - Uses explicit ROOM_NUMBER_MAP and default prices provided
   - Preserves Owner-only fields (name, price) on non-Owner sessions
   - Merges server updates safely to avoid clobbering local Owner edits
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
    if (!Array.isArray(r)) return;

    // If we're Owner, accept server state fully.
    if (getRole() === "Owner") {
      rooms = r;
      saveLocal();
      applyDataToUI();
      return;
    }

    // For non-Owner sessions (Manager / anonymous), merge per-room preserving local owner fields.
    const merged = (r || []).map((srvRoom) => {
      const local = (rooms || []).find((lr) => lr.id === srvRoom.id) || {};
      return {
        ...srvRoom,
        name: local.name || srvRoom.name || `Room ${srvRoom.id}`,
        price: typeof local.price !== "undefined" ? local.price : (srvRoom.price || 1500),
      };
    });

    rooms = merged;
    saveLocal();
    applyDataToUI();
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

/* Room number mapping and default price logic (explicit mapping provided) */
const ROOM_NUMBER_MAP = {
  1: 102,
  2: 103,
  3: 104,
  4: 105,
  5: 106,
  6: 201,
  7: 202,
  8: 203,
  9: 204,
  10: 205,
  11: 206,
  12: 207,
  13: 208,
  14: 301,
  15: 302,
  16: 303,
  17: 304,
  18: 305,
  19: 306,
  20: 307,
  21: 308,
  22: 401,
  23: 402,
  24: 403,
  25: 404,
  26: 405,
  27: 406,
  28: 407,
  29: 408
};

function getDefaultPriceForRoomNumber(roomNumber) {
  const price350 = new Set([
    102,103,104,105,106,
    201,202,203,204,205,206,207,
    301,302,303,304,305,306,307,
    401,402,403,404,405,406,407
  ]);
  const price500 = new Set([208, 308, 408]);
  if (price350.has(roomNumber)) return 350;
  if (price500.has(roomNumber)) return 500;
  return 1500;
}

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

/* Initialize rooms if empty using explicit mapping and prices */
if (!rooms.length) {
  rooms = Array.from({ length: 29 }, (_, i) => {
    const id = i + 1;
    const mappedNumber = ROOM_NUMBER_MAP[id] || (100 + id);
    return {
      id,
      name: String(mappedNumber),
      status: "available",
      price: getDefaultPriceForRoomNumber(mappedNumber),
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
    };
  });
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
    else
      document.getElementById("dashboardScreen")?.classList.remove("owner-visible");

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
  else
    document
      .getElementById("dashboardScreen")
      ?.classList.remove("owner-visible");

  const roleDisplay = document.getElementById("userRole");
  if (roleDisplay) roleDisplay.textContent = getRole();

  loadInitialData().catch(() => {});
}

/* ---------------- LOAD INITIAL DATA ---------------- */
async function loadInitialData() {
  try {
    const r = await fetchWithAuth(`${API}/rooms`);
    if (r.ok) {
      const serverRooms = await r.json();
      if (Array.isArray(serverRooms) && serverRooms.length) {
        if (getRole() === "Owner") {
          rooms = serverRooms.map((sr) => ({ name: sr.name || `Room ${sr.id}`, ...sr }));
        } else {
          rooms = serverRooms.map((sr) => {
            const local = (rooms || []).find((lr) => lr.id === sr.id) || {};
            const mappedNumber = ROOM_NUMBER_MAP[sr.id] || (100 + sr.id);
            return {
              name: local.name || sr.name || String(mappedNumber),
              price: typeof local.price !== "undefined" ? local.price : (sr.price || getDefaultPriceForRoomNumber(mappedNumber)),
              ...sr,
            };
          });
        }
      }
    }
  } catch {}

  try {
    const p = await fetchWithAuth(`${API}/payments`);
    if (p.ok) {
      const json = await p.json();
      if (json && typeof json === 'object' && ('cash' in json || 'upi' in json || 'dayRevenue' in json || 'monthRevenue' in json)) {
        payments = json;
      } else if (json && typeof json === 'object') {
        payments.dayRevenue = json.dayRevenue || payments.dayRevenue || 0;
        payments.monthRevenue = json.monthRevenue || payments.monthRevenue || 0;
      }
    }
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
    div.dataset.roomId = room.id;

    div.onclick = () => openRoomModal(room.id);

    let icon = '<i class="fas fa-door-open text-2xl mb-2"></i>';
    if (room.status === "occupied") icon = '<i class="fas fa-user text-2xl mb-2"></i>';
    if (room.status === "maintenance") icon = '<i class="fas fa-tools text-2xl mb-2"></i>';

    const displayName = room.name || `Room ${room.id}`;

    div.innerHTML = `
      <div class="text-center">
        ${icon}
        <p class="font-bold">${escapeHtml(displayName)}</p>
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

  // Room name (owner only). Use explicit wrapper to control visibility even though modal is outside dashboard area.
  const roomNameInput = document.getElementById("roomName");
  const roomNameWrapper = document.getElementById("roomNameWrapper");
  if (roomNameInput) roomNameInput.value = room.name || `Room ${room.id}`;
  if (roomNameWrapper) {
    if (getRole() === "Owner") {
      roomNameWrapper.style.display = "block";
    } else {
      roomNameWrapper.style.display = "none";
    }
  }

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

/* When status changes in the modal, hide and CLEAR the customer inputs if not occupied */
document
  .getElementById("roomStatus")
  ?.addEventListener("change", function () {
    const block = document.getElementById("customerDetails");
    if (block)
      block.style.display = this.value === "occupied" ? "block" : "none";

    if (this.value !== "occupied") {
      // Clear modal customer inputs immediately (UI only). The save handler will persist the cleared state to the room.
      const fieldsToClear = [
        "customerName",
        "aadharNumber",
        "phoneNumber",
        "checkinTime",
        "checkoutTime",
        "paymentMode",
      ];
      fieldsToClear.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
      const numEl = document.getElementById("numberOfPersons");
      if (numEl) numEl.value = 1;
      const paidEl = document.getElementById("paidAmount");
      if (paidEl) paidEl.value = 0;

      // Recalculate totals shown in modal
      calculateTotalAmount();
    }
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

    // Allow owner to provide a custom name; otherwise preserve existing name
    const submittedName = document.getElementById("roomName")?.value?.trim();
    const currentName = rooms[idx].name || `Room ${roomId}`;
    const roomNameToSave = getRole() === "Owner" && submittedName ? submittedName : currentName;

    let customerName =
      document.getElementById("customerName")?.value?.trim() || "";
    let numberOfPersons =
      Number(document.getElementById("numberOfPersons")?.value) || 1;
    let aadharNumber =
      document.getElementById("aadharNumber")?.value?.trim() || "";
    let phoneNumber =
      document.getElementById("phoneNumber")?.value?.trim() || "";
    const checkinTime =
      document.getElementById("checkinTime")?.value || "";
    const checkoutTime =
      document.getElementById("checkoutTime")?.value || "";
    const paymentMode =
      document.getElementById("paymentMode")?.value || "";
    let paidAmount =
      Number(document.getElementById("paidAmount")?.value) || 0;

    // If room is being released (not occupied), we clear the customer/payment inputs for the room,
    // and avoid posting any payment changes. The customer DB remains untouched.
    if (status !== "occupied") {
      customerName = "";
      numberOfPersons = 1;
      aadharNumber = "";
      phoneNumber = "";
      paidAmount = 0;
    }

    let previousPaid = rooms[idx].paidAmount || 0;
    let newPaid = paidAmount;
    let addedAmount = newPaid - previousPaid;

    if (status !== "occupied") {
      addedAmount = 0;
    }

    if (addedAmount > 0) {
      try {
        const resp = await fetchWithAuth(`${API}/payments`, {
          method: "POST",
          body: { amount: addedAmount, mode: paymentMode || 'cash', roomId }
        });

        if (resp.ok) {
          const j = await resp.json();
          if (j && j.payments) payments = j.payments;
        } else {
          payments.cash = payments.cash || 0;
          payments.upi = payments.upi || 0;
          payments.dayRevenue = payments.dayRevenue || 0;
          payments.monthRevenue = payments.monthRevenue || 0;

          if (paymentMode === "UPI") payments.upi += addedAmount;
          else payments.cash += addedAmount;

          payments.dayRevenue += addedAmount;
          payments.monthRevenue += addedAmount;
        }
      } catch (err) {
        payments.cash = payments.cash || 0;
        payments.upi = payments.upi || 0;
        payments.dayRevenue = payments.dayRevenue || 0;
        payments.monthRevenue = payments.monthRevenue || 0;

        if (paymentMode === "UPI") payments.upi += addedAmount;
        else payments.cash += addedAmount;

        payments.dayRevenue += addedAmount;
        payments.monthRevenue += addedAmount;
      }
    }

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
      name: roomNameToSave,
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

    if (status !== "occupied") {
      updatedRoom.customerName = "";
      updatedRoom.numberOfPersons = 1;
      updatedRoom.aadharNumber = "";
      updatedRoom.phoneNumber = "";
      updatedRoom.checkinTime = "";
      updatedRoom.checkoutTime = "";
      updatedRoom.paymentMode = "";
      updatedRoom.totalAmount = 0;
      updatedRoom.paidAmount = 0;
      updatedRoom.dueAmount = 0;
    }

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
      // Build payload: strip Owner-only fields if current session is not Owner.
      const payload = { ...updatedRoom };
      if (getRole() !== "Owner") {
        delete payload.name;
        delete payload.price;
      }

      const response = await fetchWithAuth(`${API}/rooms/${roomId}`, {
        method: "PUT",
        body: payload,
      });

      if (!response.ok) throw new Error("Server failed");

      const respJson = await response.json().catch(() => null);
      const serverRoom = respJson && respJson.room ? respJson.room : null;

      if (getRole() === "Owner") {
        rooms[idx] = serverRoom || updatedRoom;
      } else {
        rooms[idx] = {
          ...(serverRoom || updatedRoom),
          name: rooms[idx].name || ((serverRoom && serverRoom.name) || updatedRoom.name),
          price: typeof rooms[idx].price !== "undefined" ? rooms[idx].price : ((serverRoom && serverRoom.price) || updatedRoom.price),
        };
      }

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

/* ---------------- PAYMENT MODAL ---------------- */
function openPaymentModal(roomId) {
  const room = rooms.find((r) => r.id === roomId);
  if (!room) return;

  const paymentRoomInput = document.getElementById("paymentRoomId");
  if (paymentRoomInput) paymentRoomInput.value = room.id;

  document.getElementById("paymentRoomNumber").textContent = room.id;
  document.getElementById("paymentCustomerName").textContent = room.customerName || "-";
  document.getElementById("paymentTotalAmount").textContent = "₹" + (room.totalAmount || 0);
  document.getElementById("paymentAlreadyPaid").textContent = "₹" + (room.paidAmount || 0);
  document.getElementById("paymentDueAmount").textContent = "₹" + (room.dueAmount || 0);

  document.getElementById("additionalPayment").value = "";
  document.getElementById("additionalPaymentMode").value = "cash";

  document.getElementById("paymentModal")?.classList.remove("hidden");
}

function closePaymentModal() {
  document.getElementById("paymentModal")?.classList.add("hidden");
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
        document.getElementById("paymentRoomId")?.value
      ) || 0;

    const idx = rooms.findIndex((r) => r.id === roomId);
    if (idx === -1) return;

    const paymentAmount =
      Number(document.getElementById("additionalPayment")?.value) ||
      0;

    const paymentMode =
      document.getElementById("additionalPaymentMode")?.value || "cash";

    if (paymentAmount <= 0) {
      showNotification(
        "Enter a valid payment amount",
        "error"
      );
      return;
    }

    /* --------- UPDATE ROOM LOCALLY FIRST --------- */
    rooms[idx].paidAmount =
      (rooms[idx].paidAmount || 0) + paymentAmount;

    rooms[idx].dueAmount = Math.max(
      0,
      (rooms[idx].totalAmount || 0) -
        (rooms[idx].paidAmount || 0)
    );

    /* --------- TRY TO POST PAYMENT TO SERVER (correct payload) --------- */
    try {
      const resp = await fetchWithAuth(`${API}/payments`, {
        method: "POST",
        body: { amount: paymentAmount, mode: paymentMode, roomId }
      });

      if (resp.ok) {
        const j = await resp.json();
        if (j && j.payments) payments = j.payments;
      } else {
        payments.cash = payments.cash || 0;
        payments.upi = payments.upi || 0;
        payments.dayRevenue = payments.dayRevenue || 0;
        payments.monthRevenue = payments.monthRevenue || 0;

        if (paymentMode === "UPI") payments.upi += paymentAmount;
        else payments.cash += paymentAmount;

        payments.dayRevenue += paymentAmount;
        payments.monthRevenue += paymentAmount;
      }
    } catch (err) {
      payments.cash = payments.cash || 0;
      payments.upi = payments.upi || 0;
      payments.dayRevenue = payments.dayRevenue || 0;
      payments.monthRevenue = payments.monthRevenue || 0;

      if (paymentMode === "UPI") payments.upi += paymentAmount;
      else payments.cash += paymentAmount;

      payments.dayRevenue += paymentAmount;
      payments.monthRevenue += paymentAmount;
    }

    saveLocal();
    applyDataToUI();

    // PUT the room to server (best-effort)
    try {
      const payload = { ...rooms[idx] };
      if (getRole() !== "Owner") {
        delete payload.name;
        delete payload.price;
      }
      fetchWithAuth(`${API}/rooms/${roomId}`, {
        method: "PUT",
        body: payload,
      }).catch(() => {});
    } catch {}

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
      <small class="text-gray-400">${new Date(n.timestamp || n.time || Date.now()).toLocaleString()}</small>
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

function toggleNotifications() {
  const dropdown = document.getElementById("notificationDropdown");
  if (dropdown) {
    dropdown.classList.toggle("hidden");
    loadNotifications();
  } else {
    const list = document.getElementById("notificationList");
    if (list) list.classList.toggle("hidden");
  }
}

async function clearAllNotifications() {
  if (!confirm("Clear all notifications? This cannot be undone.")) return;

  try {
    await fetchWithAuth(`${API}/notifications`, { method: "DELETE" });
    notifications = [];
    saveLocal();
    updateNotificationBadge();
    loadNotifications();
    showNotification("Notifications cleared", "success");
  } catch (err) {
    notifications = [];
    saveLocal();
    updateNotificationBadge();
    loadNotifications();
    showNotification("Cleared locally (server unreachable)", "error");
  }
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

  (customer.history || []).forEach((h) => {
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

function closeCustomerModal() {
  document.getElementById("customerModal")?.classList.add("hidden");
}

document
  .getElementById("closeCustomerModal")
  ?.addEventListener("click", () => {
    document
      .getElementById("customerModal")
      ?.classList.add("hidden");
  });

/* ---------------- ALL CUSTOMERS MODAL ---------------- */
function openAllCustomersModal() {
  const modal = document.getElementById("allCustomersModal");
  const table = document.getElementById("allCustomersTable");
  const noEl = document.getElementById("noCustomersFound");
  if (!modal || !table) return;

  function renderList(list) {
    table.innerHTML = "";
    if (!list || !list.length) {
      if (noEl) noEl.classList.remove("hidden");
      return;
    } else {
      if (noEl) noEl.classList.add("hidden");
    }

    list.forEach((c) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="px-6 py-4">${escapeHtml(c.name || "-")}</td>
        <td class="px-6 py-4">${escapeHtml(c.aadhar || "-")}</td>
        <td class="px-6 py-4">${escapeHtml(c.phoneNumber || "-")}</td>
        <td class="px-6 py-4">${(Array.isArray(c.history) && c.history.length) || 0}</td>
        <td class="px-6 py-4">${c.history && c.history.length ? escapeHtml(c.history[c.history.length-1].checkoutTime || '-') : '-'}</td>
        <td class="px-6 py-4">
          <button onclick="viewCustomerDetailsForAadhar('${escapeHtml(c.aadhar || "")}')" class="text-blue-600">View</button>
        </td>
      `;
      table.appendChild(tr);
    });
  }

  renderList(customersDB);

  const search = document.getElementById("customerSearch");
  if (search) {
    search.oninput = () => {
      const q = (search.value || "").trim().toLowerCase();
      if (!q) return renderList(customersDB);
      const filtered = customersDB.filter((c) =>
        (c.name || "").toLowerCase().includes(q) ||
        (c.aadhar || "").toLowerCase().includes(q) ||
        (c.phoneNumber || "").toLowerCase().includes(q)
      );
      renderList(filtered);
    };
  }

  modal.classList.remove("hidden");
}

function closeAllCustomersModal() {
  document.getElementById("allCustomersModal")?.classList.add("hidden");
}

function viewCustomerDetailsForAadhar(aadhar) {
  if (!aadhar) return;
  const customer = customersDB.find((c) => c.aadhar === aadhar);
  if (!customer) {
    showNotification("Customer not found", "error");
    return;
  }

  if (customer.history && customer.history.length) {
    const last = customer.history[customer.history.length - 1];
    if (last && last.roomId) {
      openRoomModal(Number(last.roomId));
    }
  }

  document.getElementById("custName").textContent = customer.name || "-";
  document.getElementById("custAadhar").textContent = customer.aadhar || "-";
  document.getElementById("custPhone").textContent = customer.phoneNumber || "-";
  const historyBox = document.getElementById("custHistory");
  historyBox.innerHTML = "";
  (customer.history || []).forEach((h) => {
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

/* ---------------- LOGOUT ---------------- */
function logout() {
  setToken("");
  setRole("");
  window.location.reload();
}

document.getElementById("logoutBtn")?.addEventListener("click", logout);

/* ---------------- ESCAPE HTML ---------------- */
function escapeHtml(s) {
  if (s === null || s === undefined) return "";
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

/* Close room modal helper (HTML references closeModal) */
function closeModal() {
  document.getElementById("roomModal")?.classList.add("hidden");
}

/* ---------------- CLOSE ROOM MODAL ---------------- */
document
  .getElementById("closeRoomModal")
  ?.addEventListener("click", () => {
    document.getElementById("roomModal")?.classList.add("hidden");
  });

/* ---------------- CLOSE NOTIFICATION DROPDOWN WHEN CLICK OUTSIDE ---------------- */
document.addEventListener("click", (e) => {
  const dropdown = document.getElementById("notificationDropdown");
  const btn = document.querySelector('[onclick="toggleNotifications()"]') || document.getElementById("notificationButton");

  if (!dropdown || !btn) return;

  if (!btn.contains(e.target) && !dropdown.contains(e.target))
    dropdown.classList.add("hidden");
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
    document.getElementById("allCustomersModal")?.classList.add("hidden");
    document.getElementById("notificationDropdown")?.classList.add("hidden");
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

/* ---------------- Small toast implementation for showNotification ---------------- */
function showNotification(msg, type = "info", timeout = 3000) {
  try {
    const containerId = "hk-toast-container";
    let container = document.getElementById(containerId);
    if (!container) {
      container = document.createElement("div");
      container.id = containerId;
      container.style.position = "fixed";
      container.style.right = "20px";
      container.style.top = "20px";
      container.style.zIndex = 99999;
      document.body.appendChild(container);
    }
    const el = document.createElement("div");
    el.textContent = msg;
    el.style.marginTop = "8px";
    el.style.padding = "10px 14px";
    el.style.borderRadius = "6px";
    el.style.color = "#fff";
    el.style.minWidth = "160px";
    el.style.boxShadow = "0 6px 18px rgba(0,0,0,0.12)";
    if (type === "error") {
      el.style.background = "#ef4444";
    } else if (type === "success") {
      el.style.background = "#10b981";
    } else {
      el.style.background = "#1f2937";
    }
    container.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 300);
    }, timeout);
  } catch (e) {
    // fallback
    console.log(type, msg);
  }
}

/* ---------------- END OF SCRIPT.JS ---------------- */
