import { get } from './api.js';
import { icons } from './icons.js';
import { $, esc, store, money, toast, toastError, copyText } from './ui.js';
import { DOC_TYPES } from './shared/doc-types.js';
import { proofCardHtml } from './shared/proof-html.js';
import { downloadProofCard, shareProofCard } from './shared/proof-card.js';
import { applyAppearance } from './shared/appearance.js';
import { proofLabel, proofDirection } from './shared/proof-details.js';

const root = $('#pub');
const token = location.pathname.split('/').filter(Boolean).pop();
const api = `/public/c/${encodeURIComponent(token)}`;

function paint({ confirmation: c, settings, isOwner }) {
  c.image_src = c.has_image ? `/api${api}/image` : null;
  const biz = settings.business;
  const locale = settings.documents.locale;
  document.title = `${proofLabel(c)}${c.amount !== undefined ? ` · ${money(c.amount, c.currency)}` : ''}`;
  root.innerHTML = `<div class="paid-wrap">
    ${isOwner ? '<div class="pub-owner"><span>This is your shared payment proof.</span><a href="/#/payments">Back to app</a></div>' : ''}
    ${proofCardHtml(c, biz, locale)}
    <div class="paid-actions">
      <button class="btn btn--primary" type="button" data-act="share">${icons.share}<span>Share</span></button>
      <button class="btn" type="button" data-act="download">${icons.download}<span>Save image</span></button>
      <button class="btn" type="button" data-act="copy">${icons.link}<span>Copy link</span></button>
    </div>
    ${c.document ? `<a class="paid-doc" href="/d/${encodeURIComponent(c.document.token)}">
      <span><span class="label">${esc(DOC_TYPES[c.document.type]?.label || 'Bill')}</span><br><span class="mono strong">${esc(c.document.number)}</span></span>
      <span class="btn btn--ghost btn--sm">${icons.globe}<span>View bill</span></span></a>` : ''}
    <footer class="pub-foot">
      ${biz.email ? `Questions? <a href="mailto:${esc(biz.email)}">${esc(biz.email)}</a>` : ''}
      ${biz.phone ? ` · <a href="tel:${esc(biz.phone)}">${esc(biz.phone)}</a>` : ''}
    </footer>
  </div>`;
}

async function start() {
  let data;
  try {
    data = await get(api);
    store.settings = data.settings;
    applyAppearance(data.settings);
    paint(data);
  } catch (err) {
    root.innerHTML = `<div class="pub-missing"><span class="label">Error ${esc(err.status || '')}</span>
      <h1 class="pub-amount">Not found</h1><p class="muted">This link is not valid anymore. Ask the sender for a new one.</p></div>`;
    return;
  }
  const card = { confirmation: data.confirmation, business: data.settings.business, locale: data.settings.documents.locale,
    font: data.settings.appearance?.font, style: data.settings.appearance?.style };
  root.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    try {
      if (act === 'copy') {
        await copyText(location.href);
        toast('Link copied');
      } else if (act === 'download') {
        await downloadProofCard(card);
      } else if (act === 'share') {
        const how = await shareProofCard(card, { text: card.confirmation.amount === undefined ? proofLabel(card.confirmation)
          : `${money(card.confirmation.amount, card.confirmation.currency)} ${proofDirection(card.confirmation)}`, url: location.href });
        if (how === 'downloaded') toast('Image saved. Attach it to your message.');
      }
    } catch (err) { toastError(err); }
  });
}

start();
