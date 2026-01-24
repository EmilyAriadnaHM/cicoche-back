// src/routes/admin.reports.js
const router = require("express").Router();
const { z } = require("zod");
const prisma = require("../lib/prisma");
const requireAuth = require("../middlewares/requireAuth");
const requireRole = require("../middlewares/requireRole");

router.get("/reports", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status) : null;
    const category = req.query.category ? String(req.query.category) : null;
    const q = req.query.q ? String(req.query.q).trim() : null;

    const where = {
      ...(status ? { status } : {}),
      ...(category ? { category } : {}),
      ...(q
        ? {
            OR: [
              { subject: { contains: q } },
              { description: { contains: q } },
              { reporter: { nombre: { contains: q } } },
              { reporter: { email: { contains: q } } },
            ],
          }
        : {}),
    };

    const rows = await prisma.incidentReport.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        reporter: { select: { id: true, nombre: true, email: true } },
        reportedUser: { select: { id: true, nombre: true, email: true } },
      },
      take: 300,
    });

    res.json({ reports: rows });
  } catch (e) {
    console.error("ADMIN GET /reports ERR:", e);
    res.status(500).json({ error: "Error interno" });
  }
});

router.get("/reports/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const report = await prisma.incidentReport.findUnique({
      where: { id },
      include: {
        reporter: { select: { id: true, nombre: true, email: true } },
        reportedUser: { select: { id: true, nombre: true, email: true } },
        space: { select: { id: true, titulo: true, direccion: true } },
        reservation: { select: { id: true, status: true, startAt: true, endAt: true } },
        assignedTo: { select: { id: true, nombre: true, email: true } },
      },
    });

    if (!report) return res.status(404).json({ error: "Reporte no encontrado" });
    res.json({ report });
  } catch (e) {
    console.error("ADMIN GET /reports/:id ERR:", e);
    res.status(500).json({ error: "Error interno" });
  }
});

const PatchSchema = z.object({
  status: z.string().trim().min(1).max(30).optional(),
  category: z.string().trim().min(1).max(30).optional(),
  adminNote: z.string().trim().max(10000).optional().nullable(),
  assignedToId: z.number().int().positive().optional().nullable(),
});

router.patch("/reports/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const parsed = PatchSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Datos inválidos.", details: parsed.error.flatten() });
    }

    const data = {};
    const { status, category, adminNote, assignedToId } = parsed.data;

    if (status !== undefined) data.status = status;
    if (category !== undefined) data.category = category;
    if (adminNote !== undefined) data.adminNote = adminNote;
    if (assignedToId !== undefined) data.assignedToId = assignedToId;

    // si lo cierran, marcamos resolvedAt
    if (status === "CLOSED" || status === "RESOLVED") {
      data.resolvedAt = new Date();
    }

    const updated = await prisma.incidentReport.update({
      where: { id },
      data,
      select: { id: true, reporterId: true, status: true, category: true },
    });

    // realtime
    const io = req.app.get("io");
    if (io) {
      io.emit("admin.reports.updated", { reportId: updated.id, ts: new Date().toISOString() });
      io.to(`user:${updated.reporterId}`).emit("reports.updated", { reportId: updated.id, ts: new Date().toISOString() });
    }

    res.json({ report: updated });
  } catch (e) {
    console.error("ADMIN PATCH /reports/:id ERR:", e);
    if (e?.code === "P2025") return res.status(404).json({ error: "Reporte no encontrado" });
    res.status(500).json({ error: "Error interno" });
  }
});

module.exports = router;
