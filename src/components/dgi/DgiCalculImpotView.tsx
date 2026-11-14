import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Calculator, Check, FileText, Plus, Save, Search, Wallet, X } from 'lucide-react';
import { Button, EmptyState, MetricStrip, Panel } from '../ui';
import { DEVISES, type Devise } from '../../services/nomenclatureService';
import {
  ANNEES,
  MOIS,
  moisLabel,
  saveDgiCalculImpot,
  subscribeToDgiCalculsImpot,
  type DgiCalculImpot,
  type DgiCalculLigne,
  type MontantDevise,
} from '../../services/dgiCalculImpotService';
import { TaxpayerSearch } from '../transfer/TaxpayerSearch';
import { impotTotalDuOf } from '../../services/dgiDeclarationService';
import { formatMoney } from '../../utils/money';
import { parseFigure } from '../../utils/parseFigure';

// Re-exported so callers keep the same import path.
export { parseFigure };
import type { Business, UserRole } from '../../types';

/**
 * Catégorie salariale — the choices of the DGI "Nouveau calcul" card, in the
 * order given.
 */
export const CATEGORIES_SALARIALES = [
  'Nationaux non imposables',
  'Nationaux imposables',
  'Expatriés non imposables',
  'Expatrié imposable',
  'Associés actifs',
  'Exploitant individuel',
  'Personnel occasionnel',
] as const;

export type CategorieSalariale = (typeof CATEGORIES_SALARIALES)[number];

/**
 * The figures of the card, below Catégorie salariale, in the order given:
 * Nombre, Rémunérations brutes, Rémunérations imposables, Montant I.P.R,
 * Montant I.E.R, Impôt total dû.
 */
type FigureKey = 'nombre' | 'remunerationsBrutes' | 'remunerationsImposables' | 'montantIpr' | 'montantIer' | 'impotTotalDu';

const FIGURES: { key: FigureKey; label: string; whole?: boolean }[] = [
  { key: 'nombre', label: 'Nombre', whole: true },
  { key: 'remunerationsBrutes', label: 'Rémunérations brutes' },
  { key: 'remunerationsImposables', label: 'Rémunérations imposables' },
  { key: 'montantIpr', label: 'Montant I.P.R' },
  { key: 'montantIer', label: 'Montant I.E.R' },
  { key: 'impotTotalDu', label: 'Impôt total dû' },
];

const EMPTY_FIGURES: Record<FigureKey, string> = {
  nombre: '',
  remunerationsBrutes: '',
  remunerationsImposables: '',
  montantIpr: '',
  montantIer: '',
  impotTotalDu: '',
};

/**
 * The figures that carry their own currency switch — Rémunérations brutes,
 * Rémunérations imposables, Montant I.P.R, Montant I.E.R and Impôt total dû —
 * each saved in USD ($) or CDF (FC).
 */
type DeviseKey = Exclude<FigureKey, 'nombre'>;
const DEVISE_KEYS: readonly FigureKey[] = [
  'remunerationsBrutes',
  'remunerationsImposables',
  'montantIpr',
  'montantIer',
  'impotTotalDu',
];
const isDeviseKey = (k: FigureKey): k is DeviseKey => DEVISE_KEYS.includes(k);

/** The currencies those figures may be saved in: USD ($) or CDF (FC). */
const IPR_DEVISES = DEVISES.filter((d): d is (typeof DEVISES)[number] & { id: Devise } => d.id === 'USD' || d.id === 'CDF');

const inputClass =
  'w-full px-3.5 py-2 bg-surface2 border rounded-[10px] text-xs text-ink placeholder:text-muted focus:border-accent focus:outline-none transition-premium font-sans';

/** An amount in its currency: "1 364 414,5$" or "1 364 414,5 FC". */
export const formatMontant = (m?: MontantDevise) => {
  if (!m || typeof m.montant !== 'number' || !Number.isFinite(m.montant)) return '—';
  if (m.devise === 'CDF') {
    return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(m.montant)} FC`;
  }
  return formatMoney(m.montant);
};

/** ISO timestamp → dd/mm/yyyy hh:mm, local time. */
const frDateTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

type Actor = { uid: string; displayName: string; role: UserRole };

/**
 * The table of saved calculs: the same titles as the card, in the same order,
 * one row per catégorie salariale, grouped by calcul.
 */
const TABLE_HEADERS: { label: string; right?: boolean; w: string }[] = [
  { label: 'Contribuable', w: 'min-w-[180px]' },
  { label: 'Salaires du mois de', w: 'min-w-[110px]' },
  { label: 'Année', w: 'min-w-[70px]' },
  { label: 'Catégorie salariale', w: 'min-w-[170px]' },
  { label: 'Nombre', right: true, w: 'min-w-[70px]' },
  { label: 'Rémunérations brutes', right: true, w: 'min-w-[130px]' },
  { label: 'Rémunérations imposables', right: true, w: 'min-w-[130px]' },
  { label: 'Montant I.P.R', right: true, w: 'min-w-[110px]' },
  { label: 'Montant I.E.R', right: true, w: 'min-w-[110px]' },
  { label: 'Impôt total dû', right: true, w: 'min-w-[120px]' },
  { label: 'Enregistré le', w: 'min-w-[130px]' },
];

/**
 * The Calcul d'impôt subtab of the DGI portal's Registration: the saved
 * calculations table and the "Nouvelle déclaration" button that opens the
 * "Nouveau calcul" card.
 */
export const DgiCalculImpotView: React.FC<{ canModify: boolean; taxpayers: Business[]; actor: Actor }> = ({
  canModify,
  taxpayers,
  actor,
}) => {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<DgiCalculImpot[]>([]);
  /** Table search by taxpayer name. */
  const [nameQuery, setNameQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(
    () =>
      subscribeToDgiCalculsImpot(
        (r) => {
          setRows(r);
          setLoading(false);
        },
        () => {
          setLoadError('Impossible de charger les calculs d’impôt.');
          setLoading(false);
        },
      ),
    [],
  );

  /**
   * The KPI figures: how many calculs (declarations) are saved, and what they
   * come to — the sum of their "Impôt total dû", kept per currency (USD and
   * CDF are never added together: no exchange rate is recorded).
   */
  const kpi = useMemo(() => {
    let usd = 0;
    let cdf = 0;
    let lignes = 0;
    for (const calc of rows) {
      for (const l of calc.lignes || []) {
        lignes += 1;
        const m = l.impotTotalDu;
        if (!m || typeof m.montant !== 'number' || !Number.isFinite(m.montant)) continue;
        if (m.devise === 'CDF') cdf += m.montant;
        else usd += m.montant;
      }
    }
    return { count: rows.length, lignes, usd: Math.round(usd * 100) / 100, cdf: Math.round(cdf * 100) / 100 };
  }, [rows]);

  /** The total, in each currency it was declared in ("0$" when nothing yet). */
  const totalValue =
    kpi.cdf > 0 && kpi.usd > 0 ? (
      <span className="flex flex-col gap-0.5">
        <span>{formatMontant({ montant: kpi.cdf, devise: 'CDF' })}</span>
        <span>{formatMontant({ montant: kpi.usd, devise: 'USD' })}</span>
      </span>
    ) : kpi.cdf > 0 ? (
      formatMontant({ montant: kpi.cdf, devise: 'CDF' })
    ) : (
      formatMontant({ montant: kpi.usd, devise: 'USD' })
    );

  const td = 'px-4 py-3 align-top text-xs text-ink';

  /** Calculs whose taxpayer name contains every word typed (accents and case ignored). */
  const fold = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const nameWords = fold(nameQuery.trim()).split(/\s+/).filter(Boolean);
  const shownRows =
    nameWords.length === 0 ? rows : rows.filter((c) => nameWords.every((w) => fold(c.contribuableName || '').includes(w)));

  return (
    <>
      <MetricStrip
        columns={2}
        className="!mt-0"
        items={[
          {
            label: 'Déclarations enregistrées',
            value: loading ? '…' : kpi.count.toLocaleString('fr-FR'),
            trend: `${kpi.lignes} catégorie${kpi.lignes === 1 ? '' : 's'} salariale${kpi.lignes === 1 ? '' : 's'}`,
            trendType: 'muted',
            subline: 'Calculs d’impôt enregistrés',
            icon: <FileText className="w-4 h-4 text-accent" />,
          },
          {
            label: 'Montant des déclarations',
            value: loading ? '…' : totalValue,
            trendType: 'muted',
            subline: 'Total de l’impôt total dû, par devise',
            icon: <Wallet className="w-4 h-4 text-accent" />,
          },
        ]}
      />

      <Panel
        title={<span data-no-i18n className="text-[13px] tracking-[0.03em]">DECLARATION MENSUELLE DES IMPÔTS PROFESSIONNEL ET EXCEPTIONNEL SUR LES RÉMUNÉRATIONS</span>}
        padding="none"
        actions={
          canModify ? (
            <Button variant="primary" size="md" icon={<Plus className="w-4 h-4" />} onClick={() => setOpen(true)}>
              Nouvelle déclaration
            </Button>
          ) : undefined
        }
      >
        {/* Search by taxpayer name — no text inside the field. */}
        <div className="px-6 py-4 border-b border-line">
          <label htmlFor="dgi-calc-name-search" className="block text-xs font-semibold text-ink mb-1.5">
            Rechercher un contribuable
          </label>
          <div className="relative max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
            <input
              id="dgi-calc-name-search"
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
        {loading ? (
          <div className="p-6 text-xs text-muted">Chargement…</div>
        ) : rows.length > 0 && shownRows.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted">Aucun contribuable ne correspond à la recherche.</div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={<Calculator className="w-6 h-6" />}
              title="Aucun calcul d’impôt"
              description={loadError || 'Aucun calcul d’impôt n’est encore enregistré.'}
            />
          </div>
        ) : (
          <div className="overflow-x-auto scrollbar-thin">
            <table className="premium-table w-full text-left border-collapse font-sans">
              <thead>
                <tr className="border-b border-line bg-surface2/50">
                  {TABLE_HEADERS.map((h) => (
                    <th
                      key={h.label}
                      scope="col"
                      className={`${h.w} px-4 py-3.5 text-[11px] font-bold uppercase tracking-[0.06em] text-faint align-bottom ${
                        h.right ? 'text-right' : 'text-left'
                      }`}
                    >
                      {h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              {shownRows.map((calc) => {
                // One row per catégorie, then the "Total montant à payer" row.
                const span = Math.max(1, calc.lignes.length) + 1;
                const total = impotTotalDuOf(calc);
                return (
                  <tbody key={calc.id} className="border-b border-line">
                    {calc.lignes.map((l, li) => (
                      <tr key={`${calc.id}-${li}`} className={li > 0 ? 'border-t border-line/60' : ''}>
                        {li === 0 && (
                          <>
                            <td rowSpan={span} className={td}>
                              <div className="font-semibold">{calc.contribuableName || '—'}</div>
                              <div className="text-[11px] text-muted mt-0.5">
                                {calc.contribuableNif ? `NIF ${calc.contribuableNif}` : '—'}
                              </div>
                            </td>
                            <td rowSpan={span} className={`${td} whitespace-nowrap`}>
                              {moisLabel(calc.salairesMois ?? Number((calc.periode || '').slice(5)))}
                            </td>
                            <td rowSpan={span} className={`${td} tabular-nums whitespace-nowrap`}>
                              {calc.annee ?? ((calc.periode || '').slice(0, 4) || '—')}
                            </td>
                          </>
                        )}
                        <td className={td}>{l.categorie}</td>
                        <td className={`${td} text-right tabular-nums`}>{l.nombre}</td>
                        <td className={`${td} text-right tabular-nums whitespace-nowrap`}>{formatMontant(l.remunerationsBrutes)}</td>
                        <td className={`${td} text-right tabular-nums whitespace-nowrap`}>{formatMontant(l.remunerationsImposables)}</td>
                        <td className={`${td} text-right tabular-nums whitespace-nowrap`}>{formatMontant(l.montantIpr)}</td>
                        <td className={`${td} text-right tabular-nums whitespace-nowrap`}>{formatMontant(l.montantIer)}</td>
                        <td className={`${td} text-right tabular-nums whitespace-nowrap font-bold`}>{formatMontant(l.impotTotalDu)}</td>
                        {li === 0 && (
                          <td rowSpan={span} className={`${td} whitespace-nowrap`}>
                            <div className="font-mono tabular-nums" data-no-i18n>
                              {frDateTime(calc.createdAt)}
                            </div>
                            <div className="text-[11px] text-muted mt-0.5">{calc.createdByName || '—'}</div>
                          </td>
                        )}
                      </tr>
                    ))}
                    {/* Total montant à payer — the sum of this declaration's
                        "Impôt total dû", per currency (never converted). */}
                    <tr className="border-t border-line bg-surface2/50">
                      <td colSpan={6} className={`${td} text-right font-bold uppercase tracking-[0.06em] text-[11px]`}>
                        Total montant à payer
                      </td>
                      <td className={`${td} text-right tabular-nums whitespace-nowrap font-bold text-accent`}>
                        {total.length === 0 ? (
                          '—'
                        ) : (
                          <span className="inline-flex flex-col items-end gap-0.5">
                            {total.map((m) => (
                              <span key={m.devise}>{formatMontant(m)}</span>
                            ))}
                          </span>
                        )}
                      </td>
                    </tr>
                  </tbody>
                );
              })}
            </table>
          </div>
        )}
      </Panel>

      {open && (
        <NouveauCalculCard taxpayers={taxpayers} actor={actor} onClose={() => setOpen(false)} onSaved={() => setOpen(false)} />
      )}
    </>
  );
};

/** One catégorie salariale's form: its figures and the currency of each. */
type CategorieForm = { figures: Record<FigureKey, string>; devises: Record<DeviseKey, Devise> };

const emptyCategorieForm = (): CategorieForm => ({
  figures: { ...EMPTY_FIGURES },
  devises: {
    remunerationsBrutes: 'USD',
    remunerationsImposables: 'USD',
    montantIpr: 'USD',
    montantIer: 'USD',
    impotTotalDu: 'USD',
  },
});

const ALL_EMPTY_FORMS = (): Record<CategorieSalariale, CategorieForm> =>
  Object.fromEntries(CATEGORIES_SALARIALES.map((c) => [c, emptyCategorieForm()])) as Record<
    CategorieSalariale,
    CategorieForm
  >;

/** Field-error key of a figure: "<catégorie>|<figure>". */
const errKey = (c: CategorieSalariale, k: FigureKey) => `${c}|${k}`;

/**
 * The "Nouveau calcul" card. The contribuable and the période come first;
 * then several catégories salariales may be selected, each opening its own
 * form — Nombre, Rémunérations brutes, Rémunérations imposables, Montant
 * I.P.R, Montant I.E.R, Impôt total dû — shown in the order of the list.
 * "Enregistrer" checks every field and saves the calcul to the table.
 */
const NouveauCalculCard: React.FC<{
  taxpayers: Business[];
  actor: Actor;
  onClose: () => void;
  onSaved: () => void;
}> = ({ taxpayers, actor, onClose, onSaved }) => {
  const [contribuable, setContribuable] = useState<Business | null>(null);
  /** "Salaires du mois de" (1–12) and "Année", as on the enrolment form. */
  const [salairesMois, setSalairesMois] = useState('');
  const [annee, setAnnee] = useState('');
  const [selected, setSelected] = useState<CategorieSalariale[]>([]);
  /**
   * Every catégorie's form. A form is kept when its catégorie is unticked, so
   * ticking it again brings back what was typed.
   */
  const [forms, setForms] = useState<Record<CategorieSalariale, CategorieForm>>(ALL_EMPTY_FORMS);
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

  /** Tick or untick a catégorie; the selection stays in the list's order. */
  const toggleCategorie = (c: CategorieSalariale) => {
    clearErr('categories');
    setSelected((cur) =>
      cur.includes(c) ? cur.filter((x) => x !== c) : CATEGORIES_SALARIALES.filter((x) => x === c || cur.includes(x)),
    );
  };

  /**
   * Keep the figure exactly as typed — digits with any commas, dots or spaces
   * the user writes ("1,364,414.50", "1.364.414,50", "1 364 414") — and drop
   * only characters that can never be part of a number (letters, symbols).
   */
  const setFigure = (c: CategorieSalariale, key: FigureKey, raw: string) => {
    // The minus sign is KEPT: it is stripped further down only for the
    // characters that can never be part of a number. Dropping it here turned
    // a credit the officer typed (-500) into a charge of +500 without any
    // message; the figure now reaches the validation and is refused there.
    const v = raw.replace(/[^\d.,\s\u00a0\u202f-]/g, '');
    clearErr(errKey(c, key));
    setForms((f) => ({ ...f, [c]: { ...f[c], figures: { ...f[c].figures, [key]: v } } }));
  };
  const setDevise = (c: CategorieSalariale, key: DeviseKey, d: Devise) =>
    setForms((f) => ({ ...f, [c]: { ...f[c], devises: { ...f[c].devises, [key]: d } } }));

  /** Check every field; the lines to save, or null with the errors shown. */
  const validate = (): DgiCalculLigne[] | null => {
    const e: Record<string, string> = {};
    if (!contribuable) e.contribuable = 'Choisissez le contribuable.';
    if (!salairesMois) e.salairesMois = 'Choisissez le mois des salaires.';
    if (!annee) e.annee = 'Choisissez l’année.';
    if (selected.length === 0) e.categories = 'Sélectionnez au moins une catégorie salariale.';
    const lignes: DgiCalculLigne[] = [];
    for (const c of selected) {
      const { figures, devises } = forms[c];
      const nums = {} as Record<FigureKey, number>;
      for (const { key, whole } of FIGURES) {
        const raw = figures[key].trim();
        const n = parseFigure(raw);
        if (!raw) e[errKey(c, key)] = 'Champ obligatoire.';
        else if (!Number.isFinite(n)) e[errKey(c, key)] = 'Montant invalide.';
        else if (whole && (!Number.isInteger(n) || n < 1)) e[errKey(c, key)] = 'Nombre entier, au moins 1.';
        nums[key] = n;
      }
      const m = (k: DeviseKey): MontantDevise => ({ montant: nums[k], devise: devises[k] });
      lignes.push({
        categorie: c,
        nombre: nums.nombre,
        remunerationsBrutes: m('remunerationsBrutes'),
        remunerationsImposables: m('remunerationsImposables'),
        montantIpr: m('montantIpr'),
        montantIer: m('montantIer'),
        impotTotalDu: m('impotTotalDu'),
      });
    }
    setErrors(e);
    if (Object.keys(e).length > 0) {
      setFormError('Corrigez les champs signalés en rouge.');
      return null;
    }
    setFormError('');
    return lignes;
  };

  const save = async () => {
    if (saving) return;
    const lignes = validate();
    if (!lignes || !contribuable) return;
    setSaving(true);
    try {
      await saveDgiCalculImpot(
        {
          contribuableId: contribuable.id,
          contribuableName: contribuable.businessName || '',
          contribuableNif: contribuable.nif || '',
          salairesMois: Number(salairesMois),
          annee: Number(annee),
          lignes,
        },
        actor,
      );
      onSaved();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'L’enregistrement a échoué. Réessayez.');
      setSaving(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const border = (k: string) => (errors[k] ? 'border-danger' : 'border-line');
  const FieldError: React.FC<{ k: string }> = ({ k }) =>
    errors[k] ? <p className="mt-1 text-[11px] text-danger">{errors[k]}</p> : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/60 backdrop-blur-xs"
      onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}
    >
      <div className="bg-surface rounded-[18px] border border-line shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="shrink-0 px-6 py-4.5 border-b border-line flex items-center justify-between gap-3 bg-surface">
          <div className="min-w-0">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-accent font-sans">
              Calcul d’impôt
            </span>
            <h2 className="font-display text-lg font-bold text-ink tracking-tight">Nouveau calcul</h2>
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
        {/* Scrolls on its own between the fixed header and footer. */}
        <div className="flex-1 min-h-0 scroll-y-smooth">
        <fieldset disabled={saving} className="p-6 space-y-5 min-w-0">
          {/* Contribuable, then Salaires du mois de and Année. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="min-w-0 sm:col-span-2">
              <TaxpayerSearch
                id="dgi-calc-contribuable"
                label="Contribuable"
                hint="Nom, NIF ou commune"
                taxpayers={taxpayers}
                value={contribuable}
                onChange={(b) => {
                  setContribuable(b);
                  clearErr('contribuable');
                }}
                error={errors.contribuable}
              />
            </div>
            <div>
              <label htmlFor="dgi-calc-salaires-mois" className="block text-xs font-semibold text-ink mb-1">
                Salaires du mois de
              </label>
              <select
                id="dgi-calc-salaires-mois"
                value={salairesMois}
                onChange={(e) => {
                  setSalairesMois(e.target.value);
                  clearErr('salairesMois');
                }}
                className={`${inputClass} ${border('salairesMois')} cursor-pointer`}
              >
                <option value="">— Sélectionner —</option>
                {MOIS.map((mois, i) => (
                  <option key={mois} value={String(i + 1)}>
                    {mois}
                  </option>
                ))}
              </select>
              <FieldError k="salairesMois" />
            </div>
            <div>
              <label htmlFor="dgi-calc-annee" className="block text-xs font-semibold text-ink mb-1">
                Année
              </label>
              <select
                id="dgi-calc-annee"
                value={annee}
                onChange={(e) => {
                  setAnnee(e.target.value);
                  clearErr('annee');
                }}
                className={`${inputClass} ${border('annee')} cursor-pointer`}
              >
                <option value="">— Sélectionner —</option>
                {ANNEES.map((a) => (
                  <option key={a} value={String(a)}>
                    {a}
                  </option>
                ))}
              </select>
              <FieldError k="annee" />
            </div>
          </div>

          {/* Catégorie salariale — one or more. */}
          <div>
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <span id="dgi-calc-categorie" className="block text-xs font-semibold text-ink">
                Catégorie salariale
              </span>
              <span className="text-[11px] text-muted">
                {selected.length === 0
                  ? 'Sélectionnez une ou plusieurs catégories'
                  : `${selected.length} sélectionnée${selected.length > 1 ? 's' : ''}`}
              </span>
            </div>
            <div
              role="group"
              aria-labelledby="dgi-calc-categorie"
              className={`grid grid-cols-1 sm:grid-cols-2 gap-1.5 p-1.5 rounded-[10px] border bg-surface2 ${
                errors.categories ? 'border-danger' : 'border-line'
              }`}
            >
              {CATEGORIES_SALARIALES.map((c) => {
                const on = selected.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggleCategorie(c)}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-[8px] text-xs text-left transition-premium cursor-pointer border ${
                      on
                        ? 'bg-surface text-accent font-semibold border-accent/30 shadow-[0_2px_8px_oklch(20%_0.03_260/0.08)]'
                        : 'text-ink border-transparent hover:bg-surface/70'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`w-4 h-4 shrink-0 rounded-[4px] border flex items-center justify-center ${
                        on ? 'bg-accent border-accent text-white' : 'border-line bg-surface'
                      }`}
                    >
                      {on && <Check className="w-3 h-3" strokeWidth={3} />}
                    </span>
                    {c}
                  </button>
                );
              })}
            </div>
            <FieldError k="categories" />
          </div>

          {/* One form per selected catégorie. */}
          {selected.map((c, ci) => {
            const form = forms[c];
            const slug = `c${CATEGORIES_SALARIALES.indexOf(c)}`;
            return (
              <section key={c} aria-label={c} className="rounded-[12px] border border-line overflow-hidden">
                <div className="px-4 py-2.5 bg-surface2 border-b border-line flex items-center justify-between gap-3">
                  <h3 className="text-xs font-bold text-ink">
                    <span className="text-accent mr-1.5 tabular-nums">{ci + 1}.</span>
                    {c}
                  </h3>
                  <button
                    type="button"
                    onClick={() => toggleCategorie(c)}
                    aria-label={`Retirer — ${c}`}
                    title="Retirer cette catégorie"
                    className="p-1 rounded-[6px] text-muted hover:text-ink hover:bg-surface transition-premium cursor-pointer shrink-0"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="p-4 space-y-4">
                  {FIGURES.map(({ key, label, whole }) => (
                    <div key={key}>
                      <label htmlFor={`dgi-calc-${slug}-${key}`} className="block text-xs font-semibold text-ink mb-1">
                        {label}
                      </label>
                      <div className="flex items-stretch gap-2">
                        <input
                          id={`dgi-calc-${slug}-${key}`}
                          type="text"
                          inputMode={whole ? 'numeric' : 'decimal'}
                          autoComplete="off"
                          value={form.figures[key]}
                          onChange={(e) => setFigure(c, key, e.target.value)}
                          placeholder={whole ? '0' : '0.00'}
                          aria-invalid={!!errors[errKey(c, key)]}
                          className={`${inputClass} ${border(errKey(c, key))} tabular-nums flex-1 min-w-0`}
                        />
                        {isDeviseKey(key) && (
                          /* Devise of this figure — USD ($) or CDF (FC). */
                          <div
                            role="radiogroup"
                            aria-label={`Devise — ${label}`}
                            className="shrink-0 inline-flex items-center gap-1 p-1 rounded-[10px] border border-line bg-surface2"
                          >
                            {IPR_DEVISES.map((d) => {
                              const on = form.devises[key] === d.id;
                              return (
                                <button
                                  key={d.id}
                                  type="button"
                                  role="radio"
                                  aria-checked={on}
                                  title={d.label}
                                  onClick={() => setDevise(c, key, d.id)}
                                  className={`h-full px-3 rounded-[8px] text-xs font-semibold whitespace-nowrap transition-premium cursor-pointer ${
                                    on
                                      ? 'bg-surface text-accent shadow-[0_2px_8px_oklch(20%_0.03_260/0.08)] border border-accent/20'
                                      : 'text-muted hover:text-ink border border-transparent'
                                  }`}
                                >
                                  {d.button}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      <FieldError k={errKey(c, key)} />
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
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
