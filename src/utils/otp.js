// src/utils/otp.js
const crypto = require("crypto");

function generateOtp6() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

module.exports = { generateOtp6 };
