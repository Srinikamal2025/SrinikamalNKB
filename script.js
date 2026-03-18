// ==========================================
// HOTEL DASHBOARD - FULL BOOKING SYSTEM
// ==========================================

const SHEET_API_URL = 'https://sheetdb.io/api/v1/kgyt3gjbywfsn';

// --- GLOBAL VARIABLES ---
let allBookings = [];
let currentRoomStatus = {}; 
let currentRevenue = 0; // Total value of all rooms booked
let currentBalance = 0; // Total cash actually collected

// --- 1. LOAD DATA & CALCULATE DASHBOARD ---
async function loadData() {
    console.log("Fetching booking history...");
    try {
        const response = await fetch(SHEET_API_URL);
        allBookings = await response.json();

        // Reset counters to zero before recalculating
        currentRevenue = 0; 
        currentBalance = 0; 
        currentRoomStatus = {};

        // Loop through the history to build the dashboard
        allBookings.forEach(booking => {
            // Add up the money
            currentRevenue += parseFloat(booking.price) || 0;
            currentBalance += parseFloat(booking.amountPaid) || 0;

            // If the guest is still here, put them in the current room status
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

// --- 2. CHECK-IN A GUEST ---
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

    // 1. Update the local data so the screen changes instantly
    allBookings.push(newBooking);
    currentRoomStatus[roomNum] = newBooking;
    currentRevenue += parseFloat(price);
    currentBalance += parseFloat(amountPaid);
    
    updateUI();

    // 2. Save the new row to Google Sheets
    try {
        await fetch(SHEET_API_URL, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ data: newBooking })
        });
        console.log(`Guest ${name} saved to database!`);
    } catch (error) {
        console.error("Failed to save guest:", error);
    }
}

// --- 3. CHECK-OUT A GUEST ---
async function checkOutGuest(roomNum, checkOutDate, finalPayment = 0) {
    const activeBooking = currentRoomStatus[roomNum];
    
    if (!activeBooking) {
        console.error("No one is currently booked in this room.");
        return;
    }

    // 1. Update the local data instantly
    activeBooking.checkOut = checkOutDate;
    activeBooking.status = "Checked Out";
    
    // If they pay their remaining balance at checkout, add it!
    if (finalPayment > 0) {
        activeBooking.amountPaid = parseFloat(activeBooking.amountPaid) + parseFloat(finalPayment);
        currentBalance += parseFloat(finalPayment);
    }

    delete currentRoomStatus[roomNum]; 
    updateUI();

    // 2. Update their specific row in Google Sheets
    try {
        await fetch(`${SHEET_API_URL}/id/${activeBooking.id}`, {
            method: 'PUT',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                data: {
                    checkOut: checkOutDate,
                    status: "Checked Out",
                    amountPaid: activeBooking.amountPaid // Update the total paid
                }
            })
        });
        console.log(`Room ${roomNum} checked out successfully!`);
    } catch (error) {
        console.error("Failed to check out guest:", error);
    }
}

// --- 4. UPDATE THE HTML SCREEN ---
function updateUI() {
    // Connect these to your actual HTML element IDs
    // document.getElementById('revenue-counter').innerText = '₹' + currentRevenue;
    // document.getElementById('balance-counter').innerText = '₹' + currentBalance;
    
    console.log("Screen updated.");
}

// --- START THE APP ---
loadData();
