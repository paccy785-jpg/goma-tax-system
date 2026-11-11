import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FileText,
  RefreshCw,
  FileCheck2,
  FileClock,
  FileWarning,
  Building2,
  Loader2,
  Calculator,
  Lock,
  Search,
  X,
} from 'lucide-react';
import { Assessment, Business, TaxRate, UserRole, natureCode, natureDisplay } from '../types';
import {
  getBusinesses,
  subscribeToBusinesses,
  getAssessments,
  subscribeToAssessments,
  getTaxRates,
} from '../services/dbService';
import {
  computeDeclarations,
  summarizeDeclarations,
  resolveFiscalCycle,
} from '../services/declarationService';
import {
  subscribeToTaxCalculations,
  TaxCalculation,
  CONTRIBUABLE_TYPE_LABELS,
  calcPaymentModeLabel,
} from '../services/taxCalculationService';
import { fmtTaux, fmtUSD } from '../utils/taxCalc';
import {
  FoncierCalculation,
  FONCIER_PAYMENT_MODE_LABELS,
  subscribeToFoncierCalculations,
} from '../services/foncierCalculationService';
import { CalculFoncierModal } from './declarations/CalculFoncierModal';
import { FoncierCalcTable, LocatifCalcTable } from './declarations/CalcTables';
import { subscribeToLeases } from '../services/leaseService';
import { RentalLease } from '../types';
import { useToast } from '../contexts/ToastContext';
import { Button, Panel, MetricStrip, EmptyState, TableSkeleton } from './ui';
import { CalculImpotModal } from './declarations/CalculImpotModal';
import { usd } from './registry/registryBits';

interface DeclarationsViewProps {
  userRole: UserRole;
}

/** Subtabs of the Declarations page. */
type DeclarationsSubTab = 'locatifs' | 'fonciers';

const DECLARATIONS_SUBTABS: { id: DeclarationsSubTab; label: string; hint: string }[] = [
  { id: 'fonciers', label: "Déclarations d'impôts fonciers", hint: 'Impôt foncier — propriétés déclarées' },
  { id: 'locatifs', label: "Déclarations d'impôts locatifs", hint: 'Impôt sur les revenus locatifs — bailleurs et locataires' },
];

/** Same segmented control as the Taxpayer Registry subtabs. */
const DeclarationsSubTabs: React.FC<{
  active: DeclarationsSubTab;
  onChange: (id: DeclarationsSubTab) => void;
}> = ({ active, onChange }) => (
  <div
    role="tablist"
    aria-label="Sections des déclarations"
    className="inline-flex items-center gap-1 p-1 rounded-[12px] bg-surface2 border border-line"
  >
    {DECLARATIONS_SUBTABS.map((tab) => {
      const isActive = tab.id === active;
      return (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={isActive}
          title={tab.hint}
          onClick={() => onChange(tab.id)}
          className={`px-4 py-2 rounded-[9px] text-xs font-semibold transition-premium cursor-pointer whitespace-nowrap ${
            isActive
              ? 'bg-surface text-accent shadow-[0_2px_8px_oklch(20%_0.03_260/0.08)] border border-accent/20'
              : 'text-muted hover:text-ink border border-transparent'
          }`}
        >
          {tab.label}
        </button>
      );
    })}
  </div>
);

export const DeclarationsView: React.FC<DeclarationsViewProps> = ({ userRole }) => {
  const { showToast } = useToast();

  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [rates, setRates] = useState<TaxRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  /** Saved Calculs d'impôts, newest first. */
  const [calculations, setCalculations] = useState<TaxCalculation[]>([]);
  const [calcLoading, setCalcLoading] = useState(true);
  const [calculOpen, setCalculOpen] = useState(false);
  const [subTab, setSubTab] = useState<DeclarationsSubTab>('fonciers');

  // ---- Calculs d'impôts Fonciers ----
  const [foncierOpen, setFoncierOpen] = useState(false);
  const closeFoncier = useCallback(() => setFoncierOpen(false), []);
  const [foncierCalcs, setFoncierCalcs] = useState<FoncierCalculation[]>([]);
  const [foncierLoading, setFoncierLoading] = useState(true);
  useEffect(() => {
    // Same self-healing listener as the locatif register.
    let unsub: (() => void) | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let disposed = false;
    const open = () => {
      unsub = subscribeToFoncierCalculations(
        (data) => {
          if (!disposed && attempt === 0) {
            setFoncierCalcs(data || []);
            setFoncierLoading(false);
          }
        },
        () => {
          if (disposed) return;
          setFoncierLoading(false);
          attempt += 1;
          retryTimer = setTimeout(() => {
            if (disposed) return;
            unsub?.();
            attempt = 0;
            open();
          }, Math.min(30000, 2000 * attempt));
        }
      );
    };
    open();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      unsub?.();
    };
  }, []);
  // ---- Taxpayer search (name or NIF), across both subtabs ----
  const [taxpayerQuery, setTaxpayerQuery] = useState('');

  /**
   * The lease register links bailleurs and locataires, so a search for either
   * finds every calculation they are party to — a locataire's name finds the
   * foncier and locatif slips of the bailleur whose property they rent, and
   * the reverse.
   */
  const [leases, setLeases] = useState<RentalLease[]>([]);
  useEffect(() => subscribeToLeases((d) => setLeases(d || []), undefined, null), []);

  /** NIF of a person on the taxpayer roll, by id or — for a locataire — by name. */
  const nifById = useMemo(() => new Map(businesses.map((b) => [b.id, b.nif || ''])), [businesses]);
  const nifByName = useMemo(
    () => new Map(businesses.map((b) => [(b.businessName || '').trim().toLowerCase(), b.nif || ''])),
    [businesses]
  );

  /** Every typed word must appear in the name or NIF, so order does not matter. */
  const matches = useCallback(
    (name?: string, nif?: string) => {
      const q = taxpayerQuery.trim().toLowerCase();
      if (!q) return true;
      const hay = `${name || ''} ${nif || ''}`.toLowerCase();
      return q.split(/\s+/).every((t) => hay.includes(t));
    },
    [taxpayerQuery]
  );
  const tenantNif = useCallback((name: string) => nifByName.get(name.trim().toLowerCase()) || '', [nifByName]);

  /**
   * Which calculations match, and — when the match came through the other
   * party of a lease — who it was, so the row can say why it is shown.
   */
  const { shownCalcs, shownFoncier, matchedVia } = useMemo(() => {
    const via = new Map<string, string>();
    const q = taxpayerQuery.trim();
    if (!q) return { shownCalcs: calculations, shownFoncier: foncierCalcs, matchedVia: via };

    const locatifs = calculations.filter((c) => {
      if (matches(c.contribuableName, c.contribuableNif)) return true;
      // The locataires this slip was filed for.
      const forTenant = (c.locataires || []).find((l) => matches(l.name, tenantNif(l.name)));
      if (forTenant) {
        via.set(c.id, `locataire ${forTenant.name}`);
        return true;
      }
      if (c.contribuableType === 'bailleur') {
        // A bailleur's slip, found through one of their locataires.
        for (const l of leases) {
          if (l.bailleurId !== c.contribuableRefId) continue;
          const t = (l.tenantNames || []).find((n) => matches(n, tenantNif(n)));
          if (t) {
            via.set(c.id, `locataire ${t}`);
            return true;
          }
        }
        return false;
      }
      // A locataire's slip, found through their bailleur.
      const lease = leases.find((l) => l.id === c.contribuableRefId);
      if (lease?.bailleurName && matches(lease.bailleurName, nifById.get(lease.bailleurId || ''))) {
        via.set(c.id, `bailleur ${lease.bailleurName}`);
        return true;
      }
      return false;
    });

    const fonciers = foncierCalcs.filter((c) => {
      if (matches(c.bailleurName, c.bailleurNif)) return true;
      // A bailleur's foncier slip, found through a locataire of the taxed property.
      const parcels = new Set(c.lines.map((l) => l.parcelId).filter(Boolean));
      for (const l of leases) {
        if (!parcels.has(l.parcelId) && l.bailleurId !== c.bailleurId) continue;
        const t = (l.tenantNames || []).find((n) => matches(n, tenantNif(n)));
        if (t) {
          via.set(c.id, `locataire ${t}`);
          return true;
        }
      }
      return false;
    });

    return { shownCalcs: locatifs, shownFoncier: fonciers, matchedVia: via };
  }, [taxpayerQuery, calculations, foncierCalcs, leases, matches, tenantNif, nifById]);
  const searching = taxpayerQuery.trim().length > 0;

  const addSavedFoncier = useCallback((calc: FoncierCalculation) => {
    setFoncierCalcs((prev) => (prev.some((c) => c.id === calc.id) ? prev : [calc, ...prev]));
    setFoncierLoading(false);
  }, []);
  const closeCalcul = useCallback(() => setCalculOpen(false), []);

  // ---- Real-time ledger subscriptions ------------------------------------
  useEffect(() => {
    setLoading(true);
    getTaxRates(true)
      .then((r) => setRates(r || []))
      .catch((err) => console.warn('[Declarations] Rate schedule load error:', err));

    const unsubBiz = subscribeToBusinesses(
      (data) => {
        setBusinesses(data || []);
        setLoading(false);
      },
      (err) => {
        console.error('[Declarations] Registry listener error:', err);
        setLoading(false);
      }
    );
    const unsubAssessments = subscribeToAssessments(
      (data) => setAssessments(data || []),
      (err) => console.warn('[Declarations] Assessment listener error:', err)
    );

    return () => {
      unsubBiz();
      unsubAssessments();
    };
  }, []);

  /**
   * Live register of saved calculations.
   *
   * A Firestore listener that is refused (permissions not yet deployed, a
   * dropped connection) is closed for good, and the table would sit at zero
   * until a page reload. So a failed listener re-opens itself, backing off up
   * to 30 seconds; `calcEpoch` lets Refresh re-open it on demand.
   */
  const [calcEpoch, setCalcEpoch] = useState(0);
  useEffect(() => {
    let unsub: (() => void) | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let disposed = false;

    const open = () => {
      unsub = subscribeToTaxCalculations(
        (data) => {
          // The service reports [] after an error; only a real snapshot counts.
          if (!disposed && attempt === 0) {
            setCalculations(data || []);
            setCalcLoading(false);
          }
        },
        (err) => {
          console.warn('[Declarations] Tax calculation listener error:', err);
          if (disposed) return;
          setCalcLoading(false);
          attempt += 1;
          const delay = Math.min(30000, 2000 * attempt);
          retryTimer = setTimeout(() => {
            if (disposed) return;
            unsub?.();
            attempt = 0;
            open();
          }, delay);
        }
      );
    };
    open();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      unsub?.();
    };
  }, [calcEpoch]);

  /** Put a just-saved row on the table at once, ahead of the listener. */
  const addSavedCalculation = useCallback((calc: TaxCalculation) => {
    setCalculations((prev) => (prev.some((c) => c.id === calc.id) ? prev : [calc, ...prev]));
    setCalcLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [biz, ass, r] = await Promise.all([
        getBusinesses(),
        getAssessments(),
        getTaxRates(true),
      ]);
      setBusinesses(biz || []);
      setAssessments(ass || []);
      setRates(r || []);
      setCalcEpoch((n) => n + 1);
      showToast('Declarations register refreshed', 'success');
    } catch (err) {
      console.error('[Declarations] Refresh failed:', err);
      showToast('Could not refresh the declarations register', 'error');
    } finally {
      setRefreshing(false);
    }
  }, [showToast]);

  const fiscalYear = useMemo(
    () => resolveFiscalCycle(assessments),
    [assessments]
  );

  const rows = useMemo(
    () => computeDeclarations(businesses, assessments, rates),
    [businesses, assessments, rates]
  );

  const summary = useMemo(() => summarizeDeclarations(rows), [rows]);

  /**
   * Declaration standing, driven by the saved Calculs d'impôts.
   *
   * A contributor has declared once at least one calculation is saved in
   * their name — several calculations for one person still count once.
   *   - Declared: distinct bailleurs and locataires with a saved calculation.
   *   - Not declared: taxpayers on the roll with no calculation in their name.
   * A bailleur is matched to the roll by taxpayer id; a locataire is not a
   * taxpayer on the roll, so they count as declared but never as missing.
   */
  const standing = useMemo(() => {
    const declaredKeys = new Set<string>();
    const declaredRollIds = new Set<string>();
    let locataires = 0;
    calculations.forEach((c) => {
      if (!c.contribuableName) return;
      const key =
        c.contribuableType === 'bailleur'
          ? `bailleur:${c.contribuableRefId}`
          : `locataire:${c.contribuableRefId}:${c.contribuableName.trim().toLowerCase()}`;
      if (declaredKeys.has(key)) return;
      declaredKeys.add(key);
      if (c.contribuableType === 'bailleur') declaredRollIds.add(c.contribuableRefId);
      else locataires += 1;
    });

    const rollIds = new Set(rows.map((r) => r.businessId || r.id));
    const declaredOnRoll = [...declaredRollIds].filter((id) => rollIds.has(id)).length;
    const total = rollIds.size;
    return {
      declared: declaredKeys.size,
      locataires,
      notDeclared: Math.max(0, total - declaredOnRoll),
      rate: total > 0 ? Math.round((declaredOnRoll / total) * 100) : 0,
    };
  }, [calculations, rows]);


  return (
    <>
      {/* Search by taxpayer name or NIF — filters both subtabs. */}
      <div className="mb-4 max-w-xl">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
          <input
            type="search"
            value={taxpayerQuery}
            onChange={(e) => setTaxpayerQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setTaxpayerQuery('')}
            aria-label="Rechercher un bailleur ou un locataire par nom ou NIF"
            className="w-full h-11 pl-10 pr-10 rounded-[12px] border border-line bg-surface text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none transition-premium font-sans shadow-xs"
          />
          {searching && (
            <button
              type="button"
              onClick={() => setTaxpayerQuery('')}
              aria-label="Effacer la recherche"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted hover:text-ink hover:bg-surface2 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        {searching && (
          <p className="text-[12px] text-muted mt-1.5">
            {subTab === 'locatifs'
              ? `${shownCalcs.length} calcul${shownCalcs.length === 1 ? '' : 's'} locatif${shownCalcs.length === 1 ? '' : 's'}`
              : `${shownFoncier.length} calcul${shownFoncier.length === 1 ? '' : 's'} foncier${shownFoncier.length === 1 ? '' : 's'}`}{' '}
            pour « {taxpayerQuery.trim()} »
          </p>
        )}
      </div>

      <div className="mb-6">
        <DeclarationsSubTabs active={subTab} onChange={setSubTab} />
      </div>

      <MetricStrip
        columns={3}
        items={[
          {
            label: 'On the Roll',
            value: summary.total,
            subline: 'contributors in cycle',
            icon: <Building2 className="w-4 h-4" />,
          },
          {
            label: 'Declared',
            value: standing.declared,
            trend: `${standing.rate}%`,
            trendType: standing.rate >= 80 ? 'sage' : standing.rate >= 50 ? 'warn' : 'danger',
            subline:
              standing.locataires > 0
                ? `of the roll · incl. ${standing.locataires} locataire${standing.locataires === 1 ? '' : 's'}`
                : 'of the roll',
            icon: <FileCheck2 className="w-4 h-4" />,
          },
          {
            label: 'Not Declared',
            value: standing.notDeclared,
            trendType: standing.notDeclared > 0 ? 'danger' : 'sage',
            subline: 'awaiting a return',
            icon: <FileWarning className="w-4 h-4" />,
          },
        ]}
      />

      {subTab === 'locatifs' && (
      <Panel
        title="Calcul d'impôts"
        subtitle={
          calcLoading
            ? 'Chargement du registre…'
            : searching
              ? `${shownCalcs.length} sur ${calculations.length} calcul${calculations.length === 1 ? '' : 's'}`
              : `${calculations.length} calcul${calculations.length === 1 ? '' : 's'} enregistré${
                  calculations.length === 1 ? '' : 's'
                }`
        }
        actions={
          <Button
            variant="ghost"
            size="sm"
            icon={<Calculator className="w-3.5 h-3.5" />}
            onClick={() => setCalculOpen(true)}
          >
            Nouvelle déclaration
          </Button>
        }
        padding="none"
      >
        {calcLoading ? (
          <TableSkeleton rows={4} cols={8} />
        ) : shownCalcs.length === 0 && searching ? (
          <div className="px-6 pb-6">
            <EmptyState
              icon={<Search className="w-5 h-5" />}
              title="Aucun contribuable ne correspond"
              description={`Aucun calcul locatif pour un bailleur ou un locataire correspondant à « ${taxpayerQuery.trim()} ».`}
              actionLabel="Effacer la recherche"
              onAction={() => setTaxpayerQuery('')}
            />
          </div>
        ) : calculations.length === 0 ? (
          <div className="px-6 pb-6">
            <EmptyState
              icon={<Calculator className="w-5 h-5" />}
              title="Aucun calcul enregistré"
              description="Ouvrez Calcul d'impôts, choisissez le bailleur ou le locataire, saisissez le revenu brut, le taux et les retenues versées, choisissez le mode de paiement puis enregistrez : le calcul apparaît ici."
              actionLabel="Calcul d'impôts"
              onAction={() => setCalculOpen(true)}
            />
          </div>
        ) : (
          <LocatifCalcTable rows={shownCalcs} matchedVia={matchedVia} />
        )}
      </Panel>
      )}

      {subTab === 'fonciers' && (
        <Panel
          title="Calcul d'impôts"
          subtitle={
            foncierLoading
              ? 'Chargement du registre…'
              : searching
                ? `${shownFoncier.length} sur ${foncierCalcs.length} calcul${foncierCalcs.length === 1 ? '' : 's'}`
                : `${foncierCalcs.length} calcul${foncierCalcs.length === 1 ? '' : 's'} enregistré${
                    foncierCalcs.length === 1 ? '' : 's'
                  }`
          }
          actions={
            <Button
              variant="ghost"
              size="sm"
              icon={<Calculator className="w-3.5 h-3.5" />}
              onClick={() => setFoncierOpen(true)}
            >
              Nouvelle déclaration
            </Button>
          }
          padding="none"
        >
          {foncierLoading ? (
            <TableSkeleton rows={4} cols={12} />
          ) : shownFoncier.length === 0 && searching ? (
            <div className="p-6">
              <EmptyState
                icon={<Search className="w-5 h-5" />}
                title="Aucun contribuable ne correspond"
                description={`Aucun calcul foncier pour un bailleur ou un locataire correspondant à « ${taxpayerQuery.trim()} ».`}
                actionLabel="Effacer la recherche"
                onAction={() => setTaxpayerQuery('')}
              />
            </div>
          ) : foncierCalcs.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<Calculator className="w-5 h-5" />}
                title="Aucun calcul d'impôt foncier"
                description="Cliquez sur Nouvelle déclaration, choisissez le bailleur, le rang et l'usage, saisissez la superficie ou le nombre et le taux, choisissez le mode de paiement, puis enregistrez : le calcul apparaît ici."
                actionLabel="Nouvelle déclaration"
                onAction={() => setFoncierOpen(true)}
              />
            </div>
          ) : (
            <FoncierCalcTable rows={shownFoncier} matchedVia={matchedVia} />
          )}
        </Panel>
      )}

      <CalculFoncierModal isOpen={foncierOpen} onClose={closeFoncier} onSaved={addSavedFoncier} />

      <CalculImpotModal isOpen={calculOpen} onClose={closeCalcul} onSaved={addSavedCalculation} />
    </>
  );
};
