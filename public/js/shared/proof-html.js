// The on-screen version of the payment post. Same layout as the PNG from proof-card.js.
import { escapeHtml as esc, formatMoney, formatDate } from './format.js';
import { CHECK } from './proof-card.js';

const checkDots = () => CHECK.join('').split('')
  .map((on, i) => `<i class="${on === '1' ? 'on' : ''}" style="--i:${i}"></i>`).join('');

export function proofCardHtml(c, business = {}, locale = 'en-IN') {
  const rows = [
    ['Date', formatDate(c.paid_on, locale)],
    ['Method', c.method],
    c.reference && ['UTR / Ref', c.reference],
    c.document?.number && ['For', c.document.number],
  ].filter(Boolean);
  const amount = formatMoney(c.amount, c.currency, locale);
  // Doto glyphs are about 0.62em wide; shrink long amounts so they stay on one line.
  const size = Math.min(17, 130 / amount.length).toFixed(2);
  return `<div class="proof-box"><article class="proof" aria-label="Payment received">
    <header class="proof-head">
      ${business.logo ? `<span class="proof-logo"><img src="${esc(business.logo)}" alt=""></span>` : ''}
      <span class="proof-biz">${esc(business.name || '')}</span>
      <span class="proof-rec" aria-hidden="true"></span>
    </header>
    <div class="proof-label"><span class="proof-led" aria-hidden="true"></span>Payment received</div>
    <div class="proof-amount" style="font-size:${size}cqw">${esc(amount)}</div>
    ${c.payer ? `<div class="proof-payer">from ${esc(c.payer)}</div>` : ''}
    <dl class="proof-rows">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    ${c.note ? `<p class="proof-note">${esc(c.note)}</p>` : ''}
    <footer class="proof-foot">
      <span class="proof-check" aria-hidden="true">${checkDots()}</span>
      <span class="proof-thanks">Thank you</span>
    </footer>
  </article></div>`;
}
