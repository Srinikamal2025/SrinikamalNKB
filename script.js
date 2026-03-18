// ==========================================
// FINAL HOTEL DASHBOARD SCRIPT
// ==========================================

// 🛑 REPLACE THIS WITH YOUR REAL SHEETDB LINK 🛑
const SHEET_API_URL = 'https://sheetdb.io/api/v1/kgyt3gjbywfsn';

// --- GLOBAL VARIABLES ---
let allBookings = [];
let currentRoomStatus = {}; 
let currentRevenue = 0; 
let currentBalance = 0; 

// --- 1. LOAD DATA & CALCULATE DASHBOARD ---
async function loadData() {
    console.log("Fetching booking history...");
    try {
        const response = await fetch(SHEET_API_URL);
        allBookings = await response.json();

        // Reset counters
        currentRevenue = 0; 
        currentBalance = 0; 
        currentRoomStatus = {};

        // Calculate totals from history
        allBookings.forEach(booking => {
            currentRevenue += parseFloat(booking.price) || 0;
            currentBalance += parseFloat(booking.amountPaid) || 0;

            if (booking.status === "Occupied") {
                currentRoomStatus[booking.roomNumber] = booking;
            }
        });

        console.log("Data loaded! Revenue:", currentRevenue, "Balance:", currentBalance);
        updateUI();
    } catch (error) {
        console.error("Error loading data from Google Sheets:", error);
    }
}

// --- 2. THE CHECK-IN LOGIC ---
async function checkInGuest(roomNum, name, aadhar, phone, checkInDate, price, amountPaid) {
    const bookingId = Date.now().toString(); 

    const newBooking = {
        id: bookingId,
        roomNumber: roomNum,
        customerName: name,
        aadhar: aadhar,
        phone: phone,
        checkIn: checkInDate,
        checkOut: "", 
        price: price,           
        amountPaid: amountPaid, 
        status: "Occupied"
    };

    // Update the screen instantly so it feels fast
    allBookings.push(newBooking);
    currentRoomStatus[roomNum] = newBooking;
    currentRevenue += parseFloat(price) || 0;
    currentBalance += parseFloat(amountPaid) || 0;
    updateUI();

    // Save to Google Sheets (Wrapped in an array [] for SheetDB)
    try {
        console.log("Saving to database...", newBooking);
        const response = await fetch(SHEET_API_URL, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ data: [newBooking] }) 
        });

        if (!response.ok) {
            throw new Error(`SheetDB Error: ${response.status}`);
        }
        console.log("Success! Guest saved to Google Sheets.");
        alert(`${name} checked into Room ${roomNum} successfully!`);
    } catch (error) {
        console.error("Failed to save guest:", error);
        alert("Warning: Could not save to database. Check console for details.");
    }
}

// --- 3. GLUE THE HTML BUTTON TO THE JAVASCRIPT ---
function submitForm() {
    // 1. Grab values from the input boxes
    const room = document.getElementById('roomNum').value;
    const name = document.getElementById('guestName').value;
    const aadhar = document.getElementById('aadharNum').value;
    const phone = document.getElementById('phoneNum').value;
    const date = document.getElementById('checkInDate').value;
    const price = document.getElementById('roomPrice').value;
    const paid = document.getElementById('amountPaid').value;

    // 2. Make sure they didn't leave required fields blank
    if (!room || !name || !date || !price || !paid) {
        alert("Please fill in all required fields (Room, Name, Date, Price, Paid).");
        return;
    }

    // 3. Run the check-in function
    checkInGuest(room, name, aadhar, phone, date, price, paid);

    // 4. Clear the form for the next guest
    document.getElementById('checkInForm').reset();
}

// --- 4. UPDATE THE HTML SCREEN ---
function updateUI() {
    document.getElementById('revenue-counter').innerText = currentRevenue;
    document.getElementById('balance-counter').innerText = currentBalance;
}

// --- START THE APP ---
loadData();
