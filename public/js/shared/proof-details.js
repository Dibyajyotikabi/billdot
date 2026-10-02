export const PROOF_FIELDS = {
  amount: 'Amount', payer: 'Sender name', receiver: 'Receiver name', reference: 'Transaction ID / UTR',
  paid_on: 'Payment date', method: 'Payment method', document: 'Linked bill', note: 'Note',
};

export const PROOF_ICONS = { arrow: 'Direction arrow', check: 'Simple check', seal: 'Circle check', dots: 'Dot matrix' };
export const proofDirection = (c) => c.direction === 'received' ? 'received' : 'sent';
export const proofIconStyle = (value) => Object.hasOwn(PROOF_ICONS, value) ? value : 'arrow';
export const proofLabel = (c) => proofDirection(c) === 'sent' ? 'Payment sent' : 'Payment received';
export const proofParties = (c) => proofDirection(c) === 'sent'
  ? [['to', c.receiver], ['from', c.payer]] : [['from', c.payer], ['to', c.receiver]];

export function proofIconSvg(c) {
  const style = proofIconStyle(c.icon_style);
  const path = style === 'arrow' ? (proofDirection(c) === 'sent' ? 'M7 17 17 7M7 7h10v10' : 'M17 7 7 17M7 7v10h10') : 'm6 12 4 4 8-8';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${style === 'seal' ? '<circle cx="12" cy="12" r="10"></circle>' : ''}<path d="${path}"></path></svg>`;
}

export function proofVisibility(input = {}) {
  return Object.fromEntries(Object.keys(PROOF_FIELDS).map((key) => [key, input?.[key] !== false]));
}

// Used by both renderers and the public API so hidden values are not shared.
export function visibleProof(c) {
  const visibility = proofVisibility(c.visibility);
  return { ...c, visibility, ...Object.fromEntries(Object.keys(PROOF_FIELDS)
    .filter((key) => !visibility[key]).map((key) => [key, undefined])) };
}
