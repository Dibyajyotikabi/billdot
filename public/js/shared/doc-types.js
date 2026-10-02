// Document types and paper formats shared by the server and the browser.

export const DOC_TYPES = {
  invoice: { label: 'Invoice', title: 'Invoice', party: 'Bill to', dateLabel: 'Due', payable: true },
  quote: { label: 'Quotation', title: 'Quotation', party: 'Prepared for', dateLabel: 'Valid until', respondable: true },
  proforma: { label: 'Proforma invoice', title: 'Proforma', party: 'Bill to', dateLabel: 'Due', payable: true },
  receipt: { label: 'Receipt', title: 'Receipt', party: 'Received from', dateLabel: null, paidOnSave: true },
  credit_note: { label: 'Credit note', title: 'Credit note', party: 'Credit to', dateLabel: null },
  delivery_note: { label: 'Delivery note', title: 'Delivery', party: 'Deliver to', dateLabel: null, hidePrices: true },
};

export const FORMATS = {
  a4: { label: 'A4', hint: 'Standard invoice' },
  letter: { label: 'US Letter', hint: 'North America' },
  a5: { label: 'A5', hint: 'Small bill' },
  thermal80: { label: 'Thermal 80mm', hint: 'Receipt printer' },
  thermal58: { label: 'Thermal 58mm', hint: 'Mini receipt' },
};

export const STATUS_LABELS = {
  draft: 'Draft',
  sent: 'Sent',
  viewed: 'Viewed',
  claimed: 'Payment claimed',
  partial: 'Partly paid',
  paid: 'Paid',
  overdue: 'Overdue',
  accepted: 'Accepted',
  declined: 'Declined',
  void: 'Void',
};

export const PAYMENT_METHODS = ['Bank transfer', 'UPI', 'Cash', 'Card', 'Cheque', 'PayPal', 'Stripe', 'Other'];

export const isThermal = (format) => format === 'thermal80' || format === 'thermal58';

// Status shown to people. Stored status covers the lifecycle; overdue and
// partial are derived from dates and payments so they never go stale.
export function effectiveStatus(doc, today) {
  const stored = doc.status;
  if (['draft', 'void', 'accepted', 'declined'].includes(stored)) return stored;
  const total = Number(doc.total) || 0;
  const paid = Number(doc.amount_paid) || 0;
  if (stored === 'paid' || (total > 0 && paid >= total)) return 'paid';
  if (!DOC_TYPES[doc.type]?.payable) return stored;
  if (stored === 'claimed') return 'claimed';
  if (doc.due_date && today && doc.due_date < today) return 'overdue';
  if (paid > 0) return 'partial';
  return stored;
}
