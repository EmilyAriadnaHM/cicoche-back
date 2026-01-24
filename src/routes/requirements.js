// src/routes/requirements.js
const router = require('express').Router();
const prisma = require('../lib/prisma');
const requireAuth = require('../middlewares/requireAuth');

function isUploadedDoc(d) {
  return typeof d.url === "string" && d.url.startsWith("/uploads/documents/");
}

function hasKind(docs, kind) {
  return docs.some(d => d.kind === kind && isUploadedDoc(d));
}

function hasKindVerified(docs, kind) {
  return docs.some(d => d.kind === kind && d.verified === true && isUploadedDoc(d));
}

function getDocByKind(docs, kind) {
  // Como estás borrando el anterior al subir, solo habrá 1 por kind.
  // A futuro, si guardas historial, aquí elegimos el más reciente.
  const list = docs
    .filter((d) => d.kind === kind && isUploadedDoc(d))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return list[0] || null;
}

function statusFromDoc(doc) {
  if (!doc) return "NO_SUBIDO";
  return doc.verified ? "VALIDADO" : "PENDIENTE";
}

function publicDoc(doc) {
  if (!doc) return null;
  return {
    id: doc.id,
    kind: doc.kind,
    url: doc.url,
    verified: doc.verified,
    createdAt: doc.createdAt,
    // updatedAt: doc.updatedAt, // ⚠️ OJO: tu modelo Document NO tiene updatedAt
    rejectionReason: doc.rejectionReason || null, // ✅ NUEVO
  };
}


router.get('/me', requireAuth, async (req, res) => {
  const userId = req.user.id;

  const [docs, vehicles, spaces, user] = await Promise.all([
    prisma.document.findMany({ where: { userId } }),
    prisma.vehicle.findMany({ where: { userId } }),
    prisma.space.findMany({ where: { idPropietario: userId } }),
    prisma.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: true } } }
    })
  ]);

  const roleNames = user.roles.map(r => r.role.name);
  const result = {};

  //OCUPANTE 
  if (roleNames.includes('OCUPANTE')) {
  const missingUploads = [];
  const missingValidations = [];

  const ine = getDocByKind(docs, "INE");
  const tarjeta = getDocByKind(docs, "TARJETA_CIRCULACION");

  if (!ine) missingUploads.push("INE");
  else if (!ine.verified) missingValidations.push("INE");
  if (!tarjeta) missingUploads.push("TARJETA_CIRCULACION");
  else if (!tarjeta.verified) missingValidations.push("TARJETA_CIRCULACION");

  if (vehicles.length === 0) missingUploads.push("VEHICULO");

  const items = [
    {
      kind: "INE",
      label: "INE",
      status: statusFromDoc(ine),
      doc: publicDoc(ine),
      actionPath: "/documents/ine",
    },
    {
      kind: "TARJETA_CIRCULACION",
      label: "Tarjeta de circulación",
      status: statusFromDoc(tarjeta),
      doc: publicDoc(tarjeta),
      actionPath: "/documents/tarjeta",
    },
    {
      kind: "VEHICULO",
      label: "Vehículo",
      status: vehicles.length > 0 ? "SUBIDO" : "NO_SUBIDO",
      vehicleCount: vehicles.length,
      actionPath: "/vehicles/new",
    },
  ];

  result.OCUPANTE = {
    items,
    missingUploads,
    missingValidations,
    ready: missingUploads.length === 0 && missingValidations.length === 0,
  };
}

  // --- PRESTADOR ---
  if (roleNames.includes('PRESTADOR')) {
  const missingUploads = [];
  const missingValidations = [];

  const ine = getDocByKind(docs, "INE");
  const comp = getDocByKind(docs, "COMPROBANTE_DOMICILIO");

  if (!ine) missingUploads.push("INE");
  else if (!ine.verified) missingValidations.push("INE");

  if (!comp) missingUploads.push("COMPROBANTE_DOMICILIO");
  else if (!comp.verified) missingValidations.push("COMPROBANTE_DOMICILIO");

  const items = [
    {
      kind: "INE",
      label: "INE",
      status: statusFromDoc(ine),
      doc: publicDoc(ine),
      actionPath: "/documents/ine",
    },
    {
      kind: "COMPROBANTE_DOMICILIO",
      label: "Comprobante de domicilio",
      status: statusFromDoc(comp),
      doc: publicDoc(comp),
      actionPath: "/documents/comprobante",
    },
  ];

  result.PRESTADOR = {
    items,
    missingUploads,
    missingValidations,
    ready: missingUploads.length === 0 && missingValidations.length === 0,
  };
}

  res.json(result);
});

module.exports = router;
