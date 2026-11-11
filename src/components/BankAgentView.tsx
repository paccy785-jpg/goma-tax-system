import { useRevenueLedger } from '../hooks/useRevenueLedger';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Clock, Search, X, Wallet, Lock, Landmark, PenLine } from 'lucide-react';
import { natureCode, UserRole } from '../types';
import { subscribeToTaxCalculations, TaxCalculation, calcPaymentModeLabel } from '../services/taxCalculationService';
import {
  FoncierCalculation,
  FONCIER_PAYMENT_MODE_LABELS,
  subscribeToFoncierCalculations,
} from '../services/foncierCalculationService';
import {
  BankConfirmation,
  confirmationId,
  DECLARATION_KIND_LABELS,
  normalizeReference,
  subscribeToBankConfirmations,
} from '../services/bankConfirmationService';
import { formatMoney } from '../utils/money';
import { Button, EmptyState, MetricStrip, Panel, TableSkeleton } from './ui';
import { ConfirmPaymentModal, PayableDeclaration } from './bank/ConfirmPaymentModal';
import { NotePerception, subscribeToNotesPerception } from '../services/notePerceptionService';
import { ComptableTable } from './notePerception/ComptableTable';
import { PaiementComptableModal } from './notePerception/PaiementComptableModal';
import { ConfirmNotePaymentModal } from './notePerception/ConfirmNotePaymentModal';
import { PaymentsView } from './PaymentsView';
import { RemplirDeclarationModal } from './bank/RemplirDeclarationModal';
import { DeclarationAdmin, subscribeToDeclarationAdmin } from '../services/declarationAdminService';

/** Subtabs of the Bank Agent page. */
export type BankSubTab = 'declarations' | 'notes' | 'payments';

const BANK_SUBTABS: { id: BankSubTab; label: string; hint: string }[] = [
  { id: 'declarations', label: 'Déclarations', hint: 'Paiements des déclarations foncières et locatives' },
  { id: 'notes', label: 'Note de perception', hint: 'Paiements des notes de perception' },
  // Payment History — formerly its own tab under the Finance Department.
  { id: 'payments', label: 'Historique des paiements', hint: 'Encaissements et reçus officiels' },
];

/** Same segmented control as the other pages' subtabs. */
const BankSubTabs: React.FC<{
  active: BankSubTab;
  onChange: (id: BankSubTab) => void;
  tabs: BankSubTab[];
}> = ({ active, onChange, tabs }) => (
  <div
    role="tablist"
    aria-label="Sections de l'agent bancaire"
    className="inline-flex items-center gap-1 p-1 rounded-[12px] bg-surface2 border border-line"
  >
    {BANK_SUBTABS.filter((tab) => tabs.includes(tab.id)).map((tab) => {
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

type StatusFilter = 'pending' | 'paid' | 'all';

const COLS = {
  who: 'w-[20%]',
  kind: 'w-[10%]',
  detail: 'w-[19%]',
  date: 'w-[9%]',
  amount: 'w-[10%]',
  mode: 'w-[11%]',
  status: 'w-[21%]',
} as const;
const HEADERS: { key: keyof typeof COLS; label: string; right?: boolean }[] = [
  { key: 'who', label: 'Contribuable' },
  { key: 'kind', label: 'Impôt' },
  { key: 'detail', label: 'Objet de la déclaration' },
  { key: 'date', label: 'Déclaré le' },
  { key: 'amount', label: 'Montant à payer', right: true },
  { key: 'mode', label: 'Mode de paiement' },
  { key: 'status', label: 'Paiement' },
];
const pad = (i: number, last: number) => (i === 0 ? 'pl-6 pr-3' : i === last ? 'pl-3 pr-6' : 'px-3');
const frDate = (iso: string) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '—');

/** Foncier slip → what the bank needs to see. */
function fromFoncier(c: FoncierCalculation): PayableDeclaration {
  const parcels = Array.from(
    new Map(c.lines.map((l) => [l.parcelId || l.numeroParcelle || '', l])).values()
  ).map((l) => `${l.nature ? natureCode(l.nature) + ' ' : ''}${l.numeroParcelle ? `Parcelle ${l.numeroParcelle}` : ''}`.trim());
  return {
    kind: 'foncier',
    calculationId: c.id,
    contribuableName: c.bailleurName || 'Non renseigné',
    contribuableNif: c.bailleurNif,
    detail: parcels.filter(Boolean).join(', '),
    amountUSD: c.totalImpotDuUSD,
    modePaiement: c.modePaiement ? FONCIER_PAYMENT_MODE_LABELS[c.modePaiement] : undefined,
    declaredAt: c.createdAt,
  };
}

/** Locatif slip → what the bank needs to see. The amount due is the solde à payer. */
function fromLocatif(c: TaxCalculation): PayableDeclaration {
  const who = c.contribuableType === 'bailleur' ? 'Bailleur' : c.contribuableType === 'locataire' ? 'Locataire' : '';
  const pour = c.locataires?.length ? `Pour : ${c.locataires.map((l) => l.name).join(', ')}` : '';
  return {
    kind: 'locatif',
    calculationId: c.id,
    contribuableName: c.contribuableName || 'Non renseigné',
    contribuableNif: c.contribuableNif,
    detail: [who, pour].filter(Boolean).join(' · '),
    amountUSD: c.soldeUSD,
    modePaiement: calcPaymentModeLabel(c.modePaiement),
    declaredAt: c.createdAt,
  };
}

export const BankAgentView: React.FC<{
  userRole: UserRole;
  /**
   * Whether the role may see Historique des paiements (the "payments"
   * permission of the role matrix — the former Payment History tab).
   */
  canSeePayments?: boolean;
  /** The subtab to open on (e.g. a "Payment History" link elsewhere opens 'payments'). */
  initialSubTab?: BankSubTab;
}> = ({ userRole, canSeePayments = false, initialSubTab }) => {
  const canConfirm = userRole === 'Admin' || userRole === 'Supervisor' || userRole === 'Cashier';

  const [reloadKey, setReloadKey] = useState(0);
  const { sources, loading, error, cached } = useRevenueLedger(reloadKey);
  const fonciers = sources.foncierCalculations;
  const locatifs = sources.taxCalculations;
  const confirmations = sources.bankConfirmations;
  const notes = sources.notesPerception.filter((n) => !/^NP-DEMO-/i.test(n.taxateur?.numeroFacture || ''));
  const notesLoading = loading;
  const [status, setStatus] = useState<StatusFilter>('pending');
  const [q, setQ] = useState('');
  const [active, setActive] = useState<PayableDeclaration | null>(null);
  const tabs: BankSubTab[] = canSeePayments
    ? ['declarations', 'notes', 'payments']
    : ['declarations', 'notes'];
  const [chosenSubTab, setSubTab] = useState<BankSubTab>(initialSubTab ?? 'declarations');
  const subTab: BankSubTab = tabs.includes(chosenSubTab) ? chosenSubTab : 'declarations';

  // The payment card.
  const [payOpen, setPayOpen] = useState(false);
  const [remplirOpen, setRemplirOpen] = useState(false);
  /** The declaration whose row's "Remplir la déclaration" opened the card. */
  const [remplirId, setRemplirId] = useState<string | null>(null);
  const openRemplir = (id: string | null) => {
    setRemplirId(id);
    setRemplirOpen(true);
  };
  // "Réservé à l'administration" filled in by the accountant — a declaration's
  // payment is confirmed only once it is filled.
  const [admins, setAdmins] = useState<DeclarationAdmin[]>([]);
  useEffect(() => subscribeToDeclarationAdmin((d) => setAdmins(d || [])), []);
  const filledIds = useMemo(() => new Set(admins.map((a) => a.id)), [admins]);
  /** The note whose row's "Remplir" opened the card (none: the header button). */
  const [payNoteId, setPayNoteId] = useState<string | null>(null);
  const closePay = useCallback(() => {
    setPayOpen(false);
    setPayNoteId(null);
  }, []);
  const close = useCallback(() => setActive(null), []);

  const confirmedById = useMemo(() => new Map(confirmations.map((c) => [c.id, c])), [confirmations]);
  // One bank reference pays one thing — a declaration or a note de perception.
  const usedReferences = useMemo(
    () =>
      new Set([
        ...confirmations.map((c) => normalizeReference(c.reference)),
        ...notes.filter((n) => n.confirmation).map((n) => normalizeReference(n.confirmation!.reference)),
      ]),
    [confirmations, notes]
  );
  /** The note whose "Confirmer le paiement" is open — read live from the list. */
  const [confirmNoteId, setConfirmNoteId] = useState<string | null>(null);
  const confirmNote = confirmNoteId ? notes.find((n) => n.id === confirmNoteId) || null : null;
  const closeConfirmNote = useCallback(() => setConfirmNoteId(null), []);

  /** Every declaration from both subtabs, newest first, with its payment state. */
  const rows = useMemo(() => {
    const all = [...fonciers.map(fromFoncier), ...locatifs.map(fromLocatif)].sort((a, b) =>
      (b.declaredAt || '').localeCompare(a.declaredAt || '')
    );
    return all.map((d) => {
      const confirmation = confirmedById.get(confirmationId(d.kind, d.calculationId));
      const state: 'paid' | 'pending' | 'none' = confirmation ? 'paid' : d.amountUSD > 0 ? 'pending' : 'none';
      const filled = filledIds.has(confirmationId(d.kind, d.calculationId));
      return { d, confirmation, state, filled };
    });
  }, [fonciers, locatifs, confirmedById, filledIds]);

  const pending = rows.filter((r) => r.state === 'pending');
  /** Pending declarations the accountant has not filled in yet. */
  const toFill = useMemo(() => pending.filter((r) => !r.filled).map((r) => r.d), [pending]);
  const paid = rows.filter((r) => r.state === 'paid');
  const sum = (list: typeof rows) =>
    Math.round(list.reduce((s, r) => s + (r.confirmation?.amountUSD ?? r.d.amountUSD), 0) * 100) / 100;

  const shown = useMemo(() => {
    const base = status === 'pending' ? pending : status === 'paid' ? paid : rows;
    const query = q.trim().toLowerCase();
    if (!query) return base;
    const tokens = query.split(/\s+/);
    return base.filter((r) => {
      const hay = [r.d.contribuableName, r.d.contribuableNif, r.d.detail, r.confirmation?.reference]
        .join(' ')
        .toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [rows, pending, paid, status, q]);

  const chips: { id: StatusFilter; label: string; count: number }[] = [
    { id: 'pending', label: 'À confirmer', count: pending.length },
    { id: 'paid', label: 'Paiements confirmés', count: paid.length },
    { id: 'all', label: 'Toutes les déclarations', count: rows.length },
  ];

  if (loading || error) return <div role="status" className="space-y-4">
    <p>{error || 'Chargement du registre complet…'}</p>
    {error && <Button onClick={() => setReloadKey((k) => k + 1)}>Réessayer</Button>}
  </div>;

  return (
    <>
      {cached && <p role="status" className="mb-4">Données locales non confirmées : les totaux peuvent être incomplets.</p>}
      <div className="mb-6">
        <BankSubTabs active={subTab} onChange={setSubTab} tabs={tabs} />
      </div>

      {subTab === 'payments' ? (
        <PaymentsView userRole={userRole} />
      ) : subTab === 'notes' ? (
        <>
          {canConfirm && (
            <div className="mb-4 flex justify-end">
              <Button variant="primary" size="md" icon={<Landmark className="w-4 h-4" />} onClick={() => setPayOpen(true)}>
                Remplir la note de perception
              </Button>
            </div>
          )}
          <ComptableTable
            notes={notes}
            loading={notesLoading}
            onAdd={canConfirm ? () => setPayOpen(true) : undefined}
            onFill={
              canConfirm
                ? (n) => {
                    setPayNoteId(n.id);
                    setPayOpen(true);
                  }
                : undefined
            }
            onConfirm={canConfirm ? (n) => setConfirmNoteId(n.id) : undefined}
          />
          {canConfirm && (
            <ConfirmNotePaymentModal note={confirmNote} usedReferences={usedReferences} onClose={closeConfirmNote} />
          )}
          {!canConfirm && (
            <p className="text-[12px] text-faint mt-4">Votre rôle consulte les paiements en lecture seule.</p>
          )}
          {canConfirm && (
            <PaiementComptableModal
              isOpen={payOpen}
              onClose={closePay}
              notes={notes}
              initialNoteId={payNoteId}
            />
          )}
        </>
      ) : (
      <>
      <div className="mb-4 max-w-xl relative">
        <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && setQ('')}
          aria-label="Rechercher"
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

      <MetricStrip
        columns={3}
        items={[
          {
            label: 'À confirmer',
            value: pending.length,
            trend: formatMoney(sum(pending)),
            trendType: pending.length > 0 ? 'warn' : 'sage',
            subline: 'en attente de paiement',
            icon: <Clock className="w-4 h-4" />,
          },
          {
            label: 'Paiements confirmés',
            value: paid.length,
            trend: formatMoney(sum(paid)),
            trendType: 'sage',
            subline: 'encaissés',
            icon: <BadgeCheck className="w-4 h-4" />,
          },
          {
            label: 'Total déclaré',
            value: formatMoney(sum([...pending, ...paid])),
            subline: `${pending.length + paid.length} déclaration${pending.length + paid.length === 1 ? '' : 's'} à payer`,
            icon: <Wallet className="w-4 h-4" />,
          },
        ]}
      />

      <Panel
        title="Paiements des déclarations"
        subtitle="Impôts fonciers et locatifs déclarés — confirmez chaque paiement reçu avec sa référence."
        padding="none"
      >
        <div className="px-6 py-3.5 border-b border-line flex items-center gap-2 flex-wrap">
          {chips.map((c) => {
            const on = status === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setStatus(c.id)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] text-[12px] font-medium transition-premium cursor-pointer ${
                  on ? 'bg-accent text-white font-semibold' : 'bg-surface2 text-muted hover:bg-line hover:text-ink'
                }`}
              >
                {c.label}
                <span className={`text-[11px] font-bold tabular-nums ${on ? 'text-white/80' : 'text-faint'}`}>{c.count}</span>
              </button>
            );
          })}
        </div>

        {loading ? (
          <TableSkeleton rows={5} cols={7} />
        ) : shown.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={status === 'paid' ? <BadgeCheck className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
              title={
                q.trim()
                  ? 'Aucun résultat'
                  : status === 'pending'
                    ? 'Aucun paiement en attente'
                    : status === 'paid'
                      ? 'Aucun paiement confirmé'
                      : 'Aucune déclaration'
              }
              description={
                q.trim()
                  ? `Aucune déclaration ne correspond à « ${q.trim()} ».`
                  : status === 'pending'
                    ? 'Toutes les déclarations à payer ont été confirmées. Les nouvelles déclarations des onglets Fonciers et Locatifs apparaîtront ici.'
                    : 'Les déclarations enregistrées dans Declarations apparaîtront ici.'
              }
              actionLabel={q.trim() ? 'Effacer la recherche' : undefined}
              onAction={q.trim() ? () => setQ('') : undefined}
            />
          </div>
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="premium-table w-full table-fixed text-left border-collapse font-sans">
              <thead>
                <tr className="border-b border-line bg-surface2/50">
                  {HEADERS.map((h, i) => (
                    <th
                      key={h.key}
                      scope="col"
                      className={`${COLS[h.key]} ${pad(i, HEADERS.length - 1)} py-3.5 text-[11px] font-bold uppercase tracking-[0.06em] text-faint align-top ${
                        h.right ? 'text-right' : 'text-left'
                      }`}
                    >
                      {h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {shown.map(({ d, confirmation, state, filled }) => (
                  <tr key={`${d.kind}_${d.calculationId}`} className="hover:bg-surface2/30 transition-premium align-middle">
                    <td className={`${pad(0, 6)} py-3.5`}>
                      <div className="text-xs font-semibold text-ink truncate" title={d.contribuableName}>
                        {d.contribuableName}
                      </div>
                      <div className="text-[11px] text-muted truncate mt-0.5">
                        {d.contribuableNif ? `NIF ${d.contribuableNif}` : '—'}
                      </div>
                    </td>
                    <td className={`${pad(1, 6)} py-3.5`}>
                      <span
                        className={`inline-block px-1.5 py-0.5 rounded-[6px] text-[11px] font-bold uppercase tracking-wide ${
                          d.kind === 'foncier' ? 'bg-navy/10 text-navy' : 'bg-accent-soft text-accent'
                        }`}
                      >
                        {d.kind === 'foncier' ? 'Foncier' : 'Locatif'}
                      </span>
                    </td>
                    <td className={`${pad(2, 6)} py-3.5`}>
                      <span className="block text-xs text-ink truncate" title={d.detail || DECLARATION_KIND_LABELS[d.kind]}>
                        {d.detail || '—'}
                      </span>
                    </td>
                    <td className={`${pad(3, 6)} py-3.5`}>
                      <span className="text-xs font-mono text-ink tabular-nums whitespace-nowrap">{frDate(d.declaredAt)}</span>
                    </td>
                    <td className={`${pad(4, 6)} py-3.5 text-right`}>
                      <span
                        className={`text-sm font-bold tabular-nums whitespace-nowrap ${
                          state === 'none' ? 'text-faint' : state === 'paid' ? 'text-sage' : 'text-accent-dark'
                        }`}
                      >
                        {formatMoney(confirmation?.amountUSD ?? Math.max(0, d.amountUSD))}
                      </span>
                    </td>
                    <td className={`${pad(5, 6)} py-3.5`}>
                      <span className="block text-xs text-ink truncate">{d.modePaiement || '—'}</span>
                    </td>
                    <td className={`${pad(6, 6)} py-3.5`}>
                      {state === 'paid' && confirmation ? (
                        <div className="min-w-0">
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[6px] bg-sage/12 text-sage text-[11px] font-bold uppercase tracking-wide">
                            <BadgeCheck className="w-3 h-3" />
                            Payé
                          </span>
                          <div className="text-[12px] font-mono text-ink truncate mt-1" title={confirmation.reference}>
                            Réf. {confirmation.reference}
                          </div>
                          <div className="flex items-center gap-1 text-[11px] text-faint mt-0.5">
                            <Lock className="w-2.5 h-2.5" />
                            {frDate(confirmation.confirmedAt)}
                          </div>
                        </div>
                      ) : state === 'none' ? (
                        <span className="text-[12px] text-muted italic">Rien à payer (trop-perçu)</span>
                      ) : canConfirm && !filled ? (
                        // The accountant fills in "Réservé à l'administration"
                        // first; only then can the payment be confirmed.
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<PenLine className="w-3.5 h-3.5" />}
                          onClick={() => openRemplir(confirmationId(d.kind, d.calculationId))}
                        >
                          Remplir la déclaration
                        </Button>
                      ) : canConfirm ? (
                        <Button
                          variant="primary"
                          size="sm"
                          icon={<BadgeCheck className="w-3.5 h-3.5" />}
                          onClick={() => setActive(d)}
                        >
                          Confirmer le paiement
                        </Button>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[6px] bg-warn/10 text-warn text-[11px] font-bold uppercase tracking-wide">
                          <Clock className="w-3 h-3" />
                          En attente
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {!canConfirm && (
        <p className="text-[12px] text-faint mt-4">Votre rôle consulte les paiements en lecture seule.</p>
      )}
      </>
      )}

      <ConfirmPaymentModal
        item={active}
        usedReferences={usedReferences}
        onClose={close}
        onConfirmed={() => setActive(null)}
      />
      {remplirOpen && (
        <RemplirDeclarationModal
          declarations={toFill}
          initialId={remplirId}
          onClose={() => setRemplirOpen(false)}
          onSaved={(r) => setAdmins((prev) => (prev.some((x) => x.id === r.id) ? prev : [...prev, r]))}
        />
      )}
    </>
  );
};
