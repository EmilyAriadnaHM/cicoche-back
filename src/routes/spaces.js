// src/routes/spaces.js
const router = require("express").Router();
const { z } = require("zod");
const prisma = require("../lib/prisma");
const requireAuth = require("../middlewares/requireAuth");
const fs = require("fs");
const path = require("path");
const requireRole = require("../middlewares/requireRole");
const { checkReady } = require("../utils/roleReadiness");
const requireRoleReady = require("../middlewares/requireRoleReady");
const quotes = require("../services/quotes.service");

// Directorio donde guardaremos las fotos
const uploadDir = path.join(__dirname, "..", "..", "uploads", "spaces");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// helper: base URL real (la del request)
function getBaseUrl(req) {
  return `${req.protocol}://${req.get("host")}`;
}

// Tipos de vehículo (de tu enum VehicleType en Prisma)
const VEHICLE_TYPES = ["COCHE", "CAMIONETA", "MOTO", "URBAN", "REDILA"];
//const VEHICLE_TYPES = ["COCHE", "CAMIONETA", "MOTO", "VAN", "ESTACA", "REDILA", "URBAN"];

/**
 * Body esperado desde la app:
 *  title, description, address,
 *  length,width,height (number|null),
 *  covered (boolean), type,
 *  priceHour, priceDay,
 *  lat,lng (number|null),
 *  photos: [base64,...] (max 4)
 *
 *  NUEVO:
 *  capacity: number (>=1)
 *  allowedVehicleTypes: ["COCHE","MOTO",...]
 */
const spaceSchema = z.object({
  title: z.string().min(3),
  description: z.string().min(10),
  address: z.string().min(10),

  length: z.number().nullable().optional(),
  width: z.number().nullable().optional(),
  height: z.number().nullable().optional(),

  covered: z.boolean(),
  type: z.enum(["COCHERA", "PATIO", "TERRENO"]),

  priceHour: z.number().positive(),
  priceDay: z.number().positive(),

  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),

  photos: z.array(z.string()).max(4).optional(),

  // ✅ NUEVO
  capacity: z.number().int().min(1).max(50).optional(),
  allowedVehicleTypes: z.array(z.enum(VEHICLE_TYPES)).max(10).optional(),
});

router.post(
  "/",
  requireAuth,
  requireRole("PRESTADOR"),
  requireRoleReady("PRESTADOR"),
  async (req, res) => {
    try {
      const ready = await checkReady(req.user.id, "PRESTADOR");
      if (!ready) {
        return res
          .status(403)
          .json({ error: "Requisitos de PRESTADOR no completos o no validados" });
      }

      const data = spaceSchema.parse(req.body);

      const base = getBaseUrl(req);

      // Normaliza reglas
      const capacity = Number.isInteger(data.capacity) && data.capacity > 0 ? data.capacity : 1;
      const allowedVehicleTypes = Array.isArray(data.allowedVehicleTypes)
        ? Array.from(new Set(data.allowedVehicleTypes))
        : [];

      // 1) Crear Space (con reglas)
      const space = await prisma.space.create({
        data: {
          idPropietario: req.user.id,
          titulo: data.title,
          descripcion: data.description,
          direccion: data.address,

          // Nota: si tus campos en Prisma NO permiten null, ajusta esto
          largoCm: data.length != null ? Math.round(data.length * 100) : 0,
          anchoCm: data.width != null ? Math.round(data.width * 100) : 0,
          altoCm: data.height != null ? Math.round(data.height * 100) : 0,

          cubierto: data.covered,
          tipoEspacio: data.type,

          precioHora: data.priceHour,
          precioDia: data.priceDay,

          latitud: data.lat ?? null,
          longitud: data.lng ?? null,

          capacity, // ✅ NUEVO
          activo: true,

          // ✅ NUEVO: reglas de vehículo (si viene vacío, backend lo interpreta como “sin restricciones”)
          allowedVehicleTypes:
            allowedVehicleTypes.length > 0
              ? { create: allowedVehicleTypes.map((t) => ({ type: t })) }
              : undefined,
        },
      });

      // 2) Guardar fotos (si vienen)
      if (Array.isArray(data.photos) && data.photos.length > 0) {
        const fotosData = [];

        for (let i = 0; i < data.photos.length; i++) {
          const base64 = data.photos[i];
          if (!base64 || typeof base64 !== "string") continue;

          const filename = `space_${space.id}_${Date.now()}_${i}.jpg`;
          const filepath = path.join(uploadDir, filename);

          const buffer = Buffer.from(base64, "base64");
          await fs.promises.writeFile(filepath, buffer);

          const publicUrl = `${base}/uploads/spaces/${filename}`;

          fotosData.push({
            spaceId: space.id,
            url: publicUrl,
          });
        }

        if (fotosData.length > 0) {
          await prisma.spacePhoto.createMany({
            data: fotosData,
            skipDuplicates: true,
          });
        }
      }

      return res.status(201).json({ spaceId: space.id });
    } catch (err) {
      console.error("Error en POST /api/spaces:", err);

      if (err?.issues) {
        return res.status(400).json({
          error: "Datos inválidos",
          details: err.issues,
        });
      }

      return res.status(500).json({ error: "Error interno del servidor" });
    }
  }
);

// ✅ NUEVO: actualizar SOLO reglas (capacidad + tipos permitidos)
const rulesSchema = z.object({
  capacity: z.number().int().min(1).max(50),
  allowedVehicleTypes: z.array(z.enum(VEHICLE_TYPES)).max(10).optional(),
});

router.patch(
  "/:id/rules",
  requireAuth,
  requireRole("PRESTADOR"),
  requireRoleReady("PRESTADOR"),
  async (req, res) => {
    try {
      const ready = await checkReady(req.user.id, "PRESTADOR");
      if (!ready) {
        return res
          .status(403)
          .json({ error: "Requisitos de PRESTADOR no completos o no validados" });
      }

      const id = Number(req.params.id);
      if (Number.isNaN(id)) return res.status(400).json({ error: "ID inválido" });

      const body = rulesSchema.parse(req.body);

      const space = await prisma.space.findFirst({
        where: { id, idPropietario: req.user.id },
        select: { id: true },
      });

      if (!space) return res.status(404).json({ error: "Espacio no encontrado o no autorizado" });

      const types = Array.isArray(body.allowedVehicleTypes)
        ? Array.from(new Set(body.allowedVehicleTypes))
        : [];

      await prisma.$transaction(async (tx) => {
        await tx.space.update({
          where: { id },
          data: { capacity: body.capacity },
        });

        // Reemplaza reglas
        await tx.spaceAllowedVehicleType.deleteMany({ where: { spaceId: id } });

        if (types.length > 0) {
          await tx.spaceAllowedVehicleType.createMany({
            data: types.map((t) => ({ spaceId: id, type: t })),
            skipDuplicates: true,
          });
        }
      });

      return res.json({ ok: true });
    } catch (err) {
      console.error("Error en PATCH /api/spaces/:id/rules:", err);
      if (err?.issues) {
        return res.status(400).json({ error: "Datos inválidos", details: err.issues });
      }
      return res.status(500).json({ error: "Error interno del servidor" });
    }
  }
);

router.get("/mine", requireAuth, requireRole("PRESTADOR"), async (req, res) => {
  try {
    const ready = await checkReady(req.user.id, "PRESTADOR");
    if (!ready) return res.status(403).json({ error: "Requisitos de PRESTADOR no completos o no validados" });

    const spaces = await prisma.space.findMany({
      where: { idPropietario: req.user.id },
      include: {
        photos: true,
        allowedVehicleTypes: { select: { type: true } }, // ✅ NUEVO
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ spaces });
  } catch (err) {
    console.error("Error en GET /api/spaces/mine:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

router.get("/nearby", async (req, res) => {
  try {
    const onlyAvailable = String(req.query.onlyAvailable || "0") === "1";
    const priceMode = req.query.priceMode === "DIA" ? "DIA" : "HORA";
    const minPrice = req.query.minPrice != null ? Number(req.query.minPrice) : null;
    const maxPrice = req.query.maxPrice != null ? Number(req.query.maxPrice) : null;

    const type = req.query.type ? String(req.query.type) : null; // COCHERA|PATIO|TERRENO
    const covered = String(req.query.covered || "0") === "1";

    const priceField = priceMode === "DIA" ? "precioDia" : "precioHora";

    const where = { activo: true };
    // ✅ Nuevo: filtro por tipo(s) de vehículo
    const vehicleType = req.query.vehicleType ? String(req.query.vehicleType) : null;
    const vehicleTypesRaw = req.query.vehicleTypes ? String(req.query.vehicleTypes) : null;

    let vehicleTypes = [];
    if (vehicleType) vehicleTypes = [vehicleType];
    if (vehicleTypesRaw) vehicleTypes = vehicleTypesRaw.split(",").map(s => s.trim()).filter(Boolean);

    // valida contra el enum permitido
    vehicleTypes = vehicleTypes.filter((t) => VEHICLE_TYPES.includes(t));

    if (type) where.tipoEspacio = type;
    if (covered) where.cubierto = true;

    if (minPrice != null && !Number.isNaN(minPrice))
      where[priceField] = { ...(where[priceField] || {}), gte: minPrice };
    if (maxPrice != null && !Number.isNaN(maxPrice))
      where[priceField] = { ...(where[priceField] || {}), lte: maxPrice };

    // Nota: tu filtro onlyAvailable actual no considera horario; lo dejo “simple” por ahora
    if (onlyAvailable) {
      where.reservations = {
        none: {
          status: { in: ["ACEPTADA", "CHECKIN_SOLICITADO", "EN_CURSO"] },
        },
      };
    }

    if (vehicleTypes.length > 0) {
      // Si el espacio tiene reglas, debe coincidir con alguno de los tipos solicitados.
      // Si NO tiene reglas (vacío), lo tratamos como "acepta cualquiera" => también entra.
      where.OR = [
        { allowedVehicleTypes: { some: { type: { in: vehicleTypes } } } },
        { allowedVehicleTypes: { none: {} } },
      ];
    }


    const spaces = await prisma.space.findMany({
      where,
      include: {
        photos: true,
        allowedVehicleTypes: { select: { type: true } }, // ✅ NUEVO
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ spaces });
  } catch (err) {
    console.error("Error en GET /api/spaces/nearby:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

router.get("/:id/quote", async (req, res) => {
  try {
    const spaceId = Number(req.params.id);
    if (Number.isNaN(spaceId)) return res.status(400).json({ error: "ID inválido" });

    const { startAt, endAt } = req.query;

    const q = await quotes.quote({
      spaceId,
      startAt,
      endAt,
    });

    res.json({ quote: q });
  } catch (e) {
    res.status(e.statusCode || 400).json({ error: e.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const space = await prisma.space.findUnique({
      where: { id },
      include: {
        photos: true,
        owner: {
          select: { id: true, nombre: true, email: true, telefono: true },
        },
        allowedVehicleTypes: { select: { type: true } }, // ✅ NUEVO
      },
    });

    if (!space) return res.status(404).json({ error: "Espacio no encontrado" });

    res.json({ space });
  } catch (err) {
    console.error("Error en GET /api/spaces/:id:", err);
    res.status(500).json({ error: "Error interno del servidor" });
  }
});

module.exports = router;
