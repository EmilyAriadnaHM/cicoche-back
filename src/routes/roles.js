// src/routes/roles.js
const router = require('express').Router();
const prisma = require('../lib/prisma');
const requireAuth = require('../middlewares/requireAuth');

router.post('/add', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const role = String(req.body?.role || '').trim().toUpperCase();

    // Solo permitir estos roles desde el cliente
    const allowed = ['OCUPANTE', 'PRESTADOR'];
    if (!allowed.includes(role)) {
      return res.status(400).json({ error: 'Rol inválido. Usa OCUPANTE o PRESTADOR.' });
    }

    // Buscar el rol en BD
    const roleDb = await prisma.role.findUnique({ where: { name: role } });
    if (!roleDb) return res.status(404).json({ error: 'Rol no encontrado en BD.' });

    // Asignar rol de forma idempotente (si ya lo tiene, no truena)
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId: roleDb.id } },
      create: { userId, roleId: roleDb.id },
      update: {},
    });

    // Regresar usuario actualizado con roles (para refrescar frontend)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: true } } },
    });

    res.json({
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        roles: user.roles.map(r => r.role.name),
        createdAt: user.createdAt,
      },
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
