import { db, kvGet, kvSet } from './db.js';
import { HttpError, nowIso, parseJson } from './util.js';
import { DOC_TYPES, FORMATS } from '../public/js/shared/doc-types.js';
import { FONT_OPTIONS, STYLE_OPTIONS } from '../public/js/shared/appearance.js';
import { PROOF_ICONS } from '../public/js/shared/proof-details.js';

export const DEFAULT_SETTINGS = {
  appearance: { font: 'original', style: 'billdot', proofIcon: 'arrow' },
  business: {
    name: '', tagline: '', email: '', phone: '', website: '', address: '', taxId: '', logo: '', signatory: '',
  },
  payment: {
    bankName: '', accountName: '', accountNumber: '', ifsc: '', swift: '', upiId: '', paymentLink: '', instructions: '',
  },
  documents: {
    currency: 'INR',
    locale: 'en-IN',
    taxLabel: 'GST',
    defaultTaxRate: 18,
    splitTax: false,
    defaultDueDays: 14,
    quoteValidDays: 30,
    defaultFormat: 'a4',
    showAmountInWords: true,
    notes: 'Thank you for your business.',
    terms: '',
  },
  numbering: {
    invoice: { prefix: 'INV-{YYYY}-', next: 1, pad: 4 },
    quote: { prefix: 'QT-{YYYY}-', next: 1, pad: 4 },
    proforma: { prefix: 'PF-{YYYY}-', next: 1, pad: 4 },
    receipt: { prefix: 'RC-{YYYY}-', next: 1, pad: 4 },
    credit_note: { prefix: 'CN-{YYYY}-', next: 1, pad: 4 },
    delivery_note: { prefix: 'DN-{YYYY}-', next: 1, pad: 4 },
  },
  email: {
    host: '',
    port: 587,
    secure: false,
    user: '',
    pass: '',
    fromName: '',
    fromEmail: '',
    bcc: '',
    subject: '{type} {number} from {business}',
    message: 'Hi {client},\n\nHere is your {type} {number} for {total}.{due_line}\n\nYou can view, download or pay it here:\n{link}\n\nThanks,\n{business}',
    reminderSubject: 'Reminder: {type} {number} is due',
    reminderMessage: 'Hi {client},\n\nA quick reminder that {type} {number} for {balance} was due on {due}.\n\nYou can view and pay it here:\n{link}\n\nIf you have already paid, please ignore this note.\n\nThanks,\n{business}',
  },
  automation: {
    reminders: true,
    reminderDays: [1, 7, 14],
    recurring: true,
  },
  sharing: {
    publicUrl: '',
  },
};

const isObject = (x) => x && typeof x === 'object' && !Array.isArray(x);

function deepMerge(base, patch) {
  if (!isObject(base) || !isObject(patch)) return patch === undefined ? base : patch;
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

/* ---------- businesses ----------
   Each business keeps its own details, payment info and number series.
   Everything else (email, automation, document defaults) is shared. */

export const PROFILE_KEYS = ['business', 'payment', 'numbering'];
export const businessCode = (id) => `B${String(id).padStart(2, '0')}`;

const businessRow = (id) => (id ? db.prepare('SELECT * FROM businesses WHERE id = ?').get(id) : undefined);

export function defaultBusinessId() {
  const id = kvGet('defaultBusinessId', null);
  if (businessRow(id)) return id;
  return db.prepare('SELECT id FROM businesses ORDER BY id LIMIT 1').get()?.id ?? null;
}

export function profileOf(row) {
  const saved = parseJson(row?.profile, {});
  return Object.fromEntries(PROFILE_KEYS.map((k) => [k, deepMerge(DEFAULT_SETTINGS[k], saved[k] || {})]));
}

export function businessExists(id) {
  return Boolean(businessRow(Number(id)));
}

// Settings as seen by one business. Falls back to the default business.
export function settingsFor(businessId) {
  const base = deepMerge(DEFAULT_SETTINGS, kvGet('settings', {}));
  const defaultId = defaultBusinessId();
  const row = businessRow(Number(businessId)) || businessRow(defaultId);
  if (!row) return { ...base, businessId: null };
  const profile = profileOf(row);
  // Emails from a second business should carry its own name, not the main one.
  const fromName = row.id === defaultId ? base.email.fromName : (profile.business.name || base.email.fromName);
  return { ...base, ...profile, email: { ...base.email, fromName }, businessId: row.id };
}

export function getSettings() {
  return settingsFor(null);
}

export function saveProfile(id, patch) {
  const row = businessRow(id);
  if (!row) throw new HttpError(404, 'Business not found.');
  const profile = deepMerge(parseJson(row.profile, {}), patch);
  db.prepare('UPDATE businesses SET profile = ?, name = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(profile), String(profile.business?.name || '').slice(0, 200), nowIso(), id);
}

// Only known keys survive; values are coerced to the type of the default.
export function sanitize(defaults, patch) {
  if (!isObject(patch)) return {};
  const out = {};
  for (const [key, def] of Object.entries(defaults)) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (isObject(def)) out[key] = sanitize(def, value);
    else if (Array.isArray(def)) {
      out[key] = Array.isArray(value)
        ? value.map(Number).filter((n) => Number.isFinite(n) && n >= 0 && n <= 365).slice(0, 6)
        : def;
    } else if (typeof def === 'number') out[key] = Number.isFinite(Number(value)) ? Number(value) : def;
    else if (typeof def === 'boolean') out[key] = Boolean(value);
    else out[key] = String(value ?? '').slice(0, key === 'logo' ? 700_000 : 4000);
  }
  return out;
}

export function saveSettings(patch, businessId = null) {
  const clean = sanitize(DEFAULT_SETTINGS, patch);
  if (clean.appearance && !Object.hasOwn(FONT_OPTIONS, clean.appearance.font)) delete clean.appearance.font;
  if (clean.appearance && !Object.hasOwn(STYLE_OPTIONS, clean.appearance.style)) delete clean.appearance.style;
  if (clean.appearance && !Object.hasOwn(PROOF_ICONS, clean.appearance.proofIcon)) delete clean.appearance.proofIcon;
  if (clean.email && !clean.email.pass) delete clean.email.pass;
  if (clean.documents && !FORMATS[clean.documents.defaultFormat]) delete clean.documents.defaultFormat;
  if (clean.numbering) {
    for (const key of Object.keys(clean.numbering)) {
      if (!DOC_TYPES[key]) delete clean.numbering[key];
    }
  }
  const profilePatch = {};
  for (const key of PROFILE_KEYS) {
    if (!clean[key]) continue;
    profilePatch[key] = clean[key];
    delete clean[key];
  }
  const target = businessExists(businessId) ? Number(businessId) : defaultBusinessId();
  if (Object.keys(profilePatch).length && target) saveProfile(target, profilePatch);
  if (Object.keys(clean).length) kvSet('settings', deepMerge(kvGet('settings', {}), clean));
  return settingsFor(target);
}

export function publicSettings(settings = getSettings()) {
  const { pass, ...email } = settings.email;
  return { ...settings, email: { ...email, pass: '', passSet: Boolean(pass) } };
}

// Fields safe to show on a client-facing page.
export function clientFacingSettings(settings = getSettings()) {
  return { business: settings.business, payment: settings.payment, documents: settings.documents, appearance: settings.appearance };
}

export const emailConfigured = (settings = getSettings()) =>
  Boolean(settings.email.host && settings.email.fromEmail);

// First run after the multi-business update: the existing details become business B01
// and every existing document is assigned to it.
function migrateBusinesses() {
  if (!db.prepare('SELECT 1 FROM businesses LIMIT 1').get()) {
    const legacy = kvGet('settings', {});
    const profile = Object.fromEntries(PROFILE_KEYS.map((k) => [k, legacy[k] || {}]));
    const now = nowIso();
    const { lastInsertRowid } = db.prepare('INSERT INTO businesses (name, profile, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(String(profile.business.name || ''), JSON.stringify(profile), now, now);
    kvSet('defaultBusinessId', Number(lastInsertRowid));
  }
  db.prepare('UPDATE documents SET business_id = ? WHERE business_id IS NULL').run(defaultBusinessId());
}
migrateBusinesses();
