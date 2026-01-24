const prisma = require("../lib/prisma");

function hasKind(docs, kind) {
  return docs.some((d) => d.kind === kind);
}
function hasKindVerified(docs, kind) {
  return docs.some((d) => d.kind === kind && d.verified === true);
}

async function computeReady(userId) {
  const [docs, vehicles, spaces] = await Promise.all([
    prisma.document.findMany({ where: { userId } }),
    prisma.vehicle.findMany({ where: { userId } }),
    prisma.space.findMany({ where: { idPropietario: userId } }),
  ]);

  // OCUPANTE
  const ocupanteMissingUploads = [];
  const ocupanteMissingValidations = [];

  if (!hasKind(docs, "INE")) ocupanteMissingUploads.push("INE");
  else if (!hasKindVerified(docs, "INE")) ocupanteMissingValidations.push("INE");

  if (!hasKind(docs, "TARJETA_CIRCULACION")) ocupanteMissingUploads.push("TARJETA_CIRCULACION");
  else if (!hasKindVerified(docs, "TARJETA_CIRCULACION"))
    ocupanteMissingValidations.push("TARJETA_CIRCULACION");

  if (vehicles.length === 0) ocupanteMissingUploads.push("VEHICULO");

  const ocupanteReady =
    ocupanteMissingUploads.length === 0 && ocupanteMissingValidations.length === 0;

  // PRESTADOR
  const prestadorMissingUploads = [];
  const prestadorMissingValidations = [];

  if (!hasKind(docs, "INE")) prestadorMissingUploads.push("INE");
  else if (!hasKindVerified(docs, "INE")) prestadorMissingValidations.push("INE");

  if (!hasKind(docs, "COMPROBANTE_DOMICILIO")) prestadorMissingUploads.push("COMPROBANTE_DOMICILIO");
  else if (!hasKindVerified(docs, "COMPROBANTE_DOMICILIO"))
    prestadorMissingValidations.push("COMPROBANTE_DOMICILIO");

  // Nota: NO exigimos ESPACIO para ready (evita bloqueo circular)
  const prestadorReady =
    prestadorMissingUploads.length === 0 && prestadorMissingValidations.length === 0;

  return {
    OCUPANTE: {
      ready: ocupanteReady,
      missingUploads: ocupanteMissingUploads,
      missingValidations: ocupanteMissingValidations,
    },
    PRESTADOR: {
      ready: prestadorReady,
      missingUploads: prestadorMissingUploads,
      missingValidations: prestadorMissingValidations,
    },
    // Si luego ocupas espacios en una validación puntual:
    stats: { spacesCount: spaces.length, vehiclesCount: vehicles.length },
  };
}

module.exports = function requireRoleReady(roleName) {
  return async function (req, res, next) {
    try {
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: "No autenticado" });

      const data = await computeReady(userId);
      const roleInfo = data[roleName];

      if (!roleInfo) {
        return res.status(403).json({ error: `Rol ${roleName} no aplica` });
      }

      if (!roleInfo.ready) {
        return res.status(403).json({
          error: `Requisitos de ${roleName} no completos/validados`,
          reason: "NOT_READY",
          missingUploads: roleInfo.missingUploads,
          missingValidations: roleInfo.missingValidations,
        });
      }

      // Puedes guardar en req por si lo quieres usar después
      req.roleReady = data;

      next();
    } catch (e) {
      console.error("requireRoleReady error:", e);
      res.status(500).json({ error: "Error interno" });
    }
  };
};
