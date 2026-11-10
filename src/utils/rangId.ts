/**
 * The lot number ("rang") of a cadastral parcel.
 *
 * The id doubles as the document id, so "12" and "012" are two different
 * documents for the same lot: the register then lists the lot twice, and
 * parcels, leases and notices quoting either spelling no longer group
 * together.
 */

/** True when the text is a lot number the register can hold. */
export function isRangIdValid(id: string): boolean {
  return /^\d{1,6}$/.test(id.trim());
}

/**
 * The canonical spelling of a lot number: leading zeros dropped.
 *
 * "012", "0012" and "12" are the same lot, so they have to be one entry.
 */
export function normalizeRangId(id: string): string {
  const trimmed = id.trim();
  if (!/^\d+$/.test(trimmed)) return trimmed;
  return trimmed.replace(/^0+(?=\d)/, '');
}
