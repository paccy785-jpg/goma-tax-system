import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase/config';
import { UserRole } from '../types';
import { logAuditEvent } from './dbService';

/**
 * Document numbers of the printed declarations — Impôt foncier (IF) and
 * Impôt sur les revenus locatifs (IRL) — from the Profil du contribuable.
 *
 * A declaration document is one taxpayer + one declaration type + one exercice
 * fiscal. It gets its number the first time it is printed — CPF000001,
 * CPF000002, … — and keeps that number for good: printing it again shows the
 * same number. Another document (another taxpayer, the other declaration type,
 * or another exercice fiscal) takes the next number. One sequence is shared by
 * both declarations, so a number is never used twice.
 *
 * - The sequence lives in counters/{CPF_DOCUMENT_COUNTER_ID}; the counters
 *   rules only let it advance, so a number is never issued again.
 * - Each document's number lives in cpfDocuments/{taxpayerId_type_exercice};
 *   the rules make it write-once, so a document's number never changes.
 */
export const CPF_DOCUMENT_COUNTER_ID = 'cpfDeclarationDocuments';
export const CPF_DOCUMENTS_COLLECTION = 'cpfDocuments';

/** "CPF" followed by the number, padded to six digits: 7 → CPF000007. */
export const formatCpfDocumentCode = (n: number) => `CPF${String(n).padStart(6, '0')}`;

export interface CpfDocumentMeta {
  declType: 'foncier' | 'locatif';
  taxpayerId: string;
  taxpayerName: string;
  nif?: string;
  exercice: number;
}

export interface CpfDocumentActor {
  uid: string;
  displayName: string;
  role: UserRole;
}

/** The id of a declaration document: taxpayer + declaration type + exercice fiscal. */
export const cpfDocumentId = (m: Pick<CpfDocumentMeta, 'declType' | 'taxpayerId' | 'exercice'>) =>
  `${m.taxpayerId}_${m.declType}_${m.exercice}`;

/**
 * The number of this declaration document: the one it already has, or — the
 * first time it is printed — the next number in the sequence. Throws if the
 * number could not be read or reserved.
 */
export async function issueCpfDocumentCode(meta: CpfDocumentMeta, actor?: CpfDocumentActor | null): Promise<string> {
  const counterRef = doc(db, 'counters', CPF_DOCUMENT_COUNTER_ID);
  const docRef = doc(db, CPF_DOCUMENTS_COLLECTION, cpfDocumentId(meta));

  const { code, isNew } = await runTransaction(db, async (tx) => {
    // A transaction does all of its reads before any write.
    const existing = await tx.get(docRef);
    if (existing.exists()) {
      const kept = String(existing.data().code || '');
      if (kept) return { code: kept, isNew: false };
    }
    const counter = await tx.get(counterRef);
    const current = counter.exists() ? Number(counter.data().currentSequence) || 0 : 0;
    const next = Math.floor(current) + 1;
    const nextCode = formatCpfDocumentCode(next);
    const now = new Date().toISOString();
    tx.set(counterRef, {
      id: CPF_DOCUMENT_COUNTER_ID,
      currentSequence: next,
      lastCode: nextCode,
      updatedAt: now,
    });
    tx.set(docRef, {
      id: docRef.id,
      code: nextCode,
      sequence: next,
      declType: meta.declType,
      taxpayerId: meta.taxpayerId,
      taxpayerName: meta.taxpayerName,
      nif: meta.nif || '',
      exercice: meta.exercice,
      createdAt: now,
      createdByUid: actor?.uid ?? '',
      createdByName: actor?.displayName ?? '',
    });
    return { code: nextCode, isNew: true };
  });

  if (actor) {
    const title =
      meta.declType === 'foncier'
        ? 'Déclaration de l’impôt foncier (IF)'
        : 'Déclaration de l’impôt sur les revenus locatifs (IRL)';
    await logAuditEvent(
      actor.uid,
      actor.displayName,
      actor.role,
      'PRINT_DECLARATION_DOCUMENT',
      'RevenueDeclaration',
      code,
      `${title} ${isNew ? 'imprimée' : 'réimprimée'} — document ${code}, ${meta.taxpayerName}${
        meta.nif ? ` (NIF ${meta.nif})` : ''
      }, exercice fiscal ${meta.exercice}.`
    ).catch(() => {});
  }
  return code;
}
