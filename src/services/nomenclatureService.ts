import {
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  Unsubscribe,
} from 'firebase/firestore';
import { dprnkDb } from '../firebase/config';

/**
 * The Nomenclatures des Impôts list is shared by the DPRNK and DGI portals: it
 * always lives in the DPRNK database, so a tax added, corrected or deleted on
 * either portal is the same on both.
 */
const nomDb = () => dprnkDb();
import { UserRole } from '../types';
import { logAuditEvent } from './dbService';
import { formatMoney } from '../utils/money';

/**
 * Nomenclatures des Impôts — the reference list of taxes: for each budget
 * article, its fait générateur, its periodicity and its rate.
 */
export const NOMENCLATURES_COLLECTION = 'nomenclaturesImpots';

export interface NomenclatureImpot {
  id: string;
  /** Titre — the heading the tax belongs under. Optional: some taxes have none. */
  titre?: string;
  /** Article budgétaire — one entry per article. */
  articleBudgetaire: string;
  /** Libellé — the name of the tax. Absent on entries saved before it was added. */
  libelle?: string;
  /** Fait générateur — what makes the tax due. */
  faitGenerateur: string;
  /** Périodicité — how often it is due. */
  periodicite: string;
  /** Taux — as written on the nomenclature (e.g. "300", "15 %"). */
  taux: string;
  /**
   * Devise du taux — the currency a bare amount is shown in, or GRATUIT when
   * the item is free (no amount). Absent on entries saved before the choice
   * existed; those are in US dollars.
   */
  devise?: TauxDevise;
  createdAt: string;
  createdByUid: string;
  createdByName: string;
  /** Last correction, if any. */
  updatedAt?: string;
  updatedByUid?: string;
  updatedByName?: string;
}

export type NomenclatureInput = Pick<NomenclatureImpot, 'articleBudgetaire' | 'faitGenerateur' | 'periodicite' | 'taux'> & {
  titre: string;
  libelle: string;
  devise: TauxDevise | '';
};

/** Currencies a taux can be shown in. */
export type Devise = 'USD' | 'CDF';
/** A currency, or GRATUIT for an item that costs nothing. */
export type TauxDevise = Devise | 'GRATUIT';
export const DEVISES: { id: TauxDevise; label: string; button: string }[] = [
  { id: 'USD', label: 'Dollar américain', button: 'USD ($)' },
  { id: 'CDF', label: 'Franc congolais', button: 'CDF (FC)' },
  { id: 'GRATUIT', label: 'Gratuit — aucun montant', button: 'Gratuit' },
];

/**
 * How a taux reads, in its currency. A bare amount ("300", "1 500", "2,5") is
 * formatted in the chosen currency — "300$" or "300 FC"; anything already
 * carrying its own unit ("15 %", "30 $/m²") is shown exactly as written.
 */
export function formatTaux(raw: string, devise: TauxDevise = 'USD'): string {
  if (devise === 'GRATUIT') return 'Gratuit';
  const t = (raw || '').trim();
  if (!t) return '—';
  if (/^\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:[.,]\d+)?$|^\d+(?:[.,]\d+)?$/.test(t)) {
    const n = Number(t.replace(/[ \u00a0\u202f]/g, '').replace(',', '.'));
    if (Number.isFinite(n)) {
      if (devise === 'CDF') {
        return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n)}\u00a0FC`;
      }
      return formatMoney(n);
    }
  }
  return t;
}

/** Suggested periodicities; any other value may be typed. */
export const PERIODICITES = ['Décennale', 'Annuelle', 'Semestrielle', 'Trimestrielle', 'Mensuelle', 'Journalière', 'Ponctuelle (à chaque acte)'];

/** How an article is compared, so the same article typed twice is caught. */
export const normalizeArticle = (s: string) => s.trim().replace(/\s+/g, ' ').toUpperCase();

const clean = (s: string) => (s || '').trim().replace(/\s+/g, ' ');

/** How a title is compared — the same rule the table uses to group taxes. */
export const titleKey = (s?: string) => clean(s || '').toLocaleLowerCase('fr');
const libelleKey = (s?: string) => clean(s || '').toLocaleLowerCase('fr');

/**
 * One document per tax: its title, article budgétaire and libellé together.
 * Taxes under one title may share an article (each with its own libellé);
 * the exact same tax can never be saved twice.
 */
function idFor(titre: string, article: string, libelle: string): string {
  const raw = `${titleKey(titre)}§${normalizeArticle(article)}§${libelleKey(libelle)}`;
  const enc = encodeURIComponent(raw);
  if (enc.length <= 1400) return `nom_${enc}`;
  // Very long titles and libellés: a short, stable fingerprint instead.
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `nom_h_${h1.toString(36)}${h2.toString(36)}_${raw.length}`;
}

/** Why a tax can't be saved alongside the ones already in the nomenclature. */
export type NomenclatureConflict =
  | { kind: 'autre-titre'; titre: string; message: string }
  | { kind: 'doublon'; message: string };

/**
 * The sharing rule for articles budgétaires:
 *  - taxes under the same title may share an article (the case of a table
 *    whose taxes all carry one article);
 *  - an article already used under a different title — or by a tax without a
 *    title — is refused, so two tables never mix their articles;
 *  - the exact same tax (same title, article and libellé) is refused.
 * `excludeId` leaves out the entry being corrected.
 */
export function findNomenclatureConflict(
  input: Pick<NomenclatureInput, 'titre' | 'articleBudgetaire' | 'libelle'>,
  existing: NomenclatureImpot[],
  excludeId?: string
): NomenclatureConflict | null {
  const art = normalizeArticle(input.articleBudgetaire || '');
  if (!art) return null;
  const tk = titleKey(input.titre);
  const lk = libelleKey(input.libelle);
  const sameArticle = existing.filter((r) => r.id !== excludeId && normalizeArticle(r.articleBudgetaire) === art);
  const other = sameArticle.find((r) => titleKey(r.titre) !== tk);
  if (other) {
    const t = clean(other.titre || '');
    return {
      kind: 'autre-titre',
      titre: t,
      message: t
        ? `Cet article budgétaire est déjà utilisé sous le titre « ${t} ». Les impôts qui partagent un article doivent avoir le même titre.`
        : 'Cet article budgétaire est déjà utilisé par un impôt sans titre. Les impôts qui partagent un article doivent avoir le même titre.',
    };
  }
  if (lk && sameArticle.some((r) => libelleKey(r.libelle) === lk)) {
    return {
      kind: 'doublon',
      message: 'Cet impôt figure déjà dans la nomenclature : même titre, même article budgétaire et même libellé.',
    };
  }
  return null;
}

export async function addNomenclature(
  input: NomenclatureInput,
  actor: { uid: string; displayName: string; role: UserRole },
  /** The nomenclature as loaded — checked against the article-sharing rule. */
  existing: NomenclatureImpot[] = []
): Promise<NomenclatureImpot> {
  const titre = clean(input.titre);
  const articleBudgetaire = clean(input.articleBudgetaire);
  const libelle = clean(input.libelle);
  const faitGenerateur = (input.faitGenerateur || '').trim();
  const periodicite = clean(input.periodicite);
  const devise = input.devise;
  // A free item has no amount.
  const taux = devise === 'GRATUIT' ? '' : clean(input.taux);

  if (!articleBudgetaire) throw new Error("Saisissez l'article budgétaire.");
  if (!libelle) throw new Error('Saisissez le libellé.');
  if (!faitGenerateur) throw new Error('Saisissez le fait générateur.');
  if (!periodicite) throw new Error('Saisissez la périodicité.');
  if (devise !== 'USD' && devise !== 'CDF' && devise !== 'GRATUIT') {
    throw new Error('Choisissez la devise du taux, ou Gratuit.');
  }
  if (devise !== 'GRATUIT' && !taux) throw new Error('Saisissez le taux.');

  const conflict = findNomenclatureConflict({ titre, articleBudgetaire, libelle }, existing);
  if (conflict) throw new Error(conflict.message);

  const id = idFor(titre, articleBudgetaire, libelle);
  const row: NomenclatureImpot = {
    id,
    ...(titre ? { titre } : {}),
    articleBudgetaire,
    libelle,
    faitGenerateur,
    periodicite,
    taux,
    devise,
    createdAt: new Date().toISOString(),
    createdByUid: actor.uid,
    createdByName: actor.displayName,
  };

  // Claim the tax inside a transaction: the same tax is never entered twice.
  const ref = doc(nomDb(), NOMENCLATURES_COLLECTION, id);
  await runTransaction(nomDb(), async (tx) => {
    const taken = await tx.get(ref);
    if (taken.exists()) {
      throw new Error('Cet impôt figure déjà dans la nomenclature : même titre, même article budgétaire et même libellé.');
    }
    tx.set(ref, row);
  });

  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    'CREATE_NOMENCLATURE',
    'NomenclatureImpot',
    id,
    `Nomenclature ajoutée — article budgétaire ${articleBudgetaire} (${libelle}), périodicité ${periodicite}, taux ${formatTaux(taux, devise)}.`
  ).catch(() => {});

  return row;
}

/**
 * Correct an entry. Its title, article or libellé may change too: the entry
 * then moves to its new document inside one transaction. The article-sharing
 * rule applies as when adding.
 */
export async function updateNomenclature(
  row: NomenclatureImpot,
  input: NomenclatureInput,
  actor: { uid: string; displayName: string; role: UserRole },
  existing: NomenclatureImpot[] = []
): Promise<NomenclatureImpot> {
  const titre = clean(input.titre);
  const articleBudgetaire = clean(input.articleBudgetaire);
  const libelle = clean(input.libelle);
  const faitGenerateur = (input.faitGenerateur || '').trim();
  const periodicite = clean(input.periodicite);
  const devise = input.devise;
  // A free item has no amount.
  const taux = devise === 'GRATUIT' ? '' : clean(input.taux);

  if (!articleBudgetaire) throw new Error("Saisissez l'article budgétaire.");
  if (!libelle) throw new Error('Saisissez le libellé.');
  if (!faitGenerateur) throw new Error('Saisissez le fait générateur.');
  if (!periodicite) throw new Error('Saisissez la périodicité.');
  if (devise !== 'USD' && devise !== 'CDF' && devise !== 'GRATUIT') {
    throw new Error('Choisissez la devise du taux, ou Gratuit.');
  }
  if (devise !== 'GRATUIT' && !taux) throw new Error('Saisissez le taux.');

  const conflict = findNomenclatureConflict({ titre, articleBudgetaire, libelle }, existing, row.id);
  if (conflict) throw new Error(conflict.message);

  const newId = idFor(titre, articleBudgetaire, libelle);
  const updated: NomenclatureImpot = {
    ...row,
    id: newId,
    titre: titre || undefined,
    articleBudgetaire,
    libelle,
    faitGenerateur,
    periodicite,
    taux,
    devise,
    updatedAt: new Date().toISOString(),
    updatedByUid: actor.uid,
    updatedByName: actor.displayName,
  };
  const { id: _id, ...rest } = updated;
  // The title is optional: a cleared title is left off the saved entry.
  const data = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));

  const oldRef = doc(nomDb(), NOMENCLATURES_COLLECTION, row.id);
  const newRef = doc(nomDb(), NOMENCLATURES_COLLECTION, newId);
  await runTransaction(nomDb(), async (tx) => {
    const current = await tx.get(oldRef);
    if (!current.exists()) throw new Error("Cette nomenclature n'existe plus.");
    if (newId !== row.id) {
      const taken = await tx.get(newRef);
      if (taken.exists()) {
        throw new Error('Cet impôt figure déjà dans la nomenclature : même titre, même article budgétaire et même libellé.');
      }
      tx.set(newRef, { ...data, id: newId });
      tx.delete(oldRef);
    } else {
      tx.set(oldRef, { ...data, id: newId });
    }
  });

  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    'UPDATE_NOMENCLATURE',
    'NomenclatureImpot',
    newId,
    `Nomenclature modifiée — article budgétaire ${row.articleBudgetaire}${
      row.articleBudgetaire !== articleBudgetaire ? ` → ${articleBudgetaire}` : ''
    } (${libelle}), périodicité ${periodicite}, taux ${formatTaux(taux, devise)}.`
  ).catch(() => {});

  return updated;
}

/** Remove one entry from the nomenclature. */
export async function deleteNomenclature(
  row: NomenclatureImpot,
  actor: { uid: string; displayName: string; role: UserRole }
): Promise<void> {
  await deleteDoc(doc(nomDb(), NOMENCLATURES_COLLECTION, row.id));
  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    'DELETE_NOMENCLATURE',
    'NomenclatureImpot',
    row.id,
    `Nomenclature supprimée — article budgétaire ${row.articleBudgetaire}${row.libelle ? ` (${row.libelle})` : ''}.`
  ).catch(() => {});
}

/** Natural order of budget articles (1.1.2 before 1.1.10); taxes sharing an article in the order they were added. */
const byArticle = (a: NomenclatureImpot, b: NomenclatureImpot) =>
  a.articleBudgetaire.localeCompare(b.articleBudgetaire, 'fr', { numeric: true, sensitivity: 'base' }) ||
  (a.createdAt || '').localeCompare(b.createdAt || '');

export function subscribeToNomenclatures(
  onData: (rows: NomenclatureImpot[]) => void,
  onError?: (err: unknown) => void
): Unsubscribe {
  return onSnapshot(
    query(collection(nomDb(), NOMENCLATURES_COLLECTION), orderBy('createdAt', 'desc'), limit(2000)),
    (snap) => onData(snap.docs.map((d) => ({ ...(d.data() as NomenclatureImpot), id: d.id })).sort(byArticle)),
    (err) => {
      console.warn('[Nomenclatures] Listener error:', err);
      if (onError) onError(err);
      onData([]);
    }
  );
}
