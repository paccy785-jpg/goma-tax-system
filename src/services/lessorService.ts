import {
  collection,
  doc,
  onSnapshot,
  query,
  setDoc,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { Lessor, UserRole } from '../types';
import { logAuditEvent } from './dbService';
import { intentId } from './idempotency';

/**
 * Locateurs — the lessors who receive rent on declared property.
 *
 * A locateur is filed with the bailleur (owner) it acts for, selected from the
 * taxpayer roll. The bailleur's NIF is carried on the record so a lease reads
 * without a second lookup; the locateur itself no longer supplies a NIF.
 */
export const LESSORS_COLLECTION = 'lessors';

export function subscribeToLessors(
  onData: (lessors: Lessor[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  const q = query(collection(db, LESSORS_COLLECTION));
  return onSnapshot(
    q,
    (snapshot) => {
      const lessors = snapshot.docs
        .map((d) => ({ ...(d.data() as Lessor), id: d.id }))
        .sort(
          (a, b) =>
            a.name.localeCompare(b.name) || (a.nif || '').localeCompare(b.nif || '')
        );
      onData(lessors);
    },
    (err) => {
      console.warn('[Lessors] Register listener error:', err);
      onError?.(err);
      onData([]);
    }
  );
}

export async function addLessor(
  input: {
    name: string;
    bailleur?: { id: string; name: string; nif?: string };
  },
  actor: { uid: string; displayName: string; role: UserRole }
): Promise<Lessor> {
  const name = input.name.trim();
  if (!name) throw new Error('Enter the locateur’s name.');

  const id = intentId('les', 'lessor.add', [name, input.bailleur?.id, actor.uid]);
  const lessor: Lessor = {
    id,
    name,
    ...(input.bailleur
      ? {
          bailleurId: input.bailleur.id,
          bailleurName: input.bailleur.name,
          bailleurNif: input.bailleur.nif,
        }
      : {}),
    createdAt: new Date().toISOString(),
    createdBy: actor.uid,
    createdByName: actor.displayName,
  };

  await setDoc(doc(db, LESSORS_COLLECTION, id), lessor);

  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    'CREATE_LESSOR',
    'Lessor',
    lessor.id,
    `Locateur ${lessor.name} registered${
      lessor.bailleurName ? ` for bailleur ${lessor.bailleurName}` : ''
    }.`
  ).catch(() => {});

  return lessor;
}
