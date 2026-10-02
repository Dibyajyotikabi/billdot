// Totals math. The server recomputes with this on every save so stored
// figures always match what the browser previewed.

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export const round2 = (n) => Math.round((num(n) + Number.EPSILON) * 100) / 100;

export function computeTotals(doc) {
  const items = (doc.items || []).map((it) => ({
    ...it,
    amount: round2(num(it.qty) * num(it.rate)),
  }));
  const subtotal = round2(items.reduce((s, it) => s + it.amount, 0));
  const rawDiscount = doc.discount_type === 'percent'
    ? (subtotal * num(doc.discount_value)) / 100
    : num(doc.discount_value);
  const discount = round2(Math.min(Math.max(rawDiscount, 0), subtotal));
  const ratio = subtotal > 0 ? (subtotal - discount) / subtotal : 0;

  const groups = new Map();
  for (const it of items) {
    const rate = num(it.tax_rate);
    if (rate <= 0) continue;
    const taxable = it.amount * ratio;
    const g = groups.get(rate) || { rate, taxable: 0, tax: 0 };
    g.taxable += taxable;
    g.tax += (taxable * rate) / 100;
    groups.set(rate, g);
  }
  const taxGroups = [...groups.values()]
    .sort((a, b) => a.rate - b.rate)
    .map((g) => ({ rate: g.rate, taxable: round2(g.taxable), tax: round2(g.tax) }));
  const tax_total = round2(taxGroups.reduce((s, g) => s + g.tax, 0));
  const shipping = round2(Math.max(num(doc.shipping), 0));
  const total = round2(subtotal - discount + tax_total + shipping);

  return { items, subtotal, discount, taxGroups, tax_total, shipping, total };
}

export function balanceDue(doc) {
  return round2(Math.max(num(doc.total) - num(doc.amount_paid), 0));
}
