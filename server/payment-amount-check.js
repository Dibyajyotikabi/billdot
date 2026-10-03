import { amountValue } from '../public/js/shared/payment-text.js';

// The English model has no ₹, so it drops the sign or reads it as 3, 2, % or a stray letter.
// The Hindi model knows ₹ but misses the digit 1, so it only confirms the sign, not the digits.
export const MAX_AMOUNT_CHECKS = 12;
export const AMOUNT_CHECK_CHARS = '₹0123456789,.';
const MAX_AMOUNT_DIGITS = 9;
const CHECK_PADDING = 0.6;
const AMOUNT_WORD = /^([%ZF&?XR=]?)(\d[\d,]*(?:\.\d{1,2})?)$/;

// Lone, grouped or sign-prefixed numbers. Long numbers are references, not amounts.
export function amountWords(lines) {
  return lines.flatMap((line) => line.words.filter((word) => {
    const [, prefix, number] = AMOUNT_WORD.exec(word.text) || [];
    if (!number || number.replace(/\D/g, '').length > MAX_AMOUNT_DIGITS) return false;
    return Boolean(prefix) || number.includes(',') || line.words.length === 1;
  })).slice(0, MAX_AMOUNT_CHECKS);
}

// Room on the left for the ₹ sign the English model left out.
export function checkArea({ x0, y0, x1, y1 }, { width, height }) {
  const pad = Math.round((y1 - y0) * CHECK_PADDING);
  const left = Math.max(0, x0 - pad * 2);
  const top = Math.max(0, y0 - pad);
  return { left, top, width: Math.min(width, x1 + pad) - left, height: Math.min(height, y1 + pad) - top };
}

const digitsWithoutOnes = (s) => s.replace(/[^02-9]/g, '');

// Returns the corrected word, '' to drop a word that cannot be trusted, or null to keep it.
export function checkAmountWord(word, check) {
  const [, prefix, number] = AMOUNT_WORD.exec(word) || [];
  if (!number || !/[\d₹]/.test(check)) return null;
  const hasRupee = check.includes('₹');
  const seen = digitsWithoutOnes(check.slice(check.lastIndexOf('₹') + 1));
  const stripped = number.slice(1);
  if (!prefix && /^[23][1-9]/.test(number) && amountValue(stripped) !== null) {
    const fullSeen = digitsWithoutOnes(number) === seen;
    if (digitsWithoutOnes(stripped) === seen && !fullSeen) return hasRupee ? `₹${stripped}` : stripped;
    if (!fullSeen) return hasRupee ? '' : null;
  }
  return hasRupee ? `₹${number}` : null;
}

export function correctedText(lines, fixes) {
  if (!lines.some((line) => line.words.some((word) => fixes.has(word)))) return null;
  return lines.map((line) => line.words.map((word) => (fixes.has(word) ? fixes.get(word) : word.text))
    .filter(Boolean).join(' ')).join('\n');
}
