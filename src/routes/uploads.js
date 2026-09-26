import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Same root as index.js, so uploads land next to package.json regardless of cwd.
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..', 'uploads');
fs.mkdirSync(DIR, { recursive: true });

const IMAGES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const DOCS = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const ALLOWED = new Set([...IMAGES, ...DOCS]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, DIR),
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase().slice(0, 8);
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) =>
    ALLOWED.has(file.mimetype) ? cb(null, true) : cb(new Error('Allowed files: JPG, PNG, WebP, GIF, AVIF, PDF, DOC or DOCX')),
});

const r = Router();

/** Absolute URL so the admin panel and website can both load it cross-origin. */
const publicUrl = (req, name) =>
  `${process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`}/uploads/${name}`;

r.post('/', (req, res) => {
  upload.array('files', 10)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files received' });
    res.status(201).json({ urls: files.map((f) => publicUrl(req, f.filename)) });
  });
});

r.delete('/:name', (req, res) => {
  const name = path.basename(req.params.name);
  const file = path.join(DIR, name);
  if (!file.startsWith(DIR)) return res.status(400).json({ error: 'Bad path' });
  fs.promises.unlink(file).catch(() => {});
  res.json({ ok: true });
});

export default r;
