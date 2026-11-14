import { collection, doc, getDocs, onSnapshot, orderBy, query, setDoc, Unsubscribe, where } from 'firebase/firestore';
import { db } from '../firebase/config';
import { UserRole } from '../types';
import { logAuditEvent } from './dbService';
import type { Devise } from './nomenclatureService';
import { dgiCalculDocId, dgiPeriode, hasCalculForPeriod } from '../utils/dgiRecords';

/**
 * Calculs d'impôt of the DGI portal (Registration → Calcul d'impôt): one saved
 * "Nouveau calcul" card per record, with one line per catégorie salariale.
 * A saved calcul is final — the Firestore rules allow create and read only.
 */
export const DGI_CALCULS_IMPOT_COLLECTION = 'dgiCalculsImpot';

/** An amount and the currency it was saved in. */
export interface MontantDevise {
  montant: number;
  devise: Devise;
}

/** One catégorie salariale of a calcul, with the figures of its form. */
export interface DgiCalculLigne {
  categorie: string;
  nombre: number;
  remunerationsBrutes: MontantDevise;
  remunerationsImposables: MontantDevise;
  montantIpr: MontantDevise;
  montantIer: MontantDevise;
  impotTotalDu: MontantDevise;
}

export interface DgiCalculImpot {
  id: string;
  contribuableId: string;
  contribuableName: string;
  contribuableNif: string;
  /** "Salaires du mois de": 1 (Janvier) to 12 (Décembre). */
  salairesMois: number;
  /** "Année". */
  annee: number;
  /** yyyy-mm, from the two above — kept for sorting and filtering. */
  periode: string;
  lignes: DgiCalculLigne[];
  createdAt: string;
  createdByUid: string;
  createdByName: string;
}

export type DgiCalculImpotInput = Pick<
  DgiCalculImpot,
  'contribuableId' | 'contribuableName' | 'contribuableNif' | 'salairesMois' | 'annee' | 'lignes'
>;

/** The months of "Salaires du mois de", as on the taxpayer enrolment form. */
export const MOIS = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
] as const;

/** The years offered by "Année", as on the taxpayer enrolment form: 2020 to 2035. */
export const ANNEES: number[] = Array.from({ length: 2035 - 2020 + 1 }, (_, i) => 2020 + i);

/** The month's name, or "—". */
export const moisLabel = (m?: number) => (m && m >= 1 && m <= 12 ? MOIS[m - 1] : '—');

/** yyyy-mm → mm/yyyy. */
export const frPeriode = (p?: string) => (p && /^\d{4}-\d{2}$/.test(p) ? `${p.slice(5)}/${p.slice(0, 4)}` : p || '—');

export async function saveDgiCalculImpot(
  input: DgiCalculImpotInput,
  actor: { uid: string; displayName: string; role: UserRole }
): Promise<DgiCalculImpot> {
  if (!input.contribuableId) throw new Error('Choisissez le contribuable.');
  if (!Number.isInteger(input.salairesMois) || input.salairesMois < 1 || input.salairesMois > 12) {
    throw new Error('Choisissez le mois des salaires.');
  }
  if (!Number.isInteger(input.annee) || input.annee < 1900) throw new Error('Choisissez l’année.');
  if (input.lignes.length === 0) throw new Error('Sélectionnez au moins une catégorie salariale.');

  const periode = dgiPeriode(input.annee, input.salairesMois);

  // One calculation per taxpayer and period. A saved calcul is final — the
  // rules allow create and read only — so a second one for the same month
  // cannot be corrected or withdrawn: it would simply add the tax a second
  // time to every total. The card is filed under a derived id, so the
  // database refuses the second write as well.
  const existing = await getDocs(
    query(collection(db, DGI_CALCULS_IMPOT_COLLECTION), where('contribuableId', '==', input.contribuableId))
  );
  const already = existing.docs.some(
    (d) => hasCalculForPeriod([d.data() as DgiCalculImpot], input.contribuableId, periode)
  );
  if (already) {
    throw new Error(
      `Un calcul d’impôt existe déjà pour ce contribuable pour la période ${frPeriode(periode)}.`
    );
  }

  const ref = doc(db, DGI_CALCULS_IMPOT_COLLECTION, dgiCalculDocId(input.contribuableId, periode));
  const record: DgiCalculImpot = {
    id: ref.id,
    contribuableId: input.contribuableId,
    contribuableName: input.contribuableName || '',
    contribuableNif: input.contribuableNif || '',
    salairesMois: input.salairesMois,
    annee: input.annee,
    periode,
    lignes: input.lignes,
    createdAt: new Date().toISOString(),
    createdByUid: actor.uid,
    createdByName: actor.displayName,
  };
  await setDoc(ref, record);

  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    'CREATE_DGI_CALCUL_IMPOT',
    'TaxCalculation',
    record.id,
    `Calcul d’impôt enregistré — ${record.contribuableName}, salaires du mois de ${moisLabel(record.salairesMois)} ${record.annee} : ${record.lignes
      .map((l) => l.categorie)
      .join(', ')}.`,
    null,
    { ...record }
  ).catch(() => {});

  return record;
}

/** Live list of saved calculs, newest first. */
export function subscribeToDgiCalculsImpot(
  onData: (rows: DgiCalculImpot[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  return onSnapshot(
    query(collection(db, DGI_CALCULS_IMPOT_COLLECTION), orderBy('createdAt', 'desc')),
    (snap) => onData(snap.docs.map((d) => ({ ...(d.data() as DgiCalculImpot), id: d.id }))),
    (err) => {
      console.warn('[DgiCalculImpot] Listener error:', err);
      if (onError) onError(err);
      onData([]);
    }
  );
}
