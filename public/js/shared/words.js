// Amount in words. Uses lakh and crore for INR, thousand and million otherwise.

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowThousand(n) {
  const parts = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? ` ${ONES[n % 10]}` : ''));
  } else if (n > 0) {
    parts.push(ONES[n]);
  }
  return parts.join(' ');
}

function integerToWords(n, indian) {
  if (n === 0) return 'Zero';
  const scales = indian
    ? [[10000000, 'Crore'], [100000, 'Lakh'], [1000, 'Thousand']]
    : [[1e9, 'Billion'], [1e6, 'Million'], [1000, 'Thousand']];
  const parts = [];
  for (const [size, name] of scales) {
    if (n >= size) {
      parts.push(`${integerToWords(Math.floor(n / size), indian)} ${name}`);
      n %= size;
    }
  }
  if (n > 0) parts.push(belowThousand(n));
  return parts.join(' ');
}

const UNITS = {
  INR: ['Rupees', 'Paise'],
  USD: ['Dollars', 'Cents'],
  EUR: ['Euros', 'Cents'],
  GBP: ['Pounds', 'Pence'],
  AUD: ['Dollars', 'Cents'],
  CAD: ['Dollars', 'Cents'],
  SGD: ['Dollars', 'Cents'],
  AED: ['Dirhams', 'Fils'],
};

export function amountInWords(amount, currency = 'INR') {
  const value = Math.abs(Number(amount) || 0);
  const whole = Math.floor(value);
  const fraction = Math.round((value - whole) * 100);
  const [major, minor] = UNITS[currency] || [currency, 'Cents'];
  const indian = currency === 'INR';
  let text = `${integerToWords(whole, indian)} ${major}`;
  if (fraction > 0) text += ` and ${integerToWords(fraction, indian)} ${minor}`;
  return `${text} Only`;
}
