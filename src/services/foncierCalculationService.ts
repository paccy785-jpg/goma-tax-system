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
import { PropertyMeasureKind, UserRole } from '../types';
import { roundMoney } from '../utils/frenchNumber';
import { logAuditEvent } from './dbService';
import { intentId } from './idempotency';
import { formatMoney } from '../utils/money';

/**
 * Calculs d'impôts Fonciers — slips saved from the foncier Nouveau calcul card.
 *
 * One calculation holds one or more lines, one per rang / usage:
 *
 *   (5) Montant impôt  = (3) Superficie ou nombre × (4) Taux
 *   (6) Total impôt dû = Σ (5) over the lines
 *
 * Same tariff logic as the Identification des Propriétés register: the taux is
 * USD per m² for a surface, USD per unit for a count. A saved calculation is
 * final — the Firestore rules allow create and read, never update or delete.
 */
export const FONCIER_CALCULATIONS_COLLECTION = 'foncierCalculations';

/** (7) Mode de paiement offered on the foncier slip. */
export type FoncierPaymentMode =
  | 'especes'
  | 'avis_certification'
  | 'cheque_certifie'
  | 'virement'
  | 'credit_impot';

export const FONCIER_PAYMENT_MODE_LABELS: Record<FoncierPaymentMode, string> = {
  especes: 'Espèces',
  avis_certification: 'Avis de certification',
  cheque_certifie: 'Chèque certifié',
  virement: 'Virement',
  credit_impot: 'Crédit d’impôt',
};

/** Display order in the dropdown. */
export const FONCIER_PAYMENT_MODES: FoncierPaymentMode[] = [
  'especes',
  'avis_certification',
  'cheque_certifie',
  'virement',
  'credit_impot',
];

export interface FoncierLine {
  /** The bailleur's declared property this line taxes. */
  parcelId?: string;
  numeroParcelle?: string;
  /** NOTEZ 1 nature of the property, as declared. */
  nature?: string;
  /** Full address, ville → parcelle, for tooltips. */
  address?: string;
  /** Each address level of the property, as declared. */
  villeTerritoire?: string;
  communeChefferie?: string;
  quartierGroupement?: string;
  avenueLocalite?: string;
  /** (1) Rang — id from the rang register. */
  rang: string;
  rangDesignation?: string;
  /** (2) Usage — code from the usage register. */
  usage: string;
  usageDesignation?: string;
  /** (3) Superficie (m²) or nombre (units). */
  measureKind: PropertyMeasureKind;
  measureValue: number;
  /** (4) Taux, USD per m² or per unit. */
  tauxUSD: number;
  /** (5) Montant impôt = (3) × (4). */
  montantImpotUSD: number;
}

export interface FoncierBailleur {
  /** Taxpayer id of the property owner. */
  id: string;
  name: string;
  nif?: string;
  location?: string;
}

export interface FoncierCalculation {
  id: string;
  /** The bailleur who owes the tax. Absent only on slips saved before it was asked. */
  bailleurId?: string;
  bailleurName?: string;
  bailleurNif?: string;
  bailleurLocation?: string;
  lines: FoncierLine[];
  /** (6) Total impôt dû = Σ (5). */
  totalImpotDuUSD: number;
  /** (7) Mode de paiement. Absent only on slips saved before it was asked. */
  modePaiement?: FoncierPaymentMode;
  createdAt: string;
  createdByUid: string;
  createdByName: string;
}

/** (5) for one line, to the cent. */
export function montantFoncier(measureValue: number, tauxUSD: number): number {
  if (!Number.isFinite(measureValue) || !Number.isFinite(tauxUSD)) return 0;
  return roundMoney(measureValue * tauxUSD);
}

/** (6) across lines, to the cent. */
export function totalFoncier(lines: Pick<FoncierLine, 'measureValue' | 'tauxUSD'>[]): number {
  return roundMoney(lines.reduce((sum, l) => sum + montantFoncier(l.measureValue, l.tauxUSD), 0));
}

export type FoncierLineInput = Omit<FoncierLine, 'montantImpotUSD'>;

/**
 * Save one calculation. (5) and (6) are recomputed here from (3) and (4), so a
 * stored slip can never carry an amount that does not follow from its inputs.
 */
export async function addFoncierCalculation(
  bailleur: FoncierBailleur,
  linesIn: FoncierLineInput[],
  modePaiement: FoncierPaymentMode,
  actor: { uid: string; displayName: string; role: UserRole }
): Promise<FoncierCalculation> {
  if (!bailleur?.id || !bailleur.name?.trim()) throw new Error('Sélectionnez le bailleur.');
  if (!linesIn.length) throw new Error('Sélectionnez au moins une propriété du bailleur.');
  if (!FONCIER_PAYMENT_MODE_LABELS[modePaiement]) throw new Error('Sélectionnez le mode de paiement.');

  const lines: FoncierLine[] = linesIn.map((l, i) => {
    const n = i + 1;
    if (!l.rang) throw new Error(`Ligne ${n} : sélectionnez le rang.`);
    if (!l.usage) throw new Error(`Ligne ${n} : sélectionnez l’usage.`);
    if (l.measureKind !== 'superficie' && l.measureKind !== 'nombre') {
      throw new Error(`Ligne ${n} : choisissez superficie ou nombre.`);
    }
    if (!Number.isFinite(l.measureValue) || l.measureValue <= 0) {
      throw new Error(`Ligne ${n} : ${l.measureKind === 'superficie' ? 'superficie' : 'nombre'} invalide.`);
    }
    if (l.measureKind === 'nombre' && !Number.isInteger(l.measureValue)) {
      throw new Error(`Ligne ${n} : le nombre doit être un entier.`);
    }
    if (!Number.isFinite(l.tauxUSD) || l.tauxUSD < 0) throw new Error(`Ligne ${n} : taux invalide.`);
    return {
      ...(l.parcelId ? { parcelId: l.parcelId } : {}),
      ...(l.numeroParcelle ? { numeroParcelle: l.numeroParcelle } : {}),
      ...(l.nature ? { nature: l.nature } : {}),
      ...(l.address ? { address: l.address } : {}),
      ...(l.villeTerritoire ? { villeTerritoire: l.villeTerritoire } : {}),
      ...(l.communeChefferie ? { communeChefferie: l.communeChefferie } : {}),
      ...(l.quartierGroupement ? { quartierGroupement: l.quartierGroupement } : {}),
      ...(l.avenueLocalite ? { avenueLocalite: l.avenueLocalite } : {}),
      rang: l.rang,
      ...(l.rangDesignation ? { rangDesignation: l.rangDesignation } : {}),
      usage: l.usage,
      ...(l.usageDesignation ? { usageDesignation: l.usageDesignation } : {}),
      measureKind: l.measureKind,
      measureValue: l.measureValue,
      tauxUSD: l.tauxUSD,
      montantImpotUSD: montantFoncier(l.measureValue, l.tauxUSD),
    };
  });

  const now = Date.now();
  const calc: FoncierCalculation = {
    id: intentId('fon', 'foncier.calculation', [
      bailleur.id,
      modePaiement,
      lines.map((l) => [l.parcelId, l.rang, l.usage, l.measureKind, l.measureValue, l.tauxUSD]),
      actor.uid,
    ]),
    bailleurId: bailleur.id,
    bailleurName: bailleur.name.trim(),
    ...(bailleur.nif?.trim() ? { bailleurNif: bailleur.nif.trim() } : {}),
    ...(bailleur.location?.trim() ? { bailleurLocation: bailleur.location.trim() } : {}),
    lines,
    totalImpotDuUSD: totalFoncier(lines),
    modePaiement,
    createdAt: new Date(now).toISOString(),
    createdByUid: actor.uid,
    createdByName: actor.displayName,
  };

  await setDoc(doc(db, FONCIER_CALCULATIONS_COLLECTION, calc.id), calc);

  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    'CREATE_FONCIER_CALCULATION',
    'TaxCalculation',
    calc.id,
    `Calcul d'impôt foncier enregistré pour ${bailleur.name.trim()} — ${lines.length} ligne${lines.length === 1 ? '' : 's'}, total impôt dû ${formatMoney(calc.totalImpotDuUSD)} (${FONCIER_PAYMENT_MODE_LABELS[modePaiement]}).`,
    null,
    { ...calc }
  ).catch(() => {});

  return calc;
}

/** Live register of saved foncier calculations, newest first. */
export function subscribeToFoncierCalculations(
  onData: (rows: FoncierCalculation[]) => void,
  onError?: (err: unknown) => void,
  limitCount = 300
): Unsubscribe {
  const q = query(
    collection(db, FONCIER_CALCULATIONS_COLLECTION),
    orderBy('createdAt', 'desc'),
    limit(limitCount)
  );
  return onSnapshot(
    q,
    (snapshot) =>
      onData(snapshot.docs.map((d) => ({ ...(d.data() as FoncierCalculation), id: d.id }))),
    (err) => {
      console.warn('[FoncierCalculations] Listener error:', err);
      if (onError) onError(err);
      onData([]);
    }
  );
}
