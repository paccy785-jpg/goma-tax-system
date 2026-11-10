/**
 * A bank transfer reference.
 *
 * A reference pays one declaration. The normalised form is what the office
 * compares, so the same transfer typed with different spacing or case is
 * recognised as the same one.
 */

/** Normalised form a reference is compared in, to catch the same one typed twice. */
export const normalizeReference = (ref: string) => ref.trim().replace(/\s+/g, ' ').toUpperCase();

/**
 * The document that claims a bank reference.
 *
 * Derived from the normalised reference, so the same transfer always lands on
 * the same document no matter how it was typed. The claim is taken in the
 * transaction that files the confirmation, which is what makes it exclusive:
 * Firestore serialises competing transactions on this document.
 */
export function referenceClaimId(normalizedReference: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < normalizedReference.length; i++) {
    h ^= normalizedReference.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `ref_${h.toString(36).padStart(7, '0')}`;
}
