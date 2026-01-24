// src/routes/admin.users.js
const router = require("express").Router();
const { z } = require("zod");
const prisma = require("../lib/prisma");
const requireAuth = require("../middlewares/requireAuth");
const requireRole = require("../middlewares/requireRole");

// Estados sugeridos (ajusta a tu DB si ya tienes otros)
const STATUS = ["ACTIVE", "SUSPENDED", "BANNED"];

function pickUser(u) {
  return {
    id: u.id,
    nombre: u.nombre,
    email: u.email,
    telefono: u.telefono,
    status: u.status,
    statusReason: u.statusReason || null,
    statusUpdatedAt: u.statusUpdatedAt || null,
    createdAt: u.createdAt,
    roles: (u.roles || []).map((r) => r.role?.name).filter(Boolean),
  };
}

// GET /api/admin/users?q=...&status=ACTIVE|SUSPENDED|BANNED&take=30&skip=0
router.get("/users", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const status = String(req.query.status || "").trim().toUpperCase();

    const take = Math.min(Math.max(Number(req.query.take || 30), 1), 100);
    const skip = Math.max(Number(req.query.skip || 0), 0);

    const where = {
      ...(STATUS.includes(status) ? { status } : {}),
      ...(q
        ? {
            OR: [
              { nombre: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
              { telefono: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take,
        skip,
        include: { roles: { include: { role: true } } },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ users: items.map(pickUser), total, take, skip });
  } catch (e) {
    console.error("ADMIN GET /users error:", e);
    res.status(500).json({ error: "Error interno" });
  }
});

// GET /api/admin/users/:id
router.get("/users/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const u = await prisma.user.findUnique({
      where: { id },
      include: { roles: { include: { role: true } } },
    });
    if (!u) return res.status(404).json({ error: "Usuario no encontrado" });

    res.json({ user: pickUser(u) });
  } catch (e) {
    console.error("ADMIN GET /users/:id error:", e);
    res.status(500).json({ error: "Error interno" });
  }
});

const UpdateStatusSchema = z.object({
  status: z.enum(["ACTIVE", "SUSPENDED", "BANNED"]),
  reason: z.string().trim().min(3).max(280).optional(),
});

// PATCH /api/admin/users/:id/status { status, reason? }
router.patch("/users/:id/status", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const parsed = UpdateStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Datos inválidos.", details: parsed.error.flatten() });
    }

    const { status, reason } = parsed.data;

    // evita que un admin se bloquee a sí mismo accidentalmente (opcional)
    if (id === req.user.id && status !== "ACTIVE") {
      return res.status(400).json({ error: "No puedes cambiar tu propio estado." });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: {
        status,
        statusReason: status === "ACTIVE" ? null : (reason || "Sin detalle"),
        statusUpdatedAt: new Date(),
        statusUpdatedById: req.user.id,
      },
      include: { roles: { include: { role: true } } },
    });

    // Notifica al usuario por socket (si usas rooms user:id)
    const io = req.app.get("io");
    if (io) {
      io.to(`user:${updated.id}`).emit("user.status.updated", {
        userId: updated.id,
        status: updated.status,
        reason: updated.statusReason || null,
        ts: new Date().toISOString(),
      });
    }

    res.json({ user: pickUser(updated) });
  } catch (e) {
    console.error("ADMIN PATCH /users/:id/status error:", e);
    if (e?.code === "P2025") return res.status(404).json({ error: "Usuario no encontrado" });
    res.status(500).json({ error: "Error interno" });
  }
});

module.exports = router;
