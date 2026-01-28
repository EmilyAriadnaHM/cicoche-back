// src/routes/documents.js
const router = require("express").Router();
const { z } = require("zod");
const prisma = require("../lib/prisma");
const requireAuth = require("../middlewares/requireAuth");
const { uploadDocument } = require("../middlewares/uploadDocuments");


const docSchemaManual = z.object({
  kind: z.enum(["INE", "COMPROBANTE_DOMICILIO", "TARJETA_CIRCULACION", "FOTO_ESPACIO"]),
  url: z.string().min(1).refine((v) => v.startsWith("/uploads/documents/"), {
    message: "URL manual inválida. Debe iniciar con /uploads/documents/ (usa /upload para subir archivos).",
  }),
});

function emitNewDocumentToAdmins(req, doc) {
  const io = req.app.get("io");
  if (!io) return;

  io.to("admins").emit("admin.documents.new", {   
    docId: doc.id,
    userId: doc.userId,
    kind: doc.kind,
    url: doc.url,
    verified: doc.verified,
    createdAt: doc.createdAt,
    ts: new Date().toISOString(),
  });
}



router.post("/", requireAuth, async (req, res) => {
  try {
    const data = docSchemaManual.parse(req.body);

   
    await prisma.document.deleteMany({
      where: { userId: req.user.id, kind: data.kind },
    });

    const doc = await prisma.document.create({
      data: {
        userId: req.user.id,
        kind: data.kind,
        url: data.url,
        verified: false,
      },
    });
    emitNewDocumentToAdmins(req, doc);

    res.status(201).json({ doc });
  } catch (err) {
    if (err?.issues) {
      return res.status(400).json({ error: "Datos inválidos", details: err.issues });
    }
    console.error(err);
    res.status(500).json({ error: "Error interno" });
  }
});

// ----- 2) Nuevo: subir archivo (imagen/pdf) -----
const uploadSchema = z.object({
  kind: z.enum(["INE", "COMPROBANTE_DOMICILIO", "TARJETA_CIRCULACION", "FOTO_ESPACIO"]),
});

router.post(
  "/upload",
  requireAuth,

  (req, res, next) => {
    uploadDocument.single("file")(req, res, (err) => {
      if (!err) return next();

      //tamaño excedido
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "Archivo demasiado grande. Máximo 12 MB." });
      }

      //errores(tipo no permitido, etc.)
      return res.status(400).json({ error: err.message || "Error subiendo archivo" });
    });
  },

  async (req, res) => {
    try {
      const { kind } = uploadSchema.parse(req.body);

      if (!req.file) {
        return res.status(400).json({ error: "Archivo requerido" });
      }

      const relativeUrl = `/uploads/documents/${req.file.filename}`;

      await prisma.document.deleteMany({
        where: { userId: req.user.id, kind },
      });

      const doc = await prisma.document.create({
        data: {
          userId: req.user.id,
          kind,
          url: relativeUrl,
          verified: false,
        },
      });

      emitNewDocumentToAdmins(req, doc);

      return res.status(201).json({ doc });
    } catch (err) {
      if (err?.issues) {
        return res.status(400).json({ error: "Datos inválidos", details: err.issues });
      }
      console.error(err);
      return res.status(500).json({ error: "Error interno" });
    }
  }
);

module.exports = router;
