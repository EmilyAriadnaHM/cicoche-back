// src/middlewares/uploadDocuments.js
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const uploadDir = path.join(__dirname, "..", "..", "uploads", "documents");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

function extFromMimeOrName(file) {
  const mime = (file.mimetype || "").toLowerCase();
  const name = (file.originalname || "").toLowerCase();

  if (mime === "application/pdf" || name.endsWith(".pdf")) return ".pdf";
  if (mime === "image/png" || name.endsWith(".png")) return ".png";
  if (mime === "image/webp" || name.endsWith(".webp")) return ".webp";
  return ".jpg"; 
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const kind = String(req.body.kind || "DOC").toUpperCase();
    const userId = req.user?.id || "0";
    const ext = extFromMimeOrName(file);
    cb(null, `${kind}_${userId}_${Date.now()}${ext}`);
  },
});

function fileFilter(req, file, cb) {
  const mime = (file.mimetype || "").toLowerCase();
  const name = (file.originalname || "").toLowerCase();

  const isPdf = mime === "application/pdf" || name.endsWith(".pdf");

  const isImage =
    mime.startsWith("image/") ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".png") ||
    name.endsWith(".webp");

  // Algunos Android mandan octet-stream, pero podemos validar por extensión
  const isOctetStream = mime === "application/octet-stream";
  const allowedByName =
    name.endsWith(".pdf") ||
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".png") ||
    name.endsWith(".webp");

  const ok = isPdf || isImage || (isOctetStream && allowedByName);

  if (!ok) return cb(new Error("Tipo no permitido. Sube imagen (jpg/png/webp) o PDF."), false);
  cb(null, true);
}


const uploadDocument = multer({
  storage,
  fileFilter,
  limits: { fileSize: 12 * 1024 * 1024 }, // 12MB
});

module.exports = { uploadDocument };
