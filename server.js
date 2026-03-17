// Import necessary modules
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const pdf = require('pdfkit');

const app = express();
app.use(bodyParser.json());

// MongoDB connection
mongoose.connect('mongodb://localhost:27017/hotel', {useNewUrlParser: true, useUnifiedTopology: true});

// Database Schema
const roomSchema = new mongoose.Schema({
    roomNumber: Number,
    customerName: String,
    aadhar: String,
    phone: String,
    checkin: Date,
    checkout: Date,
    numberOfDays: Number,
    rent: Number
});

const checkoutRecordSchema = new mongoose.Schema({
    checkoutRecords: [roomSchema]
});

const CheckoutRecord = mongoose.model('CheckoutRecord', checkoutRecordSchema);

// Authentication middleware
const authenticate = (req, res, next) => {
    const passcode = req.body.passcode;
    if (passcode === 'your_passcode_here') { // example passcode
        next();
    } else {
        res.status(401).send('Unauthorized');
    }
};

// Endpoint to open a room
app.post('/openRoom', authenticate, (req, res) => {
    const { roomNumber, rent, managerInput } = req.body;
    // Logic for opening room
    res.send('Room opened with Manager input: ' + managerInput);
});

// Endpoint for checking out
app.post('/checkout', authenticate, (req, res) => {
    const { roomNumber, balanceValidation } = req.body;
    // Logic for checkout with balance validation
    res.send('Checked out successfully.');
});

// PDF export functionality
app.get('/exportPDF', authenticate, (req, res) => {
    const doc = new pdf();
    res.setHeader('Content-disposition', 'attachment; filename=customers.pdf');
    res.setHeader('Content-type', 'application/pdf');
    doc.pipe(res);
    doc.text('Customer Database');
    // Logic to fetch customer data and add to PDF
    doc.end();
});

// Other routes as needed

const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});