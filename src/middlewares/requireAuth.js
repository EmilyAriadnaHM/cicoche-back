const jwt = require("jsonwebtoken");
const prisma = require("../lib/prisma");

module.exports = async function requireAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) return res.status(401).json({ error: "No autenticado" });

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const userId = payload?.id;

    if (!userId) return res.status(401).json({ error: "Token inválido" });

    const user = await prisma.user.findUnique({
      where: { id: Number(userId) },
      select: {
        id: true,
        email: true,
        nombre: true,
        telefono: true,
        roles: { include: { role: true } },
      },
    });

    if (!user) return res.status(401).json({ error: "Usuario no existe" });

    const roleNames = (user.roles || [])
      .map((r) => r?.role?.name)
      .filter(Boolean);

    req.user = {
      id: user.id,
      email: user.email,
      nombre: user.nombre,
      telefono: user.telefono,
      roles: roleNames,
    };

    next();
  } catch (e) {
    return res.status(401).json({ error: "No autenticado" });
  }
};
