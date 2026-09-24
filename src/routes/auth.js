import { Router } from 'express';
import { User } from '../models/index.js';
import { hashPassword, verifyPassword, issueToken, readToken, bearer } from '../lib/auth.js';

const r = Router();
const ok = (fn) => (req, res) => fn(req, res).catch((e) => res.status(400).json({ error: e.message }));
const shape = (u) => ({ _id: u._id, name: u.name, email: u.email, phone: u.phone, status: u.status });

// Accounts are created by an administrator; there is no public sign-up.

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
