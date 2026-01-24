const router = require('express').Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const prisma = require('../lib/prisma');
const { z } = require('zod');
const requireAuth = require('../middlewares/requireAuth');

// ahora roles es array opcional
const registerSchema = z.object({
  nombre: z.string().min(2),
  email: z.string().email(),
  telefono: z.string().min(8).optional(),
  password: z.string().min(8),
  // puede venir ["OCUPANTE"] o ["OCUPANTE","PRESTADOR"]
  roles: z.array(z.string()).optional()
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

function signToken(user, roles) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      roles: roles.map(r => r.role.name) // ["OCUPANTE", ...]
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const data = registerSchema.parse(req.body);

    // 1. validamos que no exista
    const exists = await prisma.user.findFirst({
      where: {
        OR: [
          { email: data.email },
          data.telefono ? { telefono: data.telefono } : undefined
        ].filter(Boolean)
      }
    });
    if (exists) {
      return res.status(409).json({ error: 'Email o teléfono ya registrado' });
    }

    // 2. hash
    const passwordHash = await bcrypt.hash(data.password, 10);

    // 3. crear usuario
    const user = await prisma.user.create({
      data: {
        nombre: data.nombre,
        email: data.email,
        telefono: data.telefono || null,
        passwordHash
      }
    });

    // 4. determinar roles que pidió el frontend
    const requestedRoles = Array.isArray(data.roles) ? data.roles : ['OCUPANTE'];

    // 5. nunca dejar que se autoasigne ADMIN
    const safeRoles = requestedRoles.filter(r => r !== 'ADMIN');

    // 6. obtener ids de roles existentes
    const rolesDb = await prisma.role.findMany({
      where: {
        name: { in: safeRoles }
      }
    });

    // 7. vincular usuario con roles
    if (rolesDb.length > 0) {
      await prisma.userRole.createMany({
        data: rolesDb.map(r => ({
          userId: user.id,
          roleId: r.id
        })),
        skipDuplicates: true
      });
    }

    // volver a leer usuario con roles
    const userWithRoles = await prisma.user.findUnique({
      where: { id: user.id },
      include: {
        roles: {
          include: { role: true }
        }
      }
    });

    const token = signToken(userWithRoles, userWithRoles.roles);

    res.status(201).json({
      user: {
        id: userWithRoles.id,
        nombre: userWithRoles.nombre,
        email: userWithRoles.email,
        roles: userWithRoles.roles.map(r => r.role.name)
      },
      token
    });
  } catch (err) {
    if (err?.issues) {
      return res.status(400).json({ error: 'Datos inválidos', details: err.issues });
    }
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
    // Prisma unique constraint
  if (err?.code === "P2002") {
    const target = err?.meta?.target; // puede ser ["email"] o ["telefono"] etc.
    const field = Array.isArray(target) ? target[0] : target;

    if (field === "email") {
      return res.status(409).json({
        error: "El correo ya está registrado.",
        code: "DUPLICATE_EMAIL",
        field: "email",
      });
    }

    if (field === "telefono") {
      return res.status(409).json({
        error: "El teléfono ya está registrado.",
        code: "DUPLICATE_PHONE",
        field: "telefono",
        telefono: telefono.trim() ? tel : null
      });
    }

    // fallback si Prisma no manda target como esperas
    return res.status(409).json({
      error: "Ya existe un registro con datos únicos repetidos.",
      code: "DUPLICATE_UNIQUE",
      field: field || null,
    });
  }

  return res.status(500).json({ error: "Error interno", code: "SERVER_ERROR" });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const data = loginSchema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email: data.email },
      include: {
        roles: {
          include: { role: true }
        }
      }
    });

    if (!user) return res.status(401).json({ error: 'Credenciales inválidas' });

    const ok = await bcrypt.compare(data.password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Credenciales inválidas' });

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() }
    });

    const token = signToken(user, user.roles);

    res.json({
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        roles: user.roles.map(r => r.role.name)
      },
      token
    });
  } catch (err) {
    if (err?.issues) {
      return res.status(400).json({ error: 'Datos inválidos', details: err.issues });
    }
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// GET /api/auth/profile
router.get('/profile', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: {
      roles: { include: { role: true } }
    }
  });

  res.json({
    user: {
      id: user.id,
      nombre: user.nombre,
      email: user.email,
      roles: user.roles.map(r => r.role.name),
      createdAt: user.createdAt
    }
  });
});

router.get('/profile', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: { roles: { include: { role: true } } }
  });

  res.json({
    user: {
      id: user.id,
      nombre: user.nombre,
      email: user.email,
      telefono: user.telefono,
      photoUrl: user.photoUrl,
      roles: user.roles.map(r => r.role.name),
      createdAt: user.createdAt
    }
  });
});


module.exports = router;
