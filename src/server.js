// src/server.js 
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");

const authRouter = require("./routes/auth");
const documentsRouter = require("./routes/documents");
const vehiclesRouter = require("./routes/vehicles");
const spacesRouter = require("./routes/spaces");
const requirementsRouter = require("./routes/requirements");
const passwordResetRoutes = require("./routes/passwordReset");
const prisma = require("./lib/prisma");
const { initSocket } = require("./socket");
const chatRoutesFactory = require("./routes/chat.routes");
const meRoutes = require("./routes/me");

const app = express();
const PORT = process.env.PORT || 4000;


app.use(cors({ origin: "*" }));

// Body limits (base64)
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// 📂 Archivos estáticos (uploads)
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));
app.use("/uploads/spaces", express.static(path.join(__dirname, "..", "uploads", "spaces")));
app.use("/uploads/vehicles", express.static(path.join(__dirname, "..", "uploads", "vehicles")));
app.use("/uploads/documents", express.static(path.join(__dirname, "..", "uploads", "documents")));
app.use("/api", chatRoutesFactory(prisma));
app.use("/api/admin", require("./routes/admin.users"));
app.use("/api", require("./routes/support"));
app.use("/api/admin", require("./routes/admin.support"));
app.use("/api", require("./routes/reports"));
app.use("/api/admin", require("./routes/admin.reports"));

// ✅ Crear server HTTP para Socket.IO
const httpServer = http.createServer(app);

// ✅ Socket.IO (ya trae auth + rooms + chat por reserva)
const io = initSocket(httpServer, prisma);

io.engine.on("connection_error", (err) => {
  console.log("EIO connection_error:", {
    code: err.code,
    message: err.message,
    context: err.context,
  });
});


// ✅ Hacer io accesible desde rutas
app.set("io", io);

app.get("/health", (_, res) => res.json({ ok: true }));

// 📂 Rutas API
app.use("/api/auth", authRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/vehicles", vehiclesRouter);
app.use("/api/spaces", spacesRouter);
app.use("/api/requirements", requirementsRouter);
app.use('/api/reservations', require('./routes/reservations'));
app.use('/api/roles', require('./routes/roles'));
app.use("/api/admin", require("./routes/admin.documents"));
app.use("/api/auth", passwordResetRoutes);
//app.use("/api/admin/documents", require("./routes/adminDocuments"));
app.use("/api", meRoutes);

//Healthcheck
app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "CICOCHE API", ts: new Date().toISOString() });
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`API + Socket running on http://localhost:${PORT}`);

  const { verifySmtp } = require("./mail/mailer");
  const disableEmail = String(process.env.DISABLE_EMAIL || "").toLowerCase() === "true";

  // Solo verifica SMTP si NO está deshabilitado
  if (!disableEmail) {
    verifySmtp();
  } else {
    console.log("✉️ Email deshabilitado (DISABLE_EMAIL=true).");
  }
});
