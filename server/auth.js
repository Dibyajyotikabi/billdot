import crypto from 'node:crypto';
import { db, kvGet, kvSet } from './db.js';
import { HttpError, newToken } from './util.js';

const COOKIE = 'bd_session';
const SESSION_DAYS = 30;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export const isSetup = () => Boolean(kvGet('auth')?.hash);

export function setPassword(password) {
  if (typeof password !== 'string' || password.length < 6) {
    throw new HttpError(400, 'Use a password with at least 6 characters.');
  }
  kvSet('auth', { hash: hashPassword(password) });
}

export function checkPassword(password) {
  return verifyPassword(String(password || ''), kvGet('auth')?.hash);
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function createSession(req, res) {
  const id = newToken(32);
  const maxAge = SESSION_DAYS * 86400;
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (id, expires_at) VALUES (?, ?)').run(sha256(id), Date.now() + maxAge * 1000);
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`);
}

export function destroySession(req, res) {
  const id = readCookie(req, COOKIE);
  if (id) db.prepare('DELETE FROM sessions WHERE id = ?').run(sha256(id));
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

export function destroyAllSessions() {
  db.prepare('DELETE FROM sessions').run();
}

export function hasSession(req) {
  const id = readCookie(req, COOKIE);
  if (!id) return false;
  const row = db.prepare('SELECT expires_at FROM sessions WHERE id = ?').get(sha256(id));
  return Boolean(row && row.expires_at > Date.now());
}

export function requireAuth(req, res, next) {
  if (!hasSession(req)) return next(new HttpError(401, 'Please sign in.'));
  // A custom header forces a CORS preflight, which blocks cross-site form posts.
  if (req.method !== 'GET' && req.get('x-requested-with') !== 'billdot') {
    return next(new HttpError(403, 'Missing request header.'));
  }
  next();
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const isLoopback = (req) => LOOPBACK.has(req.socket.remoteAddress || '');
const MAX_TRACKED_IPS = 1000;

// Requests through the tunnel arrive from loopback too, so proxy headers decide.
export function isLocalRequest(req) {
  return isLoopback(req) && !req.headers['cf-connecting-ip'] && !req.headers['x-forwarded-for'];
}

// Only cloudflared, which connects from loopback, may name the real client.
// A device on the Wi-Fi could fake the header to dodge the rate limit.
export function clientIp(req) {
  const addr = req.socket.remoteAddress || 'unknown';
  return (isLoopback(req) && req.headers['cf-connecting-ip']) || addr;
}

export function rateLimit({ limit, windowMs }) {
  const hits = new Map();
  return (req, res, next) => {
    const key = clientIp(req);
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.reset < now) {
      if (hits.size >= MAX_TRACKED_IPS) {
        for (const [k, e] of hits) if (e.reset < now) hits.delete(k);
      }
      hits.set(key, { count: 1, reset: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > limit) {
      res.setHeader('Retry-After', Math.ceil((entry.reset - now) / 1000));
      return next(new HttpError(429, 'Too many attempts. Please wait a few minutes.'));
    }
    next();
  };
}
