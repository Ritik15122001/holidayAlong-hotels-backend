import crypto from 'node:crypto';

/**
 * Staff sessions for the admin panel.
 *
 * Two kinds of token are accepted: the legacy ADMIN_TOKEN from the environment,
 * which is always treated as a Super Admin, and signed tokens issued to staff
 * accounts, which carry the account's role.
 */
const SECRET = process.env.ADMIN_JWT_SECRET || process.env.ADMIN_TOKEN || 'holiday-along-admin-secret';
const TTL_DAYS = 7;

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const sign = (data) => crypto.createHmac('sha256', SECRET).update(data).digest('base64url');

/**
 * How long a session may sit untouched before another device may take over.
 * Without this, closing the browser without signing out would lock the
 * account until the token expired.
 */
export const IDLE_MINUTES = Number(process.env.ADMIN_IDLE_MINUTES || 20);

export function issueAdminToken(user, sessionId) {
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({
    sub: String(user._id),
    name: user.name,
    username: user.username,
    role: user.role,
    sid: sessionId,
    exp: Date.now() + TTL_DAYS * 864e5,
  });
  return `${header}.${payload}.${sign(`${header}.${payload}`)}`;
}

/** Is this account's stored session still live, or has it gone idle? */
export function sessionIsLive(user) {
  if (!user?.sessionId) return false;
  const seen = user.lastSeenAt || user.sessionStartedAt;
  if (!seen) return false;
  return Date.now() - new Date(seen).getTime() < IDLE_MINUTES * 60_000;
}

/** A short, readable note of where a session was opened. */
export function deviceLabel(userAgent = '') {
  const ua = String(userAgent);
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : /Firefox\//.test(ua) ? 'Firefox' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /Mac OS X/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows'
    : /Linux/.test(ua) ? 'Linux' : '';
  return [browser, os].filter(Boolean).join(' on ');
}

export function readAdminToken(token) {
  const [h, p, sig] = String(token || '').split('.');
  if (!h || !p || !sig) return null;
  const expected = sign(`${h}.${p}`);
  if (expected.length !== sig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * What an Editor may reach, keyed by the first path segment under /api/admin.
 * Everything not listed here is Super Admin only — that way a new area is
 * locked down by default rather than accidentally exposed.
 */
export const EDITOR_AREAS = new Set([
  'stats',        // the dashboard landing
  'hotels',
  'cities',
  'locations',
  'amenities',
  'room-types',
  'meal-plans',
  'vendors',
  'brochures',    // Packages
  'leads',        // Bookings
  'finance',      // Expenses & P&L
  'uploads',      // images and documents attached to the above
  'prices',
]);

/** The areas a role may reach, for the admin panel to build its menu from. */
export const areasFor = (role) => (role === 'Super Admin' ? null : [...EDITOR_AREAS]);

/** Signing in and reading your own profile are never gated. */
const ALWAYS = new Set(['login', 'logout', 'me']);

/**
 * First path segment below /api/admin. Read from the original URL rather than
 * req.path so it still works for routers mounted deeper, such as finance.
 */
const areaOf = (req) => {
  const url = String(req.originalUrl || req.url || '').split('?')[0];
  const after = url.split('/api/admin/')[1];
  return (after || '').split('/').filter(Boolean)[0] || '';
};

/** Blocks an Editor from any area outside the allow list above. */
export function requireArea(req, res, next) {
  const area = areaOf(req);
  if (ALWAYS.has(area)) return next();
  if (req.admin?.role === 'Super Admin') return next();
  if (EDITOR_AREAS.has(area)) return next();
  return res.status(403).json({ error: 'Your account does not have access to this area' });
}
