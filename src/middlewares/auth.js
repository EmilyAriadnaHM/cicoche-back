// src/middlewares/auth.js
const jwt = require("jsonwebtoken");

function authRequired(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;

    if (!token) return res.status(401).json({ ok: false, error: "NO_TOKEN" });

    const payload = jwt.verify(token, process.env.JWT_SECRET);

    const userId = Number(payload.id || payload.userId);
    if (!userId) return res.status(401).json({ ok: false, error: "BAD_TOKEN" });

    req.user = { id: userId };
    next();
  } catch (e) {
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  }
}

module.exports = { authRequired };
