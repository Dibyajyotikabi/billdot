// Only labelled or currency-marked values are candidates. Never infer a payer from "To".
function validDate(year, month, day) {
  const d = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number(year) < 2000 || Number(year) > 2100 || d.getUTCFullYear() !== Number(year)
    || d.getUTCMonth() + 1 !== Number(month) || d.getUTCDate() !== Number(day)) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalize(text) {
  const source = String(text).replace(/\r/g, '').replace(/[\u00a0\u202f]/g, ' ')
    .replace(/[०-९]/g, (n) => String(n.charCodeAt(0) - '०'.charCodeAt(0)));
  return { source, lines: source.split('\n').map((s) => s.trim()).filter(Boolean) };
}

export function amountValue(value) {
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})+,\d{3})(?:\.\d{1,2})?$/.test(value)) return null;
  const n = Number(value.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 && n < 1e12 ? n : null;
}

const NUMBER = String.raw`([\d,]+(?:\.\d{1,2})?)(?!\d)`;
const MARKED_AMOUNT = new RegExp(String.raw`(?:\p{Sc}|INR\b|Rs\.?\s*|रु\.?\s*)\s*${NUMBER}`, 'giu');
// A % after letters, digits or * belongs to a masked account like "xx%5371", not to an amount.
const PERCENT_AMOUNT = new RegExp(String.raw`(?<![\p{L}\p{N}*])%\s*${NUMBER}`, 'gu');
const BARE_AMOUNT = /^[^\p{L}\d\s]?\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?)\s*[^\p{L}\d\s]{0,2}$/gu;

const candidates = (pattern, text) => [...text.matchAll(pattern)]
  .map((m) => ({ raw: m[1], value: amountValue(m[1]) })).filter((c) => c.value !== null);

// The value seen most often wins. A tie means different amounts on screen, so none is picked.
function mostSeen(found) {
  const counts = new Map();
  for (const { value } of found) counts.set(value, (counts.get(value) || 0) + 1);
  const [first, second] = [...counts].sort((a, b) => b[1] - a[1]);
  return first && (!second || first[1] > second[1]) ? first[0] : null;
}

// Labels win, then currency-marked values, then OCR guesses: ₹ read as %, or dropped from a lone grouped number.
function readAmount({ source, lines }) {
  const labelled = /(?:amount(?:\s+(?:paid|received|sent|transferred))?|paid amount|राशि|भुगतान राशि)\s*[:\-]?\s*(?:\p{Sc}|INR|Rs\.?|रु\.?)?\s*([\d,]+(?:\.\d{1,2})?)/iu.exec(source);
  if (labelled) return amountValue(labelled[1]);
  const marked = candidates(MARKED_AMOUNT, source);
  if (marked.length) return mostSeen(marked);
  const guesses = lines.flatMap((line) => {
    const percent = candidates(PERCENT_AMOUNT, line);
    return percent.length ? percent : candidates(BARE_AMOUNT, line);
  });
  // "32,450" next to "2,450" is the same amount with ₹ read as 3 (or 2), so it does not count against it.
  const values = new Set(guesses.map((c) => c.value));
  return mostSeen(guesses.filter((c) => !(/^[23]/.test(c.raw) && values.has(amountValue(c.raw.slice(1))))));
}

export function parsePaymentText(text = '') {
  const { source, lines } = normalize(text);
  const fields = {};
  const amount = readAmount({ source, lines });
  if (amount !== null) fields.amount = amount;

  // Prefer UTR / UPI reference over an app's internal transaction ID.
  const reference = /(?:\bUTR(?:\s*\/\s*(?:reference|ref))?(?:\s+(?:number|no\.?|ID))?|\bUPI\s+(?:(?:reference|ref\.?)(?:\s+(?:number|no\.?))?|transaction\s+ID)|\bRRN|\b(?:Bank\s+)?reference(?:\s+(?:number|no\.?|ID))?|यूटीआर|यूपीआई (?:संदर्भ|लेनदेन आईडी))\s*[:#\-]?\s*([A-Z0-9][A-Z0-9 -]{5,119})/i.exec(source);
  if (reference) {
    const value = reference[1].replace(/[ -]/g, '');
    if (/^[A-Z0-9]{6,120}$/i.test(value) && /\d/.test(value)) fields.reference = value;
  }
  if (!fields.reference) {
    const transaction = /\b(?:TXN\.?\s*ID|transaction\s+(?:ID|number|no\.?))\s*[:#\-]?\s*(\d{12})(?!\d)/i.exec(source);
    if (transaction) fields.reference = transaction[1];
  }

  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const iso = /\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/.exec(source);
  const numeric = /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](20\d{2})\b/.exec(source);
  const named = /\b(\d{1,2})[\s\-]+([A-Za-z]{3,9})[\s,\-]+(20\d{2})\b/.exec(source);
  const monthFirst = /\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s*(20\d{2})\b/.exec(source);
  const paidOn = iso ? validDate(iso[1], iso[2], iso[3])
    : numeric ? validDate(numeric[3], numeric[2], numeric[1])
      : named ? validDate(named[3], months.indexOf(named[2].slice(0, 3).toLowerCase()) + 1, named[1])
        : monthFirst ? validDate(monthFirst[3], months.indexOf(monthFirst[1].slice(0, 3).toLowerCase()) + 1, monthFirst[2]) : null;
  if (paidOn) fields.paid_on = paidOn;

  // Drop OCR table borders and a trailing amount, as in "Paid to NAME ₹17,100".
  const clean = (value) => String(value || '').replace(/[|]/g, ' ')
    .replace(/\s+(?:\p{Sc}|%|Rs\.?)?\s*\d[\d,]*(?:\.\d{1,2})?$/u, '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < lines.length; i += 1) {
    const payer = /^(?:received from|paid by|payer(?: name)?|from|भेजने वाला|भुगतानकर्ता|प्रेषक)\s*[:\-]?\s*(.*)$/i.exec(lines[i]);
    if (!payer) continue;
    const value = clean(payer[1] || lines[i + 1]);
    if (/\p{L}/u.test(value) && !/^(?:bank|account|a\/c|upi|utr|date|amount|to)\b/i.test(value)
      && !/[@₹]|\d{5}/.test(value)) fields.payer = value.slice(0, 160);
    break;
  }
  if (!fields.payer) {
    const paid = lines.map((line) => /^(.{2,160}?)\s+(?:paid|sent)(?:\s+to)?(?:\s+([^₹\d].{1,159}))?$/i.exec(line)).find(Boolean);
    if (paid && !/^(?:amount|payment|you|money)\b/i.test(paid[1]) && !/[@\d₹]/.test(paid[1])) fields.payer = paid[1].trim();
  }
  const nameValue = (value) => {
    const name = clean(value);
    return /\p{L}/u.test(name) && !/[@\p{Sc}]|\d{3}/u.test(name)
      && !/^(?:bank|account|a\/c|upi|utr|date|amount|reference|paid|payment|powered|txn)\b/i.test(name) ? name.slice(0, 160) : null;
  };
  for (let i = 0; i < lines.length; i += 1) {
    const receiver = /^(?:paid to|sent to|received by|receiver(?: name)?|recipient(?: name)?|to|प्राप्तकर्ता)\s*[:\-]?\s*(.*)$/i.exec(lines[i]);
    if (receiver) {
      const name = nameValue(receiver[1] || lines[i + 1]);
      if (name) { fields.receiver = name; break; }
    }
  }
  if (!fields.receiver) {
    const banking = /^banking name\s*[:\-]?\s*(.+)$/im.exec(source);
    if (banking && nameValue(banking[1])) fields.receiver = nameValue(banking[1]);
  }
  if (!fields.receiver && fields.payer) {
    for (let i = 0; i < lines.length; i += 1) {
      const sent = /^(.{2,160}?)\s+(?:paid|sent)(?:\s+to)?(?:\s+(.+))?$/i.exec(lines[i]);
      if (!sent || sent[1].trim() !== fields.payer) continue;
      const name = nameValue(sent[2] || lines[i + 1]);
      if (name) fields.receiver = name;
      break;
    }
  }
  if (/\b(?:UPI|GPay|Google Pay|PhonePe|Paytm|CRED|BHIM)\b|यूपीआई/i.test(source)) fields.method = 'UPI';
  else if (/\b(?:NEFT|IMPS|RTGS|bank transfer)\b/i.test(source)) fields.method = 'Bank transfer';
  else if (/\b(?:debit card|credit card|card payment)\b/i.test(source)) fields.method = 'Card';
  return fields;
}

// Several OCR readings of one screenshot: earlier readings win for text fields,
// while the amount weighs every reading together so one misread cannot hide the rest.
export function parsePaymentTexts(texts = []) {
  const readings = texts.filter(Boolean);
  const { amount: _first, ...fields } = Object.assign({}, ...readings.map(parsePaymentText).reverse());
  const amount = readAmount(normalize(readings.join('\n')));
  return amount === null ? fields : { ...fields, amount };
}
