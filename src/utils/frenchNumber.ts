/**
 * French number to words.
 *
 * Used for the "en toutes lettres" line of an official tax slip, so the
 * wording has to follow French orthography exactly — not an approximation.
 * The rules that actually bite:
 *
 *  - 21 → "vingt-et-un", but 81 → "quatre-vingt-un" (no "et")
 *  - 70 → "soixante-dix", 71 → "soixante-et-onze", 77 → "soixante-dix-sept"
 *  - 80 → "quatre-vingts" (plural), 81 → "quatre-vingt-un" (singular)
 *  - 91 → "quatre-vingt-onze", 99 → "quatre-vingt-dix-neuf"
 *  - 100 → "cent", 200 → "deux cents", 201 → "deux cent un"
 *  - 1000 → "mille" (invariable), 2000 → "deux mille"
 *  - 1 000 000 → "un million", 2 000 000 → "deux millions"
 */

const UNITS = [
  'zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
  'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize',
  'dix-sept', 'dix-huit', 'dix-neuf',
];

const TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];

/** 0 → 99. */
function belowHundred(n: number): string {
  if (n < 20) return UNITS[n];

  if (n < 70) {
    const tens = Math.floor(n / 10);
    const units = n % 10;
    if (units === 0) return TENS[tens];
    // 21, 31, 41, 51, 61 → "vingt-et-un" and friends.
    if (units === 1) return `${TENS[tens]}-et-un`;
    return `${TENS[tens]}-${UNITS[units]}`;
  }

  if (n < 80) {
    if (n === 70) return 'soixante-dix';
    if (n === 71) return 'soixante-et-onze';
    // 72 → douze, 77 → dix-sept, 79 → dix-neuf.
    return `soixante-${belowHundred(10 + (n - 70))}`;
  }

  if (n < 90) {
    // 80 takes an "s" and stands alone; 81 → 89 take the plain unit.
    if (n === 80) return 'quatre-vingts';
    return `quatre-vingt-${UNITS[n - 80]}`;
  }

  if (n === 90) return 'quatre-vingt-dix';
  if (n === 91) return 'quatre-vingt-onze';
  // 92 → douze, 99 → dix-neuf.
  return `quatre-vingt-${belowHundred(10 + (n - 90))}`;
}

/**
 * 0 → 999.
 *
 * `isFinal` tells the function whether this group ends the number. It
 * matters for "cent", which takes an "s" only when it is multiplied and
 * nothing follows it: 500 → "cinq cents", but 500 000 → "cinq cent mille".
 */
function belowThousand(n: number, isFinal = true): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;

  if (hundreds === 0) return belowHundred(rest);

  // "cent" and "cents" stand alone — never "un cent".
  const head = hundreds === 1 ? 'cent' : `${UNITS[hundreds]} cent`;
  if (rest === 0) return isFinal && hundreds !== 1 ? `${head}s` : head;
  return `${head} ${belowHundred(rest)}`;
}

/** 0 → 999 999. */
function belowMillion(n: number): string {
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;

  if (thousands === 0) return belowThousand(n);

  // "mille" is invariable and never takes a leading "un".
  // "vingt" loses its "s" before "mille": 80 000 → "quatre-vingt mille".
  const head =
    thousands === 1
      ? 'mille'
      : `${belowThousand(thousands, false).replace(/quatre-vingts$/, 'quatre-vingt')} mille`;
  return rest === 0 ? head : `${head} ${belowThousand(rest)}`;
}

/** 0 → 999 999 999. */
function belowMilliard(n: number): string {
  const millions = Math.floor(n / 1_000_000);
  const rest = n % 1_000_000;

  if (millions === 0) return belowMillion(n);

  const head = millions === 1 ? 'un million' : `${belowThousand(millions, false)} millions`;
  return rest === 0 ? head : `${head} ${belowMillion(rest)}`;
}

/** Any non-negative integer, spelled out in French. */
export function integerToFrenchWords(value: number): string {
  if (!Number.isFinite(value)) return '';
  const n = Math.trunc(value);
  if (n < 0) return `moins ${integerToFrenchWords(-n)}`;
  if (n < 1000) return belowThousand(n);

  const milliards = Math.floor(n / 1_000_000_000);
  const rest = n % 1_000_000_000;
  if (milliards === 0) return belowMilliard(n);

  const head = milliards === 1 ? 'un milliard' : `${belowThousand(milliards, false)} milliards`;
  return rest === 0 ? head : `${head} ${belowMilliard(rest)}`;
}

export interface FrenchCurrencyLabels {
  /** Singular unit, e.g. "dollar américain". */
  singular: string;
  /** Plural unit, e.g. "dollars américains". */
  plural: string;
  /** Singular subunit, e.g. "centime". */
  centSingular?: string;
  /** Plural subunit, e.g. "centimes". */
  centPlural?: string;
}

export const USD_LABELS: FrenchCurrencyLabels = {
  singular: 'dollar américain',
  plural: 'dollars américains',
  centSingular: 'centime',
  centPlural: 'centimes',
};

/** Round to two decimals, the precision a monetary amount is kept at. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return NaN;
  // Scale FIRST, then round on the integer. The old form was
  // `Math.round((value + Number.EPSILON) * 100) / 100`, and Number.EPSILON is
  // ~2.2e-16 — far too small to lift any value above ~4 after multiplying by
  // 100. A true half-cent therefore rounded DOWN whenever the binary product
  // landed a hair under .5 (8.075 * 100 === 807.4999999999999), so roughly
  // 0.35% of 15% duties were a cent short. `toFixed(6)` snaps that float noise
  // back onto the intended half before rounding.
  const cents = Number((Math.abs(value) * 100).toFixed(6));
  return Math.sign(value) * Math.round(cents) / 100;
}

/**
 * Spell a monetary amount out in French, with the currency and its cents.
 *
 * `125.5` → "cent vingt-cinq dollars américains et cinquante centimes"
 *
 * The amount is rounded to the cent first, so a value that arrives as
 * 0.1 + 0.2 does not print a stray third decimal.
 */
export function amountInFrenchWords(
  value: number,
  labels: FrenchCurrencyLabels = USD_LABELS
): string {
  if (!Number.isFinite(value)) return '';

  const negative = value < 0;
  const abs = Math.abs(roundMoney(value));

  let whole = Math.floor(abs);
  let cents = Math.round((abs - whole) * 100);
  // A rounded-up cent carries into the unit: 1.999 → 2 dollars.
  if (cents === 100) {
    whole += 1;
    cents = 0;
  }

  const centSingular = labels.centSingular || 'centime';
  const centPlural = labels.centPlural || 'centimes';

  // "un centime" is spelled with its article; "deux centimes" is not.
  const centWord =
    cents === 1 ? `un ${centSingular}` : `${integerToFrenchWords(cents)} ${centPlural}`;

  // Below one unit the amount is read as cents alone: "un centime", never
  // "zéro dollar américain et un centime".
  if (whole === 0) {
    // The sign still applies: a credit of fifty cents is "moins cinquante
    // centimes". Without it the slip printed the digits "-0,50$" next to the
    // words "cinquante centimes" — the same document saying the taxpayer is
    // owed money and that they owe it.
    if (cents === 0) return negative ? `moins zéro ${labels.singular}` : `zéro ${labels.singular}`;
    return negative ? `moins ${centWord}` : centWord;
  }

  const unit = whole === 1 ? labels.singular : labels.plural;
  // "million" and "milliard" are nouns, so a round amount takes "de":
  // 2 000 000 → "deux millions de dollars américains".
  const de = whole >= 1_000_000 && whole % 1_000_000 === 0 ? 'de ' : '';
  let text = `${integerToFrenchWords(whole)} ${de}${unit}`;

  if (cents > 0) {
    text += ` et ${centWord}`;
  }

  return negative ? `moins ${text}` : text;
}
