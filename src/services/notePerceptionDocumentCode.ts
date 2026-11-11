import { doc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase/config';

/** One permanent print code per saved note, including notes filed before numbering.
 * Identity is the note ID, never the taxpayer ID: another note for the same
 * taxpayer receives its own code, while every reprint keeps the original code.
 */
export async function issueNotePerceptionDocumentCode(noteId: string): Promise<string> {
  if (!noteId) throw new Error('Sélectionnez une note enregistrée.');
  const ref = doc(db, 'npDocuments', noteId);
  const counterRef = doc(db, 'counters', 'npDocuments');
  return runTransaction(db, async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists()) {
      const code = existing.data().code;
      if (typeof code !== 'string' || !/^NP\d{6,}$/.test(code)) throw new Error('Code de note invalide.');
      return code;
    }
    const note = await tx.get(doc(db, 'notesPerception', noteId));
    if (!note.exists()) throw new Error('Cette note de perception n’existe plus.');
    const counter = await tx.get(counterRef);
    const current = counter.exists() ? counter.data().currentSequence : 0;
    if (!Number.isSafeInteger(current) || current < 0 || current >= Number.MAX_SAFE_INTEGER) {
      throw new Error('Compteur des notes de perception invalide.');
    }
    const sequence = current + 1;
    const code = `NP${String(sequence).padStart(6, '0')}`;
    const createdAt = new Date().toISOString();
    tx.set(counterRef, { currentSequence: sequence, lastCode: code, updatedAt: createdAt }, { merge: true });
    tx.set(ref, { noteId, code, sequence, createdAt });
    return code;
  });
}
