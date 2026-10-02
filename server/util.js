import crypto from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const nowIso = () => new Date().toISOString();
export const newToken = (bytes = 18) => crypto.randomBytes(bytes).toString('base64url');

// Wraps async route handlers so rejected promises reach the error middleware.
export const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const v = {
  str(value, max = 500) {
    if (value === undefined || value === null) return '';
    return String(value).slice(0, max).trim();
  },
  num(value, { min = -1e12, max = 1e12 } = {}) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return Math.min(Math.max(n, min), max);
  },
  date(value, { required = false } = {}) {
    if (!value) {
      if (required) throw new HttpError(400, 'A date is required.');
      return null;
    }
    const s = String(value).slice(0, 10);
    if (!DATE_RE.test(s)) throw new HttpError(400, `Invalid date: ${s}`);
    return s;
  },
  email(value, { required = false } = {}) {
    const s = v.str(value, 254);
    if (!s) {
      if (required) throw new HttpError(400, 'An email address is required.');
      return '';
    }
    if (!EMAIL_RE.test(s)) throw new HttpError(400, `Invalid email: ${s}`);
    return s;
  },
  emails(value) {
    return v.str(value, 1000).split(/[,;\s]+/).filter(Boolean).map((e) => v.email(e, { required: true }));
  },
  oneOf(value, allowed, fallback) {
    return allowed.includes(value) ? value : fallback;
  },
  id(value) {
    const n = Number.parseInt(value, 10);
    if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Invalid id.');
    return n;
  },
};

export function parseJson(text, fallback) {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function fillTemplate(template, values) {
  return String(template || '').replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));
}
