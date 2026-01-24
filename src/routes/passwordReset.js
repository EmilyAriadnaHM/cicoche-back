const express = require("express");
const bcrypt = require("bcrypt");
const prisma = require("../lib/prisma");
const { generateOtp6 } = require("../utils/otp");
const { sendPasswordResetOtp } = require("../mail/mailer");

const router = express.Router();

router.post("/forgot-password", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "Email requerido" });

    const user = await prisma.user.findUnique({ where: { email } });

    // responder ok aunque no exista
    if (!user) {
  if (process.env.NODE_ENV !== "production") {
    console.log("[forgot-password] Email no registrado:", email);
  }
  return res.json({ ok: true });
}

    await prisma.passwordResetOtp.updateMany({
      where: { userId: user.id, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });

    const otp = generateOtp6();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.passwordResetOtp.create({
      data: { userId: user.id, otpHash, expiresAt },
    });

    await sendPasswordResetOtp({ to: user.email, nombre: user.nombre, otp });

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error interno" });
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const otp = String(req.body?.otp || "").trim();
    const newPassword = String(req.body?.newPassword || "");

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ error: "Datos incompletos" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "La contraseña debe tener mínimo 8 caracteres" });
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return res.status(400).json({ error: "Código inválido" });

    const record = await prisma.passwordResetOtp.findFirst({
      where: { userId: user.id, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });

    if (!record) return res.status(400).json({ error: "Código inválido o expirado" });

    if (record.attempts >= 5) {
      await prisma.passwordResetOtp.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      });
      return res.status(400).json({ error: "Demasiados intentos. Solicita un nuevo código." });
    }

    const ok = await bcrypt.compare(otp, record.otpHash);
    if (!ok) {
      await prisma.passwordResetOtp.update({
        where: { id: record.id },
        data: { attempts: { increment: 1 } },
      });
      return res.status(400).json({ error: "Código inválido" });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);

    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      prisma.passwordResetOtp.update({ where: { id: record.id }, data: { consumedAt: new Date() } }),
    ]);

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Error interno" });
  }
});

module.exports = router;
