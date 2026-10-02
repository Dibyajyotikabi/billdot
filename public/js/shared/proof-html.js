// The on-screen version of the payment post. Same layout as the PNG from proof-card.js.
import { escapeHtml as esc, formatMoney, formatDate } from './format.js';
import { CHECK } from './proof-card.js';
import { visibleProof, proofLabel, proofDirection, proofParties, proofIconStyle, proofIconSvg } from './proof-details.js';

const checkDots = () => CHECK.join('').split('')
  .map((on, i) => `<i class="${on === '1' ? 'on' : ''}" style="--i:${i}"></i>`).join('');

export function proofCardHtml(c, business = {}, locale = 'en-IN') {
  c = visibleProof(c);
  const rows = [
    c.paid_on && ['Date', formatDate(c.paid_on, locale)],
    c.method && ['Method', c.method],
    c.reference && ['UTR / Ref', c.reference],
    c.document?.number && ['For', c.document.number],
  ].filter(Boolean);
  const amount = formatMoney(c.amount, c.currency, locale);
  // Doto glyphs are about 0.62em wide; shrink long amounts so they stay on one line.
  const size = Math.min(17, 130 / amount.length).toFixed(2);
  const label = proofLabel(c);
  const icon = proofIconStyle(c.icon_style);
  return `<div class="proof-box"><article class="proof" aria-label="${label}">
    <header class="proof-head">
      ${business.logo ? `<span class="proof-logo"><img src="${esc(business.logo)}" alt=""></span>` : ''}
      <span class="proof-biz">${esc(business.name || '')}</span>
      <span class="proof-rec" aria-hidden="true"></span>
    </header>
    <div class="proof-label"><span class="proof-led" aria-hidden="true"></span>${label}</div>
    ${c.amount !== undefined ? `<div class="proof-amount" style="font-size:${size}cqw;--amount-size:${size}cqw">${esc(amount)}</div>` : ''}
    ${proofParties(c).filter(([, name]) => name).map(([prefix, name]) => `<div class="proof-payer">${prefix} ${esc(name)}</div>`).join('')}
    <dl class="proof-rows">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    ${c.note ? `<p class="proof-note">${esc(c.note)}</p>` : ''}
    <footer class="proof-foot">
      ${icon === 'dots' ? `<span class="proof-check" aria-hidden="true">${checkDots()}</span>` : `<span class="proof-symbol proof-symbol--${icon}" aria-hidden="true">${proofIconSvg(c)}</span>`}
      <span class="proof-thanks">${proofDirection(c) === 'sent' ? 'Payment confirmation' : 'Thank you'}</span>
    </footer>
  </article>${c.image_src ? `<figure class="proof-attachment">
    <figcaption><span class="proof-attachment-mark" aria-hidden="true">✓</span><span>Payment evidence<small>Attached payment screenshot</small></span></figcaption>
    <a href="${esc(c.image_src)}" target="_blank" rel="noopener"><img src="${esc(c.image_src)}" alt="Attached payment screenshot" decoding="async"></a>
  </figure>` : ''}</div>`;
}
