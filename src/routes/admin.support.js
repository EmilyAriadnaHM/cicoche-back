// src/routes/admin.support.js
const router = require("express").Router();
const { z } = require("zod");
const prisma = require("../lib/prisma");
const requireAuth = require("../middlewares/requireAuth");
const requireRole = require("../middlewares/requireRole");

const StatusSchema = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]),
});

const AdminMessageSchema = z.object({
  body: z.string().trim().min(1).max(3000),
});

const AssignSchema = z.object({
  assignedToId: z.number().int().positive().nullable(),
});

function mapTicket(t) {
  return {
    id: t.id,
    status: t.status,
    category: t.category,
    subject: t.subject,
    description: t.description,
    userId: t.userId,
    assignedToId: t.assignedToId,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    user: t.user
      ? { id: t.user.id, nombre: t.user.nombre, email: t.user.email }
      : null,
  };
}

// GET /api/admin/support/tickets?status=OPEN|IN_PROGRESS|RESOLVED|CLOSED|ALL&q=...
router.get("/support/tickets", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const status = String(req.query.status || "ALL").toUpperCase();
    const q = String(req.query.q || "").trim();

    const where = {
      ...(status !== "ALL" ? { status } : {}),
      ...(q
        ? {
            OR: [
              { subject: { contains: q, mode: "insensitive" } },
              { description: { contains: q, mode: "insensitive" } },
              { user: { email: { contains: q, mode: "insensitive" } } },
              { user: { nombre: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {}),
    };

    const tickets = await prisma.supportTicket.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 200,
      include: { user: { select: { id: true, nombre: true, email: true } } },
    });

    res.json({ tickets: tickets.map(mapTicket) });
  } catch (e) {
    console.error("ADMIN GET /support/tickets ERR:", e);
    res.status(500).json({ error: "Error al cargar tickets." });
  }
});

// GET /api/admin/support/tickets/:id
router.get("/support/tickets/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, nombre: true, email: true } },
        messages: {
          orderBy: { createdAt: "asc" },
          include: { author: { select: { id: true, nombre: true } } },
        },
      },
    });

    if (!ticket) return res.status(404).json({ error: "Ticket no encontrado" });
    res.json({ ticket });
  } catch (e) {
    console.error("ADMIN GET /support/tickets/:id ERR:", e);
    res.status(500).json({ error: "Error al cargar ticket." });
  }
});

// POST /api/admin/support/tickets/:id/messages (responder)
router.post("/support/tickets/:id/messages", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const parsed = AdminMessageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Mensaje inválido." });

    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
      select: { id: true, userId: true, status: true },
    });
    if (!ticket) return res.status(404).json({ error: "Ticket no encontrado" });

    const msg = await prisma.supportMessage.create({
      data: {
        ticketId: id,
        authorId: req.user.id,
        body: parsed.data.body,
        isAdmin: true,
      },
    });

    // si estaba OPEN, lo pasamos a IN_PROGRESS automáticamente
    await prisma.supportTicket.update({
      where: { id },
      data: { updatedAt: new Date(), status: ticket.status === "OPEN" ? "IN_PROGRESS" : ticket.status },
    });

    const io = req.app.get("io");
    if (io) {
      io.to(`user:${ticket.userId}`).emit("support.ticket.updated", { ticketId: id });
      io.emit("admin.support.updated", { ticketId: id });
    }

    res.json({ message: msg });
  } catch (e) {
    console.error("ADMIN POST /support/tickets/:id/messages ERR:", e);
    res.status(500).json({ error: "Error al enviar respuesta." });
  }
});

// PATCH /api/admin/support/tickets/:id/status
router.patch("/support/tickets/:id/status", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const parsed = StatusSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Datos inválidos." });

    const updated = await prisma.supportTicket.update({
      where: { id },
      data: { status: parsed.data.status, updatedAt: new Date() },
    });

    const io = req.app.get("io");
    if (io) {
      io.to(`user:${updated.userId}`).emit("support.ticket.updated", { ticketId: id });
      io.emit("admin.support.updated", { ticketId: id });
    }

    res.json({ ticket: updated });
  } catch (e) {
    console.error("ADMIN PATCH /support/tickets/:id/status ERR:", e);
    if (e?.code === "P2025") return res.status(404).json({ error: "Ticket no encontrado" });
    res.status(500).json({ error: "Error al actualizar estado." });
  }
});

// PATCH /api/admin/support/tickets/:id/assign (opcional)
router.patch("/support/tickets/:id/assign", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const parsed = AssignSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Datos inválidos." });

    const updated = await prisma.supportTicket.update({
      where: { id },
      data: { assignedToId: parsed.data.assignedToId, updatedAt: new Date() },
    });

    res.json({ ticket: updated });
  } catch (e) {
    console.error("ADMIN PATCH /support/tickets/:id/assign ERR:", e);
    res.status(500).json({ error: "Error al asignar ticket." });
  }
});

module.exports = router;
