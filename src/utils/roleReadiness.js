// src/utils/roleReadiness.js
const prisma = require("../lib/prisma");

async function checkReady(userId, roleName) {
  const [docs, vehicles, spaces] = await Promise.all([
    prisma.document.findMany({ where: { userId } }),
    prisma.vehicle.findMany({ where: { userId } }),
    prisma.space.findMany({ where: { idPropietario: userId } }),
  ]);

  const hasVerified = (kind) =>
    docs.some((d) => d.kind === kind && d.verified === true);

  if (roleName === "OCUPANTE") {
    return (
      hasVerified("INE") &&
      hasVerified("TARJETA_CIRCULACION") &&
      vehicles.length > 0
    );
  }

  if (roleName === "PRESTADOR") {
  return hasVerified("INE") && hasVerified("COMPROBANTE_DOMICILIO");
}


  return false;
}

module.exports = { checkReady };
