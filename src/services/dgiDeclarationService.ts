import { collection, doc, getDocs, onSnapshot, orderBy, query, setDoc, Unsubscribe, where } from 'firebase/firestore';
import { db } from '../firebase/config';
import { UserRole } from '../types';
import { logAuditEvent } from './dbService';
import type { DgiCalculImpot, MontantDevise } from './dgiCalculImpotService';
import { dgiDeclarationDocId, hasPaymentForCalcul } from '../utils/dgiRecords';

/**
 * Declarations filled in from the DGI portal's Accountant tab ("Fill in
 * declaration"). A saved declaration is final — the Firestore rules allow
 * create and read only.
 */
export const DGI_DECLARATIONS_COLLECTION = 'dgiDeclarations';

/** The modes de paiement offered: Espèces only. */
export const DGI_MODES_PAIEMENT = ['Espèces'] as const;
export type DgiModePaiement = (typeof DGI_MODES_PAIEMENT)[number];

export interface DgiDeclaration {
  id: string;
  contribuableId: string;
  contribuableName: string;
  contribuableNif: string;
  /** Avenue, quartier, commune — as shown under the taxpayer on the card. */
  contribuableAdresse?: string;
  modePaiement: DgiModePaiement;
  /**
   * The Calcul d'impôt (Declarations tab) this payment settles. Absent on
   * payments saved before the card asked for it.
   */
  calculId?: string;
  /**
   * Montant payé — the "Impôt total dû" of that declaration, one amount per
   * currency, copied when the payment is saved. (A single amount on payments
   * saved before it was taken from the declaration.)
   */
  montantPaye?: MontantDevise[] | MontantDevise;
  /** yyyy-mm-dd. */
  date: string;
  qualite: string;
  numeroQuittance: string;
  /** yyyy-mm-dd. */
  dateQuittance: string;
  createdAt: string;
  createdByUid: string;
  createdByName: string;
}

export type DgiDeclarationInput = Pick<
  DgiDeclaration,
  'contribuableId' | 'contribuableName' | 'contribuableNif' | 'contribuableAdresse' | 'modePaiement' | 'calculId' | 'montantPaye' | 'date' | 'qualite' | 'numeroQuittance' | 'dateQuittance'
>;

const isDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

export async function saveDgiDeclaration(
  input: DgiDeclarationInput,
  actor: { uid: string; displayName: string; role: UserRole }
): Promise<DgiDeclaration> {
  const clean = (v: string) => (v || '').trim().replace(/\s+/g, ' ');
  if (!input.contribuableId) throw new Error('Choisissez le contribuable.');
  if (!DGI_MODES_PAIEMENT.includes(input.modePaiement)) throw new Error('Choisissez le mode de paiement.');
  if (!input.calculId) throw new Error('Choisissez la déclaration payée.');
  const montants = Array.isArray(input.montantPaye) ? input.montantPaye : input.montantPaye ? [input.montantPaye] : [];
  if (
    montants.length === 0 ||
    montants.some((m) => !Number.isFinite(m.montant) || m.montant < 0 || (m.devise !== 'USD' && m.devise !== 'CDF'))
  ) {
    throw new Error('Le montant de la déclaration est introuvable.');
  }
  if (!isDay(input.date)) throw new Error('Saisissez la date.');
  if (!clean(input.qualite)) throw new Error('Saisissez la qualité.');
  if (!clean(input.numeroQuittance)) throw new Error('Saisissez le numéro de la quittance.');
  if (!isDay(input.dateQuittance)) throw new Error('Saisissez la date de la quittance.');

  // One payment settles one Calcul d'impôt. The payment always stands for the
  // whole "Impôt total dû", so settling the same calculation twice would
  // collect the tax twice — two receipts, and a collected total that reads
  // double. A saved declaration is final (the rules allow create and read
  // only), so the second payment could not be withdrawn either: it is filed
  // under a derived id, and the database refuses the second write.
  const settled = await getDocs(
    query(collection(db, DGI_DECLARATIONS_COLLECTION), where('calculId', '==', input.calculId))
  );
  if (hasPaymentForCalcul(settled.docs.map((d) => d.data() as DgiDeclaration), input.calculId)) {
    throw new Error('Cette déclaration a déjà été réglée par un paiement.');
  }

  const ref = doc(db, DGI_DECLARATIONS_COLLECTION, dgiDeclarationDocId(input.calculId));
  const record: DgiDeclaration = {
    id: ref.id,
    contribuableId: input.contribuableId,
    contribuableName: input.contribuableName || '',
    contribuableNif: input.contribuableNif || '',
    contribuableAdresse: input.contribuableAdresse || '',
    modePaiement: input.modePaiement,
    calculId: input.calculId,
    montantPaye: montants.map((m) => ({ montant: Math.round(m.montant * 100) / 100, devise: m.devise })),
    date: input.date,
    qualite: clean(input.qualite),
    numeroQuittance: clean(input.numeroQuittance),
    dateQuittance: input.dateQuittance,
    createdAt: new Date().toISOString(),
    createdByUid: actor.uid,
    createdByName: actor.displayName,
  };
  await setDoc(ref, record);

  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    'FILL_DGI_DECLARATION',
    'RevenueDeclaration',
    record.id,
    `Déclaration remplie — ${record.contribuableName} : ${record.modePaiement}, quittance ${record.numeroQuittance}.`,
    null,
    { ...record }
  ).catch(() => {});

  return record;
}

/** Live list of saved declarations, newest first. */
export function subscribeToDgiDeclarations(
  onData: (rows: DgiDeclaration[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  return onSnapshot(
    query(collection(db, DGI_DECLARATIONS_COLLECTION), orderBy('createdAt', 'desc')),
    (snap) => onData(snap.docs.map((d) => ({ ...(d.data() as DgiDeclaration), id: d.id }))),
    (err) => {
      console.warn('[DgiDeclaration] Listener error:', err);
      if (onError) onError(err);
      onData([]);
    }
  );
}

/**
 * "Impôt total dû" of a declaration (Calcul d'impôt): the sum of its lines,
 * one amount per currency (USD first), never converted. A declaration whose
 * total is zero gives one zero amount in the currency of its first line.
 */
export function impotTotalDuOf(calcul: DgiCalculImpot): MontantDevise[] {
  const sums: Record<'USD' | 'CDF', number> = { USD: 0, CDF: 0 };
  const seen = new Set<'USD' | 'CDF'>();
  for (const l of calcul.lignes || []) {
    const m = l.impotTotalDu;
    if (!m || !Number.isFinite(m.montant)) continue;
    const d = m.devise === 'CDF' ? 'CDF' : 'USD';
    sums[d] += m.montant;
    seen.add(d);
  }
  const out = (['USD', 'CDF'] as const)
    .filter((d) => seen.has(d) && sums[d] !== 0)
    .map((d) => ({ montant: Math.round(sums[d] * 100) / 100, devise: d }));
  if (out.length > 0) return out;
  const first = (calcul.lignes || [])[0]?.impotTotalDu?.devise === 'CDF' ? 'CDF' : 'USD';
  return seen.size > 0 ? [{ montant: 0, devise: first }] : [];
}

/**
 * The amount a payment stands for, taken from the tax declarations: the
 * "Impôt total dû" of the declaration it settles; for a payment saved before
 * that link, the most recent declaration of the same taxpayer; and only when
 * the taxpayer has no declaration, the amount stored on the payment itself.
 */
export function montantsPayesOf(d: DgiDeclaration, calculs: DgiCalculImpot[]): MontantDevise[] {
  const linked = d.calculId ? calculs.find((c) => c.id === d.calculId) : undefined;
  if (linked) return impotTotalDuOf(linked);
  if (!d.calculId) {
    const latest = calculs
      .filter((c) => c.contribuableId === d.contribuableId)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))[0];
    if (latest) return impotTotalDuOf(latest);
  }
  const m = d.montantPaye;
  return Array.isArray(m) ? m : m ? [m] : [];
}

/** Sum of the amounts paid, per currency (USD and CDF never added together). */
export function sumMontantsPayes(rows: DgiDeclaration[], calculs: DgiCalculImpot[]): { usd: number; cdf: number } {
  let usd = 0;
  let cdf = 0;
  for (const d of rows) {
    for (const m of montantsPayesOf(d, calculs)) {
      if (!Number.isFinite(m.montant)) continue;
      if (m.devise === 'CDF') cdf += m.montant;
      else usd += m.montant;
    }
  }
  return { usd: Math.round(usd * 100) / 100, cdf: Math.round(cdf * 100) / 100 };
}
