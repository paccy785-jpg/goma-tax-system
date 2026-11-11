import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import { PaymentMethod, PAYMENT_METHOD_LABELS, UserRole } from '../types';
import { amountInFrenchWords, roundMoney } from '../utils/frenchNumber';
import { impotDu, soldeAPayer, TAUX_FIXE_PCT } from '../utils/taxCalc';
import { logAuditEvent } from './dbService';
import { intentId } from './idempotency';
import { formatMoney } from '../utils/money';

/**
 * Calculs d'impôts — the slips saved from the Calcul d'impôts card.
 *
 * A saved calculation is final: the Firestore rules allow it to be created
 * and read, never changed or deleted.
 */
export const TAX_CALCULATIONS_COLLECTION = 'taxCalculations';

/**
 * Mode de paiement offered on the Calcul d'impôts slip.
 *
 * Its own list, separate from the cashier's `PaymentMethod` channels: the
 * payment screens keep theirs, so payments already recorded are untouched.
 */
export type CalcPaymentMode = 'especes' | 'cheque_certifie' | 'virement' | 'credit_impot';

export const CALC_PAYMENT_MODE_LABELS: Record<CalcPaymentMode, string> = {
  especes: 'Espèces',
  cheque_certifie: 'Chèque certifié',
  virement: 'Virement',
  credit_impot: 'Crédit d’impôt',
};

/** Display order in the dropdown. */
export const CALC_PAYMENT_MODES: CalcPaymentMode[] = [
  'especes',
  'cheque_certifie',
  'virement',
  'credit_impot',
];

/**
 * Label of a saved row's mode de paiement. Rows saved before this list
 * existed carry a cashier channel; those still print their original label.
 */
export function calcPaymentModeLabel(mode: string): string {
  if (mode in CALC_PAYMENT_MODE_LABELS) return CALC_PAYMENT_MODE_LABELS[mode as CalcPaymentMode];
  if (mode === 'Cash_Guichet') return 'Espèces';
  return PAYMENT_METHOD_LABELS[mode as PaymentMethod] || mode;
}

/** Who the tax is calculated for — the one who will pay it. */
export type ContribuableType = 'bailleur' | 'locataire';

export const CONTRIBUABLE_TYPE_LABELS: Record<ContribuableType, string> = {
  bailleur: 'Bailleur',
  locataire: 'Locataire',
};

export interface Contribuable {
  type: ContribuableType;
  /** Full name as printed on the slip. */
  name: string;
  /** Taxpayer id for a bailleur; lease id for a locataire. */
  refId: string;
  /** NIF of a bailleur, when on file. */
  nif?: string;
  /** Where they are: the bailleur's address, or the let property's. */
  location?: string;
}

/** A locataire a bailleur's calculation is filed for. */
export interface CalcLocataire {
  leaseId: string;
  name: string;
  /** The let property: parcel and address, as on the lease. */
  numeroParcelle?: string;
  address?: string;
  /** Loyer mensuel and the lease's revenu brut for the exercice, USD. */
  monthlyRentUSD?: number;
  grossUSD?: number;
}

export interface TaxCalculation {
  id: string;
  /**
   * When the contribuable is a bailleur: the locataires this calculation is
   * paid for. Absent on a locataire's own calculation.
   */
  locataires?: CalcLocataire[];
  /** The bailleur or locataire the tax is due from. */
  contribuableType: ContribuableType;
  contribuableName: string;
  contribuableRefId: string;
  contribuableNif?: string;
  contribuableLocation?: string;
  /** (1) Revenu brut, USD. */
  revenuBrutUSD: number;
  /** (2) Taux, in percent. */
  tauxPct: number;
  /** (3) Impôt dû = (1) × (2), USD. */
  impotDuUSD: number;
  /** (4) Les retenues versées, USD. */
  retenuesUSD: number;
  /** (5) Solde à payer = (3) − (4), USD. Negative is an overpayment. */
  soldeUSD: number;
  /** (6) The solde spelled out in French, as printed at save time. */
  enToutesLettres: string;
  /** (7) Mode de paiement — a `CalcPaymentMode`; older rows may hold a cashier channel. */
  modePaiement: CalcPaymentMode | PaymentMethod;
  createdAt: string;
  createdByUid: string;
  createdByName: string;
}

export interface TaxCalculationInput {
  contribuable: Contribuable;
  locataires?: CalcLocataire[];
  revenuBrutUSD: number;
  retenuesUSD: number;
  modePaiement: CalcPaymentMode;
}

/** Spell out a solde, naming an overpayment rather than writing "moins …". */
export function soldeEnLettres(soldeUSD: number): string {
  const words = amountInFrenchWords(Math.abs(soldeUSD));
  const text = words.charAt(0).toUpperCase() + words.slice(1);
  return soldeUSD < 0 ? `Trop-perçu : ${words}` : text;
}

/**
 * Save one calculation.
 *
 * Lines (3), (5) and (6) are recomputed here from (1), (2) and (4) rather than
 * taken from the card, so a stored row can never carry figures that do not
 * follow from its own inputs.
 */
export async function addTaxCalculation(
  input: TaxCalculationInput,
  actor: { uid: string; displayName: string; role: UserRole }
): Promise<TaxCalculation> {
  const revenuBrutUSD = roundMoney(input.revenuBrutUSD);
  // The rate is fixed; it is never taken from the caller.
  const tauxPct = TAUX_FIXE_PCT;
  const retenuesUSD = roundMoney(input.retenuesUSD);

  const who = input.contribuable;
  if (!who || !who.name?.trim() || !who.refId || !CONTRIBUABLE_TYPE_LABELS[who.type]) {
    throw new Error('Sélectionnez le bailleur ou le locataire.');
  }
  if (!Number.isFinite(revenuBrutUSD) || revenuBrutUSD < 0) throw new Error('Revenu brut invalide.');
  if (!Number.isFinite(tauxPct) || tauxPct < 0 || tauxPct > 100) {
    throw new Error('Le taux doit être compris entre 0 et 100 %.');
  }
  if (!Number.isFinite(retenuesUSD) || retenuesUSD < 0) throw new Error('Retenues invalides.');
  if (!CALC_PAYMENT_MODE_LABELS[input.modePaiement]) throw new Error('Sélectionnez le mode de paiement.');

  const impotDuUSD = impotDu(revenuBrutUSD, tauxPct);
  const soldeUSD = soldeAPayer(impotDuUSD, retenuesUSD);

  const now = Date.now();
  const calc: TaxCalculation = {
    id: intentId('calc', 'irl.calculation', [
      who.type,
      who.refId,
      who.name,
      revenuBrutUSD,
      retenuesUSD,
      input.modePaiement,
      (input.locataires || []).map((l) => l.leaseId),
      actor.uid,
    ]),
    ...(who.type === 'bailleur' && input.locataires?.length
      ? {
          locataires: input.locataires.map((l) => ({
            leaseId: l.leaseId,
            name: l.name.trim(),
            ...(l.numeroParcelle ? { numeroParcelle: l.numeroParcelle } : {}),
            ...(l.address ? { address: l.address } : {}),
            ...(typeof l.monthlyRentUSD === 'number' ? { monthlyRentUSD: l.monthlyRentUSD } : {}),
            ...(typeof l.grossUSD === 'number' ? { grossUSD: l.grossUSD } : {}),
          })),
        }
      : {}),
    contribuableType: who.type,
    contribuableName: who.name.trim(),
    contribuableRefId: who.refId,
    ...(who.nif?.trim() ? { contribuableNif: who.nif.trim() } : {}),
    ...(who.location?.trim() ? { contribuableLocation: who.location.trim() } : {}),
    revenuBrutUSD,
    tauxPct,
    impotDuUSD,
    retenuesUSD,
    soldeUSD,
    enToutesLettres: soldeEnLettres(soldeUSD),
    modePaiement: input.modePaiement,
    createdAt: new Date(now).toISOString(),
    createdByUid: actor.uid,
    createdByName: actor.displayName,
  };

  await setDoc(doc(db, TAX_CALCULATIONS_COLLECTION, calc.id), calc);

  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    'CREATE_TAX_CALCULATION',
    'TaxCalculation',
    calc.id,
    `Calcul d'impôts enregistré — ${CONTRIBUABLE_TYPE_LABELS[who.type].toLowerCase()} ${who.name.trim()} : revenu brut ${formatMoney(revenuBrutUSD)} × ${tauxPct} % = ${formatMoney(impotDuUSD)}, ` +
      `retenues ${formatMoney(retenuesUSD)}, solde ${formatMoney(soldeUSD)} (${CALC_PAYMENT_MODE_LABELS[input.modePaiement]}).`,
    null,
    { ...calc }
  ).catch(() => {});

  return calc;
}

/** Live register of saved calculations, newest first. */
export function subscribeToTaxCalculations(
  onData: (rows: TaxCalculation[]) => void,
  onError?: (err: unknown) => void,
  limitCount: number | null = null
): Unsubscribe {
  const q = query(
    collection(db, TAX_CALCULATIONS_COLLECTION),
    orderBy('createdAt', 'desc'),
    ...(limitCount === null ? [] : [limit(limitCount)])
  );
  return onSnapshot(
    q,
    (snapshot) => onData(snapshot.docs.map((d) => ({ ...(d.data() as TaxCalculation), id: d.id }))),
    (err) => {
      console.warn('[TaxCalculations] Listener error:', err);
      if (onError) onError(err);
      onData([]);
    }
  );
}
