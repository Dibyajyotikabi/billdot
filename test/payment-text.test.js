import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parsePaymentText } from '../public/js/shared/payment-text.js';
import { decodeScreenshot, extractPaymentScreenshot } from '../server/payment-screenshot.js';
import { proofCardHtml } from '../public/js/shared/proof-html.js';
import { visibleProof, proofVisibility, proofParties, proofIconStyle } from '../public/js/shared/proof-details.js';
import { FONT_OPTIONS, fontTheme, applyAppearance } from '../public/js/shared/appearance.js';
import { proofFileName } from '../public/js/shared/proof-card.js';

test('reads labelled UPI fields without confusing recipient and payer', () => {
  assert.deepEqual(parsePaymentText('Payment successful\n₹2,500.50\nTo Studio\nReceived from\nAsha Sharma\n02 Oct 2026, 10:30 AM\nUPI transaction ID\n612345678901'), {
    amount: 2500.5, reference: '612345678901', paid_on: '2026-10-02', payer: 'Asha Sharma', receiver: 'Studio', method: 'UPI',
  });
});

test('ignores ambiguous amounts, impossible dates and app transaction IDs', () => {
  const fields = parsePaymentText('₹500\n₹750\n31/02/2026\nTo Asha Sharma\nTransaction ID T260000123456789');
  assert.deepEqual(fields, { receiver: 'Asha Sharma' });
});

test('reads numeric dates, labelled amount, bank method and bank reference', () => {
  assert.deepEqual(parsePaymentText('Amount paid: INR 1,200.00\nPaid by: Bluebird Cafe\nDate: 02/10/2026\nIMPS\nBank reference: 612345678901'), {
    amount: 1200, payer: 'Bluebird Cafe', paid_on: '2026-10-02', method: 'Bank transfer', reference: '612345678901',
  });
});

test('does not substitute an account or UPI address for payer', () => {
  assert.equal(parsePaymentText('From\nAccount 12345678\nUPI').payer, undefined);
  assert.equal(parsePaymentText('From: asha@upi').payer, undefined);
});

test('reads decorative CRED receipts with payer-paid wording and TXN ID', () => {
  assert.deepEqual(parsePaymentText('Asha Sharma paid\nTest Studio\n₺3,500\npaid securely by\nCRED\npowered by UPI\n2 OCT 2026, 9:58AM | TXN ID: 664101799190'), {
    amount: 3500, reference: '664101799190', paid_on: '2026-10-02', payer: 'Asha Sharma', receiver: 'Test Studio', method: 'UPI',
  });
});

test('reads Hindi numerals, Indian amount grouping and reference variants', () => {
  assert.deepEqual(parsePaymentText('राशि: ₹१,२३,४५६.७८\nप्रेषक: आशा शर्मा\n०२/१०/२०२६\nयूपीआई\nUTR / Reference Number: ६१२३४५६७८९०१'), {
    amount: 123456.78, reference: '612345678901', paid_on: '2026-10-02', payer: 'आशा शर्मा', method: 'UPI',
  });
  assert.equal(parsePaymentText('Amount: ₹1,2').amount, undefined);
  assert.equal(parsePaymentText('UPI Ref No: 612345678901').reference, '612345678901');
});

test('rejects invalid, mismatched and oversized screenshot data', () => {
  assert.throws(() => decodeScreenshot('data:image/png;base64,AAAA'), /valid image/);
  assert.throws(() => decodeScreenshot('https://example.test/screenshot.png'), /JPG, PNG or WebP/);
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  assert.throws(() => decodeScreenshot(`data:image/jpeg;base64,${png}`), /valid image/);
  const bytes = Buffer.from(png, 'base64');
  bytes.writeUInt32BE(100000, 16);
  bytes.writeUInt32BE(100000, 20);
  assert.throws(() => decodeScreenshot(`data:image/png;base64,${bytes.toString('base64')}`), /16 megapixels/);
});

test('proof attachment appears only when an image source is explicitly supplied', () => {
  const c = { amount: 100, currency: 'INR', paid_on: '2026-10-02', method: 'UPI', has_image: true };
  assert.doesNotMatch(proofCardHtml(c), /proof-attachment/);
  assert.match(proofCardHtml({ ...c, image_src: '/api/confirmations/1/image' }), /Payment evidence/);
});

test('sender and receiver stay distinct for inline, labelled and missing-name receipts', () => {
  const names = parsePaymentText('Asha Sharma paid to Test Studio\n₹3500\nUPI');
  assert.equal(names.payer, 'Asha Sharma');
  assert.equal(names.receiver, 'Test Studio');
  assert.equal(parsePaymentText('To: Test Studio\n₹3500').payer, undefined);
  assert.equal(parsePaymentText('Asha Sharma paid\n₹3500\nUPI').receiver, undefined);
  assert.equal(parsePaymentText('Receiver: studio@upi').receiver, undefined);
});

test('hidden proof details are removed from rendering and public data', () => {
  const c = { amount: 3500, currency: 'INR', payer: 'Hidden Sender', receiver: 'Hidden Receiver', reference: 'HIDDEN123456',
    paid_on: '2026-10-02', method: 'UPI', note: 'Hidden note', document: { number: 'INV-HIDDEN' },
    visibility: Object.fromEntries(Object.keys(proofVisibility()).map((k) => [k, false])) };
  const html = proofCardHtml(c);
  for (const text of ['Hidden Sender', 'Hidden Receiver', 'HIDDEN123456', 'Hidden note', 'INV-HIDDEN', '3,500']) assert.ok(!html.includes(text));
  const shared = JSON.stringify(visibleProof(c));
  for (const text of ['Hidden Sender', 'Hidden Receiver', 'HIDDEN123456', 'Hidden note', 'INV-HIDDEN']) assert.ok(!shared.includes(text));
  assert.equal(proofFileName(c), 'payment-sent.png');
});

test('sent proofs lead with to and received proofs lead with from, with selectable icons', () => {
  const c = { amount: 3500, currency: 'INR', payer: 'Sender', receiver: 'Receiver' };
  const sent = proofCardHtml(c);
  assert.match(sent, /Payment sent/);
  assert.ok(sent.indexOf('to Receiver') < sent.indexOf('from Sender'));
  const received = proofCardHtml({ ...c, direction: 'received' });
  assert.match(received, /Payment received/);
  assert.ok(received.indexOf('from Sender') < received.indexOf('to Receiver'));
  assert.deepEqual(proofParties({ ...c, direction: 'sent' }), [['to', 'Receiver'], ['from', 'Sender']]);
  for (const icon of ['arrow', 'check', 'seal']) assert.match(proofCardHtml({ ...c, icon_style: icon }), new RegExp(`proof-symbol--${icon}`));
  assert.match(proofCardHtml({ ...c, icon_style: 'seal' }), /<circle/);
  assert.match(proofCardHtml({ ...c, icon_style: 'dots' }), /proof-check/);
  assert.equal(proofIconStyle('__proto__'), 'arrow');
});

test('Notion uses minimal typography while preserving selectable fonts', () => {
  const root = { dataset: {}, style: { setProperty(key, value) { this[key] = value; } } };
  applyAppearance({ appearance: { style: 'notion', font: 'original' } }, root);
  assert.equal(root.dataset.style, 'notion');
  assert.equal(root.style['--dot'], fontTheme('system').display);
  applyAppearance({ appearance: { style: 'notion', font: 'serif' } }, root);
  assert.equal(root.style['--font'], fontTheme('serif').body);
  applyAppearance({ appearance: { style: 'invalid' } }, root);
  assert.equal(root.dataset.style, 'billdot');
});

test('every selectable font covers body, detail and display and invalid fonts fall back', () => {
  for (const id of Object.keys(FONT_OPTIONS)) {
    const f = fontTheme(id);
    assert.ok(f.body && f.detail && f.display);
  }
  assert.deepEqual(fontTheme('__proto__'), fontTheme('original'));
  assert.equal(fontTheme('serif').display, 'Georgia, "Times New Roman", serif');
});

test('local OCR extracts a real screenshot and bounds concurrent work', async () => {
  const image = `data:image/jpeg;base64,${fs.readFileSync(new URL('./fixtures/payment-screenshot.jpg', import.meta.url)).toString('base64')}`;
  const reading = extractPaymentScreenshot(image);
  await assert.rejects(extractPaymentScreenshot(image), (err) => err.status === 429);
  const result = await reading;
  assert.deepEqual(result.fields, {
    amount: 2500.5, reference: '612345678901', paid_on: '2026-10-02', payer: 'Asha Sharma', method: 'UPI',
  });
  assert.equal(result.needs_review, true);
});

test('reads PhonePe receipts when OCR drops or misreads the rupee sign', () => {
  const text = 'Transaction Successful\n12:07 PM on 01 Oct 2026\nPaid to\nDIGBIJAY LENKA %17,100\n******5371\nBanking name: DIGBIJAY LENKA\n'
    + 'Message: Sand for kabi babu\nPhonePe Transaction ID\nT2610011207475937464945\nDebited from\nXXXXXX5510\n17,100\nUTR: 387273820823';
  assert.deepEqual(parsePaymentText(text), {
    amount: 17100, reference: '387273820823', paid_on: '2026-10-01', receiver: 'DIGBIJAY LENKA', method: 'UPI',
  });
  assert.equal(parsePaymentText('Paid to\n17,100\nBanking name: DIGBIJAY LENKA').receiver, 'DIGBIJAY LENKA');
  assert.equal(parsePaymentText('Paid to\n217,100\n17,100').amount, undefined);
});

test('reads dark bank receipts with a date pill and stray OCR marks', () => {
  const text = 'SEVEN SEAS SANITARY\n%50,000 ~\nRequest Accepted\n& Sep 30,2026\nPaid To: SEVEN SEAS SANITARY\nCurrent A/c: 541701010050039\n'
    + 'Paid By : DIBYAJYOTI| KABI\nBank Transfer | IMPS\nHDFC Transaction ID\nHDFCD79BE3D7E8AA\nReference Number\n627344932215';
  assert.deepEqual(parsePaymentText(text), {
    amount: 50000, reference: '627344932215', paid_on: '2026-09-30', payer: 'DIBYAJYOTI KABI', receiver: 'SEVEN SEAS SANITARY', method: 'Bank transfer',
  });
});
