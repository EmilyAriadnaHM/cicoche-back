// src/routes/me.js
const router = require("express").Router();
const { z } = require("zod");
const prisma = require("../lib/prisma");
const requireAuth = require("../middlewares/requireAuth");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

// carpeta uploads/avatars
const avatarDir = path.join(__dirname, "..", "..", "uploads", "avatars");
if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, avatarDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
    cb(null, `avatar_${req.user.id}_${Date.now()}${ext}`);
  },
});

function fileFilter(_, file, cb) {
  const ok = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
  ].includes(file.mimetype);

  cb(ok ? null : new Error("Tipo de archivo no permitido."), ok);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});


// ------------------ helpers ------------------
function getBaseUrl(req) {
  return `${req.protocol}://${req.get("host")}`;
}

function mapUser(u, baseUrl = "") {
  const raw = u.photoUrl || null;

  const photoUrl = raw
    ? (raw.startsWith("http") ? raw : `${baseUrl}${raw}`)
    : null;

  return {
    id: u.id,
    nombre: u.nombre,
    email: u.email,
    telefono: u.telefono,
    photoUrl,
    isVerified: u.isVerified,
    status: u.status,
    lastLogin: u.lastLogin,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    roles: (u.roles || []).map((r) => r.role?.name).filter(Boolean),
  };
}


function roundTo(n, decimals = 3) {
  if (n == null) return null;
  const p = Math.pow(10, decimals);
  return Math.round(Number(n) * p) / p;
}

function dowLabel(dow) {
  // JS getDay(): 0=Dom ... 6=Sáb
  return ["DOM", "LUN", "MAR", "MIE", "JUE", "VIE", "SAB"][dow] || String(dow);
}

// Periodo fijo: últimos 30 días
function since30d() {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
}

// ------------------ GET /api/me ------------------
router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { roles: { include: { role: true } } },
    });
    if (!user) return res.status(404).json({ error: "Usuario no encontrado." });

    return res.json({ user: mapUser(user, getBaseUrl(req)) });
  } catch (e) {
    console.log("GET /api/me ERR:", e);
    return res.status(500).json({ error: "Error al cargar el perfil." });
  }
});

// ------------------ PATCH /api/me ------------------
const UpdateMeSchema = z.object({
  nombre: z.string().trim().min(2).max(120).optional(),

  // Permite 10 dígitos o "" para limpiar
  telefono: z
    .union([z.string().trim().regex(/^\d{10}$/, "El teléfono debe tener 10 dígitos."), z.literal("")])
    .optional(),

  // Permite string o "" para limpiar
  photoUrl: z.union([z.string().trim().max(500), z.literal("")]).optional(),
});


router.patch("/me", requireAuth, async (req, res) => {
  try {
    const parsed = UpdateMeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Datos inválidos.",
        details: parsed.error.flatten(),
      });
    }

    const { nombre, telefono, photoUrl } = parsed.data;

    const data = {};
    if (nombre !== undefined) data.nombre = nombre.trim();

    if (telefono !== undefined) {
    data.telefono = telefono === "" ? null : telefono.trim();
    }

    if (photoUrl !== undefined) {
    data.photoUrl = photoUrl === "" ? null : photoUrl.trim();
    }


    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data,
      include: { roles: { include: { role: true } } },
    });

    return res.json({ user: mapUser(updated, getBaseUrl(req)) });

  } catch (e) {
    // Prisma unique constraint
    if (e?.code === "P2002") {
      const target = e?.meta?.target;
      const field = Array.isArray(target) ? target[0] : target;

      if (field === "telefono") {
        return res.status(409).json({
          error: "El teléfono ya está registrado.",
          code: "DUPLICATE_PHONE",
          field: "telefono",
        });
      }

      if (field === "email") {
        return res.status(409).json({
          error: "El correo ya está registrado.",
          code: "DUPLICATE_EMAIL",
          field: "email",
        });
      }

      return res.status(409).json({
        error: "Ya existe un registro con datos únicos repetidos.",
        code: "DUPLICATE_UNIQUE",
        field: field || null,
      });
    }

    console.log("PATCH /api/me ERR:", e);
    return res.status(500).json({ error: "Error al actualizar el perfil." });
  }
});


// ------------------ POST /api/me/photo ------------------
router.post(
  "/me/photo",
  requireAuth,
  (req, res, next) => {
    upload.single("photo")(req, res, (err) => {
      if (!err) return next();

      // Multer error (peso, etc.)
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({ error: "La imagen excede el tamaño permitido (5MB)." });
      }

      return res.status(400).json({ error: err.message || "Error al procesar la imagen." });
    });
  },
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No se recibió imagen." });

      const current = await prisma.user.findUnique({ where: { id: req.user.id } });
      if (!current) return res.status(404).json({ error: "Usuario no encontrado." });

      // borrar anterior si estaba en uploads/avatars
      if (current.photoUrl && current.photoUrl.startsWith("/uploads/avatars/")) {
        const oldPath = path.join(process.cwd(), current.photoUrl.replace(/^\//, ""));
        fs.unlink(oldPath, () => {});
      }

      const publicPath = `/uploads/avatars/${req.file.filename}`;

      const updated = await prisma.user.update({
        where: { id: req.user.id },
        data: { photoUrl: publicPath },
        include: { roles: { include: { role: true } } },
      });

      return res.json({ user: mapUser(updated, getBaseUrl(req)) });
    } catch (e) {
      console.log("POST /api/me/photo ERR:", e);
      return res.status(500).json({ error: "Error al subir la imagen." });
    }
  }
);


// ------------------ DELETE /api/me/photo ------------------
router.delete("/me/photo", requireAuth, async (req, res) => {
  try {
    const current = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { roles: { include: { role: true } } },
    });
    if (!current) return res.status(404).json({ error: "Usuario no encontrado." });

    if (current.photoUrl && current.photoUrl.startsWith("/uploads/avatars/")) {
      const oldPath = path.join(__dirname, "..", "..", current.photoUrl);
      fs.unlink(oldPath, () => {});
    }

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: { photoUrl: null },
      include: { roles: { include: { role: true } } },
    });

    return res.json({ user: mapUser(updated, getBaseUrl(req)) });
  } catch (e) {
    console.log("DELETE /api/me/photo ERR:", e);
    return res.status(500).json({ error: "Error al eliminar la foto." });
  }
});

// ------------------ GET /api/me/dashboard ------------------
// Periodo FIJO: últimos 30 días
// Query opcional: ?as=OCUPANTE|PRESTADOR
// ------------------ GET /api/me/dashboard ------------------
router.get("/me/dashboard", requireAuth, async (req, res) => {
  try {
    const as = String(req.query.as || "OCUPANTE").toUpperCase();
    const userId = req.user.id;

    const roleWhere = as === "PRESTADOR" ? { providerId: userId } : { occupantId: userId };

    const TZ = "America/Mexico_City";
    const now = new Date();
    const since = since30d();

    // Helpers TZ (CDMX)
    const getHourCDMX = (date) => {
      const s = new Intl.DateTimeFormat("en-US", {
        timeZone: TZ,
        hour: "2-digit",
        hour12: false,
      }).format(new Date(date));
      return Number(s); // "00".."23" -> number
    };

    const getDowLabelCDMX = (date) => {
      // DOM/LUN/MAR/MIE/JUE/VIE/SAB
      const wd = new Intl.DateTimeFormat("en-US", {
        timeZone: TZ,
        weekday: "short",
      }).format(new Date(date)); // "Sun", "Mon", ...
      const map = { Sun: "DOM", Mon: "LUN", Tue: "MAR", Wed: "MIE", Thu: "JUE", Fri: "VIE", Sat: "SAB" };
      return map[wd] || wd;
    };

    const hourLabel = (h) => `${String(h).padStart(2, "0")}:00`;

    const reservations = await prisma.reservation.findMany({
      where: {
        ...roleWhere,
        startAt: { gte: since },
        // Si quieres demanda “real”, puedes filtrar:
        // status: { notIn: ["RECHAZADA", "CANCELADA"] },
      },
      select: {
        id: true,
        status: true,
        startAt: true,
        endAt: true,
        totalPrice: true,
        billingMode: true,
        space: {
          select: {
            id: true,
            titulo: true,
            latitud: true,
            longitud: true,
            // si tienes address/calle/colonia, agrégalo aquí para label real
            // address: true,
          },
        },
      },
      orderBy: { startAt: "desc" },
      take: 2000,
    });

    const totalReservations = reservations.length;

    // Totales monetarios
    // Ajusta estatus según tu negocio (estos son “cobrables” típicos)
    const moneyStatuses = new Set(["EN_CURSO", "FINALIZADA"]);

    let spent = 0;
    let earned = 0;

    for (const r of reservations) {
      if (!moneyStatuses.has(String(r.status))) continue;
      const v = Number(r.totalPrice || 0);
      if (!Number.isFinite(v)) continue;

      if (as === "PRESTADOR") earned += v;
      else spent += v;
    }

    // Top Hours (CDMX)
    const hourMap = new Map();
    for (const r of reservations) {
      const h = getHourCDMX(r.startAt);
      hourMap.set(h, (hourMap.get(h) || 0) + 1);
    }
    const topHours = Array.from(hourMap.entries())
      .map(([hour, count]) => ({
        key: String(hour),
        label: hourLabel(hour),
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    // Top Days (CDMX)
    const dayMap = new Map(); // label -> count
    for (const r of reservations) {
      const label = getDowLabelCDMX(r.startAt);
      dayMap.set(label, (dayMap.get(label) || 0) + 1);
    }
    const topDays = Array.from(dayMap.entries())
      .map(([label, count]) => ({ key: label, label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 7);

    // Top Zones (grid por lat/lng redondeado) + label útil
    const zoneMap = new Map(); // key -> { count, label }
    for (const r of reservations) {
      const lat = r.space?.latitud;
      const lng = r.space?.longitud;
      if (lat == null || lng == null) continue;

      const latR = roundTo(lat, 3);
      const lngR = roundTo(lng, 3);
      const key = `${latR}|${lngR}`;

      const prev = zoneMap.get(key);
      const label = r.space?.titulo ? r.space.titulo : `(${latR}, ${lngR})`;

      if (!prev) zoneMap.set(key, { count: 1, label });
      else zoneMap.set(key, { count: prev.count + 1, label: prev.label || label });
    }

    const topZones = Array.from(zoneMap.entries())
      .map(([key, v]) => ({ key, label: v.label, count: v.count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    // Placeholder reseñas/calificaciones (fase 2)
    const ratings = {
      receivedAvg: 0,
      receivedCount: 0,
      givenCount: 0,
    };

    return res.json({
      period: {
        kind: "LAST_30_DAYS",
        from: since.toISOString(),
        to: now.toISOString(),
      },
      as,
      totals: {
        reservations: totalReservations,
        spent: Math.round(spent * 100) / 100,
        earned: Math.round(earned * 100) / 100,
      },
      topZones,
      topHours,
      topDays,
      ratings,
    });
  } catch (e) {
    console.log("GET /api/me/dashboard ERR:", e);
    return res.status(500).json({ error: "Error al cargar el panel." });
  }
});


module.exports = router;
