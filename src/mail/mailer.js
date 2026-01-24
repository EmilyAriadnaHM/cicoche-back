// src/mail/mailer.js
const nodemailer = require("nodemailer");

function emailDisabled() {
  return String(process.env.DISABLE_EMAIL || "").toLowerCase() === "true";
}

function createTransporter() {
  const port = Number(process.env.SMTP_PORT || 465);
  const secure = String(process.env.SMTP_SECURE || "true") === "true";

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

let transporter = null;
function getTransporter() {
  if (emailDisabled()) return null;
  if (!transporter) transporter = createTransporter();
  return transporter;
}

async function verifySmtp() {
  if (emailDisabled()) {
    console.log("✉️ Email deshabilitado (DISABLE_EMAIL=true).");
    return;
  }
  try {
    const t = getTransporter();
    await t.verify();
    console.log("✅ SMTP listo");
  } catch (e) {
    console.log("❌ SMTP verify error:", e.message);
  }
}

async function sendPasswordResetOtp({ to, nombre, otp }) {
  if (emailDisabled()) {
    console.log("✉️ DISABLE_EMAIL=true => No se envía correo. OTP:", { to, otp });
    return { ok: true, disabled: true };
  }

  const t = getTransporter();
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;

  const subject = "Código de recuperación de contraseña - CICOCHE";
  const text =
    `Hola ${nombre || ""}\n\n` +
    `Tu código es: ${otp}\n\n` +
    `Este código expira en 10 minutos.\n` +
    `Si no lo solicitaste, ignora este mensaje.\n`;

  const html = `
    <div style="font-family: Arial, sans-serif; line-height: 1.5;">
      <h2>Recuperación de contraseña</h2>
      <p>Hola ${nombre || ""},</p>
      <p>Tu código es:</p>
      <div style="font-size: 28px; font-weight: 800; letter-spacing: 4px;">${otp}</div>
      <p>Este código expira en 10 minutos.</p>
      <p>Si no lo solicitaste, ignora este mensaje.</p>
    </div>
  `;

  return t.sendMail({ from, to, subject, text, html });
}

module.exports = { verifySmtp, sendPasswordResetOtp };
