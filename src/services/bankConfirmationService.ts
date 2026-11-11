import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { UserRole } from '../types';
import { logAuditEvent } from './dbService';
import { formatMoney } from '../utils/money';
import { normalizeReference, referenceClaimId } from '../utils/bankReference';
import { roundMoney } from '../utils/frenchNumber';
import { requireMoney } from '../utils/paymentAmounts';

/**
 * Bank Agent confirmations — the bank's word that a declared tax was paid.
 *
 * One confirmation per saved calculation, keyed `<kind>_<calculationId>`, so
 * the same declaration can never be confirmed twice. A confirmation is final:
 * the Firestore rules allow it to be created and read, never changed or
 * deleted.
 */
export const BANK_CONFIRMATIONS_COLLECTION = 'bankConfirmations';

/**
 * One claim per bank transfer reference.
 *
 * A reference pays one declaration. That rule used to be checked against the
 * caller's live list of confirmations — a snapshot capped at 2000 entries —
 * so two agents confirming at the same moment both passed the check, and once
 * the office held more than 2000 confirmations the oldest references fell out
 * of the list and could be used again. The claim is taken in the transaction
 * that files the confirmation, so Firestore serialises the two contenders on
 * the claim document itself.
 */
export const BANK_REFERENCE_CLAIMS_COLLECTION = 'bankReferenceClaims';

export type DeclarationKind = 'foncier' | 'locatif';

export const DECLARATION_KIND_LABELS: Record<DeclarationKind, string> = {
  foncier: 'Impôt foncier',
  locatif: 'Impôt locatif',
};

/** What a receipt in Historique des paiements can be for: a declaration, or a note de perception. */
export type ReceiptKind = DeclarationKind | 'notePerception';

export const RECEIPT_KIND_LABELS: Record<ReceiptKind, string> = {
  ...DECLARATION_KIND_LABELS,
  notePerception: 'Note de perception',
};

export interface BankConfirmation {
  /** `<kind>_<calculationId>`. */
  id: string;
  kind: DeclarationKind;
  calculationId: string;
  contribuableName: string;
  contribuableNif?: string;
  /** Amount confirmed paid, USD — the declared amount due. */
  amountUSD: number;
  modePaiement?: string;
  /** The payment reference the bank issued. */
  reference: string;
  confirmedAt: string;
  confirmedByUid: string;
  confirmedByName: string;
  /**
   * Official receipt number, issued in the same transaction as the
   * confirmation — a receipt exists only once the bank has confirmed. Read it
   * through `receiptNumberOf`, which also covers confirmations saved before
   * numbering existed.
   */
  receiptNumber?: string;
  /** Sequence behind `receiptNumber`, when it came from the counter. */
  receiptSequence?: number;
  /** What was declared — properties for the foncier, tenants for the locatif. */
  detail?: string;
  /** When the declaration itself was saved (ISO). */
  declaredAt?: string;
}

/** Counter behind the declaration receipt numbers (`RD-<year>-<00001>`). */
const RECEIPT_COUNTER_ID = 'declarationReceiptCounter';

/** Stable stand-in number for a confirmation saved without one. */
function fallbackReceiptNumber(id: string, confirmedAt: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const year = (confirmedAt || '').slice(0, 4) || String(new Date().getFullYear());
  return `RD-${year}-${h.toString(36).toUpperCase().padStart(7, '0').slice(-7)}`;
}

/** The receipt number printed for a confirmation. */
export const receiptNumberOf = (c: Pick<BankConfirmation, 'id' | 'receiptNumber' | 'confirmedAt'>) =>
  c.receiptNumber || fallbackReceiptNumber(c.id, c.confirmedAt);

/**
 * A receipt of Historique des paiements: a bank confirmation of a declaration,
 * or a note de perception's confirmed payment in the same shape.
 */
export type PaymentReceipt = Omit<BankConfirmation, 'kind'> & { kind: ReceiptKind };

export const confirmationId = (kind: DeclarationKind, calculationId: string) => `${kind}_${calculationId}`;

/** Normalised form a reference is compared in, to catch the same one typed twice. */
export { normalizeReference, referenceClaimId };

export interface ConfirmPaymentInput {
  kind: DeclarationKind;
  calculationId: string;
  contribuableName: string;
  contribuableNif?: string;
  amountUSD: number;
  modePaiement?: string;
  reference: string;
  /** What was declared, carried onto the receipt. */
  detail?: string;
  /** When the declaration was saved (ISO). */
  declaredAt?: string;
}

export async function confirmPayment(
  input: ConfirmPaymentInput,
  actor: { uid: string; displayName: string; role: UserRole },
  /** References already used, normalised — a reference pays one declaration. */
  usedReferences: Set<string>
): Promise<BankConfirmation> {
  requireMoney(input.amountUSD, 'Paiement');
  if (input.kind !== 'foncier' && input.kind !== 'locatif') throw new Error('Type de déclaration invalide.');
  const reference = input.reference.trim().replace(/\s+/g, ' ');
  if (!reference) throw new Error('Saisissez la référence du paiement.');
  if (usedReferences.has(normalizeReference(reference))) {
    throw new Error(`La référence « ${reference} » a déjà été utilisée pour un autre paiement.`);
  }
  if (!Number.isFinite(input.amountUSD) || input.amountUSD <= 0) {
    throw new Error('Cette déclaration n’a aucun montant à payer.');
  }

  const id = confirmationId(input.kind, input.calculationId);
  const ref = doc(db, BANK_CONFIRMATIONS_COLLECTION, id);
  const normalizedReference = normalizeReference(reference);
  const claimRef = doc(db, BANK_REFERENCE_CLAIMS_COLLECTION, referenceClaimId(normalizedReference));

  const record: BankConfirmation = {
    id,
    kind: input.kind,
    calculationId: input.calculationId,
    contribuableName: input.contribuableName,
    ...(input.contribuableNif ? { contribuableNif: input.contribuableNif } : {}),
    amountUSD: roundMoney(input.amountUSD),
    ...(input.modePaiement ? { modePaiement: input.modePaiement } : {}),
    reference,
    confirmedAt: new Date().toISOString(),
    confirmedByUid: actor.uid,
    confirmedByName: actor.displayName,
    ...(input.detail?.trim() ? { detail: input.detail.trim() } : {}),
    ...(input.declaredAt ? { declaredAt: input.declaredAt } : {}),
  };
  const year = record.confirmedAt.slice(0, 4);

  // Claim the confirmation inside a transaction. The check-then-write above
  // was a plain `getDoc` followed by an unconditional `setDoc`, so two agents
  // confirming the same declaration at the same moment both read "free" and
  // both wrote: the second silently replaced the first, destroying its
  // reference, its confirmer and its timestamp while the caller was told the
  // payment had been confirmed. Firestore serializes competing transactions on
  // the same document, so the loser re-reads inside its retry, sees the
  // existing confirmation and refuses.
  //
  // The official receipt number is issued in the same transaction, from a
  // counter that may only move forward, so a receipt exists exactly when — and
  // only when — the payment is confirmed, and no two receipts share a number.
  const counterRef = doc(db, 'counters', RECEIPT_COUNTER_ID);
  const commit = () =>
    runTransaction(db, async (transaction) => {
      const existing = await transaction.get(ref);
      if (existing.exists()) {
        throw new Error('Ce paiement a déjà été confirmé.');
      }
      // The accountant fills in "Réservé à l'administration" first.
      const filled = await transaction.get(doc(db, 'declarationAdmin', id));
      if (!filled.exists()) {
        throw new Error('Remplissez d’abord la déclaration (Réservé à l’administration).');
      }
      const calculation = await transaction.get(doc(db,
        input.kind === 'foncier' ? 'foncierCalculations' : 'taxCalculations', input.calculationId));
      if (!calculation.exists()) throw new Error('Cette déclaration n’existe plus.');
      const source = calculation.data();
      const amountDue = input.kind === 'foncier' ? source.totalImpotDuUSD : source.soldeUSD;
      if (!Number.isFinite(amountDue) || amountDue <= 0 || roundMoney(amountDue) !== record.amountUSD) {
        throw new Error('Le montant à confirmer ne correspond pas au solde de la déclaration. Rechargez la déclaration.');
      }
      // Firestore requires every read before the first write, including the counter.
      const counter = await transaction.get(counterRef);
      // A bank reference pays one declaration, and the claim is taken here —
      // inside the transaction that files the confirmation — rather than
      // against the caller's list of confirmations. Firestore serialises the
      // two contenders on this document, so the second one is refused instead
      // of acknowledging the same transfer twice.
      {
        const claim = await transaction.get(claimRef);
        if (claim.exists()) {
          throw new Error(`La référence « ${reference} » a déjà été utilisée pour un autre paiement.`);
        }
        transaction.set(claimRef, {
          reference,
          normalizedReference,
          kind: input.kind,
          calculationId: input.calculationId,
          confirmationId: id,
          claimedAt: record.confirmedAt,
        });
      }
      const next = (counter?.exists() ? Number(counter.data().currentSequence) || 0 : 0) + 1;
      record.receiptSequence = next;
      record.receiptNumber = `RD-${year}-${String(next).padStart(5, '0')}`;
      transaction.set(counterRef, { currentSequence: next, updatedAt: record.confirmedAt }, { merge: true });
      transaction.set(ref, record);
    });

  // Receipt numbering and reference reservation are required parts of confirmation.
  // Permission failures must not quietly disable either guarantee.
  await commit();

  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    'CONFIRM_BANK_PAYMENT',
    'BankConfirmation',
    id,
    `Paiement confirmé par la banque — ${DECLARATION_KIND_LABELS[input.kind]}, ${input.contribuableName} : ${formatMoney(
      record.amountUSD
    )}, référence ${reference}, reçu ${record.receiptNumber}.`,
    null,
    { ...record }
  ).catch(() => {});

  return record;
}

/** Live list of confirmations, newest first. */
export function subscribeToBankConfirmations(
  onData: (rows: BankConfirmation[]) => void,
  onError?: (err: unknown) => void,
  /** How many confirmations to read — the reports ask for a larger window. */
  limitCount: number | null = null
): Unsubscribe {
  return onSnapshot(
    query(collection(db, BANK_CONFIRMATIONS_COLLECTION), orderBy('confirmedAt', 'desc'), ...(limitCount === null ? [] : [limit(limitCount)])),
    (snap) => onData(snap.docs.map((d) => ({ ...(d.data() as BankConfirmation), id: d.id }))),
    (err) => {
      console.warn('[BankConfirmations] Listener error:', err);
      if (onError) onError(err);
      onData([]);
    }
  );
}
