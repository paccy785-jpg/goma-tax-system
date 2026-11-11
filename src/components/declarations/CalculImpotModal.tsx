import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Calculator, X, RotateCcw, Wallet, Lock, Loader2, Search, UserRound, Check } from 'lucide-react';
import { Business, PropertyParcel, RentalLease } from '../../types';
import { subscribeToBusinesses } from '../../services/dbService';
import { subscribeToParcels } from '../../services/parcelService';
import { subscribeToLeases } from '../../services/leaseService';
import { computeRentalRoll, grossRevenueUSD, monthsLetInExercise } from '../../services/rentalService';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  addTaxCalculation,
  CalcLocataire,
  TaxCalculation,
  CalcPaymentMode,
  CALC_PAYMENT_MODES,
  CALC_PAYMENT_MODE_LABELS,
  Contribuable,
  CONTRIBUABLE_TYPE_LABELS,
  soldeEnLettres,
} from '../../services/taxCalculationService';
import { fmtTaux, fmtUSD, impotDu, parseAmount, soldeAPayer, TAUX_FIXE_PCT } from '../../utils/taxCalc';
import { currentExercise } from '../../utils/date';
import { Button } from '../ui';

interface CalculImpotModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called with the stored row as soon as it is saved. */
  onSaved?: (calc: TaxCalculation) => void;
}

/** Exercice whose rents feed a bailleur's revenu brut suggestion. */
const EXERCICE = currentExercise();

/** One pickable name, with what is needed to find and print it. */
interface Candidate extends Contribuable {
  key: string;
  /** Lower-cased text the search runs over. */
  haystack: string;
  /** Bailleur only: total revenu brut of their leases this exercice. */
  grossUSD?: number;
}

/**
 * Bailleurs and locataires, searchable by name.
 *
 * A bailleur is a taxpayer who owns let property — named as owner on a
 * declared parcel or as bailleur on a lease. A locataire is a tenant named on
 * a lease; co-tenants on one contract are each their own entry.
 */
function buildCandidates(
  businesses: Business[],
  parcels: PropertyParcel[],
  leases: RentalLease[]
): Candidate[] {
  const out: Candidate[] = [];
  const byId = new Map(businesses.map((b) => [b.id, b]));

  // --- Bailleurs ---
  const ownerIds = new Set<string>();
  parcels.forEach((p) => p.ownerTaxpayerId && ownerIds.add(p.ownerTaxpayerId));
  leases.forEach((l) => l.bailleurId && ownerIds.add(l.bailleurId));

  ownerIds.forEach((id) => {
    const b = byId.get(id);
    const own = leases.filter((l) => l.bailleurId === id);
    const name = b?.businessName || own.find((l) => l.bailleurName)?.bailleurName || '';
    if (!name.trim()) return;
    const location = [b?.physicalAddress, b?.quartier, b?.commune].filter(Boolean).join(', ');
    out.push({
      key: `bailleur_${id}`,
      type: 'bailleur',
      name,
      refId: id,
      nif: b?.nif || undefined,
      location: location || undefined,
      grossUSD: computeRentalRoll(own, EXERCICE).totalGrossUSD,
      haystack: [name, b?.ownerFullName, b?.nif, b?.commune, b?.quartier].join(' ').toLowerCase(),
    });
  });

  // --- Locataires ---
  leases.forEach((l) => {
    const location = [
      l.address,
      l.quartierGroupement,
      l.communeChefferie,
      l.numeroParcelle ? `parcelle ${l.numeroParcelle}` : '',
    ]
      .filter(Boolean)
      .join(', ');
    (l.tenantNames || []).forEach((name, i) => {
      if (!name.trim()) return;
      out.push({
        key: `locataire_${l.id}_${i}`,
        type: 'locataire',
        name,
        refId: l.id,
        location: location || undefined,
        haystack: [name, l.bailleurName, l.address, l.quartierGroupement, l.communeChefferie, l.numeroParcelle]
          .join(' ')
          .toLowerCase(),
      });
    });
  });

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const fieldClass =
  'w-full px-3 py-2.5 text-sm rounded-[10px] border border-line bg-surface text-ink placeholder:text-faint focus:border-accent focus:outline-none transition-premium font-sans tabular-nums';

const Row: React.FC<{ n: number; label: string; hint?: string; children: React.ReactNode }> = ({
  n,
  label,
  hint,
  children,
}) => (
  <div className="grid grid-cols-[28px_1fr] gap-3 items-start">
    <span className="mt-0.5 w-7 h-7 rounded-[8px] bg-surface2 text-ink text-[12px] font-bold flex items-center justify-center font-mono">
      {n}
    </span>
    <div className="space-y-1.5 min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-xs font-semibold text-ink">{label}</label>
        {hint && <span className="text-[11px] font-mono text-faint shrink-0">{hint}</span>}
      </div>
      {children}
    </div>
  </div>
);

export const CalculImpotModal: React.FC<CalculImpotModalProps> = ({ isOpen, onClose, onSaved }) => {
  const { userProfile } = useAuth();
  const { showToast } = useToast();

  const [revenuBrut, setRevenuBrut] = useState('');
  const [retenues, setRetenues] = useState('');
  const [modePaiement, setModePaiement] = useState<CalcPaymentMode | ''>('');
  const [modeError, setModeError] = useState('');
  const [saving, setSaving] = useState(false);

  // ---- Bailleur / locataire search ----
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [parcels, setParcels] = useState<PropertyParcel[]>([]);
  const [leases, setLeases] = useState<RentalLease[]>([]);
  const [nameQuery, setNameQuery] = useState('');
  const [picked, setPicked] = useState<Candidate | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [nameError, setNameError] = useState('');
  const searchBoxRef = useRef<HTMLDivElement>(null);

  // A closed card keeps its React state (it renders `null`, it is not
  // unmounted), so the previous taxpayer and their figures were still on screen
  // the next time it opened — and could be saved against the wrong person. Clear
  // the slip every time it is opened.
  useEffect(() => {
    if (!isOpen) return;
    setRevenuBrut('');
    setRetenues('');
    setModePaiement('');
    setModeError('');
    setNameQuery('');
    setPicked(null);
    setListOpen(false);
    setActive(0);
    setNameError('');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const u1 = subscribeToBusinesses((d) => setBusinesses(d || []), undefined, null);
    const u2 = subscribeToParcels((d) => setParcels(d || []), undefined, null);
    const u3 = subscribeToLeases((d) => setLeases(d || []), undefined, null);
    return () => {
      u1();
      u2();
      u3();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!listOpen) return;
    const onDown = (e: MouseEvent) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) setListOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [listOpen]);

  const candidates = useMemo(
    () => buildCandidates(businesses, parcels, leases),
    [businesses, parcels, leases]
  );

  /** Every typed word must match, so name order does not matter. */
  const matches = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    if (!q || picked) return [];
    const tokens = q.split(/\s+/);
    return candidates.filter((c) => tokens.every((t) => c.haystack.includes(t))).slice(0, 30);
  }, [candidates, nameQuery, picked]);

  /**
   * Locataires of the picked bailleur — one entry per tenant per lease, so
   * co-tenants on one contract can each be chosen. Keyed "<leaseId>::<i>".
   */
  const [chosenTenants, setChosenTenants] = useState<Set<string>>(new Set());
  const [tenantError, setTenantError] = useState('');
  const bailleurTenants = useMemo(() => {
    if (picked?.type !== 'bailleur') return [];
    return leases
      .filter((l) => l.bailleurId === picked.refId)
      .flatMap((l) =>
        (l.tenantNames || [])
          .map((name, i) => ({ key: `${l.id}::${i}`, name: name.trim(), lease: l }))
          .filter((t) => t.name)
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [picked, leases]);

  /** Distinct leases behind the chosen locataires — co-tenants share one rent. */
  const chosenLeases = useMemo(() => {
    const ids = new Set([...chosenTenants].map((k) => k.split('::')[0]));
    return leases.filter((l) => ids.has(l.id));
  }, [chosenTenants, leases]);
  const chosenGrossUSD = useMemo(
    () => Math.round(chosenLeases.reduce((s, l) => s + grossRevenueUSD(l, EXERCICE), 0) * 100) / 100,
    [chosenLeases]
  );

  /**
   * A bailleur's revenu brut is the rent of the leases picked below — the sum
   * of each lease's revenu brut for the exercice (loyer mensuel × mois loués) —
   * filled in by the card and never typed, so each calculation carries the
   * revenue of exactly the leases it is for.
   */
  const revenuFromLeases = picked?.type === 'bailleur' && bailleurTenants.length > 0;
  useEffect(() => {
    if (!revenuFromLeases) return;
    setRevenuBrut(chosenTenants.size > 0 ? String(chosenGrossUSD) : '');
  }, [revenuFromLeases, chosenGrossUSD, chosenTenants.size]);

  const toggleTenant = (key: string) => {
    setTenantError('');
    setChosenTenants((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const allTenantsChosen =
    bailleurTenants.length > 0 && bailleurTenants.every((t) => chosenTenants.has(t.key));
  const toggleAllTenants = () => {
    setTenantError('');
    setChosenTenants(allTenantsChosen ? new Set() : new Set(bailleurTenants.map((t) => t.key)));
  };

  const choose = (c: Candidate) => {
    if (c.key !== picked?.key) setChosenTenants(new Set());
    setTenantError('');
    setPicked(c);
    setNameQuery(c.name);
    setListOpen(false);
    setActive(0);
    setNameError('');
  };

  const clearPicked = () => {
    setChosenTenants(new Set());
    setTenantError('');
    setPicked(null);
    setNameQuery('');
    setActive(0);
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !saving && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, saving]);

  const calc = useMemo(() => {
    const revenu = parseAmount(revenuBrut);
    // (2) is fixed, not typed.
    const t = TAUX_FIXE_PCT;
    // An empty withholding field means nothing was withheld.
    const ret = retenues.trim() === '' ? 0 : parseAmount(retenues);

    const revenuOk = Number.isFinite(revenu) && revenu >= 0;
    const retOk = Number.isFinite(ret) && ret >= 0;

    const impot = revenuOk ? impotDu(revenu, t) : null;
    const solde = impot !== null && retOk ? soldeAPayer(impot, ret) : null;

    return {
      revenu,
      t,
      ret,
      impot,
      solde,
      errors: {
        revenu: revenuBrut.trim() !== '' && !revenuOk ? 'Montant invalide' : '',
        retenues: !retOk ? 'Montant invalide' : '',
      },
    };
  }, [revenuBrut, retenues]);

  if (!isOpen) return null;

  const reset = () => {
    clearPicked();
    setNameError('');
    setRevenuBrut('');
    setRetenues('');
    setModePaiement('');
    setModeError('');
  };

  const soldeNegatif = calc.solde !== null && calc.solde < 0;
  const enLettres = calc.solde === null ? '' : soldeEnLettres(calc.solde);
  const complete = calc.solde !== null && revenuBrut.trim() !== '';
  const showList = listOpen && !picked && nameQuery.trim().length > 0;

  const save = async () => {
    if (!complete || calc.solde === null) return;
    let invalid = false;
    if (!picked) {
      setNameError('Sélectionnez le bailleur ou le locataire qui paiera l’impôt.');
      invalid = true;
    }
    if (picked?.type === 'bailleur' && bailleurTenants.length > 0 && chosenTenants.size === 0) {
      setTenantError('Sélectionnez le ou les locataires pour lesquels le bailleur paie.');
      invalid = true;
    }
    if (!modePaiement) {
      setModeError('Sélectionnez le mode de paiement.');
      invalid = true;
    }
    if (invalid || !picked || !modePaiement) return;
    const locataires: CalcLocataire[] = bailleurTenants
      .filter((t) => chosenTenants.has(t.key))
      .map((t) => ({
        leaseId: t.lease.id,
        name: t.name,
        numeroParcelle: t.lease.numeroParcelle || undefined,
        address:
          [t.lease.villeTerritoire, t.lease.communeChefferie, t.lease.quartierGroupement, t.lease.address]
            .filter(Boolean)
            .join(', ') || undefined,
        monthlyRentUSD: t.lease.monthlyRentUSD || 0,
        grossUSD: grossRevenueUSD(t.lease, EXERCICE),
      }));
    if (!userProfile) {
      showToast('Connectez-vous avant d’enregistrer un calcul.', 'error', 'Non connecté');
      return;
    }
    setSaving(true);
    try {
      const saved = await addTaxCalculation(
        {
          locataires,
          contribuable: {
            type: picked.type,
            name: picked.name,
            refId: picked.refId,
            nif: picked.nif,
            location: picked.location,
          },
          revenuBrutUSD: calc.revenu,
          retenuesUSD: calc.ret,
          modePaiement,
        },
        { uid: userProfile.uid, displayName: userProfile.displayName, role: userProfile.role }
      );
      onSaved?.(saved);
      showToast(
        `Calcul enregistré pour ${picked.name} — solde à payer ${fmtUSD(calc.solde)}.`,
        'success',
        'Calcul d’impôts'
      );
      reset();
      onClose();
    } catch (err) {
      showToast(
        err instanceof Error ? err.message : 'Impossible d’enregistrer le calcul.',
        'error',
        'Échec'
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
      onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="calcul-impot-title"
        className="bg-surface rounded-2xl border border-line shadow-2xl w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 bg-navy text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-white/15">
              <Calculator className="w-5 h-5" />
            </div>
            <div>
              <h3 id="calcul-impot-title" className="text-base font-bold font-display">
                Calcul d'impôts
              </h3>
              <p className="text-xs text-white/70">Montants exprimés en dollars américains (USD)</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Fermer"
            className="p-1 rounded-md text-white/80 hover:text-white hover:bg-white/10 cursor-pointer disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5 overflow-y-auto">
          {/* ---- Who pays: bailleur or locataire ---- */}
          <div className="grid grid-cols-[28px_1fr] gap-3 items-start">
            <span className="mt-0.5 w-7 h-7 rounded-[8px] bg-accent-soft text-accent flex items-center justify-center">
              <UserRound className="w-3.5 h-3.5" />
            </span>
            <div className="space-y-1.5 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor="calc-contribuable" className="text-xs font-semibold text-ink">
                  Bailleur ou locataire
                </label>
                <span className="text-[11px] text-faint shrink-0">Contribuable</span>
              </div>
              <div ref={searchBoxRef} className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
                <input
                  id="calc-contribuable"
                  type="text"
                  role="combobox"
                  aria-expanded={showList}
                  aria-controls="calc-contribuable-list"
                  aria-autocomplete="list"
                  autoComplete="off"
                  autoFocus
                  value={nameQuery}
                  onFocus={() => setListOpen(true)}
                  onChange={(e) => {
                    setNameQuery(e.target.value);
                    setActive(0);
                    setListOpen(true);
                    setNameError('');
                    // Typing over a chosen name un-picks it.
                    if (picked) setPicked(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape' && showList) {
                      e.stopPropagation();
                      setListOpen(false);
                      return;
                    }
                    if (!showList || matches.length === 0) return;
                    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                      e.preventDefault();
                      const n = matches.length;
                      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      choose(matches[active] ?? matches[0]);
                    }
                  }}
                  className={`${fieldClass} pl-9 pr-24 ${nameError ? 'border-danger' : ''} ${
                    picked ? 'font-semibold' : ''
                  }`}
                />
                {picked && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <span
                      className={`px-1.5 py-0.5 rounded-[6px] text-[11px] font-bold ${
                        picked.type === 'bailleur' ? 'bg-navy/10 text-navy' : 'bg-accent-soft text-accent'
                      }`}
                    >
                      {CONTRIBUABLE_TYPE_LABELS[picked.type]}
                    </span>
                    <button
                      type="button"
                      onClick={clearPicked}
                      aria-label="Effacer le contribuable"
                      className="p-1 rounded-md text-muted hover:text-ink hover:bg-surface2 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {showList && (
                  <ul
                    id="calc-contribuable-list"
                    role="listbox"
                    className="absolute z-20 left-0 right-0 mt-1.5 max-h-64 overflow-y-auto rounded-[12px] border border-line bg-surface shadow-2xl py-1.5"
                  >
                    {matches.length === 0 ? (
                      <li className="px-3.5 py-2.5 text-[12px] text-muted">
                        Aucun bailleur ni locataire ne correspond à{' '}
                        <span className="font-semibold text-ink">« {nameQuery.trim()} »</span>.
                      </li>
                    ) : (
                      matches.map((c, i) => (
                        <li key={c.key} role="option" aria-selected={i === active}>
                          <button
                            type="button"
                            onMouseEnter={() => setActive(i)}
                            onClick={() => choose(c)}
                            className={`w-full text-left px-3.5 py-2 flex items-start justify-between gap-3 cursor-pointer ${
                              i === active ? 'bg-accent-soft' : ''
                            }`}
                          >
                            <span className="min-w-0">
                              <span className="block text-xs font-semibold text-ink truncate">{c.name}</span>
                              <span className="block text-[11px] text-muted truncate mt-0.5">
                                {[c.nif ? `NIF ${c.nif}` : '', c.location].filter(Boolean).join(' • ') || '—'}
                              </span>
                            </span>
                            <span
                              className={`shrink-0 px-1.5 py-0.5 rounded-[6px] text-[11px] font-bold ${
                                c.type === 'bailleur' ? 'bg-navy/10 text-navy' : 'bg-accent-soft text-accent'
                              }`}
                            >
                              {CONTRIBUABLE_TYPE_LABELS[c.type]}
                            </span>
                          </button>
                        </li>
                      ))
                    )}
                  </ul>
                )}
              </div>
              {nameError ? (
                <p className="text-[12px] text-danger">{nameError}</p>
              ) : picked ? (
                <p className="text-[11px] text-muted truncate">
                  {[picked.nif ? `NIF ${picked.nif}` : '', picked.location].filter(Boolean).join(' • ') ||
                    'Aucune adresse enregistrée'}
                </p>
              ) : (
                <p className="text-[11px] text-muted">
                  Celui qui paiera l’impôt — recherché parmi les bailleurs et les locataires
                  enregistrés.
                </p>
              )}

              {/* ---- The bailleur's locataires: who this tax is paid for ---- */}
              {picked?.type === 'bailleur' && (
                <div className="pt-2">
                  <div className="flex items-baseline justify-between gap-2 mb-1.5">
                    <span className="text-xs font-semibold text-ink">Locataires de ce bailleur</span>
                    {bailleurTenants.length > 0 && (
                      <button
                        type="button"
                        onClick={toggleAllTenants}
                        className="text-[11px] font-semibold text-accent hover:underline cursor-pointer"
                      >
                        {allTenantsChosen ? 'Tout désélectionner' : 'Tout sélectionner'}
                      </button>
                    )}
                  </div>
                  {bailleurTenants.length === 0 ? (
                    <p className="p-3 rounded-[10px] bg-warn/10 border border-warn/25 text-[12px] text-ink leading-relaxed">
                      Aucun locataire n’est enregistré pour <strong>{picked.name}</strong>. Ajoutez-les dans{' '}
                      <strong>Registration → Précision sur les propriétés données en location</strong>.
                    </p>
                  ) : (
                    <div
                      role="listbox"
                      aria-multiselectable="true"
                      aria-label="Locataires du bailleur"
                      className={`rounded-[12px] border divide-y divide-line overflow-hidden ${
                        tenantError ? 'border-danger' : 'border-line'
                      }`}
                    >
                      {bailleurTenants.map((t) => {
                        const on = chosenTenants.has(t.key);
                        const l = t.lease;
                        const months = monthsLetInExercise(l, EXERCICE);
                        const where = [
                          l.villeTerritoire,
                          l.communeChefferie,
                          l.quartierGroupement,
                          l.address,
                          l.numeroParcelle ? `Parcelle ${l.numeroParcelle}` : '',
                        ]
                          .filter(Boolean)
                          .join(', ');
                        return (
                          <button
                            key={t.key}
                            type="button"
                            role="option"
                            aria-selected={on}
                            onClick={() => toggleTenant(t.key)}
                            className={`w-full text-left px-3.5 py-2.5 flex items-center gap-3 cursor-pointer transition-premium ${
                              on ? 'bg-accent-soft/60' : 'bg-surface hover:bg-surface2/50'
                            }`}
                          >
                            <span
                              className={`w-4 h-4 rounded-[5px] border flex items-center justify-center shrink-0 ${
                                on ? 'bg-accent border-accent text-white' : 'border-line bg-surface'
                              }`}
                            >
                              {on && <Check className="w-3 h-3" />}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-xs font-semibold text-ink truncate">{t.name}</span>
                              <span className="block text-[11px] text-muted truncate mt-0.5" title={where}>
                                {where || '—'}
                              </span>
                            </span>
                            <span className="shrink-0 text-right">
                              <span className="block text-[12px] font-semibold text-ink tabular-nums">
                                {l.monthlyRentUSD > 0 ? `${fmtUSD(l.monthlyRentUSD)}/mois` : 'Loyer non renseigné'}
                              </span>
                              {l.monthlyRentUSD > 0 && l.startDate && (
                                <span className="block text-[11px] text-faint tabular-nums">
                                  {months} mois · {fmtUSD(grossRevenueUSD(l, EXERCICE))}
                                </span>
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {tenantError ? (
                    <p className="text-[12px] text-danger mt-1">{tenantError}</p>
                  ) : (
                    bailleurTenants.length > 0 && (
                      <p className="text-[11px] text-muted mt-1">
                        {chosenTenants.size} / {bailleurTenants.length} locataire
                        {bailleurTenants.length === 1 ? '' : 's'} sélectionné{chosenTenants.size === 1 ? '' : 's'} —
                        cochez ceux pour lesquels le bailleur paie l’impôt.
                      </p>
                    )
                  )}
                </div>
              )}
            </div>
          </div>

          <Row n={1} label="Revenu brut" hint="USD">
            {revenuFromLeases ? (
              <>
                {/* A bailleur's revenu brut: the leases picked above, never typed. */}
                <div
                  aria-readonly="true"
                  title="Revenu brut des locataires sélectionnés — non modifiable"
                  className="px-3 py-2.5 rounded-[10px] bg-surface2 border border-line text-sm font-semibold text-ink tabular-nums flex items-center justify-between gap-2 cursor-not-allowed select-none"
                >
                  <span>{chosenTenants.size > 0 ? fmtUSD(chosenGrossUSD) : '—'}</span>
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted">
                    <Lock className="w-3 h-3" />
                    Verrouillé
                  </span>
                </div>
                <p className="text-[12px] text-muted">
                  {chosenTenants.size > 0
                    ? `Revenu brut ${EXERCICE} des baux des locataires sélectionnés (loyer mensuel × mois loués).`
                    : 'Sélectionnez les locataires : le revenu brut de leurs baux s’inscrit ici.'}
                </p>
              </>
            ) : (
              <>
                <input
                  type="text"
                  inputMode="decimal"
                  value={revenuBrut}
                  onChange={(e) => setRevenuBrut(e.target.value)}
                  placeholder="0,00"
                  className={fieldClass}
                />
                {calc.errors.revenu && <p className="text-[12px] text-danger">{calc.errors.revenu}</p>}
              </>
            )}
          </Row>

          <Row n={2} label="Taux" hint="fixe">
            {/* Fixed rate: shown, never editable. */}
            <div
              aria-readonly="true"
              title="Taux fixe — non modifiable"
              className="px-3 py-2.5 rounded-[10px] bg-surface2 border border-line text-sm font-semibold text-ink tabular-nums flex items-center justify-between gap-2 cursor-not-allowed select-none"
            >
              <span>{fmtTaux(TAUX_FIXE_PCT)}</span>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted">
                <Lock className="w-3 h-3" />
                Verrouillé
              </span>
            </div>
          </Row>

          <Row n={3} label="Impôt dû" hint="(1) × (2)">
            <div className="px-3 py-2.5 rounded-[10px] bg-surface2 border border-line text-sm font-semibold text-ink tabular-nums">
              {calc.impot === null ? '—' : fmtUSD(calc.impot)}
            </div>
          </Row>

          <Row n={4} label="Les retenues versées" hint="USD">
            <input
              type="text"
              inputMode="decimal"
              value={retenues}
              onChange={(e) => setRetenues(e.target.value)}
              placeholder="0,00"
              className={fieldClass}
            />
            {calc.errors.retenues && (
              <p className="text-[12px] text-danger">{calc.errors.retenues}</p>
            )}
          </Row>

          <Row n={5} label="Solde à payer" hint="(3) − (4)">
            <div
              className={`px-3 py-2.5 rounded-[10px] border text-base font-bold tabular-nums ${
                calc.solde === null
                  ? 'bg-surface2 border-line text-faint'
                  : soldeNegatif
                    ? 'bg-surface2 border-line text-sage'
                    : 'bg-accent-soft border-accent/30 text-accent-dark'
              }`}
            >
              {calc.solde === null ? '—' : fmtUSD(calc.solde)}
            </div>
            {soldeNegatif && (
              <p className="text-[12px] text-muted">
                Les retenues versées dépassent l'impôt dû : aucun solde à payer, trop-perçu de{' '}
                {fmtUSD(Math.abs(calc.solde!))}.
              </p>
            )}
          </Row>

          <Row n={6} label="En toutes lettres">
            <div className="px-3 py-2.5 rounded-[10px] bg-surface2 border border-line text-sm text-ink italic min-h-[42px]">
              {enLettres || '—'}
            </div>
          </Row>

          <Row n={7} label="Mode de paiement">
            <div className="relative">
              <Wallet className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
              <select
                value={modePaiement}
                onChange={(e) => {
                  setModePaiement(e.target.value as CalcPaymentMode | '');
                  setModeError('');
                }}
                className={`${fieldClass} pl-9 cursor-pointer ${modeError ? 'border-danger' : ''}`}
              >
                <option value="">Sélectionner le mode de paiement…</option>
                {CALC_PAYMENT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {CALC_PAYMENT_MODE_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>
            {modeError && <p className="text-[12px] text-danger">{modeError}</p>}
          </Row>

          <p className="text-[11px] text-muted flex items-start gap-1.5 leading-relaxed">
            <Lock className="w-3 h-3 shrink-0 mt-px" />
            Un calcul enregistré est ajouté au registre des calculs d'impôts et ne peut plus être
            modifié ni supprimé.
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-line bg-surface2/50 flex items-center justify-between gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            icon={<RotateCcw className="w-3.5 h-3.5" />}
            onClick={reset}
            disabled={saving}
          >
            Réinitialiser
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
              Fermer
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={save}
              disabled={!complete || saving}
              icon={
                saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />
              }
            >
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
