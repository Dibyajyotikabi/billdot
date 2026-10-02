import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTotals, balanceDue, round2 } from '../public/js/shared/calc.js';
import { effectiveStatus } from '../public/js/shared/doc-types.js';
import { amountInWords } from '../public/js/shared/words.js';

test('computeTotals adds line amounts and tax per rate', () => {
  const t = computeTotals({
    items: [
      { qty: 1, rate: 18000, tax_rate: 18 },
      { qty: 8, rate: 2500, tax_rate: 18 },
      { qty: 2, rate: 1000, tax_rate: 5 },
    ],
  });
  assert.equal(t.subtotal, 40000);
  assert.deepEqual(t.taxGroups, [
    { rate: 5, taxable: 2000, tax: 100 },
    { rate: 18, taxable: 38000, tax: 6840 },
  ]);
  assert.equal(t.total, 46940);
});

test('percent discount reduces the taxable base', () => {
  const t = computeTotals({ items: [{ qty: 1, rate: 1000, tax_rate: 10 }], discount_type: 'percent', discount_value: 10 });
  assert.equal(t.discount, 100);
  assert.equal(t.tax_total, 90);
  assert.equal(t.total, 990);
});

test('discount never exceeds the subtotal and bad input counts as zero', () => {
  const t = computeTotals({ items: [{ qty: 'x', rate: 500 }, { qty: 1, rate: 200 }], discount_value: 9999, shipping: -5 });
  assert.equal(t.subtotal, 200);
  assert.equal(t.discount, 200);
  assert.equal(t.shipping, 0);
  assert.equal(t.total, 0);
});

test('round2 handles float noise and balanceDue never goes negative', () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(balanceDue({ total: 100, amount_paid: 40 }), 60);
  assert.equal(balanceDue({ total: 100, amount_paid: 150 }), 0);
});

test('effectiveStatus derives overdue, partial, paid and claimed', () => {
  const base = { type: 'invoice', status: 'sent', total: 100, amount_paid: 0, due_date: '2026-10-10' };
  assert.equal(effectiveStatus(base, '2026-10-01'), 'sent');
  assert.equal(effectiveStatus(base, '2026-10-11'), 'overdue');
  assert.equal(effectiveStatus({ ...base, amount_paid: 30 }, '2026-10-01'), 'partial');
  assert.equal(effectiveStatus({ ...base, amount_paid: 100 }, '2026-10-11'), 'paid');
  assert.equal(effectiveStatus({ ...base, status: 'claimed' }, '2026-10-11'), 'claimed');
  assert.equal(effectiveStatus({ ...base, status: 'draft' }, '2026-10-11'), 'draft');
});

test('amountInWords uses the Indian system for INR', () => {
  const words = amountInWords(44840, 'INR');
  assert.match(words, /Forty Four Thousand Eight Hundred Forty/);
  assert.match(amountInWords(150000, 'INR'), /One Lakh Fifty Thousand/);
});

test('shipping is added after tax and zero-rate lines carry no tax group', () => {
  const t = computeTotals({ items: [{ qty: 2, rate: 500, tax_rate: 0 }, { qty: 1, rate: 1000, tax_rate: 12 }], shipping: 150 });
  assert.equal(t.subtotal, 2000);
  assert.deepEqual(t.taxGroups, [{ rate: 12, taxable: 1000, tax: 120 }]);
  assert.equal(t.total, 2270);
});

test('amount discount is spread across tax groups by share of subtotal', () => {
  const t = computeTotals({
    items: [{ qty: 1, rate: 3000, tax_rate: 18 }, { qty: 1, rate: 1000, tax_rate: 5 }],
    discount_type: 'amount',
    discount_value: 400,
  });
  assert.equal(t.discount, 400);
  assert.deepEqual(t.taxGroups, [{ rate: 5, taxable: 900, tax: 45 }, { rate: 18, taxable: 2700, tax: 486 }]);
  assert.equal(t.total, 4131);
});

test('an empty document totals zero without dividing by zero', () => {
  const t = computeTotals({ discount_type: 'percent', discount_value: 50 });
  assert.equal(t.subtotal, 0);
  assert.equal(t.discount, 0);
  assert.equal(t.total, 0);
});

test('effectiveStatus keeps final states and skips overdue for non-bills', () => {
  const quote = { type: 'quote', status: 'sent', total: 100, amount_paid: 0, due_date: '2026-01-01' };
  assert.equal(effectiveStatus(quote, '2026-10-01'), 'sent', 'an expired quote is not overdue');
  assert.equal(effectiveStatus({ ...quote, status: 'accepted' }, '2026-10-01'), 'accepted');
  const invoice = { type: 'invoice', status: 'void', total: 100, amount_paid: 100 };
  assert.equal(effectiveStatus(invoice, '2026-10-01'), 'void', 'void wins over paid');
  assert.equal(effectiveStatus({ ...invoice, status: 'sent', due_date: '2026-09-01', amount_paid: 20 }, '2026-10-01'), 'overdue');
});

test('amountInWords handles zero, paise and the western system', () => {
  assert.equal(amountInWords(0, 'INR'), 'Zero Rupees Only');
  assert.equal(amountInWords(10.5, 'INR'), 'Ten Rupees and Fifty Paise Only');
  assert.equal(amountInWords(25000000, 'INR'), 'Two Crore Fifty Lakh Rupees Only');
  assert.equal(amountInWords(2500000, 'USD'), 'Two Million Five Hundred Thousand Dollars Only');
  assert.equal(amountInWords(1.99, 'JPY'), 'One JPY and Ninety Nine Cents Only');
});
