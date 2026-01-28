// src/routes/vehicles.js
const router = require("express").Router();
const { z } = require("zod");
const prisma = require("../lib/prisma");
const requireAuth = require("../middlewares/requireAuth");
const fs = require("fs");
const path = require("path");

// Directorio donde guardaremos las fotos de vehículos
const uploadDir = path.join(__dirname, "..", "..", "uploads", "vehicles");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}


const vehicleSchema = z.object({
  type: z.enum(["COCHE", "CAMIONETA", "MOTO", "URBAN"]),
  modelo: z.number().int().min(1990),
  marca: z.string().min(2),
  color: z.string().min(2),
  plate: z.string().min(3).nullable().optional(),


  photos: z.array(z.string()).max(5).optional(),
});

// POST /api/vehicles
router.post("/", requireAuth, async (req, res) => {
  try {
    const data = vehicleSchema.parse(req.body);

    //placas
    const plateValue =
      data.plate && String(data.plate).trim() ? String(data.plate).trim() : null;

    // 1) Crear vehículo
    const vehicle = await prisma.vehicle.create({
      data: {
        userId: req.user.id,
        type: data.type,
        modelo: data.modelo,
        marca: data.marca.trim(),
        color: data.color.trim(),
        plate: plateValue,
      },
    });

    // 2) Guardar fotos
    if (data.photos?.length) {
      if (!process.env.BASE_URL) {
        console.warn(
          "WARN: BASE_URL no está definido en .env. Las URLs podrían quedar incorrectas."
        );
      }

      const fotosData = [];

      for (let i = 0; i < data.photos.length; i++) {
        const raw = data.photos[i];

        const base64 = raw.includes("base64,") ? raw.split("base64,")[1] : raw;

        // Nombre de archivo
        const filename = `vehicle_${vehicle.id}_${Date.now()}_${i}.jpg`;
        const filepath = path.join(uploadDir, filename);

        // Guardar archivo
        const buffer = Buffer.from(base64, "base64");
        await fs.promises.writeFile(filepath, buffer);

        // URL 
        const publicUrl = `${process.env.BASE_URL || ""}/uploads/vehicles/${filename}`;

        fotosData.push({
          vehicleId: vehicle.id,
          url: publicUrl,
        });
      }

      if (fotosData.length) {
        await prisma.vehiclePhoto.createMany({ data: fotosData });
      }
    }

    res.status(201).json({ vehicleId: vehicle.id });
  } catch (err) {
    console.error("Error en POST /api/vehicles:", err);

    if (err?.issues) {
      return res
        .status(400)
        .json({ error: "Datos inválidos", details: err.issues });
    }

    // Prisma
    if (err?.code === "P2002") {
      return res.status(409).json({ error: "Las placas ya están registradas." });
    }

    res.status(500).json({ error: "Error interno" });
  }
});

// GET /api/vehicles/mine
router.get("/mine", requireAuth, async (req, res) => {
  try {
    const vehicles = await prisma.vehicle.findMany({
      where: { userId: req.user.id },
      include: { photos: true },          
      orderBy: { createdAt: "desc" },
    });
    res.json({ vehicles });
  } catch (err) {
    console.error("Error en GET /api/vehicles/mine:", err);
    res.status(500).json({ error: "Error interno" });
  }
});

// GET /api/vehicles/:id
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    const vehicle = await prisma.vehicle.findFirst({
      where: { id, userId: req.user.id }, // solo el dueño
      include: { photos: true }, 
    });

    if (!vehicle)
      return res.status(404).json({ error: "Vehículo no encontrado" });

    res.json({ vehicle });
  } catch (err) {
    console.error("Error en GET /api/vehicles/:id:", err);
    res.status(500).json({ error: "Error interno" });
  }
});

// DELETE /api/vehicles/:id
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "ID inválido" });

    // 1) Verifica que sea del usuario
    const vehicle = await prisma.vehicle.findFirst({
      where: { id, userId: req.user.id },
      include: { photos: true },
    });

    if (!vehicle) return res.status(404).json({ error: "Vehículo no encontrado" });

    await prisma.vehiclePhoto.deleteMany({ where: { vehicleId: id } });
    await prisma.vehicle.delete({ where: { id } });

    return res.json({ ok: true });
  } catch (err) {
    console.error("Error en DELETE /api/vehicles/:id:", err);
    return res.status(500).json({ error: "Error interno" });
  }
});


module.exports = router;
