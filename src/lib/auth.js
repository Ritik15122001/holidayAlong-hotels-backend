import crypto from 'node:crypto';

const SECRET = process.env.USER_JWT_SECRET || 'holiday-along-user-secret';
const TTL_DAYS = 30;

/* ---------- password hashing (scrypt, no external deps) ---------- */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(password, salt, 64);
  const known = Buffer.from(hash, 'hex');
  return known.length === check.length && crypto.timingSafeEqual(known, check);
}

/* ---------- signed tokens (HMAC-SHA256, JWT-shaped) ---------- */
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

export function issueToken(user) {
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({
    sub: String(user._id),
    email: user.email,
    name: user.name,
    exp: Date.now() + TTL_DAYS * 864e5,
  });
  return `${header}.${payload}.${sign(`${header}.${payload}`)}`;
}

export function readToken(token) {
  const [h, p, sig] = String(token || '').split('.');
  if (!h || !p || !sig) return null;
  const expected = sign(`${h}.${p}`);
  if (expected.length !== sig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

/* ---------- express middleware ---------- */
export const bearer = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '');

/** Rejects the request unless a valid, non-blocked user token is present. */
export function requireUser(req, res, next) {
  const payload = readToken(bearer(req));
  if (!payload) return res.status(401).json({ error: 'Please sign in to view this', code: 'AUTH_REQUIRED' });
  req.user = payload;
  next();
}
