import { Router } from 'express';
import { User } from '../models/index.js';
import { hashPassword, verifyPassword, issueToken, readToken, bearer } from '../lib/auth.js';

const r = Router();
const ok = (fn) => (req, res) => fn(req, res).catch((e) => res.status(400).json({ error: e.message }));
const shape = (u) => ({ _id: u._id, name: u.name, email: u.email, phone: u.phone, status: u.status });

r.post('/signup', ok(async (req, res) => {
  const { name, email, phone, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const exists = await User.findOne({ email: String(email).toLowerCase() });
  if (exists) return res.status(409).json({ error: 'An account with this email already exists' });

  const user = await User.create({
    name, email, phone: phone || '',
    passwordHash: hashPassword(String(password)),
    lastLoginAt: new Date(),
  });
  res.status(201).json({ token: issueToken(user), user: shape(user) });
}));

r.post('/login', ok(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const user = await User.findOne({ email: String(email).toLowerCase() });
  if (!user || !verifyPassword(String(password), user.passwordHash)) {
    return res.status(401).json({ error: 'Incorrect email or password' });
  }
  if (user.status === 'Blocked') return res.status(403).json({ error: 'This account has been blocked' });

  user.lastLoginAt = new Date();
  await user.save();
  res.json({ token: issueToken(user), user: shape(user) });
}));

r.get('/me', ok(async (req, res) => {
  const payload = readToken(bearer(req));
  if (!payload) return res.status(401).json({ error: 'Not signed in' });
  const user = await User.findById(payload.sub).lean();
  if (!user || user.status === 'Blocked') return res.status(401).json({ error: 'Not signed in' });
  res.json({ user: shape(user) });
}));

export default r;
