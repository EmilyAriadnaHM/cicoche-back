// src/routes/support.js
const router = require("express").Router();
const { z } = require("zod");
const prisma = require("../lib/prisma");
const requireAuth = require("../middlewares/requireAuth");

const CreateTicketSchema = z.object({
  category: z.string().trim().min(2).max(30).optional(),
  subject: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(3000),
});

const CreateMessageSchema = z.object({
  body: z.string().trim().min(1).max(3000),
});

function mapTicket(t) {
  return {
    id: t.id,
    userId: t.userId,
    status: t.status,
    category: t.category,
    subject: t.subject,
    description: t.description,
    assignedToId: t.assignedToId,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

// GET /api/support/tickets (mis tickets)
router.get("/support/tickets", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    const tickets = await prisma.supportTicket.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });

    res.json({ tickets: tickets.map(mapTicket) });
  } catch (e) {
    console.error("GET /api/support/tickets ERR:", e);
    res.status(500).json({ error: "Error al cargar tus tickets." });
  }
});

// POST /api/support/tickets (crear)
router.post("/support/tickets", requireAuth, async (req, res) => {
  try {
    const parsed = CreateTicketSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Datos inválidos.", details: parsed.error.flatten() });
    }

    const userId = req.user.id;
    const { category, subject, description } = parsed.data;

    const ticket = await prisma.supportTicket.create({
      data: {
        userId,
        category: String(category || "GENERAL").toUpperCase(),
        subject,
        description,
        status: "OPEN",
      },
    });

    const io = req.app.get("io");
    if (io) io.emit("admin.support.new", { ticketId: ticket.id });

    res.json({ ticket: mapTicket(ticket) });
  } catch (e) {
    console.error("POST /api/support/tickets ERR:", e);
    res.status(500).json({ error: "Error al crear el ticket." });
  }
});

// GET /api/support/tickets/:id (detalle + mensajes)
router.get("/support/tickets/:id", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const ticket = await prisma.supportTicket.findFirst({
      where: { id, userId: req.user.id },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          include: { author: { select: { id: true, nombre: true } } },
        },
      },
    });

    if (!ticket) return res.status(404).json({ error: "Ticket no encontrado" });
    res.json({ ticket });
  } catch (e) {
    console.error("GET /api/support/tickets/:id ERR:", e);
    res.status(500).json({ error: "Error al cargar el ticket." });
  }
});

// POST /api/support/tickets/:id/messages (usuario responde)
router.post("/support/tickets/:id/messages", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const parsed = CreateMessageSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Mensaje inválido." });

    const ticket = await prisma.supportTicket.findFirst({
      where: { id, userId: req.user.id },
      select: { id: true, userId: true, status: true },
    });

    if (!ticket) return res.status(404).json({ error: "Ticket no encontrado" });
    if (ticket.status === "CLOSED") return res.status(409).json({ error: "El ticket está cerrado." });

    const msg = await prisma.supportMessage.create({
      data: {
        ticketId: id,
        authorId: req.user.id,
        body: parsed.data.body,
        isAdmin: false,
      },
    });

    await prisma.supportTicket.update({
      where: { id },
      data: { updatedAt: new Date(), status: ticket.status === "RESOLVED" ? "IN_PROGRESS" : ticket.status },
    });

    const io = req.app.get("io");
    if (io) {
      io.emit("admin.support.updated", { ticketId: id });
      io.to(`user:${req.user.id}`).emit("support.ticket.updated", { ticketId: id });
    }

    res.json({ message: msg });
  } catch (e) {
    console.error("POST /api/support/tickets/:id/messages ERR:", e);
    res.status(500).json({ error: "Error al enviar el mensaje." });
  }
});

module.exports = router;
