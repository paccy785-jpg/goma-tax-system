/**
 * Double-save protection for every write that mints a new record.
 *
 * A duplicated request (a double-click, an Enter key that submits twice, a
 * retry flushed from the Firestore offline queue, or the same form open in two
 * tabs) used to land as a second, near-identical document. The fix is to stop
 * generating ids from the raw clock and the random number generator and derive
 * them from the record's own business fields instead: the same intent always
 * resolves to the same document, so the second write overwrites the first
 * rather than standing beside it.
 */

/**
 * Width of the "same intent" window.
 *
 * One minute is long enough to swallow every realistic double-submit and short
 * enough that a deliberate second entry for the same person later in the day
 * still becomes its own record.
 */
export const INTENT_BUCKET_MS = 60_000;

const SEP = String.fromCharCode(0);

function fieldKey(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return String(value.getTime());
  if (Array.isArray(value)) return value.map(fieldKey).join(',');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).trim().toLowerCase();
}

/**
 * Stable short hash (FNV-1a, base36) of the fields that define one intent.
 *
 * FNV-1a needs no crypto import in the browser bundle. A collision would merge
 * two records that were about to be duplicated anyway, and the scope keeps
 * unrelated collections apart, so the risk is acceptable at this scale.
 */
export function fingerprint(scope: string, fields: unknown[]): string {
  const payload = [scope, ...fields].map(fieldKey).join(SEP);
  let hash = 0x811c9dc5;
  for (let i = 0; i < payload.length; i += 1) {
    hash ^= payload.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(7, '0');
}

/**
 * Wall-clock time, aligned to the intent bucket, in the shape ids already use.
 *
 * Several registers (`businesses`, `propertyParcels`, `propertyLeases`) are read
 * back with `orderBy(documentId(), 'desc')`, which only means "newest first"
 * while ids begin with a base36 timestamp. Keeping that prefix — and keeping it
 * the same width as `Date.now().toString(36)` — is what lets a deduplicating id
 * sit in an existing collection without re-sorting it.
 */
export function intentTimeToken(): string {
  return (Math.floor(Date.now() / INTENT_BUCKET_MS) * INTENT_BUCKET_MS).toString(36);
}

/**
 * Document id for a create: prefix, intent-window timestamp, business hash.
 *
 * Two calls that mean the same thing inside the same window produce the same
 * string; a repeat in a later window is a different string, so a genuine second
 * filing still gets its own record.
 */
export function intentId(prefix: string, scope: string, fields: unknown[]): string {
  return `${prefix}_${intentTimeToken()}_${fingerprint(scope, fields)}`;
}

const seenIntents = new Map<string, number>();

/**
 * True the first time an intent is seen, false while an identical one is fresh.
 *
 * Used by the audit ledger, where a repeat is noise rather than a second fact:
 * the same officer, action and subject inside the window is one event reported
 * twice.
 */
export function isFirstIntent(key: string, windowMs = INTENT_BUCKET_MS): boolean {
  const now = Date.now();
  for (const [seenKey, at] of seenIntents) {
    if (now - at > windowMs) seenIntents.delete(seenKey);
  }
  const at = seenIntents.get(key);
  if (at !== undefined && now - at < windowMs) return false;
  seenIntents.set(key, now);
  return true;
}
