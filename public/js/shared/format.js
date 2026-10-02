// Formatting helpers that work the same in Node and the browser.

const formatters = new Map();

export function formatMoney(amount, currency = 'INR', locale = 'en-IN') {
  const key = `${locale}|${currency}`;
  if (!formatters.has(key)) {
    try {
      formatters.set(key, new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2 }));
    } catch {
      formatters.set(key, new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    }
  }
  return formatters.get(key).format(Number(amount) || 0);
}

export function formatNumber(n, locale = 'en-IN') {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(Number(n) || 0);
}

export function formatDate(iso, locale = 'en-IN') {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const multiline = (value) => escapeHtml(value).replace(/\n/g, '<br>');

export function localToday() {
  return new Date().toLocaleDateString('en-CA');
}

export function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + Number(days || 0));
  return d.toLocaleDateString('en-CA');
}
