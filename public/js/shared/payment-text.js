// Only labelled or currency-marked values are candidates. Never infer a payer from "To".
function validDate(year, month, day) {
  const d = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number(year) < 2000 || Number(year) > 2100 || d.getUTCFullYear() !== Number(year)
    || d.getUTCMonth() + 1 !== Number(month) || d.getUTCDate() !== Number(day)) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parsePaymentText(text = '') {
  const source = String(text).replace(/\r/g, '').replace(/[\u00a0\u202f]/g, ' ')
    .replace(/[०-९]/g, (n) => String(n.charCodeAt(0) - '०'.charCodeAt(0)));
  const lines = source.split('\n').map((s) => s.trim()).filter(Boolean);
  const fields = {};
  const amountValue = (value) => {
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})+,\d{3})(?:\.\d{1,2})?$/.test(value)) return null;
    const n = Number(value.replace(/,/g, ''));
    return Number.isFinite(n) && n > 0 && n < 1e12 ? n : null;
  };
  // OCR often reads ₹ as % or drops it, so a lone grouped number on its own line also counts.
  const amountPattern = /(?:\p{Sc}|INR\b|Rs\.?\s*|रु\.?\s*|%(?=\s*\d))\s*([\d,]+(?:\.\d{1,2})?)(?!\d)/giu;
  const amounts = [...source.matchAll(amountPattern)].map((m) => amountValue(m[1])).filter((n) => n !== null);
  const bare = lines.map((line) => /^[^\p{L}\d\s]?\s*(\d{1,3}(?:,\d{2,3})+(?:\.\d{1,2})?)\s*[^\p{L}\d\s]{0,2}$/u.exec(line))
    .filter(Boolean).map((m) => amountValue(m[1])).filter((n) => n !== null);
  const labelled = /(?:amount(?:\s+(?:paid|received|sent|transferred))?|paid amount|राशि|भुगतान राशि)\s*[:\-]?\s*(?:\p{Sc}|INR|Rs\.?|रु\.?)?\s*([\d,]+(?:\.\d{1,2})?)/iu.exec(source);
  const marked = new Set([...amounts, ...bare]);
  if (labelled) {
    const n = amountValue(labelled[1]);
    if (n !== null) fields.amount = n;
  } else if (marked.size === 1) [fields.amount] = marked;

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
