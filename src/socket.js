// src/socket.js
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

function roomReservation(reservationId) {
  return `reservation:${Number(reservationId)}`;
}

function canSendChat(status) {
  return ["ACEPTADA", "CHECKIN_SOLICITADO", "EN_CURSO"].includes(status);
}

async function assertParticipant(prisma, reservationId, userId) {
  const r = await prisma.reservation.findUnique({
    where: { id: Number(reservationId) },
    select: { id: true, occupantId: true, providerId: true, status: true },
  });

  if (!r) {
    const err = new Error("RESERVATION_NOT_FOUND");
    err.code = 404;
    throw err;
  }

  const isParticipant = r.occupantId === userId || r.providerId === userId;
  if (!isParticipant) {
    const err = new Error("FORBIDDEN");
    err.code = 403;
    throw err;
  }

  return r;
}

// ✅ Persistente: puntero de lectura por (reserva, usuario)
async function upsertRead(prisma, reservationId, userId, lastReadMessageId) {
  const now = new Date();
  await prisma.chatReadState.upsert({
    where: {
      reservationId_userId: {
        reservationId: Number(reservationId),
        userId: Number(userId),
      },
    },
    create: {
      reservationId: Number(reservationId),
      userId: Number(userId),
      lastReadMessageId: Number(lastReadMessageId),
      lastReadAt: now,
    },
    update: {
      lastReadMessageId: Number(lastReadMessageId),
      lastReadAt: now,
    },
  });
  return now;
}

function initSocket(httpServer, prisma) {
  const io = new Server(httpServer, {
    cors: { origin: "*" },
  });

  // ✅ Auth por JWT
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("NO_TOKEN"));

      const payload = jwt.verify(token, process.env.JWT_SECRET);
      const userId = Number(payload.id || payload.userId);
      if (!userId) return next(new Error("BAD_TOKEN"));

      socket.user = payload;
      socket.userId = userId;
      next();
    } catch (e) {
      next(new Error("INVALID_TOKEN"));
    }
  });

  io.on("connection", (socket) => {
    const userId = socket.userId;
    const roles = socket.user?.roles || [];

    console.log("SOCKET CONNECT user:", userId, "roles:", roles);

    // Rooms existentes
    socket.join(`user:${userId}`);
    if (roles.includes("ADMIN")) socket.join("admins");

    // ==========================
    // ✅ CHAT POR RESERVA
    // ==========================

    socket.on("chat:join", async ({ reservationId }, ack) => {
      try {
        const r = await assertParticipant(prisma, reservationId, userId);

        socket.join(roomReservation(reservationId));

        ack?.({ ok: true, status: r.status });
      } catch (e) {
        ack?.({ ok: false, error: e.message, code: e.code || 500 });
      }
    });

    socket.on("chat:typing", async ({ reservationId, isTyping }) => {
      try {
        await assertParticipant(prisma, reservationId, userId);

        socket.to(roomReservation(reservationId)).emit("chat:typing", {
          reservationId: Number(reservationId),
          userId,
          isTyping: Boolean(isTyping),
        });
      } catch (_) {}
    });

    socket.on("chat:send", async ({ reservationId, body }, ack) => {
      try {
        const text = String(body || "").trim();
        if (!text) return ack?.({ ok: false, error: "EMPTY_MESSAGE" });
        if (text.length > 1000) return ack?.({ ok: false, error: "TOO_LONG" });

        const r = await assertParticipant(prisma, reservationId, userId);

        if (!canSendChat(r.status)) {
          return ack?.({ ok: false, error: "CHAT_DISABLED_FOR_STATUS", status: r.status });
        }

        // por si mandan sin join previo
        socket.join(roomReservation(reservationId));

        // Guardar mensaje
        const msg = await prisma.chatMessage.create({
          data: {
            reservationId: Number(reservationId),
            senderId: userId,
            body: text,
            type: "TEXT",
          },
          select: { id: true, reservationId: true, senderId: true, body: true, type: true, createdAt: true },
        });

        // ✅ el emisor ya leyó hasta su propio mensaje
        const now = await upsertRead(prisma, reservationId, userId, msg.id);

        // Emitir mensaje + update de lectura
        io.to(roomReservation(reservationId)).emit("chat:message:new", msg);

        io.to(roomReservation(reservationId)).emit("chat:read:update", {
          reservationId: Number(reservationId),
          userId,
          lastReadMessageId: msg.id,
          readAt: now.toISOString(),
        });

        ack?.({ ok: true, message: msg });
      } catch (e) {
        ack?.({ ok: false, error: e.message, code: e.code || 500 });
      }
    });

    socket.on("chat:read", async ({ reservationId, lastReadMessageId }, ack) => {
      try {
        await assertParticipant(prisma, reservationId, userId);

        if (!lastReadMessageId) return ack?.({ ok: true });

        const now = await upsertRead(prisma, reservationId, userId, lastReadMessageId);

        io.to(roomReservation(reservationId)).emit("chat:read:update", {
          reservationId: Number(reservationId),
          userId,
          lastReadMessageId: Number(lastReadMessageId),
          readAt: now.toISOString(),
        });

        ack?.({ ok: true });
      } catch (e) {
        ack?.({ ok: false, error: e.message, code: e.code || 500 });
      }
    });

    socket.on("disconnect", (reason) => {
      console.log("SOCKET DISCONNECT user:", userId, reason);
    });
  });

  return io;
}

module.exports = { initSocket };
