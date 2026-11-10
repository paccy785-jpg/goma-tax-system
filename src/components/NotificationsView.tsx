import React, { useEffect, useMemo, useState } from 'react';
import { Bell, Calculator, Landmark, BadgeCheck, ArrowLeftRight, Search, X } from 'lucide-react';
import { UserRole } from '../types';
import { subscribeToTaxCalculations, TaxCalculation } from '../services/taxCalculationService';
import { FoncierCalculation, subscribeToFoncierCalculations } from '../services/foncierCalculationService';
import { BankConfirmation, subscribeToBankConfirmations, DECLARATION_KIND_LABELS } from '../services/bankConfirmationService';
import { MUTATION_KIND_LABELS, PropertyTransfer, subscribeToTransfers } from '../services/transferService';
import { formatMoney } from '../utils/money';
import { EmptyState, Panel } from './ui';

/**
 * Notifications — one live feed of what happened in the system: declarations
 * saved (foncier and locatif), payments confirmed by the bank, and property
 * transfers. Built from the records themselves, so it is always complete and
 * needs no separate store.
 */

type Kind = 'foncier' | 'locatif' | 'paiement' | 'transfert';
type Filter = 'all' | Kind;

interface Notice {
  id: string;
  kind: Kind;
  at: string;
  title: string;
  detail: string;
  amount?: number;
}

const KIND_META: Record<Kind, { label: string; icon: React.ReactNode; tint: string }> = {
  foncier: { label: 'Déclaration foncière', icon: <Landmark className="w-4 h-4" />, tint: 'bg-navy/10 text-navy' },
  locatif: { label: 'Déclaration locative', icon: <Calculator className="w-4 h-4" />, tint: 'bg-accent-soft text-accent' },
  paiement: { label: 'Paiement confirmé', icon: <BadgeCheck className="w-4 h-4" />, tint: 'bg-sage/12 text-sage' },
  transfert: { label: 'Transfert de propriété', icon: <ArrowLeftRight className="w-4 h-4" />, tint: 'bg-warn/10 text-warn' },
};

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Toutes' },
  { id: 'foncier', label: 'Déclarations foncières' },
  { id: 'locatif', label: 'Déclarations locatives' },
  { id: 'paiement', label: 'Paiements' },
  { id: 'transfert', label: 'Transferts' },
];

/** "il y a 5 min", "hier à 14:02", "22/10/2026 à 09:15". */
function when(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diff = (Date.now() - d.getTime()) / 1000;
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (diff < 60) return 'à l’instant';
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return `aujourd’hui à ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `hier à ${time}`;
  return `${d.toLocaleDateString('fr-FR')} à ${time}`;
}

export const NotificationsView: React.FC<{ userRole: UserRole }> = () => {
  const [fonciers, setFonciers] = useState<FoncierCalculation[]>([]);
  const [locatifs, setLocatifs] = useState<TaxCalculation[]>([]);
  const [payments, setPayments] = useState<BankConfirmation[]>([]);
  const [transfers, setTransfers] = useState<PropertyTransfer[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [, setTick] = useState(0);

  useEffect(() => subscribeToFoncierCalculations((d) => setFonciers(d || [])), []);
  useEffect(() => subscribeToTaxCalculations((d) => setLocatifs(d || [])), []);
  useEffect(() => subscribeToBankConfirmations((d) => setPayments(d || [])), []);
  useEffect(() => subscribeToTransfers((d) => setTransfers(d || [])), []);
  // Keep "il y a 5 min" current.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 60000);
    return () => clearInterval(t);
  }, []);

  const notices = useMemo<Notice[]>(() => {
    const list: Notice[] = [
      ...fonciers.map((c) => ({
        id: `f_${c.id}`,
        kind: 'foncier' as const,
        at: c.createdAt,
        title: `Déclaration d’impôt foncier — ${c.bailleurName || 'Bailleur non renseigné'}`,
        detail: `${c.lines.length} ligne${c.lines.length === 1 ? '' : 's'}${c.bailleurNif ? ` • NIF ${c.bailleurNif}` : ''}`,
        amount: c.totalImpotDuUSD,
      })),
      ...locatifs.map((c) => ({
        id: `l_${c.id}`,
        kind: 'locatif' as const,
        at: c.createdAt,
        title: `Déclaration d’impôt locatif — ${c.contribuableName || 'Non renseigné'}`,
        detail: [
          c.contribuableNif ? `NIF ${c.contribuableNif}` : '',
          c.locataires?.length ? `Pour : ${c.locataires.map((l) => l.name).join(', ')}` : '',
        ]
          .filter(Boolean)
          .join(' • '),
        amount: c.soldeUSD,
      })),
      ...payments.map((p) => ({
        id: `p_${p.id}`,
        kind: 'paiement' as const,
        at: p.confirmedAt,
        title: `Paiement confirmé — ${p.contribuableName}`,
        detail: `${DECLARATION_KIND_LABELS[p.kind]} • Réf. ${p.reference}`,
        amount: p.amountUSD,
      })),
      ...transfers.map((t) => ({
        id: `t_${t.id}`,
        kind: 'transfert' as const,
        at: t.createdAt,
        title: `Transfert de propriété — ${t.from.name} → ${t.to.name}`,
        detail: [MUTATION_KIND_LABELS[t.kind] || t.kind, t.numeroParcelle ? `Parcelle ${t.numeroParcelle}` : '']
          .filter(Boolean)
          .join(' • '),
      })),
    ];
    return list.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  }, [fonciers, locatifs, payments, transfers]);

  const shown = useMemo(() => {
    const base = filter === 'all' ? notices : notices.filter((n) => n.kind === filter);
    const query = q.trim().toLowerCase();
    if (!query) return base;
    const tokens = query.split(/\s+/);
    return base.filter((n) => tokens.every((t) => `${n.title} ${n.detail}`.toLowerCase().includes(t)));
  }, [notices, filter, q]);

  const count = (f: Filter) => (f === 'all' ? notices.length : notices.filter((n) => n.kind === f).length);

  return (
    <>
      <div className="mb-4 max-w-xl relative">
        <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQ('')}
          aria-label="Rechercher dans les notifications"
          className="w-full h-11 pl-10 pr-10 rounded-[12px] border border-line bg-surface text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none transition-premium shadow-xs"
        />
        {q && (
          <button
            type="button"
            onClick={() => setQ('')}
            aria-label="Effacer la recherche"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted hover:text-ink hover:bg-surface2 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <Panel
        title="Notifications"
        subtitle={`${shown.length} notification${shown.length === 1 ? '' : 's'}`}
        padding="none"
      >
        <div className="px-6 py-3.5 border-b border-line flex items-center gap-2 flex-wrap">
          {FILTERS.map((f) => {
            const on = filter === f.id;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] text-[12px] font-medium transition-premium cursor-pointer ${
                  on ? 'bg-accent text-white font-semibold' : 'bg-surface2 text-muted hover:bg-line hover:text-ink'
                }`}
              >
                {f.label}
                <span className={`text-[11px] font-bold tabular-nums ${on ? 'text-white/80' : 'text-faint'}`}>
                  {count(f.id)}
                </span>
              </button>
            );
          })}
        </div>

        {shown.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Bell className="w-5 h-5" />}
              title={q.trim() ? 'Aucun résultat' : 'Aucune notification'}
              description={
                q.trim()
                  ? `Aucune notification ne correspond à « ${q.trim()} ».`
                  : 'Les déclarations enregistrées, les paiements confirmés et les transferts de propriété apparaîtront ici.'
              }
              actionLabel={q.trim() ? 'Effacer la recherche' : undefined}
              onAction={q.trim() ? () => setQ('') : undefined}
            />
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((n) => {
              const meta = KIND_META[n.kind];
              return (
                <li key={n.id} className="px-6 py-3.5 flex items-start gap-3.5 hover:bg-surface2/30 transition-premium">
                  <span className={`mt-0.5 w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 ${meta.tint}`}>
                    {meta.icon}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-xs font-semibold text-ink truncate" title={n.title}>
                        {n.title}
                      </span>
                      <span className="text-[11px] text-faint shrink-0 tabular-nums">{when(n.at)}</span>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 mt-0.5">
                      <span className="text-[12px] text-muted truncate" title={n.detail}>
                        <span className="font-semibold">{meta.label}</span>
                        {n.detail ? ` • ${n.detail}` : ''}
                      </span>
                      {typeof n.amount === 'number' && (
                        <span className="text-xs font-bold text-ink tabular-nums shrink-0">{formatMoney(n.amount)}</span>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
};
