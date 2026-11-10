/**
 * NIF (Numéro d'Identification Fiscale) issuance.
 *
 * The roll uses the format `A` + 7 digits + a check letter — `A0012345Z`. The
 * digits are a plain issue sequence; the letter is derived from them, so a
 * mistyped NIF is detectable without a lookup: transposing two digits, or
 * dropping one, changes the letter and the number fails `isValidNif`. That is
 * the whole point of carrying it — a NIF is quoted on notices, certificates and
 * receipts for years, and a silent transcription error there is expensive.
 *
 * Issuance is sequential rather than random, continuing from the highest NIF
 * already on the roll. A registry that hands out NIFs at random cannot be
 * audited — an officer cannot tell a gap in the sequence from a number that was
 * never issued — and a sequential key makes a duplicate obvious.
 */

/** `A` + 7 digits + check letter. */
export const NIF_PATTERN = /^A(\d{7})([A-Z])$/;

/** First number issued when the roll is empty. */
const SEQUENCE_FLOOR = 1;

/** 7 digits of sequence, so the format cannot overflow. */
const SEQUENCE_CEILING = 9_999_999;

/**
 * Check letter for a 7-digit sequence.
 *
 * Each digit is weighted by its position and the total folded into A–Z. Chosen
 * so every single-digit substitution and every adjacent transposition of
 * unequal digits changes the letter.
 */
export function nifCheckLetter(digits: string): string {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    sum += Number(digits[i]) * (i + 1);
  }
  return String.fromCharCode(65 + (sum % 26));
}

/** True when the value is a well-formed NIF whose check letter agrees. */
export function isValidNif(value: string): boolean {
  const match = NIF_PATTERN.exec((value || '').trim().toUpperCase());
  if (!match) return false;
  return nifCheckLetter(match[1]) === match[2];
}

export interface NifIssueResult {
  nif?: string;
  error?: string;
}

/**
 * Issue the next NIF that is free on the roll.
 *
 * `existingNifs` is every NIF currently registered. Values that do not match the
 * pattern (legacy identifiers) still count as taken, so a generated NIF can
 * never collide with one — they simply do not advance the sequence.
 *
 * Starting at `highest + 1` means the candidate is free by construction: any
 * NIF with that sequence number would itself have raised `highest`. The loop
 * below is therefore belt-and-braces rather than a routine path.
 *
 * This is a client-side issue: two officers enrolling at the same instant could
 * derive the same number. The uniqueness check in `validate()` is the backstop,
 * and the roll is a single-operator register in practice.
 */
export function issueNextNif(existingNifs: string[]): NifIssueResult {
  const taken = new Set(
    (existingNifs || []).map((n) => (n || '').trim().toUpperCase()).filter(Boolean)
  );

  let highest = 0;
  for (const value of taken) {
    const match = NIF_PATTERN.exec(value);
    if (match) highest = Math.max(highest, Number(match[1]));
  }

  let candidate = Math.max(SEQUENCE_FLOOR, highest + 1);

  while (candidate <= SEQUENCE_CEILING) {
    const digits = String(candidate).padStart(7, '0');
    const nif = `A${digits}${nifCheckLetter(digits)}`;
    if (!taken.has(nif)) return { nif };
    candidate += 1;
  }

  return {
    error:
      'The NIF sequence is exhausted. Raise the sequence ceiling before enrolling further taxpayers.',
  };
}
