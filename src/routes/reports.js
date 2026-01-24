// src/routes/reports.js
const router = require("express").Router();
const { z } = require("zod");
const prisma = require("../lib/prisma");
const requireAuth = require("../middlewares/requireAuth");

const CreateReportSchema = z
  .object({
    category: z.string().trim().min(1).max(30).optional(), // si prefieres estrictamente enum, validamos abajo
    subject: z.string().trim().min(3).max(120),
    description: z.string().trim().min(10).max(5000),

    reportedUserId: z.number().int().positive().optional(),
    spaceId: z.number().int().positive().optional(),
    reservationId: z.number().int().positive().optional(),
  })
  .refine((d) => {
    // máximo 1 referencia (para evitar reportes ambiguos)
    const refs = [d.reportedUserId, d.spaceId, d.reservationId].filter((x) => x != null);
    return refs.length <= 1;
  }, { message: "Solo puedes asociar el reporte a un usuario o un espacio o una reserva (máximo 1)." });

router.get("/reports/mine", requireAuth, async (req, res) => {
  try {
    const rows = await prisma.incidentReport.findMany({
      where: { reporterId: req.user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        status: true,
        category: true,
        subject: true,
      },
      take: 200,
    });

    res.json({ reports: rows });
  } catch (e) {
    console.error("GET /api/reports/mine ERR:", e);
    res.status(500).json({ error: "Error al cargar reportes." });
  }
});

router.post("/reports", requireAuth, async (req, res) => {
  try {
    const parsed = CreateReportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Datos inválidos.", details: parsed.error.flatten() });
    }

    const { category, subject, description, reportedUserId, spaceId, reservationId } = parsed.data;

    const created = await prisma.incidentReport.create({
      data: {
        reporterId: req.user.id,
        category: category || "GENERAL",
        subject,
        description,
        reportedUserId: reportedUserId ?? null,
        spaceId: spaceId ?? null,
        reservationId: reservationId ?? null,
      },
      select: { id: true, reporterId: true },
    });

    // realtime
    const io = req.app.get("io");
    if (io) {
      io.emit("admin.reports.new", { reportId: created.id, ts: new Date().toISOString() });
      io.to(`user:${created.reporterId}`).emit("reports.updated", { reportId: created.id, ts: new Date().toISOString() });
    }

    res.json({ reportId: created.id });
  } catch (e) {
    console.error("POST /api/reports ERR:", e);
    res.status(500).json({ error: "Error al crear el reporte." });
  }
});

router.get("/reports/:id", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const report = await prisma.incidentReport.findFirst({
      where: { id, reporterId: req.user.id },
      include: {
        reportedUser: { select: { id: true, nombre: true, email: true } },
        space: { select: { id: true, titulo: true, direccion: true } },
        reservation: { select: { id: true, status: true, startAt: true, endAt: true } },
      },
    });

    if (!report) return res.status(404).json({ error: "Reporte no encontrado." });

    res.json({ report });
  } catch (e) {
    console.error("GET /api/reports/:id ERR:", e);
    res.status(500).json({ error: "Error al cargar el reporte." });
  }
});

module.exports = router;
