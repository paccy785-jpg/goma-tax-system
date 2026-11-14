import React, { useEffect, useMemo, useState } from 'react';
import { Building2, DollarSign, Eye } from 'lucide-react';
import { Badge, Button, MetricStrip, PageHeader, Panel, Skeleton, TableSkeleton } from '../ui';
import { subscribeToBusinesses } from '../../services/dbService';
import { subscribeToDgiCalculsImpot, type DgiCalculImpot } from '../../services/dgiCalculImpotService';
import { montantsPayesOf, subscribeToDgiDeclarations, type DgiDeclaration } from '../../services/dgiDeclarationService';
import { CATEGORIES_SALARIALES, formatMontant } from './DgiCalculImpotView';
import { DGI_BRAND } from '../../branding';
import { normalizeBusinessStatus, type Business, type NavigationItem } from '../../types';
import type { Devise } from '../../services/nomenclatureService';

const MONTH_NAMES_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_SHORT_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** One colour per catégorie salariale, in the order of the list. */
const CATEGORY_COLORS = ['bg-sage', 'bg-accent', 'bg-navy', 'bg-warn', 'bg-danger', 'bg-accent-soft', 'bg-line'];

/** yyyy-mm-dd → dd/mm/yyyy, without going through a time zone. */
const frDay = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('/') : d || '—');

/** "yyyy-mm" of a Date, local time. */
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/**
 * The DGI portal's dashboard — the layout of the DPRNK Tableau de bord
 * (greeting header, two KPI cards, a six-month collection chart beside a
 * portfolio breakdown, and the latest receipts), fed by the DGI portal's own
 * records: the taxpayer roll, the Calculs d'impôt (Declarations tab) and the
 * payments recorded on the Accountant tab. USD and CDF are never added
 * together — no exchange rate is recorded.
 */
export const DgiDashboardView: React.FC<{
  userName: string;
  onNavigate: (view: NavigationItem) => void;
}> = ({ userName, onNavigate }) => {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [calculs, setCalculs] = useState<DgiCalculImpot[]>([]);
  const [payments, setPayments] = useState<DgiDeclaration[]>([]);
  const [loaded, setLoaded] = useState({ biz: false, calc: false, pay: false });
  const loading = !loaded.biz || !loaded.calc || !loaded.pay;

  useEffect(
    () =>
      subscribeToBusinesses(
        (b) => {
          setBusinesses(b || []);
          setLoaded((l) => ({ ...l, biz: true }));
        },
        () => setLoaded((l) => ({ ...l, biz: true })),
      ),
    [],
  );
  useEffect(
    () =>
      subscribeToDgiCalculsImpot((c) => {
        setCalculs(c);
        setLoaded((l) => ({ ...l, calc: true }));
      }),
    [],
  );
  useEffect(
    () =>
      subscribeToDgiDeclarations((p) => {
        setPayments(p);
        setLoaded((l) => ({ ...l, pay: true }));
      }),
    [],
  );

  const now = new Date();
  const thisMonth = monthKey(now);

  /** Collected this month (by date de la quittance), per currency. */
  const month = useMemo(() => {
    let usd = 0;
    let cdf = 0;
    let count = 0;
    for (const p of payments) {
      if (!(p.dateQuittance || '').startsWith(thisMonth)) continue;
      count += 1;
      // Montant payé = Impôt total dû of the declaration paid.
      for (const m of montantsPayesOf(p, calculs)) {
        if (!Number.isFinite(m.montant)) continue;
        if (m.devise === 'CDF') cdf += m.montant;
        else usd += m.montant;
      }
    }
    return { usd: Math.round(usd * 100) / 100, cdf: Math.round(cdf * 100) / 100, count };
  }, [payments, calculs, thisMonth]);

  /** Taxpayers on the DGI roll. */
  const roll = useMemo(() => {
    const active = businesses.filter((b) => normalizeBusinessStatus(b.status) === 'Active').length;
    const goma = businesses.filter((b) => (b.commune || '').trim().toLowerCase() === 'goma').length;
    const karisimbi = businesses.filter((b) => (b.commune || '').trim().toLowerCase() === 'karisimbi').length;
    return { total: businesses.length, active, goma, karisimbi };
  }, [businesses]);

  /**
   * The chart's currency: the one more payments were made in (USD on a tie),
   * switchable — the two are never drawn on one scale.
   */
  const paidCdf = payments.filter((p) => montantsPayesOf(p, calculs).some((m) => m.devise === 'CDF')).length;
  const paidUsd = payments.filter((p) => montantsPayesOf(p, calculs).some((m) => m.devise === 'USD')).length;
  const [chartDevise, setChartDevise] = useState<Devise | null>(null);
  const devise: Devise = chartDevise ?? (paidCdf > paidUsd ? 'CDF' : 'USD');

  /** Last six months, oldest first, current month last. */
  const chart = useMemo(() => {
    const out: { key: string; label: string; amount: number; isCurrent: boolean }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      out.push({ key: monthKey(d), label: MONTH_SHORT_EN[d.getMonth()], amount: 0, isCurrent: i === 0 });
    }
    for (const p of payments) {
      const bar = out.find((o) => (p.dateQuittance || '').startsWith(o.key));
      if (!bar) continue;
      for (const m of montantsPayesOf(p, calculs)) {
        if (m.devise === devise && Number.isFinite(m.montant)) bar.amount += m.montant;
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payments, calculs, devise, thisMonth]);
  const maxChart = Math.max(...chart.map((c) => c.amount), 1);

  /** Declarations (Calculs d'impôt) by catégorie salariale: one count per line. */
  const portfolio = useMemo(() => {
    const counts = CATEGORIES_SALARIALES.map((c) => ({ categorie: c as string, count: 0 }));
    for (const calc of calculs) {
      for (const l of calc.lignes || []) {
        const row = counts.find((c) => c.categorie === l.categorie);
        if (row) row.count += 1;
      }
    }
    const total = counts.reduce((s, c) => s + c.count, 0);
    return { counts, total };
  }, [calculs]);
  const pct = (n: number) => (portfolio.total ? Math.round((n / portfolio.total) * 100) : 0);

  /** The latest receipts, newest date de la quittance first. */
  const recent = useMemo(
    () =>
      [...payments]
        .sort(
          (a, b) =>
            (b.dateQuittance || '').localeCompare(a.dateQuittance || '') ||
            (b.createdAt || '').localeCompare(a.createdAt || ''),
        )
        .slice(0, 5),
    [payments],
  );

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };
  const eyebrow = now
    .toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
    .toUpperCase();
  const firstName = userName ? userName.split(' ')[0] : 'Officer';

  const collectedValue =
    month.cdf > 0 && month.usd > 0 ? (
      <span className="flex flex-col gap-0.5">
        <span>{formatMontant({ montant: month.cdf, devise: 'CDF' })}</span>
        <span>{formatMontant({ montant: month.usd, devise: 'USD' })}</span>
      </span>
    ) : month.cdf > 0 ? (
      formatMontant({ montant: month.cdf, devise: 'CDF' })
    ) : (
      formatMontant({ montant: month.usd, devise: 'USD' })
    );

  return (
    <div className="space-y-8 font-sans">
      <PageHeader
        eyebrow={eyebrow}
        title={`${getGreeting()}, ${firstName}.`}
        description={`${DGI_BRAND.shortName} revenue command center for the professional and exceptional taxes on remuneration.`}
      />

      <MetricStrip
        columns={2}
        items={[
          {
            label: `Collected — ${MONTH_NAMES_EN[now.getMonth()]}`,
            value: loading ? '...' : collectedValue,
            trend: `${month.count} receipts`,
            trendType: 'sage',
            subline: 'By receipt date, per currency',
            icon: <DollarSign className="w-4 h-4 text-sage" />,
          },
          {
            label: 'Active Businesses',
            value: loading ? '...' : roll.active.toLocaleString('en-US'),
            trend: `${roll.total} registered`,
            trendType: 'muted',
            subline: `${roll.goma} Goma • ${roll.karisimbi} Karisimbi`,
            icon: <Building2 className="w-4 h-4 text-accent" />,
          },
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Six-month collection chart */}
        <Panel
          title="Revenue Collection Trend"
          subtitle={`Monthly collections in ${devise === 'CDF' ? 'CDF' : 'USD'} across last 6 months (accent-soft bars, current month in solid accent)`}
          actions={
            <div role="radiogroup" aria-label="Devise" className="inline-flex items-center gap-1 p-1 rounded-[10px] border border-line bg-surface2">
              {(['USD', 'CDF'] as Devise[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={devise === d}
                  onClick={() => setChartDevise(d)}
                  className={`px-2.5 py-1 rounded-[8px] text-[11px] font-semibold transition-premium cursor-pointer ${
                    devise === d
                      ? 'bg-surface text-accent shadow-[0_2px_8px_oklch(20%_0.03_260/0.08)] border border-accent/20'
                      : 'text-muted hover:text-ink border border-transparent'
                  }`}
                >
                  {d === 'USD' ? 'USD ($)' : 'CDF (FC)'}
                </button>
              ))}
            </div>
          }
        >
          {loading ? (
            <Skeleton className="h-44 w-full" />
          ) : (
            <div className="pt-4">
              <div className="h-44 flex items-end justify-between gap-3 px-2 border-b border-line pb-2">
                {chart.map((c) => (
                  <div key={c.key} className="flex-1 flex flex-col items-center gap-2 h-full justify-end group">
                    <div className="text-[11px] font-bold text-muted tabular-nums opacity-0 group-hover:opacity-100 transition-premium whitespace-nowrap">
                      {formatMontant({ montant: c.amount, devise })}
                    </div>
                    <div
                      style={{ height: `${Math.max(0, (c.amount / maxChart) * 100)}%` }}
                      className={`w-full max-w-[42px] rounded-t-[8px] transition-premium ${
                        c.isCurrent ? 'bg-accent shadow-[0_4px_12px_oklch(57%_0.16_36/0.3)]' : 'bg-accent-soft hover:bg-accent/40'
                      }`}
                    />
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between gap-3 px-2 pt-2 text-[12px] font-bold text-muted uppercase tracking-wider">
                {chart.map((c) => (
                  <span key={c.key} className={`flex-1 text-center truncate ${c.isCurrent ? 'text-accent font-extrabold' : ''}`}>
                    {c.label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Panel>

        {/* Declarations by catégorie salariale */}
        <Panel title="Tax Portfolio Health" subtitle="Declared salary categories across all saved tax calculations">
          {loading ? (
            <Skeleton className="h-44 w-full" />
          ) : (
            <div className="pt-2 space-y-4">
              <div className="h-3 w-full rounded-full bg-surface2 overflow-hidden flex shadow-inner">
                {portfolio.counts.map((c, i) =>
                  c.count > 0 ? (
                    <div
                      key={c.categorie}
                      style={{ width: `${pct(c.count)}%` }}
                      className={`${CATEGORY_COLORS[i]} transition-premium`}
                      title={`${c.categorie}: ${pct(c.count)}%`}
                    />
                  ) : null,
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 pt-2">
                {portfolio.counts.map((c, i) => (
                  <div
                    key={c.categorie}
                    className="p-3 rounded-[12px] bg-surface2/60 border border-line flex items-center justify-between gap-2"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2.5 h-2.5 rounded-full ${CATEGORY_COLORS[i]} shrink-0`} />
                      <span className="text-xs font-medium text-ink truncate" title={c.categorie}>
                        {c.categorie}
                      </span>
                    </div>
                    <span className="font-display font-bold text-sm text-ink tabular-nums shrink-0">
                      {c.count} <span className="text-[11px] text-muted font-normal">({pct(c.count)}%)</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>
      </div>

      {/* Latest receipts */}
      <Panel
        title="Recent Tax Receipts"
        subtitle="Latest receipts recorded by the accountant"
        actions={
          <Button variant="ghost" size="sm" onClick={() => onNavigate('bank-agent')}>
            View Full Ledger
          </Button>
        }
        padding="none"
      >
        {loading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : recent.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted">No tax payments recorded yet this fiscal term.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="premium-table w-full text-left border-collapse font-sans">
              <thead>
                <tr className="border-b border-line bg-surface2/40">
                  <th className="text-[11px] font-bold uppercase tracking-[0.1em] text-faint px-6 py-3.5">Receipt #</th>
                  <th className="text-[11px] font-bold uppercase tracking-[0.1em] text-faint px-6 py-3.5">Business / Taxpayer</th>
                  <th className="text-[11px] font-bold uppercase tracking-[0.1em] text-faint px-6 py-3.5">Date & Cashier</th>
                  <th className="text-[11px] font-bold uppercase tracking-[0.1em] text-faint px-6 py-3.5 text-right">Amount Tendered</th>
                  <th className="text-[11px] font-bold uppercase tracking-[0.1em] text-faint px-6 py-3.5 text-center">Status</th>
                  <th className="text-[11px] font-bold uppercase tracking-[0.1em] text-faint px-6 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {recent.map((p) => (
                  <tr key={p.id} className="hover:bg-surface2/30 transition-premium">
                    <td className="px-6 py-4 font-mono text-xs font-bold text-ink tabular-nums">{p.numeroQuittance || '—'}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-[30px] h-[30px] rounded-[8px] bg-accent-soft text-accent font-display font-bold text-xs flex items-center justify-center shrink-0">
                          {(p.contribuableName || 'P').charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-ink truncate">{p.contribuableName || '—'}</div>
                          <div className="text-[12px] text-muted truncate">{p.contribuableAdresse || '—'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-xs text-ink tabular-nums" data-no-i18n>
                        {frDay(p.dateQuittance)}
                      </div>
                      <div className="text-[12px] text-muted truncate">{p.createdByName || '—'}</div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="font-display text-sm font-bold text-ink tabular-nums whitespace-nowrap">
                        {montantsPayesOf(p, calculs).length === 0 ? (
                          '—'
                        ) : (
                          <span className="inline-flex flex-col items-end gap-0.5">
                            {montantsPayesOf(p, calculs).map((m) => (
                              <span key={m.devise}>{formatMontant(m)}</span>
                            ))}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      {montantsPayesOf(p, calculs).length > 0 ? <Badge variant="sage">Paid</Badge> : <Badge variant="warn">No amount</Badge>}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <Button variant="ghost" size="sm" onClick={() => onNavigate('bank-agent')} icon={<Eye className="w-3.5 h-3.5" />}>
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
};
