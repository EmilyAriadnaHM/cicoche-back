// src/services/quotes.service.js
const prisma = require("../lib/prisma");

function toDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function ceilDiv(a, b) {
  return Math.floor((a + b - 1) / b);
}

function calcTotalPrice(space, startAt, endAt) {
  const priceHour = Number(space.precioHora ?? 0);
  const priceDay = Number(space.precioDia ?? 0);

  const ms = endAt.getTime() - startAt.getTime();
  const minutes = Math.ceil(ms / 60000);
  const hours = ceilDiv(minutes, 60);
  const days = ceilDiv(hours, 24);

  const byHour = hours * priceHour;
  const byDay = priceDay > 0 ? days * priceDay : Number.POSITIVE_INFINITY;

  const total = Math.min(byHour, byDay);
  return Math.round(total * 100) / 100;
}

module.exports = {
  async quote({ spaceId, startAt, endAt }) {
    const start = toDate(startAt);
    const end = toDate(endAt);

    if (!start || !end) {
      const err = new Error("Fechas inválidas.");
      err.statusCode = 400;
      throw err;
    }
    if (start >= end) {
      const err = new Error("Rango inválido (startAt debe ser menor que endAt).");
      err.statusCode = 400;
      throw err;
    }

    // recomendado: bloquear cotización para fechas pasadas
    if (start < new Date()) {
      const err = new Error("No puedes cotizar en una fecha pasada.");
      err.statusCode = 400;
      throw err;
    }

    const space = await prisma.space.findUnique({
      where: { id: Number(spaceId) },
      select: {
        id: true,
        activo: true,
        precioHora: true,
        precioDia: true,
      },
    });

    if (!space || !space.activo) {
      const err = new Error("Espacio no disponible.");
      err.statusCode = 404;
      throw err;
    }

    const totalPrice = calcTotalPrice(space, start, end);

    return {
      totalPrice,
      currency: "MXN",
      startAt: start.toISOString(),
      endAt: end.toISOString(),
    };
  },
};
