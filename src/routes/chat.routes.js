// src/routes/chat.routes.js
const router = require("express").Router();
const { authRequired } = require("../middlewares/auth");

function canViewChat(status) {
  // ver historial también en FINALIZADA (solo lectura)
  return ["ACEPTADA", "CHECKIN_SOLICITADO", "EN_CURSO", "FINALIZADA"].includes(status);
}

async function assertParticipant(prisma, reservationId, userId) {
  const r = await prisma.reservation.findUnique({
    where: { id: Number(reservationId) },
    select: {
      id: true,
      occupantId: true,
      providerId: true,
      status: true,
      occupant: { select: { id: true, nombre: true, email: true } },
      provider: { select: { id: true, nombre: true, email: true } },
    },
  });
  if (!r) return null;
  const ok = r.occupantId === userId || r.providerId === userId;
  return ok ? r : null;
}


module.exports = (prisma) => {
  // GET /api/reservations/:id/chat/messages?take=30&cursor=123
  router.get("/reservations/:id/chat/messages", authRequired, async (req, res) => {
    try {
      const reservationId = Number(req.params.id);
      const userId = Number(req.user.id);

      const r = await assertParticipant(prisma, reservationId, userId);
      if (!r) return res.status(403).json({ ok: false, error: "FORBIDDEN" });

      if (!canViewChat(r.status)) {
        return res.status(409).json({ ok: false, error: "CHAT_DISABLED_FOR_STATUS", status: r.status });
      }

      const take = Math.min(Number(req.query.take) || 30, 100);
      const cursorId = req.query.cursor ? Number(req.query.cursor) : null;

      const rows = await prisma.chatMessage.findMany({
        where: { reservationId },
        orderBy: { id: "desc" },
        take,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
        select: { id: true, reservationId: true, senderId: true, body: true, type: true, createdAt: true },
      });

      const messages = rows.reverse(); // asc
      const nextCursor = messages.length ? messages[0].id : null; // id más viejo de este batch

      // ✅ Read states (si ya tienes modelo ChatReadState)
      const readStates = await prisma.chatReadState.findMany({
        where: { reservationId },
        select: { userId: true, lastReadMessageId: true },
      });

      const myState = readStates.find((x) => x.userId === userId) || null;
      const otherState = readStates.find((x) => x.userId !== userId) || null;

      const otherUser = userId === r.occupantId ? r.provider : r.occupant;

      return res.json({
        ok: true,
        status: r.status,
        messages,
        nextCursor,
        otherLastReadMessageId: otherState?.lastReadMessageId || null,
        myLastReadMessageId: myState?.lastReadMessageId || null,
        otherUser, 
        });

    } catch (e) {
      console.error("chat.messages error:", e);
      return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
    }
  });

  return router;
};
