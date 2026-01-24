//src/routes/reservations.js
const router = require('express').Router();

const requireAuth = require('../middlewares/requireAuth');
const requireRole = require('../middlewares/requireRole');
const reservations = require('../services/reservations.service');
const { checkReady } = require('../utils/roleReadiness');
const requireRoleReady = require('../middlewares/requireRoleReady');

// =========================
// OCUPANTE
// =========================

// OCUPANTE: crear reserva
router.post(
  '/',
  requireAuth,
  requireRole('OCUPANTE'),
  requireRoleReady('OCUPANTE'),
  async (req, res) => {
    try {
      const ready = await checkReady(req.user.id, 'OCUPANTE');
      if (!ready)
        return res
          .status(403)
          .json({ error: 'Requisitos de OCUPANTE no completos o no validados' });

      const r = await reservations.create({
        occupantId: req.user.id,
        spaceId: req.body.spaceId,
        startAt: req.body.startAt,
        endAt: req.body.endAt,
        billingMode: req.body.billingMode,
        vehicleId: req.body.vehicleId, // ✅ NUEVO
      });


      res.status(201).json({ reservation: r });
    } catch (e) {
      res.status(e.statusCode || 400).json({ error: e.message });
    }
  }
);

// OCUPANTE: listar mis reservas
router.get(
  '/mine',
  requireAuth,
  requireRole('OCUPANTE'),
  requireRoleReady('OCUPANTE'),
  async (req, res) => {
    try {
      const ready = await checkReady(req.user.id, 'OCUPANTE');
      const io = req.app.get("io");
      if (!ready)
        return res
          .status(403)
          .json({ error: 'Requisitos de OCUPANTE no completos o no validados' });

      const list = await reservations.listMine(req.user.id, io);

      res.json({ reservations: list });
    } catch (e) {
      res.status(500).json({ error: 'Error interno' });
    }
  }
);

// OCUPANTE: cancelar (opcional: motivo)
router.patch(
  '/:id/cancel',
  requireAuth,
  requireRole('OCUPANTE'),
  requireRoleReady('OCUPANTE'),
  async (req, res) => {
    try {
      const ready = await checkReady(req.user.id, 'OCUPANTE');
      if (!ready)
        return res
          .status(403)
          .json({ error: 'Requisitos de OCUPANTE no completos o no validados' });

      const r = await reservations.cancel({
        occupantId: req.user.id,
        reservationId: req.params.id,
        reason: req.body?.reason, // ✅ opcional
      });

      res.json({ reservation: r });
    } catch (e) {
      res.status(e.statusCode || 400).json({ error: e.message });
    }
  }
);

// OCUPANTE: marcar llegada (check-in solicitado)
router.post(
  "/:id/checkin",
  requireAuth,
  requireRole("OCUPANTE"),
  requireRoleReady("OCUPANTE"),
  async (req, res) => {
    try {
      const io = req.app.get("io");
      const ready = await checkReady(req.user.id, "OCUPANTE");
      if (!ready) return res.status(403).json({ error: "Requisitos de OCUPANTE no completos o no validados" });

      const r = await reservations.checkIn({
        occupantId: req.user.id,
        reservationId: req.params.id,
        toleranceMinutes: Number(req.body?.toleranceMinutes || 15),
        io,
      });


      res.json({ reservation: r });
    } catch (e) {
      res.status(e.statusCode || 400).json({ error: e.message });
    }
  }
);


// =========================
// PRESTADOR
// =========================

// PRESTADOR: listar reservas recibidas
router.get(
  '/for-my-spaces',
  requireAuth,
  requireRole('PRESTADOR'),
  requireRoleReady('PRESTADOR'),
  async (req, res) => {
    try {
      const status = req.query.status; // opcional: PENDIENTE, ACEPTADA, etc.

      const ready = await checkReady(req.user.id, 'PRESTADOR');
      const io = req.app.get("io");
      if (!ready)
        return res
          .status(403)
          .json({ error: 'Requisitos de PRESTADOR no completos o no validados' });
      const list = await reservations.listForProvider(req.user.id, status, io);

      res.json({ reservations: list });
    } catch (e) {
      res.status(500).json({ error: 'Error interno' });
    }
  }
);

//AMBOS
// ACTIVO: obtener la reserva activa del usuario (ocupante o prestador)
router.get("/active", requireAuth, async (req, res) => {
  try {
    const io = req.app.get("io");
    const as = req.query.as; // OCUPANTE | PRESTADOR
    const list = await reservations.getActiveForUser(req.user, as, io);
    res.json({ reservations: list, serverNow: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: "Error interno" });
  }
});

// PRESTADOR: detalle de una reserva (solo si es suya)
router.get(
  '/:id',
  requireAuth,
  requireRole('PRESTADOR'),
  requireRoleReady('PRESTADOR'),
  async (req, res) => {
    try {
      const ready = await checkReady(req.user.id, 'PRESTADOR');
      if (!ready)
        return res
          .status(403)
          .json({ error: 'Requisitos de PRESTADOR no completos o no validados' });

      const r = await reservations.getByIdForProvider({
        providerId: req.user.id,
        reservationId: req.params.id,
      });

      res.json({ reservation: r });
    } catch (e) {
      res.status(e.statusCode || 400).json({ error: e.message });
    }
  }
);

// PRESTADOR: aceptar
router.patch(
  '/:id/accept',
  requireAuth,
  requireRole('PRESTADOR'),
  requireRoleReady('PRESTADOR'),
  async (req, res) => {
    try {
      const ready = await checkReady(req.user.id, 'PRESTADOR');
      if (!ready)
        return res
          .status(403)
          .json({ error: 'Requisitos de PRESTADOR no completos o no validados' });

      const r = await reservations.accept({
        providerId: req.user.id,
        reservationId: req.params.id,
      });

      res.json({ reservation: r });
    } catch (e) {
      res.status(e.statusCode || 400).json({ error: e.message });
    }
  }
);

// PRESTADOR: rechazar (motivo obligatorio en service)
router.patch(
  '/:id/reject',
  requireAuth,
  requireRole('PRESTADOR'),
  requireRoleReady('PRESTADOR'),
  async (req, res) => {
    try {
      const ready = await checkReady(req.user.id, 'PRESTADOR');
      if (!ready)
        return res
          .status(403)
          .json({ error: 'Requisitos de PRESTADOR no completos o no validados' });

      const r = await reservations.reject({
        providerId: req.user.id,
        reservationId: req.params.id,
        reason: req.body?.reason, // ✅
      });

      res.json({ reservation: r });
    } catch (e) {
      res.status(e.statusCode || 400).json({ error: e.message });
    }
  }
);

// PRESTADOR: iniciar estancia (inicia contador real)
router.post(
  "/:id/start",
  requireAuth,
  requireRole("PRESTADOR"),
  requireRoleReady("PRESTADOR"),
  async (req, res) => {
    try {
      const io = req.app.get("io");
      const ready = await checkReady(req.user.id, "PRESTADOR");
      if (!ready) return res.status(403).json({ error: "Requisitos de PRESTADOR no completos o no validados" });

      const r = await reservations.startStay({
        providerId: req.user.id,
        reservationId: req.params.id,
        io,
      });

      res.json({ reservation: r });
    } catch (e) {
      res.status(e.statusCode || 400).json({ error: e.message });
    }
  }
);

// PRESTADOR: finalizar estancia (detiene contador y calcula total)
router.post(
  "/:id/finish",
  requireAuth,
  requireRole("PRESTADOR"),
  requireRoleReady("PRESTADOR"),
  async (req, res) => {
    try {
      const ready = await checkReady(req.user.id, "PRESTADOR");
      if (!ready) return res.status(403).json({ error: "Requisitos de PRESTADOR no completos o no validados" });

      const io = req.app.get("io");

        const r = await reservations.finishStay({
          providerId: req.user.id,
          reservationId: req.params.id,
          io,
        });


      res.json({ reservation: r });
    } catch (e) {
      res.status(e.statusCode || 400).json({ error: e.message });
    }
  }
);



module.exports = router;

