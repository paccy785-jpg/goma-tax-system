import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase/config';
import { Assessment, Business, Payment } from '../types';
import type { BankConfirmation } from './bankConfirmationService';
import type { FoncierCalculation } from './foncierCalculationService';
import type { TaxCalculation } from './taxCalculationService';
import type { NotePerception } from './notePerceptionService';

export interface RevenueSources {
  businesses: Business[];
  assessments: Assessment[];
  payments: Payment[];
  bankConfirmations: BankConfirmation[];
  foncierCalculations: FoncierCalculation[];
  taxCalculations: TaxCalculation[];
  notesPerception: NotePerception[];
}
export const emptyRevenueSources: RevenueSources = {
  businesses: [], assessments: [], payments: [], bankConfirmations: [],
  foncierCalculations: [], taxCalculations: [], notesPerception: [],
};
const names = Object.keys(emptyRevenueSources) as (keyof RevenueSources)[];

export interface RevenueSourceState {
  sources: RevenueSources;
  loading: boolean;
  error: string;
  cached: boolean;
}

/** Reads complete collections and publishes only once all sources have answered. */
export function subscribeRevenueSources(onData: (state: RevenueSourceState) => void): () => void {
  const sources = { ...emptyRevenueSources };
  const ready = new Set<string>();
  const cached = new Set<string>();
  let failed = false;
  let active = true;
  onData({ sources: emptyRevenueSources, loading: true, error: '', cached: false });
  const stops = names.map((name) => onSnapshot(collection(db, name), { includeMetadataChanges: true },
    (snapshot) => {
      if (!active || failed) return;
      Object.assign(sources, { [name]: snapshot.docs.map((d) => ({ ...d.data(), id: d.id })) });
      ready.add(name);
      if (snapshot.metadata.fromCache || snapshot.metadata.hasPendingWrites) cached.add(name);
      else cached.delete(name);
      if (ready.size === names.length) {
        onData({ sources: { ...sources }, loading: false, error: '', cached: cached.size > 0 });
      }
    },
    () => {
      if (!active) return;
      failed = true;
      onData({ sources: emptyRevenueSources, loading: false, error: 'Impossible de charger le registre complet. Réessayez.', cached: false });
    }
  ));
  return () => { active = false; stops.forEach((stop) => stop()); };
}
