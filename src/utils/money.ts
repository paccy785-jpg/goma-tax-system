import { roundMoney } from './frenchNumber';

/**
 * The one money format of the whole system: the amount, then "$", no space.
 *
 *   105      → "105$"
 *   1250     → "1 250$"
 *   37.04    → "37,04$"   (cents only when there are cents)
 *   -60      → "-60$"
 *
 * French grouping and decimal comma, matching the French slips. The group
 * separator is a narrow no-break space, so an amount never wraps mid-number.
 * Every screen formats money through here — change it once, it changes
 * everywhere.
 *
 * A missing amount (null / undefined / NaN) renders as "—", NOT "0$": on an
 * audit surface a genuinely absent figure and a computed zero must be
 * distinguishable, otherwise a field that was never recorded reads as a
 * legitimate zero-balance.
 */
export function formatMoney(amount: number | null | undefined): string {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '—';
  const n = amount;
  // Round exactly the way the stored figures are rounded, so the amount read
  // on screen is the amount written in the ledger and printed on the slip.
  // The old inline form was `Math.round((n + Number.EPSILON * …) * 100) / 100`,
  // and Number.EPSILON is far too small to lift a value above ~4 once
  // multiplied by 100: a true half-cent landed a hair under .5 and rounded
  // DOWN, so a figure stored as 8.08 printed as "8,07$". `roundMoney` is the
  // form that was corrected for exactly that reason.
  const rounded = roundMoney(n);
  // An amount that rounds to zero must not print as "-0$": on a receipt that
  // reads like a negative figure rather than a nil balance.
  const value = rounded === 0 ? 0 : rounded;
  const hasCents = Math.round(Math.abs(value) * 100) % 100 !== 0;
  const text = new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  }).format(value);
  return `${text}$`;
}
