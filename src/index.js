import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import publicRoutes from './routes/public.js';
import adminRoutes, { auth } from './routes/admin.js';
import authRoutes from './routes/auth.js';

process.env.ADMIN_TOKEN ||= 'hotel-admin-token';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api', publicRoutes);
app.use('/api/admin', auth, adminRoutes);
app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));

const PORT = process.env.PORT || 5000;
mongoose.connect(process.env.MONGO_URI)
  .then(() => app.listen(PORT, () => console.log(`API on http://localhost:${PORT}`)))
  .catch((e) => { console.error('Mongo error', e.message); process.exit(1); });
