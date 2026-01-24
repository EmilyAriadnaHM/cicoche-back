const prisma = require("../lib/prisma");

// Estados que bloquean disponibilidad del espacio (horario “ocupado”)
const ACTIVE_STATUSES = ["PENDIENTE", "ACEPTADA", "CHECKIN_SOLICITADO", "EN_CURSO"];
const CAPACITY_STATUSES = ["ACEPTADA", "CHECKIN_SOLICITADO", "EN_CURSO"];

const DEFAULT_CHECKIN_TOLERANCE_MIN = 15;

function computeDeadline(startAt, minutes = DEFAULT_CHECKIN_TOLERANCE_MIN) {
  const ms = Number(minutes) * 60 * 1000;
  return new Date(new Date(startAt).getTime() + ms);
}

function toDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function parseIntParam(value, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    const err = new Error(`Parámetro inválido: ${name}`);
    err.statusCode = 400;
    throw err;
  }
  return n;
}

function ensureNonEmptyString(value, name) {
  const s = String(value || "").trim();
  if (!s) {
    const err = new Error(`${name} es obligatorio`);
    err.statusCode = 400;
    throw err;
  }
  return s;
}

/**
 * Traslape estándar: existing.startAt < newEnd AND existing.endAt > newStart
 * Para disponibilidad general (al crear) usamos ACTIVE_STATUSES.
 */
// Traslape estándar: existing.startAt < newEnd AND existing.endAt > newStart
async function assertCapacityAvailable({ spaceId, startAt, endAt, capacity = 1, excludeReservationId }) {
  const where = {
    spaceId: Number(spaceId),
    status: { in: CAPACITY_STATUSES },
    AND: [{ startAt: { lt: endAt } }, { endAt: { gt: startAt } }],
  };

  if (excludeReservationId) {
    where.id = { not: Number(excludeReservationId) };
  }

  const overlapCount = await prisma.reservation.count({ where });

  if (overlapCount >= Number(capacity || 1)) {
    const err = new Error("No hay cupo disponible en ese horario.");
    err.statusCode = 409;
    throw err;
  }

  return overlapCount;
}


const AUTO_DAY_THRESHOLD_HOURS = 8;

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function calcTotalPrice(space, startAt, endAt, billingMode = "AUTO") {
  const priceHour = Number(space.precioHora ?? 0);
  const priceDay = Number(space.precioDia ?? 0);

  const diffMs = endAt.getTime() - startAt.getTime();
  const hours = Math.max(0, diffMs / (1000 * 60 * 60));

  const daysForBilling = Math.max(1, Math.ceil(hours / 24));

  const hourTotal = hours * priceHour;
  const dayTotal = daysForBilling * priceDay;

  if (billingMode === "HORA") {
    return { total: round2(hourTotal), hours, days: daysForBilling, used: "HORA" };
  }
  if (billingMode === "DIA") {
    return { total: round2(dayTotal), hours, days: daysForBilling, used: "DIA" };
  }

  const used = hours >= AUTO_DAY_THRESHOLD_HOURS ? "DIA" : "HORA";
  const total = used === "DIA" ? dayTotal : hourTotal;

  return { total: round2(total), hours, days: daysForBilling, used };
}

/**
 * Includes útiles para UI:
 * - space: fotos + owner
 * - occupant: datos + vehicles + fotos
 */
const PROVIDER_ALLOWED_DOC_KINDS = ["INE", "TARJETA_CIRCULACION"];

const providerListInclude = {
  space: {
    include: {
      photos: true,
      owner: {
        select: { id: true, nombre: true, email: true, telefono: true },
      },
    },
  },

  // ✅ SOLO el vehículo con el que se hizo la reserva
  vehicle: {
    include: { photos: true },
  },

  occupant: {
    select: {
      id: true,
      nombre: true,
      email: true,
      telefono: true,

      // ✅ SOLO INE y TARJETA_CIRCULACION
      documents: {
        where: { kind: { in: PROVIDER_ALLOWED_DOC_KINDS } },
        select: {
          id: true,
          kind: true,
          url: true,
          verified: true,
        },
      },
    },
  },
};



async function expireAcceptedPastDeadline(whereBase, io) {
  const now = new Date();

  const expired = await prisma.reservation.findMany({
    where: {
      ...whereBase,
      status: "ACEPTADA",
      checkInAt: null,
      checkInDeadline: { not: null, lt: now },
    },
    select: { id: true, occupantId: true, providerId: true },
  });

  if (expired.length === 0) return 0;

  await prisma.reservation.updateMany({
    where: { id: { in: expired.map((x) => x.id) } },
    data: { status: "EXPIRADA" },
  });

  if (io) {
    for (const r of expired) {
      io.to(`user:${r.occupantId}`).emit("reservation.expired", {
        reservationId: r.id,
        reason: "No llegó dentro de tolerancia",
        ts: new Date().toISOString(),
      });
      io.to(`user:${r.providerId}`).emit("reservation.expired", {
        reservationId: r.id,
        reason: "No llegó dentro de tolerancia",
        ts: new Date().toISOString(),
      });
    }
  }

  return expired.length;
}


module.exports = {
  // POST /api/reservations
    async create({ occupantId, spaceId, startAt, endAt, billingMode = "AUTO", vehicleId }) {
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
      if (start < new Date()) {
        const err = new Error("No puedes reservar en una fecha pasada.");
        err.statusCode = 400;
        throw err;
      }

      if (vehicleId == null) {
        const err = new Error("Selecciona el vehículo con el que vas a reservar.");
        err.statusCode = 400;
        throw err;
      }
      const vId = parseIntParam(vehicleId, "vehicleId");


      // 1) Espacio + reglas (capacidad + tipos permitidos)
      const space = await prisma.space.findUnique({
        where: { id: Number(spaceId) },
        select: {
          id: true,
          activo: true,
          idPropietario: true,
          precioHora: true,
          precioDia: true,
          titulo: true,
          direccion: true,

          // ✅ NUEVO
          capacity: true,

          // ✅ NUEVO: relación a tipos permitidos
          allowedVehicleTypes: { select: { type: true } },
        },
      });

      if (!space || !space.activo) {
        const err = new Error("Espacio no disponible.");
        err.statusCode = 404;
        throw err;
      }

      if (Number(space.idPropietario) === Number(occupantId)) {
        const err = new Error("No puedes reservar tu propio espacio.");
        err.statusCode = 400;
        throw err;
      }

      // 2) Vehículo debe pertenecer al ocupante
      const vehicle = await prisma.vehicle.findFirst({
        where: { id: vId, userId: Number(occupantId) },
        select: { id: true, type: true },
      });

      if (!vehicle) {
        const err = new Error("Vehículo inválido o no pertenece al usuario.");
        err.statusCode = 400;
        throw err;
      }

      // 3) Validar tipo permitido por el espacio
      const allowed = Array.isArray(space.allowedVehicleTypes) ? space.allowedVehicleTypes : [];

      // Compatibilidad: si aún no has “sembrado” allowedVehicleTypes para espacios viejos,
      // puedes permitir todo cuando esté vacío.
      if (allowed.length > 0) {
        const okType = allowed.some((x) => x.type === vehicle.type);
        if (!okType) {
          const err = new Error("El espacio no acepta ese tipo de vehículo.");
          err.statusCode = 400;
          throw err;
        }
      }

      // 4) Validar cupo (capacidad)
      await assertCapacityAvailable({
        spaceId: space.id,
        startAt: start,
        endAt: end,
        capacity: space.capacity ?? 1,
      });

      const pricing = calcTotalPrice(space, start, end, billingMode);
      const totalPrice = pricing.total;

      return prisma.reservation.create({
        data: {
          spaceId: space.id,
          occupantId: Number(occupantId),
          providerId: Number(space.idPropietario),

          // ✅ NUEVO
          vehicleId: vehicle.id,

          startAt: start,
          endAt: end,
          status: "PENDIENTE",
          totalPrice,
          billingMode: pricing.used, // HORA o DIA
        },
        include: {
          space: { select: { id: true, titulo: true, direccion: true } },
          provider: { select: { id: true, nombre: true } },

          // ✅ para que el frontend confirme qué vehículo quedó ligado
          vehicle: { select: { id: true, type: true, marca: true, modelo: true, color: true, plate: true } },
        },
      });
    },


  // GET /api/reservations/mine
    async listMine(occupantId, io) {
      await expireAcceptedPastDeadline({ occupantId: Number(occupantId) }, io);

      return prisma.reservation.findMany({
        where: { occupantId: Number(occupantId) },
        orderBy: { createdAt: "desc" },
        include: {
          space: { select: { id: true, titulo: true, direccion: true } },
          provider: { select: { id: true, nombre: true } },

          // ✅ NUEVO: vehículo
          vehicle: { select: { id: true, type: true, marca: true, modelo: true, color: true, plate: true } },
        },
      });
    },



  // GET /api/reservations/for-my-spaces
  async listForProvider(providerId, status, io) {
  await expireAcceptedPastDeadline({ providerId: Number(providerId) }, io);

  return prisma.reservation.findMany({
    where: {
      providerId: Number(providerId),
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: "desc" },
    include: providerListInclude,
  });
},


  // GET /api/reservations/:id  (PRESTADOR)
  async getByIdForProvider({ providerId, reservationId }) {
  const id = parseIntParam(reservationId, "reservationId");

  const r = await prisma.reservation.findFirst({
    where: {
      id,
      providerId: Number(providerId),
    },
    include: {
      ...providerListInclude,
      provider: { select: { id: true, nombre: true, email: true, telefono: true } },
    },
  });

  if (!r) {
    const err = new Error("Reserva no encontrada.");
    err.statusCode = 404;
    throw err;
  }

  return r;
},


  // PATCH /api/reservations/:id/cancel  (ocupante)
  async cancel({ occupantId, reservationId, reason }) {
    const id = parseIntParam(reservationId, "reservationId");
    const cleanReason = reason ? String(reason).trim() : null;

    const reservation = await prisma.reservation.findUnique({
      where: { id },
      select: { id: true, occupantId: true, status: true, startAt: true },
    });

    if (!reservation) {
      const err = new Error("Reserva no encontrada.");
      err.statusCode = 404;
      throw err;
    }

    if (Number(reservation.occupantId) !== Number(occupantId)) {
      const err = new Error("No autorizado.");
      err.statusCode = 403;
      throw err;
    }

    if (!["PENDIENTE", "ACEPTADA"].includes(reservation.status)) {
      const err = new Error("Solo se pueden cancelar reservas PENDIENTE o ACEPTADA.");
      err.statusCode = 400;
      throw err;
    }

    // (Opcional) regla: no permitir cancelar si ya inició
    if (reservation.startAt < new Date()) {
      const err = new Error("No puedes cancelar una reserva que ya inició.");
      err.statusCode = 400;
      throw err;
    }

    return prisma.reservation.update({
      where: { id },
      data: {
        status: "CANCELADA",
        cancelledReason: cleanReason, // <- descomenta si agregas el campo en Prisma
      },
    });
  },

  // PATCH /api/reservations/:id/accept  (prestador)
  async accept({ providerId, reservationId }) {
    const id = parseIntParam(reservationId, "reservationId");

    return prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.findUnique({
        where: { id },
        select: {
          id: true,
          providerId: true,
          status: true,
          spaceId: true,
          startAt: true,
          endAt: true,
        },
      });

      if (!reservation) {
        const err = new Error("Reserva no encontrada.");
        err.statusCode = 404;
        throw err;
      }

      if (Number(reservation.providerId) !== Number(providerId)) {
        const err = new Error("No autorizado.");
        err.statusCode = 403;
        throw err;
      }

      if (reservation.status !== "PENDIENTE") {
        const err = new Error("Solo se pueden aceptar reservas PENDIENTE.");
        err.statusCode = 409;
        throw err;
      }

      if (reservation.startAt < new Date()) {
        const err = new Error("No puedes aceptar una reserva en fecha pasada.");
        err.statusCode = 400;
        throw err;
      }

      // Seguridad extra: confirmar que el espacio es del prestador
      const space = await tx.space.findUnique({
        where: { id: reservation.spaceId },
        select: { id: true, idPropietario: true, capacity: true }, // ✅
      });

      if (!space) {
        const err = new Error("Espacio no encontrado.");
        err.statusCode = 404;
        throw err;
      }
      if (Number(space.idPropietario) !== Number(providerId)) {
        const err = new Error("El espacio no pertenece al prestador.");
        err.statusCode = 403;
        throw err;
      }

      // Traslape solo contra ACEPTADAS
      const capacity = Number(space.capacity ?? 1);

      // Contamos reservas que ya ocupan cupo (no pendientes)
      const acceptedCount = await tx.reservation.count({
        where: {
          id: { not: id },
          spaceId: reservation.spaceId,
          status: { in: ["ACEPTADA", "CHECKIN_SOLICITADO", "EN_CURSO"] },
          AND: [
            { startAt: { lt: reservation.endAt } },
            { endAt: { gt: reservation.startAt } },
          ],
        },
      });

      if (acceptedCount >= capacity) {
        const err = new Error("No se puede aceptar: se alcanzó la capacidad en ese horario.");
        err.statusCode = 409;
        throw err;
      }


      // Update condicional para evitar carrera
      const deadline = computeDeadline(reservation.startAt, DEFAULT_CHECKIN_TOLERANCE_MIN);

      const updatedCount = await tx.reservation.updateMany({
        where: { id, status: "PENDIENTE" },
        data: {
          status: "ACEPTADA",
          rejectReason: null,
          checkInDeadline: deadline, // ✅ clave: se fija al aceptar
        },
      });


      if (updatedCount.count !== 1) {
        const err = new Error("No se pudo aceptar; la reserva ya fue atendida por otra acción.");
        err.statusCode = 409;
        throw err;
      }

      // Rechazar pendientes traslapadas automáticamente (opcional)
      const acceptedNow = acceptedCount + 1;

      if (acceptedNow >= capacity) {
        await tx.reservation.updateMany({
          where: {
            spaceId: reservation.spaceId,
            status: "PENDIENTE",
            AND: [
              { startAt: { lt: reservation.endAt } },
              { endAt: { gt: reservation.startAt } },
            ],
            NOT: { id: reservation.id },
          },
          data: {
            status: "RECHAZADA",
            rejectReason: "Cupo ocupado (capacidad alcanzada)",
          },
        });
      }
      return tx.reservation.findUnique({
        where: { id },
        include: providerListInclude,
      });
    });
  },

  // PATCH /api/reservations/:id/reject  (prestador)
  async reject({ providerId, reservationId, reason }) {
    const id = parseIntParam(reservationId, "reservationId");
    const cleanReason = ensureNonEmptyString(reason, "El motivo de rechazo");

    return prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.findUnique({
        where: { id },
        select: { id: true, providerId: true, status: true, spaceId: true, startAt: true },
      });

      if (!reservation) {
        const err = new Error("Reserva no encontrada.");
        err.statusCode = 404;
        throw err;
      }

      if (Number(reservation.providerId) !== Number(providerId)) {
        const err = new Error("No autorizado.");
        err.statusCode = 403;
        throw err;
      }

      if (reservation.status !== "PENDIENTE") {
        const err = new Error("Solo se pueden rechazar reservas PENDIENTE.");
        err.statusCode = 409;
        throw err;
      }

      // Seguridad extra: confirmar propiedad del espacio
      const space = await tx.space.findUnique({
        where: { id: reservation.spaceId },
        select: { id: true, idPropietario: true },
      });

      if (!space) {
        const err = new Error("Espacio no encontrado.");
        err.statusCode = 404;
        throw err;
      }
      if (Number(space.idPropietario) !== Number(providerId)) {
        const err = new Error("El espacio no pertenece al prestador.");
        err.statusCode = 403;
        throw err;
      }

      const updatedCount = await tx.reservation.updateMany({
        where: { id, status: "PENDIENTE" },
        data: {
          status: "RECHAZADA",
          rejectReason: cleanReason, // <- descomenta si agregas el campo en Prisma
        },
      });

      if (updatedCount.count !== 1) {
        const err = new Error("No se pudo rechazar; la reserva ya fue atendida por otra acción.");
        err.statusCode = 409;
        throw err;
      }

      return tx.reservation.findUnique({
        where: { id },
        include: providerListInclude,
      });
    });
  },
    // POST /api/reservations/:id/checkin (OCUPANTE)
  async checkIn({ occupantId, reservationId, toleranceMinutes = 15, io }) {
    const id = parseIntParam(reservationId, "reservationId");
    const tol = Number(toleranceMinutes);
    const tolMin = Number.isFinite(tol) && tol > 0 ? tol : 15;

    const now = new Date();

    const r = await prisma.reservation.findUnique({
      where: { id },
      select: {
        id: true,
        occupantId: true,
        providerId: true,
        status: true,
        startAt: true,
        checkInDeadline: true,
        checkInAt: true,
      },
    });

    if (!r) {
      const err = new Error("Reserva no encontrada.");
      err.statusCode = 404;
      throw err;
    }

    if (Number(r.occupantId) !== Number(occupantId)) {
      const err = new Error("No autorizado.");
      err.statusCode = 403;
      throw err;
    }

    if (r.status !== "ACEPTADA") {
      const err = new Error("Solo puedes marcar llegada cuando la reserva está ACEPTADA.");
      err.statusCode = 409;
      throw err;
    }

    const deadline = r.checkInDeadline || computeDeadline(r.startAt, tolMin);


    if (now > deadline) {
      const expired = await prisma.reservation.update({
        where: { id },
        data: {
          status: "EXPIRADA",
          checkInDeadline: deadline,
        },
      });

      if (io) {
        io.to(`user:${expired.occupantId}`).emit("reservation.expired", {
          reservationId: expired.id,
          reason: "Tolerancia vencida",
          ts: new Date().toISOString(),
        });
        io.to(`user:${expired.providerId}`).emit("reservation.expired", {
          reservationId: expired.id,
          reason: "Tolerancia vencida",
          ts: new Date().toISOString(),
        });
      }

      const err = new Error("Se venció el tiempo de tolerancia para llegar.");
      err.statusCode = 409;
      throw err;
    }

    const updated = await prisma.reservation.update({
      where: { id },
      data: {
        checkInAt: now,
        checkInDeadline: deadline,
        status: "CHECKIN_SOLICITADO",
      },
      include: {
        space: { select: { id: true, titulo: true, direccion: true } },
        occupant: { select: { id: true, nombre: true, email: true, telefono: true } },
        provider: { select: { id: true, nombre: true, email: true, telefono: true } },
      },
    });

    if (io) {
      io.to(`user:${updated.providerId}`).emit("reservation.checkin_requested", {
        reservationId: updated.id,
        occupantId: updated.occupantId,
        spaceId: updated.spaceId,
        checkInAt: updated.checkInAt,
        checkInDeadline: updated.checkInDeadline,
        ts: new Date().toISOString(),
      });
      io.to(`user:${updated.occupantId}`).emit("reservation.checkin_requested", {
        reservationId: updated.id,
        checkInAt: updated.checkInAt,
        checkInDeadline: updated.checkInDeadline,
        ts: new Date().toISOString(),
      });
    }

    return updated;
  },

  // POST /api/reservations/:id/start (PRESTADOR)
  async startStay({ providerId, reservationId, io }) {
    const id = parseIntParam(reservationId, "reservationId");
    const now = new Date();

    const r = await prisma.reservation.findUnique({
      where: { id },
      select: {
        id: true,
        providerId: true,
        occupantId: true,
        status: true,
        checkInDeadline: true,
        startedAt: true,
      },
    });

    if (!r) {
      const err = new Error("Reserva no encontrada.");
      err.statusCode = 404;
      throw err;
    }

    if (Number(r.providerId) !== Number(providerId)) {
      const err = new Error("No autorizado.");
      err.statusCode = 403;
      throw err;
    }

    if (r.checkInDeadline && now > new Date(r.checkInDeadline) && r.status !== "EN_CURSO") {
      const expired = await prisma.reservation.update({
        where: { id },
        data: { status: "EXPIRADA" },
      });

      if (io) {
        io.to(`user:${expired.occupantId}`).emit("reservation.expired", {
          reservationId: expired.id,
          reason: "Tolerancia vencida",
          ts: new Date().toISOString(),
        });
        io.to(`user:${expired.providerId}`).emit("reservation.expired", {
          reservationId: expired.id,
          reason: "Tolerancia vencida",
          ts: new Date().toISOString(),
        });
      }

      const err = new Error("No se puede iniciar: tolerancia vencida (reserva expirada).");
      err.statusCode = 409;
      throw err;
    }

    if (r.status !== "CHECKIN_SOLICITADO") {
      const err = new Error("Solo puedes iniciar cuando el ocupante marcó llegada.");
      err.statusCode = 409;
      throw err;
    }

    if (r.startedAt) {
      const err = new Error("La estancia ya fue iniciada.");
      err.statusCode = 409;
      throw err;
    }

    const updated = await prisma.reservation.update({
      where: { id },
      data: {
        startedAt: now,
        status: "EN_CURSO",
      },
      include: providerListInclude,
    });

    if (io) {
      io.to(`user:${updated.occupantId}`).emit("reservation.started", {
        reservationId: updated.id,
        startedAt: updated.startedAt,
        ts: new Date().toISOString(),
      });
      io.to(`user:${updated.providerId}`).emit("reservation.started", {
        reservationId: updated.id,
        startedAt: updated.startedAt,
        ts: new Date().toISOString(),
      });
    }

    return updated;
  },

  // POST /api/reservations/:id/finish (PRESTADOR)
  async finishStay({ providerId, reservationId, io }) {
    const id = parseIntParam(reservationId, "reservationId");
    const now = new Date();

    const r = await prisma.reservation.findUnique({
      where: { id },
      include: {
        space: {
          select: { id: true, precioHora: true, precioDia: true, titulo: true, direccion: true },
        },
      },
    });

    if (!r) {
      const err = new Error("Reserva no encontrada.");
      err.statusCode = 404;
      throw err;
    }

    if (Number(r.providerId) !== Number(providerId)) {
      const err = new Error("No autorizado.");
      err.statusCode = 403;
      throw err;
    }

    if (r.status !== "EN_CURSO") {
      const err = new Error("Solo puedes finalizar una reserva EN_CURSO.");
      err.statusCode = 409;
      throw err;
    }

    if (!r.startedAt) {
      const err = new Error("No hay startedAt. No se puede calcular el tiempo real.");
      err.statusCode = 500;
      throw err;
    }

    const startedAt = new Date(r.startedAt);

    const pricing = calcTotalPrice(r.space, startedAt, now, r.billingMode);

    const updated = await prisma.reservation.update({
      where: { id },
      data: {
        endedAt: now,
        status: "FINALIZADA",
        totalPrice: pricing.total,
      },
      include: providerListInclude,
    });

    if (io) {
      io.to(`user:${updated.occupantId}`).emit("reservation.finished", {
        reservationId: updated.id,
        endedAt: updated.endedAt,
        totalPrice: updated.totalPrice,
        used: updated.billingMode,
        ts: new Date().toISOString(),
      });
      io.to(`user:${updated.providerId}`).emit("reservation.finished", {
        reservationId: updated.id,
        endedAt: updated.endedAt,
        totalPrice: updated.totalPrice,
        used: updated.billingMode,
        ts: new Date().toISOString(),
      });
    }

    return updated;
  },

  // GET /api/reservations/active?as=OCUPANTE|PRESTADOR
async getActiveForUser(userPayload, as, io) {
  const userId = Number(userPayload?.id);
  const roles = userPayload?.roles || [];
  const active = ["PENDIENTE", "ACEPTADA", "CHECKIN_SOLICITADO", "EN_CURSO"];

  if (as === "OCUPANTE") {
    if (!roles.includes("OCUPANTE")) return [];

    await expireAcceptedPastDeadline({ occupantId: userId }, io);

    return prisma.reservation.findMany({
      where: { occupantId: userId, status: { in: active } },
      orderBy: { startAt: "asc" }, // ✅ mejor para UX
      take: 10,
      include: {
      space: { include: { photos: true, owner: { select: { id: true, nombre: true, telefono: true } } } },
      provider: { select: { id: true, nombre: true, telefono: true } },
      vehicle: { include: { photos: true } },
    },
    });
  }

  if (as === "PRESTADOR") {
    if (!roles.includes("PRESTADOR")) return [];

    await expireAcceptedPastDeadline({ providerId: userId }, io);

    return prisma.reservation.findMany({
      where: { providerId: userId, status: { in: active } },
      orderBy: { startAt: "asc" },
      take: 10,
      include: providerListInclude,
    });
  }

  return [];
}

};

