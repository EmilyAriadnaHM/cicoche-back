// src/routes/admin.documents.js
const router = require("express").Router();
const prisma = require("../lib/prisma");
const requireAuth = require("../middlewares/requireAuth");
const requireRole = require("../middlewares/requireRole");

// GET /api/admin/documents?userId=4
// GET /api/admin/documents?userId=4&verified=false
router.get("/documents", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const userIdRaw = req.query.userId;
    const userId = userIdRaw != null ? Number(userIdRaw) : null;

    if (userIdRaw != null && Number.isNaN(userId)) {
      return res.status(400).json({ error: "userId inválido" });
    }

    // ✅ NUEVO: filtro por verified
    let verifiedFilter = null;
    if (req.query.verified != null) {
      if (req.query.verified === "true") verifiedFilter = true;
      else if (req.query.verified === "false") verifiedFilter = false;
      else return res.status(400).json({ error: "verified inválido (true|false)" });
    }

    const where = {
      ...(userId ? { userId } : {}),
      ...(verifiedFilter === null ? {} : { verified: verifiedFilter }),
    };

    const docs = await prisma.document.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { user: { select: { id: true, nombre: true, email: true } } },
    });

    res.json({ documents: docs });
  } catch (e) {
    console.error("ADMIN GET /documents error:", e);
    res.status(500).json({ error: "Error interno" });
  }
});


// GET /api/admin/documents/:id
router.get("/documents/:id", requireAuth, requireRole("ADMIN"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const doc = await prisma.document.findUnique({
      where: { id },
      include: { user: { select: { id: true, nombre: true, email: true } } },
    });

    if (!doc) return res.status(404).json({ error: "Documento no encontrado" });

    res.json({ document: doc });
  } catch (e) {
    console.error("ADMIN GET /documents/:id error:", e);
    res.status(500).json({ error: "Error interno" });
  }
});


// PATCH /api/admin/documents/:id/verify
// body opcional: { verified: true|false, reason?: string }
router.patch(
  "/documents/:id/verify",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (Number.isNaN(id)) return res.status(400).json({ error: "ID inválido" });

      const verified =
        typeof req.body?.verified === "boolean" ? req.body.verified : true;

      const reasonRaw = req.body?.reason;
      const reason = typeof reasonRaw === "string" ? reasonRaw.trim() : "";

      if (verified === false && !reason) {
        return res.status(400).json({ error: "Indica un motivo de no validación." });
      }

      const doc = await prisma.document.update({
        where: { id },
        data: {
          verified,
          rejectionReason: verified ? null : reason, // ✅ clave
          verifiedAt: verified ? new Date() : null,
          verifiedById: verified ? req.user.id : null,
        },
        select: { id: true, userId: true, kind: true, verified: true, rejectionReason: true },
      });

      const io = req.app.get("io");
      if (io) {
        io.to(`user:${doc.userId}`).emit("requirements.updated", {
          userId: doc.userId,
          kind: doc.kind,
          verified: doc.verified,
          rejectionReason: doc.rejectionReason,
          ts: new Date().toISOString(),
        });
      }

      res.json({ document: doc });
    } catch (e) {
      console.error("ADMIN PATCH /documents/:id/verify error:", e);
      if (e?.code === "P2025") return res.status(404).json({ error: "Documento no encontrado" });
      res.status(500).json({ error: "Error interno" });
    }
  }
);


module.exports = router;
