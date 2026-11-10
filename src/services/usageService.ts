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
import { UsageEntry, UserRole } from '../types';
import { logAuditEvent } from './dbService';

/**
 * The usage register — the declared fiscal uses a property may be put to.
 *
 * A parcel's use is what decides its rate, so the same use written three ways
 * ("Commercial", "commercial", "Commerciale") is three different tax outcomes
 * for identical premises. Keeping the allowed uses here makes the use a chosen
 * reference value instead of free text.
 */
export const USAGES_COLLECTION = 'usages';

/** Codes sort alphabetically; a code is a label here, not a quantity like a rang. */
function byUsageCode(a: UsageEntry, b: UsageEntry): number {
  return a.id.localeCompare(b.id);
}

/** Uppercase letter or digit, then letters, digits, dot, dash or underscore. */
export function isUsageIdValid(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,11}$/.test(id.trim());
}

export async function getUsages(): Promise<UsageEntry[]> {
  const snapshot = await getDocs(collection(db, USAGES_COLLECTION));
  return snapshot.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<UsageEntry, 'id'>) }))
    .sort(byUsageCode);
}

/** Live register, so a usage added here is instantly usable over there. */
export function subscribeToUsages(callback: (usages: UsageEntry[]) => void): Unsubscribe {
  return onSnapshot(
    collection(db, USAGES_COLLECTION),
    (snapshot) => {
      callback(
        snapshot.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<UsageEntry, 'id'>) }))
          .sort(byUsageCode)
      );
    },
    (err) => {
      console.warn('[Usages] Register listener unavailable:', err);
      callback([]);
    }
  );
}

/**
 * Create or correct one usage. The code doubles as the document id, so saving
 * an existing usage again renames its designation rather than creating a
 * second code for the same use.
 */
export async function saveUsage(
  input: { id: string; designation: string },
  actor: { uid: string; displayName: string; role: UserRole }
): Promise<UsageEntry> {
  const id = input.id.trim().toUpperCase();
  const designation = input.designation.trim();

  if (!isUsageIdValid(id)) {
    throw new Error(
      'Usage Id is required: up to 12 characters — letters, digits, dot, dash or underscore, no spaces.'
    );
  }
  if (!designation) {
    throw new Error('Designation is required.');
  }

  const existing = await getDocs(collection(db, USAGES_COLLECTION));
  const isEdit = existing.docs.some((d) => d.id === id);
  const previous = isEdit
    ? (existing.docs.find((d) => d.id === id)!.data() as Omit<UsageEntry, 'id'>)
    : null;

  const entry: UsageEntry = {
    id,
    designation,
    createdAt: previous?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: actor.displayName,
  };

  await setDoc(doc(db, USAGES_COLLECTION, id), entry);

  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    isEdit ? 'UPDATE_USAGE' : 'CREATE_USAGE',
    'Usage',
    id,
    isEdit
      ? `Usage ${id} designation changed from "${previous?.designation || '—'}" to "${designation}".`
      : `Usage ${id} added to the usage register with designation "${designation}".`
  ).catch(() => {});

  return entry;
}

export async function deleteUsage(
  id: string,
  actor: { uid: string; displayName: string; role: UserRole }
): Promise<void> {
  await deleteDoc(doc(db, USAGES_COLLECTION, id));
  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    'DELETE_USAGE',
    'Usage',
    id,
    `Usage ${id} removed from the usage register.`
  ).catch(() => {});
}
