import { collection, doc, onSnapshot, query, runTransaction, Unsubscribe } from 'firebase/firestore';
import { db } from '../firebase/config';
import { UserRole } from '../types';
import { logAuditEvent } from './dbService';
import { confirmationId, DECLARATION_KIND_LABELS, DeclarationKind } from './bankConfirmationService';

/**
 * "III) Réservé à l'administration" — the part of an IF / IRL declaration the
 * accountant (Comptable) fills in before the payment can be confirmed.
 *
 * One record per saved calculation, keyed `<kind>_<calculationId>` like the
 * bank confirmations. A record is final: the Firestore rules allow it to be
 * created and read, never changed or deleted. It is printed in the
 * "Réservé à l'administration" table of the declaration.
 */
export const DECLARATION_ADMIN_COLLECTION = 'declarationAdmin';

export interface DeclarationAdmin {
  /** `<kind>_<calculationId>`. */
  id: string;
  kind: DeclarationKind;
  calculationId: string;
  contribuableName: string;
  numeroQuittance: string;
  /** yyyy-mm-dd. */
  dateQuittance: string;
  nomQualiteAgent: string;
  numeroRecepisse: string;
  /** yyyy-mm-dd. */
  dateRecepisse: string;
  filledAt: string;
  filledByUid: string;
  filledByName: string;
}

export type DeclarationAdminInput = Pick<
  DeclarationAdmin,
  | 'kind'
  | 'calculationId'
  | 'contribuableName'
  | 'numeroQuittance'
  | 'dateQuittance'
  | 'nomQualiteAgent'
  | 'numeroRecepisse'
  | 'dateRecepisse'
>;

/** yyyy-mm-dd → dd/mm/yyyy, without going through a time zone. */
export const frIsoDay = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('/') : d || '');

export async function fillDeclarationAdmin(
  input: DeclarationAdminInput,
  actor: { uid: string; displayName: string; role: UserRole }
): Promise<DeclarationAdmin> {
  const clean = (v: string) => v.trim().replace(/\s+/g, ' ');
  const record: DeclarationAdmin = {
    id: confirmationId(input.kind, input.calculationId),
    kind: input.kind,
    calculationId: input.calculationId,
    contribuableName: input.contribuableName,
    numeroQuittance: clean(input.numeroQuittance),
    dateQuittance: input.dateQuittance,
    nomQualiteAgent: clean(input.nomQualiteAgent),
    numeroRecepisse: clean(input.numeroRecepisse),
    dateRecepisse: input.dateRecepisse,
    filledAt: new Date().toISOString(),
    filledByUid: actor.uid,
    filledByName: actor.displayName,
  };
  if (
    !record.calculationId ||
    !record.numeroQuittance ||
    !record.dateQuittance ||
    !record.nomQualiteAgent ||
    !record.numeroRecepisse ||
    !record.dateRecepisse
  ) {
    throw new Error('Remplissez tous les champs de la déclaration.');
  }

  const ref = doc(db, DECLARATION_ADMIN_COLLECTION, record.id);
  await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(ref);
    if (existing.exists()) throw new Error('Cette déclaration a déjà été remplie.');
    transaction.set(ref, record);
  });

  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    'FILL_DECLARATION_ADMIN',
    'DeclarationAdmin',
    record.id,
    `Déclaration remplie par le comptable — ${DECLARATION_KIND_LABELS[input.kind]}, ${input.contribuableName} : quittance ou BV ${record.numeroQuittance}, récépissé ${record.numeroRecepisse}.`,
    null,
    { ...record }
  ).catch(() => {});

  return record;
}

/** Live list of filled declarations. */
export function subscribeToDeclarationAdmin(
  onData: (rows: DeclarationAdmin[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  return onSnapshot(
    query(collection(db, DECLARATION_ADMIN_COLLECTION)),
    (snap) => onData(snap.docs.map((d) => ({ ...(d.data() as DeclarationAdmin), id: d.id }))),
    (err) => {
      console.warn('[DeclarationAdmin] Listener error:', err);
      if (onError) onError(err);
      onData([]);
    }
  );
}
