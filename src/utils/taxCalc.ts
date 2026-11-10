import { formatMoney } from './money';
import { roundMoney } from './frenchNumber';

/**
 * The arithmetic of the Calcul d'impôts slip, shared by the card and the
 * saved register so both always print the same figures.
 *
 *   (3) Impôt dû       = (1) Revenu brut × (2) Taux
 *   (5) Solde à payer  = (3) Impôt dû − (4) Les retenues versées
 */

/**
 * (2) Taux — fixed at 15 %. It is not an input: the card shows it locked, the
 * service writes this value whatever it is given, and the Firestore rules
 * refuse any calculation saved with another rate.
 */
export const TAUX_FIXE_PCT = 15;

/**
 * Parse an amount typed by an agent. Accepts "1 250,50", "1250.5", "1,250.50"
 * and returns NaN for anything that is not a number, so a half-typed field
 * never silently counts as zero.
 */
export function parseAmount(raw: string): number {
  let s = raw.replace(/[\s  $%]/g, '');
  if (!s) return NaN;
  // Both separators present: the last one is the decimal mark.
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    // A comma is ambiguous: "1,250" is a thousand in French grouping, but
    // "1,25" is one and a quarter. The WHOLE string decides which it is:
    //
    //  - a well-formed grouped integer ("1,250", "1,250,500", "-1,250") is
    //    read as thousands;
    //  - a grouped integer followed by a decimal comma ("1,250,50") is read
    //    as thousands plus a decimal mark;
    //  - anything else keeps its single comma as the decimal mark
    //    ("1,25", "1250,50", "0,500").
    //
    // Reading only the part before the first comma dropped the tail:
    // "1,250,500" came back as 1 250 and "12,500,000" as 12 500 — a 1000x
    // understatement of a tax base, a rent, a cash drawer or a note amount,
    // with no error shown to the officer. The sign matters just as much:
    // "-1,250" must be minus 1 250, not minus 1,25.
    if (/^-?(?:0|[1-9]\d{0,2}(?:,\d{3})+)$/.test(s)) {
      // Thousands grouping throughout.
      s = s.replace(/,/g, '');
    } else if (/^-?[1-9]\d{0,2}(?:,\d{3})+(?:,\d{1,2})$/.test(s)) {
      // Thousands grouping with a decimal mark on the last group.
      const lastComma = s.lastIndexOf(',');
      s = s.slice(0, lastComma).replace(/,/g, '') + '.' + s.slice(lastComma + 1);
    } else if (/^-?\d+(?:,\d{1,3})$/.test(s)) {
      // A lone comma, read as the decimal mark.
      s = s.replace(',', '.');
    } else {
      // Not a shape any of the above recognises: no digit is dropped and no
      // wrong figure is invented — the field is rejected instead.
      return NaN;
    }
  }
  if (!/^-?\d*\.?\d*$/.test(s) || s === '.' || s === '-') return NaN;
  return Number(s);
}

/** (3) = (1) × (2), the rate being a percentage, rounded to the cent. */
export function impotDu(revenuBrutUSD: number, tauxPct: number): number {
  return roundMoney((revenuBrutUSD * tauxPct) / 100);
}

/** (5) = (3) − (4), rounded to the cent. Negative means an overpayment. */
export function soldeAPayer(impotDuUSD: number, retenuesUSD: number): number {
  return roundMoney(impotDuUSD - retenuesUSD);
}

/** Money as printed on the slip — the system-wide "105$" format. */
export function fmtUSD(n: number): string {
  return formatMoney(n);
}

/** A rate as printed on the slip: "15 %", "2,5 %". */
export function fmtTaux(n: number): string {
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 4 }).format(n)} %`;
}
