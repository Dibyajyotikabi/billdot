// Boots the real server on a spare port with a throwaway data folder,
// then walks the main billing flow over HTTP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = 4400 + Math.floor(Math.random() * 500);
const BASE = `http://localhost:${PORT}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'billdot-test-'));
let server;
let cookie = '';

async function call(method, url, body, { auth = true, header = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (header) headers['X-Requested-With'] = 'billdot';
  if (auth && cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const type = res.headers.get('content-type') || '';
  return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() };
}

async function waitForServer() {
  for (let i = 0; i < 50; i += 1) {
    try {
      await fetch(`${BASE}/api/auth/status`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error('Server did not start');
}

before(async () => {
  server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/index.js'], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir },
    stdio: 'ignore',
  });
  await waitForServer();
});

after(() => {
  server.kill('SIGTERM');
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('private API needs a session', async () => {
  const res = await call('GET', '/api/documents', null, { auth: false });
  assert.equal(res.status, 401);
});

test('setup signs in and short passwords are refused', async () => {
  assert.equal((await call('POST', '/api/auth/setup', { password: '123' })).status, 400);
  const res = await call('POST', '/api/auth/setup', { password: 'secret123', businessName: 'Test Studio' });
  assert.equal(res.status, 200);
  assert.ok(cookie);
});

test('writes without the request header are rejected', async () => {
  const res = await call('POST', '/api/clients', { name: 'Nope' }, { header: false });
  assert.equal(res.status, 403);
});

test('invoice flow: create, share, claim, part pay, mark paid', async () => {
  const created = await call('POST', '/api/documents', {
    type: 'invoice',
    client: { name: 'Bluebird Cafe', email: 'owner@bluebird.test' },
    items: [{ name: 'Reels editing', qty: 4, rate: 2500, tax_rate: 18 }],
  });
  assert.equal(created.status, 201);
  const doc = created.body;
  assert.equal(doc.total, 11800);
  assert.match(doc.number, /^INV-/);

  const hidden = await call('GET', `/api/public/${doc.token}`, null, { auth: false });
  assert.equal(hidden.status, 404, 'drafts stay private');
  assert.equal((await call('POST', `/api/documents/${doc.id}/shared`, { channel: 'link' })).status, 200);

  const pub = await call('GET', `/api/public/${doc.token}`, null, { auth: false });
  assert.equal(pub.status, 200);
  assert.equal(pub.body.document.number, doc.number);
  assert.equal(pub.body.settings.email, undefined, 'SMTP settings must not leak to clients');

  const claim = await call('POST', `/api/public/${doc.token}/claim`, { method: 'UPI', reference: 'UTR1' }, { auth: false });
  assert.equal(claim.status, 200);

  const part = await call('POST', `/api/documents/${doc.id}/payments`, { amount: 5000, method: 'UPI' });
  assert.equal(part.status, 200);
  const afterPart = (await call('GET', `/api/documents/${doc.id}`)).body;
  assert.equal(afterPart.amount_paid, 5000);

  const paid = await call('POST', `/api/documents/${doc.id}/paid`, {});
  assert.equal(paid.status, 200);
  const done = (await call('GET', `/api/documents/${doc.id}`)).body;
  assert.equal(done.display_status ?? done.status, 'paid');
  assert.equal(done.amount_paid, 11800);
});

test('mark unpaid removes the paid tag and its payments', async () => {
  const doc = (await call('POST', '/api/documents', {
    type: 'invoice', client: { name: 'Undo Co' }, items: [{ name: 'Logo', qty: 1, rate: 3000 }],
  })).body;
  await call('POST', `/api/documents/${doc.id}/shared`, { channel: 'link' });
  await call('POST', `/api/documents/${doc.id}/paid`, {});
  const res = await call('POST', `/api/documents/${doc.id}/unpaid`, {});
  assert.equal(res.status, 200);
  const back = (await call('GET', `/api/documents/${doc.id}`)).body;
  assert.equal(back.status, 'sent');
  assert.equal(back.amount_paid, 0);
  assert.equal(back.paid_at, null);
  assert.equal((await call('POST', `/api/documents/${doc.id}/unpaid`, {})).status, 409);
});

test('clients and items are remembered after billing', async () => {
  const clients = (await call('GET', '/api/clients?q=blue')).body;
  assert.ok(clients.some((c) => c.name === 'Bluebird Cafe'));
  const items = (await call('GET', '/api/items?q=reels')).body;
  const reels = items.find((it) => it.name === 'Reels editing');
  assert.ok(reels);
  assert.equal(reels.rate, 2500);
});

test('a second business gets its own id, number series and totals', async () => {
  const settings = (await call('GET', '/api/settings')).body;
  assert.equal(settings.businesses.length, 1);
  assert.equal(settings.businesses[0].code, 'B01');

  const made = await call('POST', '/api/businesses', { name: 'Side Studio', business: { email: 'hi@side.test' } });
  assert.equal(made.status, 201);
  const side = made.body;
  assert.equal(side.code, 'B02');
  assert.match(side.numbering.invoice.prefix, /^B02-INV-/);

  await call('PUT', `/api/settings?business=${side.id}`, { payment: { upiId: 'side@upi' } });
  const doc = (await call('POST', '/api/documents', {
    type: 'invoice', business_id: side.id, client: { name: 'Kite Labs' }, items: [{ name: 'Audit', qty: 1, rate: 1000, tax_rate: 0 }],
  })).body;
  assert.match(doc.number, /^B02-INV-/);
  assert.equal(doc.business_id, side.id);

  await call('POST', `/api/documents/${doc.id}/shared`, { channel: 'link' });
  const pub = (await call('GET', `/api/public/${doc.token}`, null, { auth: false })).body;
  assert.equal(pub.settings.business.name, 'Side Studio');
  assert.equal(pub.settings.payment.upiId, 'side@upi');
  assert.equal(pub.document.business_id, undefined);

  const main = (await call('GET', '/api/settings')).body;
  assert.equal(main.payment.upiId, '', 'other businesses keep their own payment details');
  const listed = main.businesses.find((b) => b.id === side.id);
  assert.equal(listed.invoices, 1);
  assert.equal(listed.outstanding, 1000);
  const filtered = (await call('GET', `/api/documents?business=${side.id}`)).body;
  assert.deepEqual(filtered.map((d) => d.id), [doc.id]);

  assert.equal((await call('DELETE', `/api/businesses/${side.id}`)).status, 409, 'cannot delete a business with bills');
});

test('payment confirmation records the payment and has a public page', async () => {
  const doc = (await call('POST', '/api/documents', {
    type: 'invoice', client: { name: 'Proof Co' }, items: [{ name: 'Shoot', qty: 1, rate: 2000, tax_rate: 0 }],
  })).body;
  await call('POST', `/api/documents/${doc.id}/shared`, { channel: 'link' });
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const bad = await call('POST', '/api/confirmations', { document_id: doc.id, amount: 2000, image: 'data:image/png;base64,AAAA' });
  assert.equal(bad.status, 400);

  const made = await call('POST', '/api/confirmations', {
    document_id: doc.id, amount: 2000, reference: 'UTR998877', record_payment: true, image: png, show_image: false,
  });
  assert.equal(made.status, 201);
  assert.equal(made.body.payer, 'Proof Co');
  assert.ok(made.body.payment_id);
  const after = (await call('GET', `/api/documents/${doc.id}`)).body;
  assert.equal(after.status, 'paid');

  const token = made.body.link.split('/p/')[1];
  const pub = await call('GET', `/api/public/c/${token}`, null, { auth: false });
  assert.equal(pub.status, 200);
  assert.equal(pub.body.confirmation.reference, 'UTR998877');
  assert.equal(pub.body.confirmation.document.number, doc.number);
  assert.equal(pub.body.confirmation.has_image, false);
  assert.equal(pub.body.confirmation.id, undefined);
  assert.equal((await call('GET', `/api/public/c/${token}/image`, null, { auth: false })).status, 404, 'hidden screenshot stays private');

  await call('PUT', `/api/confirmations/${made.body.id}`, { show_image: true });
  const img = await fetch(`${BASE}/api/public/c/${token}/image`);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');

  assert.equal((await call('DELETE', `/api/confirmations/${made.body.id}`)).status, 200);
  assert.equal((await call('GET', `/api/public/c/${token}`, null, { auth: false })).status, 404);
});

test('unknown public token is a 404', async () => {
  const res = await call('GET', '/api/public/not-a-real-token', null, { auth: false });
  assert.equal(res.status, 404);
});

const share = (id) => call('POST', `/api/documents/${id}/shared`, { channel: 'link' });
const invoice = async (name, rate, extra = {}) => (await call('POST', '/api/documents', {
  type: 'invoice', client: { name }, items: [{ name: 'Work', qty: 1, rate, tax_rate: 0 }], ...extra,
})).body;

test('bad document input is refused with a 400', async () => {
  const base = { client: { name: 'Bad Input Co' }, items: [{ name: 'X', qty: 1, rate: 10 }] };
  assert.equal((await call('POST', '/api/documents', { ...base, type: 'bogus' })).status, 400);
  assert.equal((await call('POST', '/api/documents', { ...base, type: 'invoice', currency: 'R5' })).status, 400);
  assert.equal((await call('POST', '/api/documents', { ...base, type: 'invoice', issue_date: '02/10/2026' })).status, 400);
  assert.equal((await call('POST', '/api/documents', { ...base, type: 'invoice', client: { name: 'A', email: 'nope' } })).status, 400);
  assert.equal((await call('GET', '/api/documents/abc')).status, 400);
  assert.equal((await call('GET', '/api/documents/999999')).status, 404);
});

test('a custom number cannot be used twice for the same type', async () => {
  const first = await invoice('Number Co', 100, { number: 'CUSTOM-7' });
  assert.equal(first.number, 'CUSTOM-7');
  const again = await call('POST', '/api/documents', {
    type: 'invoice', number: 'CUSTOM-7', client: { name: 'Number Co' }, items: [{ name: 'X', qty: 1, rate: 1 }],
  });
  assert.equal(again.status, 409);
  const quote = await call('POST', '/api/documents', {
    type: 'quote', number: 'CUSTOM-7', client: { name: 'Number Co' }, items: [{ name: 'X', qty: 1, rate: 1 }],
  });
  assert.equal(quote.status, 201, 'other types have their own series');
});

test('quotation: client accepts once, then it converts to an invoice', async () => {
  const quote = (await call('POST', '/api/documents', {
    type: 'quote', client: { name: 'Quote Co' }, items: [{ name: 'Website', qty: 1, rate: 40000, tax_rate: 18 }],
  })).body;
  assert.match(quote.number, /^QT-/);
  await share(quote.id);

  assert.equal((await call('POST', `/api/public/${quote.token}/claim`, { method: 'UPI' }, { auth: false })).status, 400,
    'quotations cannot be claimed as paid');
  assert.equal((await call('POST', `/api/documents/${quote.id}/payments`, { amount: 100 })).status, 400,
    'quotations do not take payments');
  assert.equal((await call('POST', `/api/public/${quote.token}/respond`, { action: 'maybe' }, { auth: false })).status, 400);

  const yes = await call('POST', `/api/public/${quote.token}/respond`, { action: 'accepted', name: 'Ravi' }, { auth: false });
  assert.equal(yes.status, 200);
  assert.equal((await call('POST', `/api/public/${quote.token}/respond`, { action: 'declined' }, { auth: false })).status, 409);

  const inv = await call('POST', `/api/documents/${quote.id}/copy`, { type: 'invoice' });
  assert.equal(inv.status, 201);
  assert.match(inv.body.number, /^INV-/);
  assert.equal(inv.body.parent_id, quote.id);
  assert.equal(inv.body.total, 47200);
  assert.equal(inv.body.status, 'draft');

  const detail = (await call('GET', `/api/documents/${quote.id}`)).body;
  assert.equal(detail.status, 'accepted');
  assert.deepEqual(detail.children.map((c) => c.id), [inv.body.id]);
  assert.ok(detail.activity.some((a) => a.message.includes('(Ravi)')));
});

test('invoices cannot be answered like quotations', async () => {
  const doc = await invoice('Respond Co', 100);
  await share(doc.id);
  assert.equal((await call('POST', `/api/public/${doc.token}/respond`, { action: 'accepted' }, { auth: false })).status, 400);
});

test('receipts are paid on save and refuse payment actions', async () => {
  const receipt = (await call('POST', '/api/documents', {
    type: 'receipt', client: { name: 'Receipt Co' }, items: [{ name: 'Cash sale', qty: 2, rate: 250, tax_rate: 0 }],
  })).body;
  assert.equal(receipt.status, 'paid');
  assert.equal(receipt.amount_paid, 500);
  assert.equal(receipt.due_date, null);

  assert.equal((await call('POST', `/api/documents/${receipt.id}/paid`, {})).status, 400);
  assert.equal((await call('POST', `/api/documents/${receipt.id}/unpaid`, {})).status, 400);
  assert.equal((await call('POST', `/api/documents/${receipt.id}/payments`, { amount: 10 })).status, 400);
  const still = (await call('GET', `/api/documents/${receipt.id}`)).body;
  assert.equal(still.status, 'paid');
  assert.equal(still.amount_paid, 500, 'payment actions must not wipe a receipt');
});

test('a void document stays void and locked', async () => {
  const doc = await invoice('Void Co', 700);
  await share(doc.id);
  assert.equal((await call('POST', `/api/documents/${doc.id}/status`, { status: 'void' })).status, 200);
  assert.equal((await call('POST', `/api/documents/${doc.id}/status`, { status: 'bogus' })).status, 400);

  assert.equal((await share(doc.id)).status, 409, 'sharing a void bill must not bring it back');
  assert.equal((await call('PUT', `/api/documents/${doc.id}`, { items: [] })).status, 409);
  assert.equal((await call('POST', `/api/documents/${doc.id}/payments`, { amount: 700 })).status, 409);
  assert.equal((await call('POST', `/api/documents/${doc.id}/paid`, {})).status, 409);
  assert.equal((await call('POST', `/api/public/${doc.token}/claim`, {}, { auth: false })).status, 409);
  assert.equal((await call('GET', `/api/documents/${doc.id}`)).body.status, 'void');
});

test('deleting the only payment reopens the bill as viewed', async () => {
  const doc = await invoice('Refund Co', 1200);
  await share(doc.id);
  await call('GET', `/api/public/${doc.token}`, null, { auth: false });
  assert.equal((await call('POST', `/api/documents/${doc.id}/payments`, { amount: 0 })).status, 400);
  const paid = (await call('POST', `/api/documents/${doc.id}/payments`, { amount: 1200, method: 'Cash' })).body;
  assert.equal(paid.status, 'paid');

  const removed = await call('DELETE', `/api/documents/payments/${paid.payments[0].id}`);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.status, 'viewed');
  assert.equal(removed.body.amount_paid, 0);
  assert.equal(removed.body.paid_at, null);
  assert.equal((await call('DELETE', `/api/documents/payments/${paid.payments[0].id}`)).status, 404);
});

test('the client view marks a bill viewed and shows part payment', async () => {
  const doc = await invoice('Viewer Co', 1000);
  await share(doc.id);
  await call('POST', `/api/documents/${doc.id}/payments`, { amount: 250 });
  const pub = (await call('GET', `/api/public/${doc.token}`, null, { auth: false })).body;
  assert.equal(pub.isOwner, false);
  assert.equal(pub.document.balance, 750);
  assert.equal(pub.document.display_status, 'partial');
  assert.equal(pub.document.client_id, undefined);
  const owner = (await call('GET', `/api/documents/${doc.id}`)).body;
  assert.ok(owner.viewed_at);
  assert.ok(owner.activity.some((a) => a.kind === 'viewed'));
});

test('a zero-total bill can be marked paid and unpaid', async () => {
  const doc = await invoice('Freebie Co', 0, { items: [{ name: 'Free consult', qty: 1, rate: 0 }] });
  assert.equal(doc.total, 0);
  await share(doc.id);
  assert.equal((await call('POST', `/api/documents/${doc.id}/paid`, {})).body.status, 'paid');
  assert.equal((await call('GET', `/api/documents/${doc.id}`)).body.status, 'paid');
  assert.equal((await call('POST', `/api/documents/${doc.id}/unpaid`, {})).body.status, 'sent');
});

test('editing the total of a paid bill reopens it with the balance due', async () => {
  const doc = await invoice('Edit Co', 1000);
  await share(doc.id);
  await call('GET', `/api/public/${doc.token}`, null, { auth: false });
  await call('POST', `/api/documents/${doc.id}/paid`, {});
  const edited = await call('PUT', `/api/documents/${doc.id}`, {
    client: { name: 'Edit Co' }, items: [{ name: 'Work', qty: 1, rate: 1500, tax_rate: 0 }],
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.status, 'viewed');
  assert.equal(edited.body.balance, 500);
});

test('a refused payment proof leaves no screenshot behind', async () => {
  const quote = (await call('POST', '/api/documents', {
    type: 'quote', client: { name: 'Orphan Co' }, items: [{ name: 'X', qty: 1, rate: 100 }],
  })).body;
  const uploads = path.join(dataDir, 'uploads');
  const before = fs.readdirSync(uploads).length;
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const res = await call('POST', '/api/confirmations', { document_id: quote.id, amount: 100, record_payment: true, image: png });
  assert.equal(res.status, 400);
  assert.equal(fs.readdirSync(uploads).length, before);
  assert.equal((await call('GET', `/api/confirmations?document=${quote.id}`)).body.length, 0);
});

test('the SMTP password is write-only', async () => {
  await call('PUT', '/api/settings', { email: { host: 'smtp.test', fromEmail: 'me@test.io', pass: 'hunter2' } });
  const first = (await call('GET', '/api/settings')).body;
  assert.equal(first.email.pass, '');
  assert.equal(first.email.passSet, true);
  assert.equal(first.meta.emailReady, true);

  await call('PUT', '/api/settings', { email: { host: 'smtp2.test', pass: '' } });
  assert.equal((await call('GET', '/api/settings')).body.email.passSet, true, 'a blank password keeps the saved one');

  const dump = await call('GET', '/api/export');
  assert.equal(dump.status, 200);
  assert.ok(!JSON.stringify(dump.body).includes('hunter2'));
  assert.ok(dump.body.documents.length > 0);
});

test('documents list filters by type, status and search', async () => {
  const quotes = (await call('GET', '/api/documents?type=quote')).body;
  assert.ok(quotes.length > 0 && quotes.every((d) => d.type === 'quote'));
  const voided = (await call('GET', '/api/documents?status=void')).body;
  assert.ok(voided.length > 0 && voided.every((d) => d.display_status === 'void'));
  const found = (await call('GET', '/api/documents?q=Bluebird')).body;
  assert.ok(found.some((d) => d.client.name === 'Bluebird Cafe'));
  assert.equal(found[0].items, undefined, 'the list stays light');
  assert.match((await call('GET', '/api/documents/next-number?type=receipt')).body.number, /^RC-\d{4}-\d{4}$/);
});

test('dashboard adds up outstanding and collected money', async () => {
  const dash = (await call('GET', '/api/dashboard')).body;
  assert.ok(dash.outstanding >= 750);
  assert.ok(dash.collectedThisMonth > 0);
  assert.equal(dash.months.length, 6);
  assert.ok(dash.activity.length > 0);
});

test('setup cannot run twice', async () => {
  assert.equal((await call('POST', '/api/auth/setup', { password: 'another123' })).status, 409);
});

// Session tests run last because they swap the shared cookie.
test('sign out, wrong password, sign in and change password', async () => {
  const oldCookie = cookie;
  assert.equal((await call('POST', '/api/auth/logout', {})).status, 200);
  assert.equal((await call('GET', '/api/documents', null, { auth: false })).status, 401);
  cookie = oldCookie;
  assert.equal((await call('GET', '/api/documents')).status, 401, 'the old session is gone on the server too');

  assert.equal((await call('POST', '/api/auth/login', { password: 'wrong-one' }, { auth: false })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { password: 'secret123' }, { auth: false })).status, 200);
  const status = (await call('GET', '/api/auth/status')).body;
  assert.deepEqual([status.setup, status.authed], [true, true]);

  assert.equal((await call('POST', '/api/auth/password', { current: 'nope', next: 'newpass123' })).status, 401);
  assert.equal((await call('POST', '/api/auth/password', { current: 'secret123', next: '123' })).status, 400);
  const before = cookie;
  assert.equal((await call('POST', '/api/auth/password', { current: 'secret123', next: 'newpass123' })).status, 200);
  assert.notEqual(cookie, before);
  assert.equal((await call('GET', '/api/documents')).status, 200);
  assert.equal((await call('POST', '/api/auth/login', { password: 'secret123' }, { auth: false })).status, 401);
});

test('too many sign-in attempts are rate limited', async () => {
  let last;
  for (let i = 0; i < 12; i += 1) last = await call('POST', '/api/auth/login', { password: 'guess' }, { auth: false });
  assert.equal(last.status, 429);
});
