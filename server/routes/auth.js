import { Router } from 'express';
import {
  isSetup, setPassword, checkPassword, createSession, destroySession, destroyAllSessions,
  hasSession, isLocalRequest, rateLimit, requireAuth,
} from '../auth.js';
import { saveSettings } from '../settings.js';
import { HttpError, v } from '../util.js';

export const authRouter = Router();
const perClient = rateLimit({ limit: 10, windowMs: 15 * 60 * 1000 });
const overall = rateLimit({ limit: 60, windowMs: 15 * 60 * 1000, key: 'all' });
const limiter = (req, res, next) => overall(req, res, (err) => (err ? next(err) : perClient(req, res, next)));

authRouter.get('/status', (req, res) => {
  res.json({ setup: isSetup(), authed: hasSession(req), local: isLocalRequest(req) });
});

authRouter.post('/setup', limiter, (req, res) => {
  if (isSetup()) throw new HttpError(409, 'This workspace is already set up.');
  if (!isLocalRequest(req)) throw new HttpError(403, 'First-time setup has to be done on the computer running the app.');
  setPassword(req.body.password);
  const name = v.str(req.body.businessName, 200);
  if (name) saveSettings({ business: { name } });
  createSession(req, res);
  res.json({ ok: true });
});

authRouter.post('/login', limiter, (req, res) => {
  if (!isSetup()) throw new HttpError(409, 'Finish setup first.');
  if (!checkPassword(req.body.password)) throw new HttpError(401, 'That password is not right.');
  createSession(req, res);
  res.json({ ok: true });
});

authRouter.post('/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

authRouter.post('/password', requireAuth, limiter, (req, res) => {
  if (!checkPassword(req.body.current)) throw new HttpError(401, 'Your current password is not right.');
  setPassword(req.body.next);
  destroyAllSessions();
  createSession(req, res);
  res.json({ ok: true });
});
