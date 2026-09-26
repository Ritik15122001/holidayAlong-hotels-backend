import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import publicRoutes from './routes/public.js';
import adminRoutes, { auth } from './routes/admin.js';
import authRoutes from './routes/auth.js';
import uploadRoutes from './routes/uploads.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Resolve .env next to package.json rather than from process.cwd(), so it is
// found however the process is launched (pm2, systemd, a different cwd).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(ROOT, '.env') });

const REQUIRED = ['MONGO_URI', 'ADMIN_USER', 'ADMIN_PASS'];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(
    `\nMissing required environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}\n` +
    `Looked for a .env file at ${path.join(ROOT, '.env')}\n` +
    `Copy .env.example to .env and fill it in, or set these in your process manager.\n`
  );
  process.exit(1);
}
if (!process.env.USER_JWT_SECRET) {
  console.warn('USER_JWT_SECRET is not set — falling back to a default. Set it, or customer logins break on restart.');
}


process.env.ADMIN_TOKEN ||= 'hotel-admin-token';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Uploaded images are served straight off disk.
app.use('/uploads', express.static(path.join(ROOT, 'uploads'), {
  maxAge: '30d',
  setHeaders: (res, filePath) => {
    // PDFs and Word files should save rather than render in the tab
    if (/\.(pdf|docx?)$/i.test(filePath)) {
      res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
    }
  },
}));
app.use('/api/auth', authRoutes);
app.use('/api', publicRoutes);
app.use('/api/admin/uploads', auth, uploadRoutes);
app.use('/api/admin', auth, adminRoutes);
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

const PORT = process.env.PORT || 5000;
mongoose.connect(process.env.MONGO_URI)
  .then(() => app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`)))
  .catch((e) => { console.error('Mongo error', e.message); process.exit(1); });
