import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, escapeHtml, formatDate, formatMoney, multiline } from '../public/js/shared/format.js';

test('addDays crosses month, year and leap day boundaries', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-12-25', 14), '2027-01-08');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-03-10', -10), '2026-02-28');
  assert.equal(addDays('2026-03-10'), '2026-03-10');
});

test('escapeHtml neutralises markup and multiline keeps line breaks', () => {
  assert.equal(escapeHtml(`<img src=x onerror="a('b')">&`), '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
  assert.equal(escapeHtml(null), '');
  assert.equal(multiline('Line <1>\nLine 2'), 'Line &lt;1&gt;<br>Line 2');
});

test('formatMoney uses the locale and survives a bad currency code', () => {
  assert.match(formatMoney(150000, 'INR', 'en-IN'), /1,50,000\.00/);
  assert.match(formatMoney(150000, 'USD', 'en-US'), /\$150,000\.00/);
  assert.equal(formatMoney(12.5, 'US', 'en-US'), '12.50', 'a malformed code falls back to a plain number');
  assert.match(formatMoney('junk', 'INR', 'en-IN'), /0\.00/);
});

test('formatDate returns an empty string for missing or bad dates', () => {
  assert.equal(formatDate(''), '');
  assert.equal(formatDate('not-a-date'), '');
  assert.match(formatDate('2026-10-02', 'en-IN'), /02 Oct 2026/);
});
