// Server modules tested in-process. db.js opens the database when imported,
// so DATA_DIR points at a throwaway folder before anything loads.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'billdot-unit-'));
process.env.DATA_DIR = dataDir;

let auth;
let util;
let docs;
let scheduler;
let db;

before(async () => {
  auth = await import('../server/auth.js');
  util = await import('../server/util.js');
  docs = await import('../server/repos/documents.js');
  scheduler = await import('../server/scheduler.js');
  ({ db } = await import('../server/db.js'));
});

after(() => {
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const fakeReq = (remoteAddress, headers = {}) => ({ socket: { remoteAddress }, headers });

test('clientIp trusts cf-connecting-ip only from the local tunnel', () => {
  assert.equal(auth.clientIp(fakeReq('127.0.0.1', { 'cf-connecting-ip': '203.0.113.9' })), '203.0.113.9');
  assert.equal(auth.clientIp(fakeReq('192.168.1.40', { 'cf-connecting-ip': '203.0.113.9' })), '192.168.1.40',
    'a device on the Wi-Fi cannot pick its own rate limit key');
  assert.equal(auth.clientIp(fakeReq(undefined)), 'unknown');
});

test('isLocalRequest rejects proxied and LAN requests', () => {
  assert.equal(auth.isLocalRequest(fakeReq('::1')), true);
  assert.equal(auth.isLocalRequest(fakeReq('127.0.0.1', { 'x-forwarded-for': '1.2.3.4' })), false);
  assert.equal(auth.isLocalRequest(fakeReq('10.0.0.2')), false);
});

test('rateLimit blocks after the limit with a Retry-After header', () => {
  const limiter = auth.rateLimit({ limit: 2, windowMs: 60_000 });
  const req = fakeReq('10.0.0.7');
  const headers = {};
  const res = { setHeader: (k, val) => { headers[k] = val; } };
  const results = [];
  for (let i = 0; i < 3; i += 1) limiter(req, res, (err) => results.push(err?.status ?? 'ok'));
  assert.deepEqual(results, ['ok', 'ok', 429]);
  assert.ok(Number(headers['Retry-After']) > 0);
  limiter(fakeReq('10.0.0.8'), res, (err) => assert.equal(err, undefined, 'other addresses keep their own count'));
});

test('passwords hash with a salt and verify', () => {
  const stored = auth.hashPassword('secret123');
  assert.notEqual(stored, auth.hashPassword('secret123'));
  assert.equal(auth.verifyPassword('secret123', stored), true);
  assert.equal(auth.verifyPassword('wrong', stored), false);
  assert.equal(auth.verifyPassword('secret123', 'garbage'), false);
});

test('validators clamp, trim and reject bad input', () => {
  const { v, HttpError } = util;
  assert.equal(v.str('  hi  '), 'hi');
  assert.equal(v.str(null), '');
  assert.equal(v.num('abc'), 0);
  assert.equal(v.num(500, { max: 100 }), 100);
  assert.equal(v.date('2026-10-02T10:00:00Z'), '2026-10-02');
  assert.throws(() => v.date('02/10/2026'), HttpError);
  assert.throws(() => v.date('', { required: true }), /required/);
  assert.deepEqual(v.emails('a@x.io, b@y.io; c@z.io'), ['a@x.io', 'b@y.io', 'c@z.io']);
  assert.throws(() => v.emails('a@x.io, nope'), /Invalid email/);
  assert.throws(() => v.id('0'), /Invalid id/);
  assert.equal(v.oneOf('x', ['a', 'b'], 'a'), 'a');
});

test('fillTemplate fills known keys and leaves unknown ones alone', () => {
  assert.equal(util.fillTemplate('Hi {client}, {missing} {total}', { client: 'Asha', total: 0 }), 'Hi Asha, {missing} 0');
  assert.equal(util.fillTemplate(null, {}), '');
});

test('nextRecurringDate clamps short months and returns to the anchor day', () => {
  const next = docs.nextRecurringDate;
  assert.equal(next('2026-01-31', 'monthly', 31), '2026-02-28');
  assert.equal(next('2026-02-28', 'monthly', 31), '2026-03-31');
  assert.equal(next('2028-01-30', 'monthly', 30), '2028-02-29');
  assert.equal(next('2026-11-30', 'quarterly', 30), '2027-02-28');
  assert.equal(next('2028-02-29', 'yearly', 29), '2029-02-28');
  assert.equal(next('2026-12-29', 'weekly'), '2027-01-05');
  assert.equal(next('2026-05-15', 'monthly'), '2026-06-15', 'without an anchor the current day is kept');
});

test('scheduler creates the next recurring invoice once and moves the date on', async () => {
  const today = new Date().toLocaleDateString('en-CA');
  const tpl = docs.createDocument({
    type: 'invoice',
    client: { name: 'Monthly Retainer Co' },
    items: [{ name: 'Retainer', qty: 1, rate: 5000, tax_rate: 0 }],
    recurring: { enabled: true, interval: 'monthly', next_date: today },
  });

  await scheduler.tick();
  const children = db.prepare('SELECT id, number, total, issue_date FROM documents WHERE parent_id = ?').all(tpl.id);
  assert.equal(children.length, 1);
  assert.equal(children[0].total, 5000);
  assert.equal(children[0].issue_date, today);
  const rec = docs.getDocument(tpl.id).recurring;
  assert.equal(rec.next_date, docs.nextRecurringDate(today, 'monthly'));
  assert.equal(rec.day, Number(today.slice(8, 10)));

  await scheduler.tick();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM documents WHERE parent_id = ?').get(tpl.id).n, 1, 'no duplicate on the same day');
});

test('scheduler switches off a recurring invoice past its end date', async () => {
  const today = new Date().toLocaleDateString('en-CA');
  const tpl = docs.createDocument({
    type: 'invoice',
    client: { name: 'Ended Co' },
    items: [{ name: 'Hosting', qty: 1, rate: 900, tax_rate: 0 }],
    recurring: { enabled: true, interval: 'monthly', next_date: today, end_date: '2020-01-01' },
  });
  await scheduler.tick();
  assert.equal(docs.getDocument(tpl.id).recurring.enabled, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM documents WHERE parent_id = ?').get(tpl.id).n, 0);
});
