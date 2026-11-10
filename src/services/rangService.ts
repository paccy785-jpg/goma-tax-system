import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { RangEntry, UserRole } from '../types';
import { logAuditEvent } from './dbService';
import { isRangIdValid, normalizeRangId } from '../utils/rangId';

export { isRangIdValid, normalizeRangId };

/**
 * The rang register — numbered cadastral lots.
 *
 * `rang` is the lot number that identifies a parcel inside a quartier, and it is
 * repeated on every property declaration, lease and assessment notice. Free-typing
 * it produced the same lot written three different ways ("12", "012", "Lot 12"),
 * which breaks any grouping by parcel. Keeping the allowed values in one place
 * turns it into a reference list instead of free text.
 */
export const RANGS_COLLECTION = 'rangs';

/** Rangs sort as numbers, not as the strings Firestore stores them under. */
function byRangNumber(a: RangEntry, b: RangEntry): number {
  const na = Number(a.id);
  const nb = Number(b.id);
  if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
  return a.id.localeCompare(b.id);
}

export async function getRangs(): Promise<RangEntry[]> {
  const snapshot = await getDocs(collection(db, RANGS_COLLECTION));
  return snapshot.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<RangEntry, 'id'>) }))
    .sort(byRangNumber);
}

/** Live register, so a rang added here is instantly usable over there. */
export function subscribeToRangs(callback: (rangs: RangEntry[]) => void): Unsubscribe {
  return onSnapshot(
    collection(db, RANGS_COLLECTION),
    (snapshot) => {
      callback(
        snapshot.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<RangEntry, 'id'>) }))
          .sort(byRangNumber)
      );
    },
    (err) => {
      console.warn('[Rangs] Register listener unavailable:', err);
      callback([]);
    }
  );
}

/**
 * Create or correct one rang. The id doubles as the document id, so writing an
 * existing rang again renames it rather than creating a duplicate lot number.
 */
export async function saveRang(
  input: { id: string; designation: string },
  actor: { uid: string; displayName: string; role: UserRole }
): Promise<RangEntry> {
  const id = normalizeRangId(input.id);
  const designation = input.designation.trim();

  if (!isRangIdValid(id)) {
    throw new Error('Rang Id must be a whole number between 0 and 999999.');
  }
  if (!designation) {
    throw new Error('Designation is required.');
  }

  const existing = await getDocs(collection(db, RANGS_COLLECTION));
  const isEdit = existing.docs.some((d) => d.id === id);
  const previous = isEdit
    ? (existing.docs.find((d) => d.id === id)!.data() as Omit<RangEntry, 'id'>)
    : null;

  const entry: RangEntry = {
    id,
    designation,
    createdAt: previous?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: actor.displayName,
  };

  await setDoc(doc(db, RANGS_COLLECTION, id), entry);

  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    isEdit ? 'UPDATE_RANGE' : 'CREATE_RANGE',
    'Rang',
    id,
    isEdit
      ? `Rang ${id} designation changed from "${previous?.designation || '—'}" to "${designation}".`
      : `Rang ${id} added to the cadastral register with designation "${designation}".`
  ).catch(() => {});

  return entry;
}

export async function deleteRang(
  id: string,
  actor: { uid: string; displayName: string; role: UserRole }
): Promise<void> {
  await deleteDoc(doc(db, RANGS_COLLECTION, id));
  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    'DELETE_RANGE',
    'Rang',
    id,
    `Rang ${id} removed from the cadastral register.`
  ).catch(() => {});
}
