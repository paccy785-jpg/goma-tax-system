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
import { amountInFrenchWords, roundMoney } from '../utils/frenchNumber';
import { requireMoney } from '../utils/paymentAmounts';
import { formatMoney } from '../utils/money';
import { localDateFromIsoTimestamp, todayDateString } from '../utils/date';
import { normalizeReference, referenceClaimId } from '../utils/bankReference';
import type { PaymentReceipt } from './bankConfirmationService';

/** The payment modes the bureau comptable may record on a note de perception, in order. */
export const NOTE_PERCEPTION_PAYMENT_MODES = [
  { id: 'especes', label: 'Espèces', numbered: false },
  { id: 'cheque_bancaire', label: 'Chèque bancaire numéro', numbered: true },
  { id: 'cheque_postal', label: 'Chèque postal numéro', numbered: true },
  { id: 'bordereau_versement', label: 'Bordereau de versement (B)', numbered: false },
  { id: 'avis_credit', label: 'Avis de crédit numéro', numbered: true },
] as const;

export type NotePerceptionPaymentModeId = (typeof NOTE_PERCEPTION_PAYMENT_MODES)[number]['id'];

export const notePerceptionPaymentMode = (id: string) => NOTE_PERCEPTION_PAYMENT_MODES.find((m) => m.id === id);

/**
 * How the mode reads on the note: "Espèces", "Bordereau de versement (B)", or —
 * for a cheque or a credit advice — the mode with its number, "Chèque bancaire n° 004512".
 */
export function modePaiementText(
  id: NotePerceptionPaymentModeId,
  numero?: string,
  banque?: string,
  /** YYYY-MM-DD — the day the cheque was written. */
  dateCheque?: string
): string {
  const m = notePerceptionPaymentMode(id)!;
  if (!m.numbered) return m.label;
  const text = `${m.label.replace(/ numéro$/, '')} n° ${clean(numero)}`;
  if (id !== 'cheque_bancaire') return text;
  const day = dateCheque ? ` — Date du chèque : ${dateCheque.split('-').reverse().join('/')}` : '';
  return `${text} — Banque : ${clean(banque)}${day}`;
}

const clean = (s?: string) => (s || '').trim().replace(/\s+/g, ' ');

/**
 * Notes de perception.
 *
 * A note is filled in by sections, one per service. The first — "Remplir par
 * le service Taxateur" — is captured here and is final once saved: the
 * Firestore rules refuse any later change to it, so a note's taxation can
 * never be rewritten after the fact. Later sections are added beside it.
 */
export const NOTES_PERCEPTION_COLLECTION = 'notesPerception';

/** The part of the note filled in by the service taxateur. */
export interface TaxateurSection {
  /**
   * The taxpayer the note is issued to — picked from the taxpayer register.
   * Optional in the type only because notes saved before this field existed
   * do not carry it; every new note must name one.
   */
  contribuableId?: string;
  contribuableName?: string;
  contribuableNif?: string;
  /** 1. Numéro de facture ou note de taxation (débit). */
  numeroFacture: string;
  /** 2. Article budgétaire. */
  articleBudgetaire: string;
  /** 3. Nombre d'actes. */
  nombreActes: number;
  /** 4. Arrêté numéro. */
  arreteNumero: string;
  /** 5. Montant taxe en chiffres, USD. */
  montantUSD: number;
  /** 6. Montant taxe en lettres — always derived from (5), never typed. */
  montantEnLettres: string;
  /** 7. Nom de l'agent taxateur. */
  nomAgent: string;
  /** 8. Qualité. */
  qualite: string;
  /**
   * Signature, as drawn — a PNG data URL. No longer captured on the card;
   * kept on notes saved before it was removed.
   */
  signature?: string;
  filledAt: string;
  filledByUid: string;
  filledByName: string;
}

/** The part of the note filled in by the ordonnateur — added after the taxateur's. */
export interface OrdonnateurSection {
  /** The taxpayer the ordonnance is for — picked from the taxpayer register. */
  contribuableId: string;
  contribuableName: string;
  contribuableNif?: string;
  /** Avis de l'ordonnateur. */
  avis: string;
  /** Montant ordonné en chiffres, USD. */
  montantOrdonneUSD: number;
  /** Montant ordonné en lettres — derived from the figures, never typed. */
  montantOrdonneEnLettres: string;
  /** Le paiement doit intervenir au plus tard le — YYYY-MM-DD. */
  paiementAuPlusTardLe: string;
  /** Date d'ordonnancement — YYYY-MM-DD. */
  dateOrdonnancement: string;
  /** Nom de l'ordonnateur. */
  nomOrdonnateur: string;
  /**
   * Signature de l'ordonnateur, as drawn — a PNG data URL. No longer captured
   * on the card; kept on ordonnances saved before it was removed.
   */
  signature?: string;
  filledAt: string;
  filledByUid: string;
  filledByName: string;
}

/**
 * The part of the note filled in by the bureau comptable — the payment itself,
 * recorded at the bank once the service taxateur has filled in the note.
 */
export interface ComptableSection {
  /** Code ou désignation du bureau comptable. */
  bureauComptable: string;
  /** Mode de paiement, as it reads on the note — with its number for a cheque or a credit advice. */
  modePaiement: string;
  /** Which mode (absent on payments recorded before the modes were listed). */
  modePaiementId?: NotePerceptionPaymentModeId;
  /** The cheque or credit-advice number, for the modes that carry one. */
  modePaiementNumero?: string;
  /** The bank the cheque is drawn on — Chèque bancaire only. */
  modePaiementBanque?: string;
  /** YYYY-MM-DD — the day the cheque was written. Chèque bancaire only. */
  modePaiementDateCheque?: string;
  /** Quittance numéro. */
  quittanceNumero: string;
  /** Montant en chiffres, USD — the note's taxed amount, read from the note itself. */
  montantUSD: number;
  /** Montant en lettres — derived from the figures, never typed. */
  montantEnLettres: string;
  /** Nom du comptable. */
  nomComptable: string;
  /** Signature du comptable — legacy only; the comptable now signs the printed note by hand. */
  signature?: string;
  /** Date — YYYY-MM-DD. */
  date: string;
  filledAt: string;
  filledByUid: string;
  filledByName: string;
}

/** The bank's confirmation that a note de perception was paid — final once saved. */
export interface PaiementConfirmation {
  /** The payment reference the bank issued. */
  reference: string;
  confirmedAt: string;
  confirmedByUid: string;
  confirmedByName: string;
  /**
   * Receipt number (`RD-<year>-<00001>`), from the same counter as the
   * declarations' receipts — the note then appears in Historique des paiements.
   */
  receiptNumber?: string;
  receiptSequence?: number;
}

export interface NotePerception {
  id: string;
  taxateur: TaxateurSection;
  /** Present once the ordonnateur has filled in their part. */
  ordonnateur?: OrdonnateurSection;
  /** Present once the bureau comptable has recorded the payment. */
  comptable?: ComptableSection;
  /** Present once the payment has been confirmed, after the comptable's part. */
  confirmation?: PaiementConfirmation;
  createdAt: string;
  createdByUid: string;
  createdByName: string;
}

export type TaxateurInput = Omit<
  TaxateurSection,
  'montantEnLettres' | 'filledAt' | 'filledByUid' | 'filledByName'
>;

/** How a note number is compared, so the same number typed twice is caught. */
export const normalizeNumero = (s: string) => s.trim().replace(/\s+/g, ' ').toUpperCase();

/** One document per note number — two notes can never share a number. */
const noteIdFor = (numero: string) => `np_${encodeURIComponent(normalizeNumero(numero))}`;

/** "Cent cinq dollars américains" — the amount in words, as printed. */
export function montantEnLettres(montantUSD: number): string {
  const words = amountInFrenchWords(roundMoney(montantUSD));
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

export async function addNotePerception(
  input: TaxateurInput,
  actor: { uid: string; displayName: string; role: UserRole }
): Promise<NotePerception> {
  const contribuableName = (input.contribuableName || '').trim();
  const contribuableNif = (input.contribuableNif || '').trim();
  const numeroFacture = input.numeroFacture.trim().replace(/\s+/g, ' ');
  const articleBudgetaire = input.articleBudgetaire.trim();
  const arreteNumero = input.arreteNumero.trim();
  const nomAgent = input.nomAgent.trim().replace(/\s+/g, ' ');
  const qualite = input.qualite.trim();
  const montantUSD = roundMoney(input.montantUSD);

  if (!input.contribuableId || !contribuableName) throw new Error('Sélectionnez le contribuable.');
  if (!numeroFacture) throw new Error('Saisissez le numéro de la facture ou de la note de taxation.');
  if (!articleBudgetaire) throw new Error("Saisissez l'article budgétaire.");
  if (!Number.isInteger(input.nombreActes) || input.nombreActes <= 0) {
    throw new Error("Le nombre d'actes doit être un nombre entier supérieur à zéro.");
  }
  if (!arreteNumero) throw new Error("Saisissez le numéro de l'arrêté.");
  if (!Number.isFinite(montantUSD) || montantUSD <= 0) {
    throw new Error('Le montant de la taxe doit être supérieur à zéro.');
  }
  if (!nomAgent) throw new Error("Saisissez le nom de l'agent taxateur.");
  if (!qualite) throw new Error("Saisissez la qualité de l'agent taxateur.");

  const now = new Date().toISOString();
  const id = noteIdFor(numeroFacture);
  const note: NotePerception = {
    id,
    taxateur: {
      contribuableId: input.contribuableId,
      contribuableName,
      ...(contribuableNif ? { contribuableNif } : {}),
      numeroFacture,
      articleBudgetaire,
      nombreActes: input.nombreActes,
      arreteNumero,
      montantUSD,
      montantEnLettres: montantEnLettres(montantUSD),
      nomAgent,
      qualite,
      filledAt: now,
      filledByUid: actor.uid,
      filledByName: actor.displayName,
    },
    createdAt: now,
    createdByUid: actor.uid,
    createdByName: actor.displayName,
  };

  // Claim the number inside a transaction: two officers saving the same note
  // number at once cannot both succeed.
  const ref = doc(db, NOTES_PERCEPTION_COLLECTION, id);
  await runTransaction(db, async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists()) throw new Error('Une note de perception porte déjà ce numéro.');
    tx.set(ref, note);
  });

  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    'CREATE_NOTE_PERCEPTION',
    'NotePerception',
    id,
    `Note de perception ${numeroFacture} enregistrée — contribuable ${contribuableName}, article budgétaire ${articleBudgetaire}, ${
      input.nombreActes
    } acte(s), arrêté n° ${arreteNumero}, montant ${formatMoney(montantUSD)}, agent taxateur ${nomAgent} (${qualite}).`
  ).catch(() => {});

  return note;
}

/** The day the service taxateur filled the note (YYYY-MM-DD, local). */
export const dateTaxationOf = (note: NotePerception) =>
  localDateFromIsoTimestamp(note.taxateur?.filledAt || note.createdAt);

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export type OrdonnanceInput = Omit<
  OrdonnateurSection,
  'montantOrdonneEnLettres' | 'filledAt' | 'filledByUid' | 'filledByName'
>;

/**
 * Record the ordonnateur's part of a note de perception.
 *
 * It is written once, beside the taxateur's part, and is final: a note already
 * ordonnancée is refused here and by the Firestore rules.
 */
export async function addOrdonnance(
  note: NotePerception,
  input: OrdonnanceInput,
  actor: { uid: string; displayName: string; role: UserRole }
): Promise<OrdonnateurSection> {
  const contribuableName = (input.contribuableName || '').trim();
  const contribuableNif = (input.contribuableNif || '').trim();
  const avis = input.avis.trim();
  const nomOrdonnateur = input.nomOrdonnateur.trim().replace(/\s+/g, ' ');
  const montantOrdonneUSD = roundMoney(input.montantOrdonneUSD);
  const today = todayDateString();
  const dateTaxation = dateTaxationOf(note);

  if (!input.contribuableId || !contribuableName) throw new Error('Sélectionnez le contribuable.');
  if (!avis) throw new Error("Saisissez l'avis de l'ordonnateur.");
  if (!Number.isFinite(montantOrdonneUSD) || montantOrdonneUSD <= 0) {
    throw new Error('Le montant ordonné doit être supérieur à zéro.');
  }
  if (!DAY.test(input.dateOrdonnancement)) throw new Error("Saisissez la date d'ordonnancement.");
  if (input.dateOrdonnancement > today) {
    throw new Error("La date d'ordonnancement ne peut pas être dans le futur.");
  }
  if (input.dateOrdonnancement < dateTaxation) {
    throw new Error("La date d'ordonnancement ne peut pas précéder la date de taxation.");
  }
  if (!DAY.test(input.paiementAuPlusTardLe)) {
    throw new Error('Saisissez la date limite de paiement.');
  }
  if (input.paiementAuPlusTardLe < input.dateOrdonnancement) {
    throw new Error("La date limite de paiement ne peut pas précéder la date d'ordonnancement.");
  }
  if (!nomOrdonnateur) throw new Error("Saisissez le nom de l'ordonnateur.");

  const section: OrdonnateurSection = {
    contribuableId: input.contribuableId,
    contribuableName,
    ...(contribuableNif ? { contribuableNif } : {}),
    avis,
    montantOrdonneUSD,
    montantOrdonneEnLettres: montantEnLettres(montantOrdonneUSD),
    paiementAuPlusTardLe: input.paiementAuPlusTardLe,
    dateOrdonnancement: input.dateOrdonnancement,
    nomOrdonnateur,
    filledAt: new Date().toISOString(),
    filledByUid: actor.uid,
    filledByName: actor.displayName,
  };

  // Re-read the note inside a transaction: two officers ordering the same
  // note at once cannot both succeed, and an ordonnance is never overwritten.
  const ref = doc(db, NOTES_PERCEPTION_COLLECTION, note.id);
  await runTransaction(db, async (tx) => {
    const fresh = await tx.get(ref);
    if (!fresh.exists()) throw new Error("Cette note de perception n'existe plus.");
    if ((fresh.data() as NotePerception).ordonnateur) {
      throw new Error('Cette note de perception a déjà été ordonnancée.');
    }
    tx.update(ref, { ordonnateur: section });
  });

  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    'ORDER_NOTE_PERCEPTION',
    'NotePerception',
    note.id,
    `Ordonnance enregistrée — note de perception ${note.taxateur.numeroFacture}, contribuable ${contribuableName} : montant ordonné ${formatMoney(
      montantOrdonneUSD
    )}, paiement au plus tard le ${section.paiementAuPlusTardLe}, ordonnancée le ${section.dateOrdonnancement} par ${nomOrdonnateur}.`
  ).catch(() => {});

  return section;
}

export type PaiementInput = Pick<
  ComptableSection,
  'bureauComptable' | 'quittanceNumero' | 'nomComptable' | 'date'
> & {
  modePaiementId: NotePerceptionPaymentModeId | '';
  /** Required for Chèque bancaire, Chèque postal and Avis de crédit. */
  modePaiementNumero?: string;
  /** Required for Chèque bancaire. */
  modePaiementBanque?: string;
  /** Required for Chèque bancaire — YYYY-MM-DD, not after the payment date. */
  modePaiementDateCheque?: string;
};

/** The message when a cheque or credit-advice number is missing. */
export function numeroModeError(id: NotePerceptionPaymentModeId): string {
  if (id === 'cheque_bancaire') return 'Saisissez le numéro du chèque bancaire.';
  if (id === 'cheque_postal') return 'Saisissez le numéro du chèque postal.';
  return "Saisissez le numéro de l'avis de crédit.";
}

/** How a quittance number is compared, so the same number typed twice is caught. */
export const normalizeQuittance = (s: string) => s.trim().replace(/\s+/g, ' ').toUpperCase();

/**
 * Record the bureau comptable's part of a note de perception — the payment.
 *
 * Any note the service taxateur has filled in can be paid; the amount recorded
 * is the note's taxed amount, read from the note itself — never typed. Written
 * once, then final: a note already paid is refused here and by the Firestore
 * rules.
 */
export async function addPaiementComptable(
  note: NotePerception,
  input: PaiementInput,
  actor: { uid: string; displayName: string; role: UserRole },
  /** Quittance numbers already recorded, normalised — a quittance pays one note. */
  usedQuittances: Set<string>
): Promise<ComptableSection> {
  const bureauComptable = input.bureauComptable.trim().replace(/\s+/g, ' ');
  const mode = notePerceptionPaymentMode(input.modePaiementId);
  const modePaiementNumero = (input.modePaiementNumero || '').trim().replace(/\s+/g, ' ');
  const quittanceNumero = input.quittanceNumero.trim().replace(/\s+/g, ' ');
  const nomComptable = input.nomComptable.trim().replace(/\s+/g, ' ');
  const today = todayDateString();
  // The bank fills its part once the taxateur and the ordonnateur have filled theirs.
  if (!note.ordonnateur) throw new Error("Cette note de perception n'a pas encore été ordonnancée.");

  if (!bureauComptable) throw new Error('Saisissez le code ou la désignation du bureau comptable.');
  if (!mode) throw new Error('Sélectionnez le mode de paiement.');
  if (mode.numbered && !modePaiementNumero) throw new Error(numeroModeError(mode.id));
  const modePaiementBanque = clean(input.modePaiementBanque);
  if (mode.id === 'cheque_bancaire' && !modePaiementBanque) throw new Error('Saisissez la banque du chèque.');
  const modePaiementDateCheque = (input.modePaiementDateCheque || '').trim();
  if (mode.id === 'cheque_bancaire') {
    if (!DAY.test(modePaiementDateCheque)) throw new Error('Saisissez la date du chèque.');
    if (modePaiementDateCheque > today) throw new Error('La date du chèque ne peut pas être dans le futur.');
    if (DAY.test(input.date) && modePaiementDateCheque > input.date) {
      throw new Error('La date du chèque ne peut pas être postérieure à la date du paiement.');
    }
  }
  const modePaiement = modePaiementText(mode.id, modePaiementNumero, modePaiementBanque, modePaiementDateCheque);
  if (!quittanceNumero) throw new Error('Saisissez le numéro de la quittance.');
  if (usedQuittances.has(normalizeQuittance(quittanceNumero))) {
    throw new Error('Ce numéro de quittance a déjà été utilisé pour une autre note de perception.');
  }
  if (!nomComptable) throw new Error('Saisissez le nom du comptable.');
  if (!DAY.test(input.date)) throw new Error('Saisissez la date du paiement.');
  if (input.date > today) throw new Error('La date du paiement ne peut pas être dans le futur.');
  if (input.date < dateTaxationOf(note)) {
    throw new Error('La date du paiement ne peut pas précéder la date de taxation.');
  }

  const ref = doc(db, NOTES_PERCEPTION_COLLECTION, note.id);
  let section: ComptableSection | null = null;
  // Re-read the note inside a transaction: the amount is the one taxed on the
  // stored note, and two agents paying the same note at once cannot both succeed.
  await runTransaction(db, async (tx) => {
    const fresh = await tx.get(ref);
    if (!fresh.exists()) throw new Error("Cette note de perception n'existe plus.");
    const data = fresh.data() as NotePerception;
    if (data.comptable) throw new Error('Le paiement de cette note de perception a déjà été enregistré.');
    if (!data.ordonnateur) throw new Error("Cette note de perception n'a pas encore été ordonnancée.");
    const montantUSD = roundMoney(data.taxateur.montantUSD);
    section = {
      bureauComptable,
      modePaiement,
      modePaiementId: mode.id,
      ...(mode.numbered ? { modePaiementNumero } : {}),
      ...(mode.id === 'cheque_bancaire' ? { modePaiementBanque, modePaiementDateCheque } : {}),
      quittanceNumero,
      montantUSD,
      montantEnLettres: montantEnLettres(montantUSD),
      nomComptable,
      date: input.date,
      filledAt: new Date().toISOString(),
      filledByUid: actor.uid,
      filledByName: actor.displayName,
    };
    tx.update(ref, { comptable: section });
  });
  const saved = section as unknown as ComptableSection;

  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    'PAY_NOTE_PERCEPTION',
    'NotePerception',
    note.id,
    `Paiement enregistré — note de perception ${note.taxateur.numeroFacture} : ${formatMoney(
      saved.montantUSD
    )}, quittance n° ${quittanceNumero}, ${modePaiement}, bureau comptable ${bureauComptable}, comptable ${nomComptable}, le ${input.date}.`
  ).catch(() => {});

  return saved;
}

/**
 * The amount of a recorded payment. Payments saved before the payment took the
 * note's taxed amount carry it under their earlier field name.
 */
export const montantPaiementUSD = (c: ComptableSection): number =>
  typeof c.montantUSD === 'number' ? c.montantUSD :
    typeof (c as unknown as Record<string, unknown>).montantOrdonneUSD === 'number'
      ? (c as unknown as Record<string, number>).montantOrdonneUSD : NaN;
export const montantPaiementEnLettres = (c: ComptableSection): string =>
  c.montantEnLettres || String((c as unknown as Record<string, unknown>)['montantOrdonneEnLettres'] || '') || montantEnLettres(montantPaiementUSD(c));

/** Live list of notes, newest first. */
export function subscribeToNotesPerception(
  onData: (rows: NotePerception[]) => void,
  onError?: (err: unknown) => void,
  /** How many notes to read — the reports ask for a larger window. */
  limitCount: number | null = null
): Unsubscribe {
  return onSnapshot(
    query(collection(db, NOTES_PERCEPTION_COLLECTION), orderBy('createdAt', 'desc'), ...(limitCount === null ? [] : [limit(limitCount)])),
    (snap) => onData(snap.docs.map((d) => ({ ...(d.data() as NotePerception), id: d.id }))),
    (err) => {
      console.warn('[NotesPerception] Listener error:', err);
      if (onError) onError(err);
      onData([]);
    }
  );
}

/** The bank reference claims, shared with the declarations' confirmations. */
const BANK_REFERENCE_CLAIMS = 'bankReferenceClaims';

/**
 * Confirm the payment of a note de perception — only once the comptable has
 * filled in their part. The reference is claimed in the same transaction, in
 * the claims the declarations use, so one bank reference pays one thing.
 */
export async function confirmerPaiementNote(
  note: NotePerception,
  referenceInput: string,
  actor: { uid: string; displayName: string; role: UserRole },
  /** References already used, normalised. */
  usedReferences: Set<string>
): Promise<PaiementConfirmation> {
  const reference = referenceInput.trim().replace(/\s+/g, ' ');
  if (!reference) throw new Error('Saisissez la référence du paiement.');
  const normalizedReference = normalizeReference(reference);
  if (usedReferences.has(normalizedReference)) {
    throw new Error(`La référence « ${reference} » a déjà été utilisée pour un autre paiement.`);
  }
  if (!note.comptable) throw new Error("Le comptable n'a pas encore rempli cette note de perception.");

  const ref = doc(db, NOTES_PERCEPTION_COLLECTION, note.id);
  const claimRef = doc(db, BANK_REFERENCE_CLAIMS, referenceClaimId(normalizedReference));
  const confirmation: PaiementConfirmation = {
    reference,
    confirmedAt: new Date().toISOString(),
    confirmedByUid: actor.uid,
    confirmedByName: actor.displayName,
  };
  // The receipt number is issued in the same transaction, from the counter the
  // declarations' receipts use, so no two receipts share a number.
  const counterRef = doc(db, 'counters', 'declarationReceiptCounter');
  const year = confirmation.confirmedAt.slice(0, 4);
  const commit = () =>
    runTransaction(db, async (tx) => {
      const fresh = await tx.get(ref);
      if (!fresh.exists()) throw new Error("Cette note de perception n'existe plus.");
      const data = fresh.data() as NotePerception;
      if (!data.comptable) throw new Error("Le comptable n'a pas encore rempli cette note de perception.");
      if (data.confirmation) throw new Error('Ce paiement a déjà été confirmé.');
      if (/^NP-DEMO-/i.test(data.taxateur?.numeroFacture || '')) throw new Error('Une note de démonstration ne peut pas être encaissée.');
      const amount = requireMoney(montantPaiementUSD(data.comptable), 'Paiement');
      if (amount !== requireMoney(data.taxateur?.montantUSD, 'Montant taxé')) {
        throw new Error('Le paiement enregistré ne correspond pas au montant taxé.');
      }
      const claim = await tx.get(claimRef);
      if (claim.exists()) {
        throw new Error(`La référence « ${reference} » a déjà été utilisée pour un autre paiement.`);
      }
      const record: PaiementConfirmation = { ...confirmation };
      {
        const counter = await tx.get(counterRef);
        const next = (counter.exists() ? Number(counter.data().currentSequence) || 0 : 0) + 1;
        record.receiptSequence = next;
        record.receiptNumber = `RD-${year}-${String(next).padStart(5, '0')}`;
        tx.set(counterRef, { currentSequence: next, updatedAt: record.confirmedAt }, { merge: true });
      }
      tx.set(claimRef, {
        reference,
        normalizedReference,
        kind: 'notePerception',
        calculationId: note.id,
        confirmationId: `notePerception_${note.id}`,
        claimedAt: record.confirmedAt,
      });
      tx.update(ref, { confirmation: record });
      return record;
    });
  const saved = await commit();

  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    'CONFIRM_NOTE_PERCEPTION_PAYMENT',
    'NotePerception',
    note.id,
    `Paiement confirmé — note de perception ${note.taxateur.numeroFacture} : ${formatMoney(
      montantPaiementUSD(note.comptable)
    )}, référence ${reference}${saved.receiptNumber ? `, reçu ${saved.receiptNumber}` : ''}.`
  ).catch(() => {});

  return saved;
}

/**
 * A note de perception whose payment is confirmed, as a receipt of Historique
 * des paiements — the same shape as a declaration's bank confirmation.
 */
export function noteReceipt(n: NotePerception): PaymentReceipt | null {
  if (!n.confirmation || !n.comptable || /^NP-DEMO-/i.test(n.taxateur?.numeroFacture || '')) return null;
  const c = n.comptable;
  const name = (n.taxateur?.contribuableName || n.ordonnateur?.contribuableName || '').trim();
  const nif = (n.taxateur?.contribuableNif || n.ordonnateur?.contribuableNif || '').trim();
  const day = dateTaxationOf(n);
  return {
    id: `notePerception_${n.id}`,
    kind: 'notePerception',
    calculationId: n.id,
    contribuableName: name || 'Non renseigné',
    ...(nif ? { contribuableNif: nif } : {}),
    amountUSD: montantPaiementUSD(c),
    modePaiement: c.modePaiement,
    reference: n.confirmation.reference,
    confirmedAt: n.confirmation.confirmedAt,
    confirmedByUid: n.confirmation.confirmedByUid,
    confirmedByName: n.confirmation.confirmedByName,
    ...(n.confirmation.receiptNumber ? { receiptNumber: n.confirmation.receiptNumber } : {}),
    ...(n.confirmation.receiptSequence ? { receiptSequence: n.confirmation.receiptSequence } : {}),
    detail: `Note de perception ${n.taxateur.numeroFacture} — quittance n° ${c.quittanceNumero}`,
    ...(day ? { declaredAt: `${day}T12:00:00` } : {}),
  };
}
