import { BRAND } from '../../branding';

/**
 * The QR code printed at the foot of the note de perception.
 *
 * It carries a small, fixed-shape JSON payload — the same convention as the
 * receipts' QR codes (BRAND.qrAppTag) — that the scanning app reads to know
 * what it is looking at and to pull the whole form:
 *
 *   { "app": "DPRNK-TAX", "doc": "NOTE_PERCEPTION", "v": 1,
 *     "ref": "NP-DEMO-001", "id": "np_NP-DEMO-001", "printed": "2026-11-06T19:30" }
 *
 * - app / doc / v: which system, which document, which layout of the form
 *   (bump `v` whenever the printed form's sections or fields change);
 * - ref: the note's number (numéro facture ou note de taxation), also printed
 *   under the code — or, for a blank form, a unique reference of the copy;
 * - id: the note's document in Firestore (notesPerception/{id}) — the app reads
 *   the whole note from it; absent on a blank form;
 * - printed: when it was printed (local date and time).
 *
 * The payload stays small on purpose: a dense code is hard to scan once printed
 * at this size, so the app holds the form itself and the code identifies it.
 */
export const NOTE_PERCEPTION_QR_DOC = 'NOTE_PERCEPTION';
export const NOTE_PERCEPTION_FORM_VERSION = 1;

export interface NotePerceptionQrPayload {
  app: string;
  doc: typeof NOTE_PERCEPTION_QR_DOC;
  v: number;
  ref: string;
  id?: string;
  printed: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A unique reference for one printed copy: NP-YYYYMMDD-XXXXXX. */
export function newNotePerceptionRef(now = new Date()): string {
  const day = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  // Letters and digits that cannot be misread for one another (no 0/O, 1/I).
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  const tail = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  return `NP-${day}-${tail}`;
}

export function buildNotePerceptionQrPayload(ref: string, now = new Date(), id?: string): NotePerceptionQrPayload {
  const printed = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(
    now.getMinutes()
  )}`;
  return {
    app: BRAND.qrAppTag,
    doc: NOTE_PERCEPTION_QR_DOC,
    v: NOTE_PERCEPTION_FORM_VERSION,
    ref,
    ...(id ? { id } : {}),
    printed,
  };
}

/** Read a scanned code back; null when it is not a note de perception code. */
export function parseNotePerceptionQr(text: string): NotePerceptionQrPayload | null {
  try {
    const p = JSON.parse(text) as Partial<NotePerceptionQrPayload>;
    if (p && p.app === BRAND.qrAppTag && p.doc === NOTE_PERCEPTION_QR_DOC && typeof p.ref === 'string') {
      return p as NotePerceptionQrPayload;
    }
  } catch {
    /* not JSON — not ours */
  }
  return null;
}
