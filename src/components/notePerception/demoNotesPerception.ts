/**
 * TEMPORARY — demonstration data for the Note de Perception tab.
 *
 * Writes a handful of sample notes through the same service functions the
 * cards use (so every rule and validation applies), against taxpayers and
 * nomenclature articles already registered in the system: some paid by the
 * agent bancaire (they appear under "Note de perception"), some still waiting.
 *
 * Every sample note's number starts with DEMO_PREFIX. Remove this file and its
 * button once the demonstration is over.
 */
import { Business, UserRole } from '../../types';
import {
  addNotePerception,
  addPaiementComptable,
  normalizeQuittance,
  NotePerception,
  PaiementInput,
} from '../../services/notePerceptionService';
import { NomenclatureImpot, subscribeToNomenclatures } from '../../services/nomenclatureService';
import { todayDateString } from '../../utils/date';

export const DEMO_PREFIX = 'NP-DEMO-';

export const isDemoNote = (n: NotePerception) => (n.taxateur?.numeroFacture || '').toUpperCase().startsWith(DEMO_PREFIX);

type Actor = { uid: string; displayName: string; role: UserRole };

/** The registered nomenclature, read once. */
function loadNomenclatures(): Promise<NomenclatureImpot[]> {
  return new Promise((resolve) => {
    let done = false;
    let unsub: (() => void) | undefined;
    unsub = subscribeToNomenclatures(
      (rows) => {
        if (done) return;
        done = true;
        resolve(rows || []);
        setTimeout(() => unsub?.(), 0);
      },
      () => {
        if (!done) {
          done = true;
          resolve([]);
        }
      }
    );
  });
}

/** A bare USD rate from the nomenclature ("2500", "1 250") as a number, else null. */
const usdRate = (n?: NomenclatureImpot) => {
  if (!n || (n.devise && n.devise !== 'USD')) return null;
  const v = Number((n.taux || '').replace(/[\s  ]/g, '').replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? v : null;
};

interface DemoNote {
  tp: number;
  nom: number;
  actes: number;
  fallbackUSD: number;
  arrete: string;
  agent: string;
  qualite: string;
  payment?: Omit<PaiementInput, 'signature' | 'date'>;
}

const NOTES: DemoNote[] = [
  {
    tp: 0, nom: 0, actes: 1, fallbackUSD: 2500, arrete: 'ARR/PROV/NK/012/2026',
    agent: 'Jean-Paul Mumbere', qualite: 'Taxateur principal',
    payment: { bureauComptable: 'BC-GOMA-01 — Rawbank Goma', modePaiementId: 'especes', quittanceNumero: 'Q-DEMO-0001', nomComptable: 'Aline Kahindo' },
  },
  {
    tp: 1, nom: 1, actes: 1, fallbackUSD: 1250, arrete: 'ARR/PROV/NK/014/2026',
    agent: 'Grâce Masika', qualite: 'Taxatrice',
    payment: {
      bureauComptable: 'BC-GOMA-02 — Equity BCDC Goma', modePaiementId: 'cheque_bancaire', modePaiementNumero: '458201',
      modePaiementBanque: 'Equity BCDC', quittanceNumero: 'Q-DEMO-0002', nomComptable: 'Patrick Bahati',
    },
  },
  {
    tp: 2, nom: 2, actes: 5, fallbackUSD: 50, arrete: 'ARR/PROV/NK/019/2026',
    agent: 'Jean-Paul Mumbere', qualite: 'Taxateur principal',
    payment: { bureauComptable: 'BC-GOMA-01 — Rawbank Goma', modePaiementId: 'avis_credit', modePaiementNumero: 'AC-77120', quittanceNumero: 'Q-DEMO-0003', nomComptable: 'Aline Kahindo' },
  },
  {
    tp: 0, nom: 3, actes: 2, fallbackUSD: 10, arrete: 'ARR/PROV/NK/021/2026',
    agent: 'Grâce Masika', qualite: 'Taxatrice',
    payment: { bureauComptable: 'BC-GOMA-03 — Poste Goma', modePaiementId: 'cheque_postal', modePaiementNumero: 'CP-3301', quittanceNumero: 'Q-DEMO-0004', nomComptable: 'Esther Furaha' },
  },
  { tp: 1, nom: 4, actes: 1, fallbackUSD: 50, arrete: 'ARR/PROV/NK/023/2026', agent: 'Jean-Paul Mumbere', qualite: 'Taxateur principal' },
  { tp: 2, nom: 5, actes: 3, fallbackUSD: 60, arrete: 'ARR/PROV/NK/025/2026', agent: 'Grâce Masika', qualite: 'Taxatrice' },
];

/**
 * Create the sample notes; returns how many were created and how many paid.
 * Needs at least one registered taxpayer.
 */
export async function seedDemoNotesPerception(
  taxpayers: Business[],
  existing: NotePerception[],
  actor: Actor
): Promise<{ created: number; paid: number }> {
  if (taxpayers.length === 0) throw new Error("Enregistrez d'abord au moins un contribuable.");
  const noms = await loadNomenclatures();
  const today = todayDateString();
  const used = new Set(existing.filter((n) => n.comptable).map((n) => normalizeQuittance(n.comptable!.quittanceNumero)));
  let created = 0;
  let paid = 0;

  for (let i = 0; i < NOTES.length; i++) {
    const d = NOTES[i];
    const tp = taxpayers[d.tp % taxpayers.length];
    const nom = noms.length ? noms[d.nom % noms.length] : undefined;
    const rate = usdRate(nom);
    const note = await addNotePerception(
      {
        contribuableId: tp.id,
        contribuableName: tp.businessName || '',
        contribuableNif: tp.nif || '',
        numeroFacture: `${DEMO_PREFIX}${String(i + 1).padStart(3, '0')}`,
        articleBudgetaire: nom?.articleBudgetaire || `1.1.${i + 1}`,
        nombreActes: d.actes,
        arreteNumero: d.arrete,
        montantUSD: rate ? rate * d.actes : d.fallbackUSD,
        nomAgent: d.agent,
        qualite: d.qualite,
      },
      actor
    );
    created++;
    if (d.payment) {
      const p: PaiementInput = {
        ...d.payment,
        ...(d.payment.modePaiementId === 'cheque_bancaire' ? { modePaiementDateCheque: today } : {}),
        date: today,
      };
      const saved = await addPaiementComptable(note, p, actor, used);
      used.add(normalizeQuittance(saved.quittanceNumero));
      paid++;
    }
  }
  return { created, paid };
}
