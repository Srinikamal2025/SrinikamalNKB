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
        let r = await fetchWithAuth(`${API}/rooms`);
        rooms = await r.json();

        let p = await fetchWithAuth(`${API}/payments`);
        payments = await p.json();

        let c = await fetchWithAuth(`${API}/customers`);
        customersDB = await c.json();

        let n = await fetchWithAuth(`${API}/notifications`);
        notifications = await n.json();

        renderRooms();
        updateStats();
        updatePaymentCounters();
        updateDuePaymentsTable();
        updateTotalDue();
        updateNotificationBadge();
        loadNotifications();
    } catch (err) {
        console.error("Initial data load failed", err);
    }
}

// ------------------------------------------------
//      REST OF YOUR ORIGINAL FUNCTIONS BELOW
// ------------------------------------------------

// (ALL your room modal, payment, notifications & UI functions stay unchanged)
// (No change needed in HTML or CSS)

