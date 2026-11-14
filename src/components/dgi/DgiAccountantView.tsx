import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, FilePen, Printer, Receipt, Save, Search, X } from 'lucide-react';
import { DgiReceiptModal } from './DgiReceiptModal';
import { Button, MetricStrip, PageHeader, Panel } from '../ui';
import { TaxpayerSearch } from '../transfer/TaxpayerSearch';
import { subscribeToBusinesses } from '../../services/dbService';
import {
  DGI_MODES_PAIEMENT,
  saveDgiDeclaration,
  subscribeToDgiDeclarations,
  type DgiDeclaration,
  type DgiModePaiement,
} from '../../services/dgiDeclarationService';
import type { Business, UserRole } from '../../types';
import { formatMontant } from './DgiCalculImpotView';
import { unsettledCalculs } from '../../utils/dgiRecords';
import { todayDateString } from '../../utils/date';
import {
  moisLabel,
  subscribeToDgiCalculsImpot,
  type DgiCalculImpot,
  type MontantDevise,
} from '../../services/dgiCalculImpotService';
import { impotTotalDuOf, montantsPayesOf, sumMontantsPayes } from '../../services/dgiDeclarationService';

/** Amounts, one per line ("113 999 FC" / "250$"), or "—". */
const Montants: React.FC<{ list: MontantDevise[] }> = ({ list }) =>
  list.length === 0 ? (
    <>—</>
  ) : (
    <span className="inline-flex flex-col items-end gap-0.5">
      {list.map((m) => (
        <span key={m.devise}>{formatMontant(m)}</span>
      ))}
    </span>
  );

type Actor = { uid: string; displayName: string; role: UserRole };

/** Subtabs of the Accountant tab: the declarations, and the payment history. */
type AccountantSubTab = 'declarations' | 'payments';
const ACCOUNTANT_SUBTABS: { id: AccountantSubTab; label: string; hint: string }[] = [
  { id: 'declarations', label: 'Déclarations', hint: 'Déclarations remplies par le comptable' },
  { id: 'payments', label: 'Historique des paiements', hint: 'Encaissements enregistrés, par quittance' },
];

const inputClass =
  'w-full px-3.5 py-2 bg-surface2 border rounded-[10px] text-xs text-ink placeholder:text-muted focus:border-accent focus:outline-none transition-premium font-sans';

/** yyyy-mm-dd → dd/mm/yyyy, without going through a time zone. */
const frDay = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('/') : d || '—');

/** The address shown under a taxpayer — the same line as on the card. */
const adresseOf = (b: Business) => [b.physicalAddress, b.quartier, b.commune].filter(Boolean).join(', ');

/**
 * The Accountant table: exactly the card's titles, in the card's order —
 * Contribuable, Mode de paiement, Montant payé, Date, Qualité, Numéro de la
 * quittance, Date de la quittance — one row per saved card.
 */
const TABLE_HEADERS: { label: string; w: string }[] = [
  { label: 'Contribuable', w: 'w-[24%]' },
  { label: 'Mode de paiement', w: 'w-[11%]' },
  { label: 'Montant payé', w: 'w-[13%]' },
  { label: 'Date', w: 'w-[11%]' },
  { label: 'Qualité', w: 'w-[14%]' },
  { label: 'Numéro de la quittance', w: 'w-[14%]' },
  { label: 'Date de la quittance', w: 'w-[13%]' },
];

/**
 * The Accountant tab of the DGI portal: the "Fill in declaration" button, the
 * card it opens, and the table of saved declarations.
 */
export const DgiAccountantView: React.FC<{ actor: Actor }> = ({ actor }) => {
  // Filing a payment is a privileged act: it produces an official receipt and
  // feeds the collected totals. The read-only Auditor may look at the tab but
  // must not file — the same rule the DPRNK Accountant applies.
  const canConfirm = actor.role === 'Admin' || actor.role === 'Supervisor' || actor.role === 'Cashier';
  const [open, setOpen] = useState(false);
  const [subTab, setSubTab] = useState<AccountantSubTab>('declarations');
  /** Declarations table: search by taxpayer name. */
  const [nameQuery, setNameQuery] = useState('');
  const [taxpayers, setTaxpayers] = useState<Business[]>([]);
  const [rows, setRows] = useState<DgiDeclaration[]>([]);
  /** The tax declarations (Calculs d'impôt) — where every Montant payé comes from. */
  const [calculs, setCalculs] = useState<DgiCalculImpot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  // The registered taxpayers, live, for the card's search field.
  useEffect(() => subscribeToBusinesses((b) => setTaxpayers(b || [])), []);
  useEffect(() => subscribeToDgiCalculsImpot(setCalculs), []);

  useEffect(
    () =>
      subscribeToDgiDeclarations(
        (r) => {
          setRows(r);
          setLoading(false);
        },
        () => {
          setLoadError('Impossible de charger les déclarations.');
          setLoading(false);
        },
      ),
    [],
  );

  const td = 'px-4 py-3 align-top text-xs text-ink';

  /** The declarations whose taxpayer name contains every word typed (accents and case ignored). */
  const fold = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const nameWords = fold(nameQuery.trim()).split(/\s+/).filter(Boolean);
  const shownRows =
    nameWords.length === 0 ? rows : rows.filter((d) => nameWords.every((w) => fold(d.contribuableName || '').includes(w)));

  return (
    <div className="space-y-8 font-sans">
      <PageHeader
        title="Accountant"
        actions={
          canConfirm ? (
            <Button variant="primary" size="md" icon={<FilePen className="w-4 h-4" />} onClick={() => setOpen(true)}>
              Fill in declaration
            </Button>
          ) : undefined
        }
      />

      {/* Same segmented control as the other pages' subtabs. */}
      <div
        role="tablist"
        aria-label="Accountant sections"
        className="inline-flex items-center gap-1 p-1 rounded-[12px] bg-surface2 border border-line"
      >
        {ACCOUNTANT_SUBTABS.map((tab) => {
          const isActive = tab.id === subTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              title={tab.hint}
              onClick={() => setSubTab(tab.id)}
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

      {subTab === 'payments' ? (
        <PaymentHistory rows={rows} calculs={calculs} loading={loading} loadError={loadError} />
      ) : (
      <Panel title="Déclarations" padding="none">
        {/* Search by taxpayer name — no text inside the field. */}
        <div className="px-6 py-4 border-b border-line">
          <label htmlFor="dgi-decl-name-search" className="block text-xs font-semibold text-ink mb-1.5">
            Rechercher un contribuable
          </label>
          <div className="relative max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
            <input
              id="dgi-decl-name-search"
              type="text"
              value={nameQuery}
              onChange={(e) => setNameQuery(e.target.value)}
              autoComplete="off"
              className="w-full h-10 pl-9 pr-9 text-sm rounded-[10px] border border-line bg-surface text-ink focus:border-accent focus:outline-none transition-premium"
            />
            {nameQuery && (
              <button
                type="button"
                onClick={() => setNameQuery('')}
                aria-label="Effacer"
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted hover:text-ink hover:bg-surface2 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
        {/* The titles are always shown; the rows are the saved cards, newest first. */}
        <div className="overflow-x-auto scroll-x-visible">
          <table className="premium-table w-full min-w-[860px] table-fixed text-left border-collapse font-sans">
            <thead>
              <tr className="border-b border-line bg-surface2/50">
                {TABLE_HEADERS.map((h) => (
                  <th
                    key={h.label}
                    scope="col"
                    className={`${h.w} px-4 py-3.5 text-[11px] font-bold uppercase tracking-[0.06em] text-faint align-bottom ${h.label === 'Montant payé' || h.label === 'Action' ? 'text-right' : 'text-left'}`}
                  >
                    {h.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {loading ? (
                <tr>
                  <td colSpan={TABLE_HEADERS.length} className="px-4 py-8 text-center text-xs text-muted">
                    Chargement…
                  </td>
                </tr>
              ) : shownRows.length === 0 ? (
                <tr>
                  <td colSpan={TABLE_HEADERS.length} className="px-4 py-8 text-center text-xs text-muted">
                    {loadError ||
                      (nameQuery.trim()
                        ? 'Aucun contribuable ne correspond à la recherche.'
                        : 'Aucune déclaration n’est encore enregistrée.')}
                  </td>
                </tr>
              ) : (
                shownRows.map((d) => (
                  <tr key={d.id} className="hover:bg-surface2/30 transition-premium">
                    <td className={td}>
                      <div className="font-semibold break-words">{d.contribuableName || '—'}</div>
                      <div className="text-[11px] text-muted mt-0.5 break-words">{d.contribuableAdresse || '—'}</div>
                    </td>
                    <td className={td}>{d.modePaiement || '—'}</td>
                    <td className={`${td} text-right tabular-nums font-semibold whitespace-nowrap`}><Montants list={montantsPayesOf(d, calculs)} /></td>
                    <td className={`${td} font-mono tabular-nums whitespace-nowrap`} data-no-i18n>
                      {frDay(d.date)}
                    </td>
                    <td className={`${td} break-words`}>{d.qualite || '—'}</td>
                    <td className={`${td} font-mono tabular-nums break-words`}>{d.numeroQuittance || '—'}</td>
                    <td className={`${td} font-mono tabular-nums whitespace-nowrap`} data-no-i18n>
                      {frDay(d.dateQuittance)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
      )}

      {open && canConfirm && (
        <FillDeclarationCard taxpayers={taxpayers} calculs={calculs} rows={rows} actor={actor} onClose={() => setOpen(false)} onSaved={() => setOpen(false)} />
      )}
    </div>
  );
};

/**
 * Historique des paiements: every payment recorded on the "Fill in
 * declaration" card, one row per quittance, newest quittance first, with a
 * search by contribuable or numéro de quittance.
 */
const PAYMENT_HEADERS: { label: string; w: string }[] = [
  { label: 'Date de la quittance', w: 'w-[11%]' },
  { label: 'Numéro de la quittance', w: 'w-[11%]' },
  { label: 'Contribuable', w: 'w-[20%]' },
  { label: 'Mode de paiement', w: 'w-[9%]' },
  { label: 'Montant payé', w: 'w-[12%]' },
  { label: 'Date', w: 'w-[9%]' },
  { label: 'Qualité', w: 'w-[8%]' },
  { label: 'Enregistré par', w: 'w-[9%]' },
  // The receipt: on screen, on this computer's printer, or on the T6.
  { label: 'Action', w: 'w-[11%]' },
];

const PaymentHistory: React.FC<{
  rows: DgiDeclaration[];
  calculs: DgiCalculImpot[];
  loading: boolean;
  loadError: string;
}> = ({
  rows,
  calculs,
  loading,
  loadError,
}) => {
  const [query, setQuery] = useState('');
  /** The payment whose receipt is open. */
  const [receiptOf, setReceiptOf] = useState<DgiDeclaration | null>(null);

  const sorted = useMemo(
    () =>
      [...rows].sort(
        (a, b) =>
          (b.dateQuittance || '').localeCompare(a.dateQuittance || '') || (b.createdAt || '').localeCompare(a.createdAt || ''),
      ),
    [rows],
  );
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((d) =>
      [d.contribuableName, d.numeroQuittance, d.contribuableAdresse].join(' ').toLowerCase().includes(q),
    );
  }, [sorted, query]);

  /**
   * Montant payé, all payments — each one the "Impôt total dû" of its tax
   * declaration — per currency, never added together.
   */
  const paid = useMemo(() => sumMontantsPayes(rows, calculs), [rows, calculs]);
  const sansMontant = rows.filter((d) => montantsPayesOf(d, calculs).length === 0).length;
  const paidValue =
    paid.cdf > 0 && paid.usd > 0 ? (
      <span className="flex flex-col gap-0.5">
        <span>{formatMontant({ montant: paid.cdf, devise: 'CDF' })}</span>
        <span>{formatMontant({ montant: paid.usd, devise: 'USD' })}</span>
      </span>
    ) : paid.cdf > 0 ? (
      formatMontant({ montant: paid.cdf, devise: 'CDF' })
    ) : (
      formatMontant({ montant: paid.usd, devise: 'USD' })
    );
  const td = 'px-4 py-3 align-top text-xs text-ink';

  return (
    <>
      <MetricStrip
        columns={2}
        className="!mt-0"
        items={[
          {
            label: 'Paiements enregistrés',
            value: loading ? '…' : rows.length.toLocaleString('fr-FR'),
            trendType: 'muted',
            subline: 'Quittances enregistrées par le comptable',
            icon: <Receipt className="w-4 h-4 text-accent" />,
          },
          {
            label: 'Montant payé',
            value: loading ? '…' : paidValue,
            trend: sansMontant > 0 ? `${sansMontant} sans montant` : undefined,
            trendType: 'warn',
            subline: 'Impôt total dû des déclarations payées, par devise',
            icon: <Receipt className="w-4 h-4 text-accent" />,
          },
        ]}
      />

      <Panel title="Historique des paiements" padding="none">
        <div className="px-6 py-4 border-b border-line">
          <div className="relative max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Rechercher un paiement"
              autoComplete="off"
              className="w-full h-10 pl-9 pr-3 text-sm rounded-[10px] border border-line bg-surface text-ink focus:border-accent focus:outline-none transition-premium"
            />
          </div>
        </div>
        <div className="overflow-x-auto scroll-x-visible">
          <table className="premium-table w-full min-w-[1040px] table-fixed text-left border-collapse font-sans">
            <thead>
              <tr className="border-b border-line bg-surface2/50">
                {PAYMENT_HEADERS.map((h) => (
                  <th
                    key={h.label}
                    scope="col"
                    className={`${h.w} px-4 py-3.5 text-[11px] font-bold uppercase tracking-[0.06em] text-faint align-bottom ${h.label === 'Montant payé' || h.label === 'Action' ? 'text-right' : 'text-left'}`}
                  >
                    {h.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {loading ? (
                <tr>
                  <td colSpan={PAYMENT_HEADERS.length} className="px-4 py-8 text-center text-xs text-muted">
                    Chargement…
                  </td>
                </tr>
              ) : shown.length === 0 ? (
                <tr>
                  <td colSpan={PAYMENT_HEADERS.length} className="px-4 py-8 text-center text-xs text-muted">
                    {loadError || (query.trim() ? 'Aucun paiement ne correspond à la recherche.' : 'Aucun paiement n’est encore enregistré.')}
                  </td>
                </tr>
              ) : (
                shown.map((d) => (
                  <tr key={d.id} className="hover:bg-surface2/30 transition-premium">
                    <td className={`${td} font-mono tabular-nums whitespace-nowrap`} data-no-i18n>
                      {frDay(d.dateQuittance)}
                    </td>
                    <td className={`${td} font-mono tabular-nums font-semibold break-words`}>{d.numeroQuittance || '—'}</td>
                    <td className={td}>
                      <div className="font-semibold break-words">{d.contribuableName || '—'}</div>
                      <div className="text-[11px] text-muted mt-0.5 break-words">{d.contribuableAdresse || '—'}</div>
                    </td>
                    <td className={td}>{d.modePaiement || '—'}</td>
                    <td className={`${td} text-right tabular-nums font-semibold whitespace-nowrap`}><Montants list={montantsPayesOf(d, calculs)} /></td>
                    <td className={`${td} font-mono tabular-nums whitespace-nowrap`} data-no-i18n>
                      {frDay(d.date)}
                    </td>
                    <td className={`${td} break-words`}>{d.qualite || '—'}</td>
                    <td className={`${td} break-words`}>{d.createdByName || '—'}</td>
                    <td className={`${td} text-right`}>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setReceiptOf(d)}
                        icon={<Printer className="w-3.5 h-3.5" />}
                        className="whitespace-nowrap"
                      >
                        View receipt
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Receipt of the payment — on screen, this computer, or the T6. */}
      <DgiReceiptModal payment={receiptOf} calculs={calculs} onClose={() => setReceiptOf(null)} />
    </>
  );
};

/**
 * The "Fill in declaration" card, top to bottom: Contribuable (search of the
 * registered taxpayers), Mode de paiement (Espèces), Date, Qualité, Numéro de
 * la quittance, Date de la quittance.
 */
const FillDeclarationCard: React.FC<{
  taxpayers: Business[];
  calculs: DgiCalculImpot[];
  /** Payments already recorded — a quittance number pays one declaration. */
  rows: DgiDeclaration[];
  actor: Actor;
  onClose: () => void;
  onSaved: () => void;
}> = ({ taxpayers, calculs, rows, actor, onClose, onSaved }) => {
  const [contribuable, setContribuable] = useState<Business | null>(null);
  const [modePaiement, setModePaiement] = useState<DgiModePaiement | ''>('Espèces');
  /**
   * The tax declaration (Calcul d'impôt) this payment settles: the taxpayer's
   * most recent one unless another is chosen. Its "Impôt total dû" is the
   * Montant payé.
   */
  const [calculId, setCalculId] = useState('');
  const mesCalculs = useMemo(
    () =>
      contribuable
        ? // A calculation already settled by a payment is not offered again:
          // settling it twice would collect the tax twice.
          unsettledCalculs(
            calculs
              .filter((c) => c.contribuableId === contribuable.id)
              .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')),
            rows
          )
        : [],
    [calculs, contribuable, rows],
  );
  const calcul = mesCalculs.find((c) => c.id === calculId) || mesCalculs[0] || null;
  const montantPaye = calcul ? impotTotalDuOf(calcul) : [];
  const [date, setDate] = useState('');
  const [qualite, setQualite] = useState('');
  const [numeroQuittance, setNumeroQuittance] = useState('');
  const [dateQuittance, setDateQuittance] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const clearErr = (k: string) =>
    setErrors((e) => {
      if (!e[k]) return e;
      const n = { ...e };
      delete n[k];
      return n;
    });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const save = async () => {
    if (saving) return;
    const e: Record<string, string> = {};
    if (!contribuable) e.contribuable = 'Choisissez le contribuable.';
    if (!modePaiement) e.modePaiement = 'Choisissez le mode de paiement.';
    if (contribuable && !calcul) {
      // The taxpayer may have calculations that are all settled already — that
      // is a different answer from "no calculation recorded".
      const hasAny = calculs.some((c) => c.contribuableId === contribuable.id);
      e.calcul = hasAny
        ? 'Toutes les déclarations de ce contribuable sont déjà réglées.'
        : 'Ce contribuable n’a aucune déclaration enregistrée (onglet Declarations).';
    }
    if (!date) e.date = 'Saisissez la date.';
    else if (date > todayDateString()) e.date = 'La date ne peut pas être dans le futur.';
    if (!qualite.trim()) e.qualite = 'Saisissez la qualité.';
    if (!numeroQuittance.trim()) {
      e.numeroQuittance = 'Saisissez le numéro de la quittance.';
    } else {
      // A quittance number pays one declaration — the same guard as the
      // note de perception payments: the same number, however it is spelled,
      // cannot be recorded twice.
      const quittance = numeroQuittance.trim().replace(/\s+/g, ' ').toUpperCase();
      const taken = rows.some((d) => (d.numeroQuittance || '').trim().replace(/\s+/g, ' ').toUpperCase() === quittance);
      if (taken) e.numeroQuittance = 'Ce numéro de quittance a déjà été utilisé pour un autre paiement.';
    }
    if (!dateQuittance) e.dateQuittance = 'Saisissez la date de la quittance.';
    else if (dateQuittance > todayDateString()) {
      e.dateQuittance = 'La date de la quittance ne peut pas être dans le futur.';
    }
    setErrors(e);
    if (Object.keys(e).length > 0 || !contribuable || !modePaiement || !calcul) {
      setFormError('Corrigez les champs signalés en rouge.');
      return;
    }
    setFormError('');
    setSaving(true);
    try {
      await saveDgiDeclaration(
        {
          contribuableId: contribuable.id,
          contribuableName: contribuable.businessName || '',
          contribuableNif: contribuable.nif || '',
          contribuableAdresse: adresseOf(contribuable),
          modePaiement,
          calculId: calcul.id,
          montantPaye,
          date,
          qualite,
          numeroQuittance,
          dateQuittance,
        },
        actor,
      );
      onSaved();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'L’enregistrement a échoué. Réessayez.');
      setSaving(false);
    }
  };

  const border = (k: string) => (errors[k] ? 'border-danger' : 'border-line');
  const fieldError = (k: string) => (errors[k] ? <p className="mt-1 text-[11px] text-danger">{errors[k]}</p> : null);
  const label = (htmlFor: string, text: string) => (
    <label htmlFor={htmlFor} className="block text-xs font-semibold text-ink mb-1">
      {text}
    </label>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/60 backdrop-blur-xs"
      onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}
    >
      <div className="bg-surface rounded-[18px] border border-line shadow-2xl w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="shrink-0 px-6 py-4.5 border-b border-line flex items-center justify-between gap-3 bg-surface">
          <div className="min-w-0">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-accent font-sans">Accountant</span>
            <h2 className="font-display text-lg font-bold text-ink tracking-tight">Fill in declaration</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Fermer"
            className="p-1.5 rounded-[8px] text-muted hover:text-ink hover:bg-surface2 transition-premium cursor-pointer shrink-0 disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 scroll-y-smooth">
          <fieldset disabled={saving} className="p-6 space-y-4 min-w-0">
            {/* 1. Contribuable — opens the registered taxpayers on focus. */}
            <TaxpayerSearch
              id="dgi-decl-contribuable"
              label="Contribuable"
              hint="Cliquez pour voir les contribuables enregistrés, ou tapez un nom, un NIF ou une commune"
              taxpayers={taxpayers}
              value={contribuable}
              onChange={(b) => {
                setContribuable(b);
                setCalculId('');
                clearErr('contribuable');
                clearErr('calcul');
              }}
              error={errors.contribuable}
              showAllOnFocus
            />

            {/* 2. Mode de paiement — Espèces only. */}
            <div>
              {label('dgi-decl-mode', 'Mode de paiement')}
              <select
                id="dgi-decl-mode"
                value={modePaiement}
                onChange={(e) => {
                  setModePaiement(e.target.value as DgiModePaiement | '');
                  clearErr('modePaiement');
                }}
                className={`${inputClass} ${border('modePaiement')} cursor-pointer`}
              >
                {DGI_MODES_PAIEMENT.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              {fieldError('modePaiement')}
            </div>

            {/* Déclaration payée — the taxpayer's tax declarations (Calcul
                d'impôt); Montant payé is its Impôt total dû, filled in for you. */}
            <div>
              {label('dgi-decl-calcul', 'Déclaration')}
              <select
                id="dgi-decl-calcul"
                value={calcul?.id || ''}
                onChange={(e) => {
                  setCalculId(e.target.value);
                  clearErr('calcul');
                }}
                disabled={!contribuable || mesCalculs.length === 0}
                className={`${inputClass} ${border('calcul')} cursor-pointer disabled:cursor-not-allowed disabled:text-muted`}
              >
                {!contribuable ? (
                  <option value="">Choisir le contribuable d’abord</option>
                ) : mesCalculs.length === 0 ? (
                  <option value="">Aucune déclaration pour ce contribuable</option>
                ) : (
                  mesCalculs.map((c) => (
                    <option key={c.id} value={c.id}>
                      Salaires du mois de {moisLabel(c.salairesMois)} {c.annee}
                    </option>
                  ))
                )}
              </select>
              {fieldError('calcul')}
            </div>

            <div>
              {label('dgi-decl-montant', 'Montant payé')}
              <div
                id="dgi-decl-montant"
                aria-readonly="true"
                className={`${inputClass} border-line bg-surface2/60 tabular-nums font-semibold min-h-[34px] flex items-center`}
              >
                {montantPaye.length > 0 ? (
                  <span className="flex flex-wrap gap-x-4">
                    {montantPaye.map((m) => (
                      <span key={m.devise}>{formatMontant(m)}</span>
                    ))}
                  </span>
                ) : (
                  <span className="font-normal text-muted">—</span>
                )}
              </div>
              <p className="mt-1 text-[11px] text-muted">Impôt total dû de la déclaration choisie (onglet Declarations).</p>
            </div>

            {/* 3. Date. */}
            <div>
              {label('dgi-decl-date', 'Date')}
              <input
                id="dgi-decl-date"
                type="date"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  clearErr('date');
                }}
                className={`${inputClass} ${border('date')} cursor-pointer`}
              />
              {fieldError('date')}
            </div>

            {/* 4. Qualité. */}
            <div>
              {label('dgi-decl-qualite', 'Qualité')}
              <input
                id="dgi-decl-qualite"
                type="text"
                autoComplete="off"
                value={qualite}
                onChange={(e) => {
                  setQualite(e.target.value);
                  clearErr('qualite');
                }}
                className={`${inputClass} ${border('qualite')}`}
              />
              {fieldError('qualite')}
            </div>

            {/* 5. Numéro de la quittance. */}
            <div>
              {label('dgi-decl-numero-quittance', 'Numéro de la quittance')}
              <input
                id="dgi-decl-numero-quittance"
                type="text"
                autoComplete="off"
                value={numeroQuittance}
                onChange={(e) => {
                  setNumeroQuittance(e.target.value);
                  clearErr('numeroQuittance');
                }}
                className={`${inputClass} ${border('numeroQuittance')}`}
              />
              {fieldError('numeroQuittance')}
            </div>

            {/* 6. Date de la quittance. */}
            <div>
              {label('dgi-decl-date-quittance', 'Date de la quittance')}
              <input
                id="dgi-decl-date-quittance"
                type="date"
                value={dateQuittance}
                onChange={(e) => {
                  setDateQuittance(e.target.value);
                  clearErr('dateQuittance');
                }}
                className={`${inputClass} ${border('dateQuittance')} cursor-pointer`}
              />
              {fieldError('dateQuittance')}
            </div>
          </fieldset>
        </div>

        {/* Footer */}
        <div className="shrink-0 px-6 py-3.5 border-t border-line bg-surface2/40 flex items-center justify-between gap-3">
          <div className="min-w-0 text-[12px]">
            {formError ? (
              <span className="inline-flex items-center gap-1.5 text-danger font-semibold">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {formError}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <Button variant="ghost" size="md" onClick={onClose} disabled={saving}>
              Annuler
            </Button>
            <Button variant="primary" size="md" icon={<Save className="w-4 h-4" />} onClick={save} disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
