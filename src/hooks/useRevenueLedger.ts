import { useEffect, useMemo, useState } from 'react';
import { comptableLedger } from '../services/reportLedger';
import { subscribeRevenueSources, emptyRevenueSources, RevenueSourceState } from '../services/revenueSources';

export function useRevenueLedger(reloadKey = 0) {
  const [state, setState] = useState<RevenueSourceState>({ sources: emptyRevenueSources, loading: true, error: '', cached: false });
  useEffect(() => subscribeRevenueSources(setState), [reloadKey]);
  return useMemo(() => {
    const s = state.sources;
    const extra = comptableLedger({ businesses: s.businesses, confirmations: s.bankConfirmations,
      fonciers: s.foncierCalculations, locatifs: s.taxCalculations, notes: s.notesPerception });
    const payments = [...s.payments, ...extra.payments];
    const assessments = [...s.assessments, ...extra.assessments];
    const invalid = s.foncierCalculations.some((f) => !Number.isFinite(f.totalImpotDuUSD) || f.totalImpotDuUSD < 0) ||
      s.taxCalculations.some((l) => !Number.isFinite(l.soldeUSD)) ||
      s.notesPerception.some((n) => n.taxateur && !/^NP-DEMO-/i.test(n.taxateur.numeroFacture || '') && !Number.isFinite(n.taxateur.montantUSD)) ||
      payments.some((p) => !p.isVoided && (!Number.isFinite(p.amountPaidUSD) || p.amountPaidUSD < 0)) ||
      assessments.some((a) => !Number.isFinite(a.amountDueUSD) || a.amountDueUSD < 0);
    return { ...state, businesses: s.businesses, assessments, payments,
      error: state.error || (invalid ? 'Le registre contient des montants absents ou invalides. Corrigez les enregistrements avant de consulter les totaux.' : '') };
  }, [state]);
}
