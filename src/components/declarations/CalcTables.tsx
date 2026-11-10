import React from 'react';
import { Lock } from 'lucide-react';
import { natureCode, natureDisplay } from '../../types';
import {
  TaxCalculation,
  CONTRIBUABLE_TYPE_LABELS,
  calcPaymentModeLabel,
} from '../../services/taxCalculationService';
import { FoncierCalculation, FONCIER_PAYMENT_MODE_LABELS } from '../../services/foncierCalculationService';
import { fmtTaux, fmtUSD } from '../../utils/taxCalc';
import { amountInFrenchWords, roundMoney } from '../../utils/frenchNumber';

/**
 * The Calculs d'impôts tables, shared by the Declarations page and the Tax
 * Payer Profile, so both always print a calculation the same way.
 */

/** Column widths of the Calculs d'impôts register, in slip order. */
const CALC_COLUMNS = {
  contribuable: 'w-[18%]',
  revenu: 'w-[10%]',
  taux: 'w-[7%]',
  impot: 'w-[11%]',
  retenues: 'w-[11%]',
  solde: 'w-[11%]',
  lettres: 'w-[18%]',
  mode: 'w-[14%]',
} as const;

/**
 * Column widths when the Bailleur / Locataire column is left out (the Tax Payer
 * Profile, where the taxpayer is already shown above the table).
 */
const CALC_COLUMNS_NO_PARTY: Record<keyof typeof CALC_COLUMNS, string> = {
  contribuable: '',
  revenu: 'w-[12%]',
  taux: 'w-[9%]',
  impot: 'w-[13%]',
  retenues: 'w-[13%]',
  solde: 'w-[13%]',
  lettres: 'w-[23%]',
  mode: 'w-[17%]',
};

/**
 * Horizontal padding per column: one rhythm across the whole table, with the
 * outer columns matching the panel's own 24px gutter.
 */
const CALC_PAD = (i: number, last: number) =>
  i === 0 ? 'pl-6 pr-3' : i === last ? 'pl-3 pr-6' : 'px-3';

const CALC_HEADERS: { key: keyof typeof CALC_COLUMNS; label: string; hint?: string; right?: boolean }[] = [
  { key: 'contribuable', label: 'Bailleur / Locataire' },
  { key: 'revenu', label: 'Revenu brut', hint: '(1)', right: true },
  { key: 'taux', label: 'Taux', hint: '(2)', right: true },
  { key: 'impot', label: 'Impôt dû', hint: '(3) = (1)×(2)', right: true },
  { key: 'retenues', label: 'Les retenues versées', hint: '(4)', right: true },
  { key: 'solde', label: 'Solde à payer', hint: '(5) = (3)−(4)', right: true },
  { key: 'lettres', label: 'En toutes lettres', hint: '(6)' },
  { key: 'mode', label: 'Mode de paiement', hint: '(7)' },
];

/** Column widths of the Calculs d'impôts Fonciers register, in slip order. */
/**
 * Column widths of the Calculs d'impôts Fonciers register — one row per
 * property, in the order of the foncier declaration sheet.
 */
const FONCIER_COLUMNS = {
  nature: 'w-[7%]',
  ville: 'w-[9%]',
  commune: 'w-[9%]',
  quartier: 'w-[9%]',
  avenue: 'w-[9%]',
  numero: 'w-[8%]',
  rang: 'w-[6%]',
  usage: 'w-[9%]',
  mesure: 'w-[8%]',
  taux: 'w-[8%]',
  montant: 'w-[9%]',
  total: 'w-[9%]',
} as const;

const FONCIER_HEADERS: { key: keyof typeof FONCIER_COLUMNS; label: string; right?: boolean }[] = [
  { key: 'nature', label: 'Nature' },
  { key: 'ville', label: 'Ville/territoire' },
  { key: 'commune', label: 'Commune/chefferie' },
  { key: 'quartier', label: 'Quartier/groupement' },
  { key: 'avenue', label: 'Avenue/localité' },
  { key: 'numero', label: 'Numéro de parcelle' },
  { key: 'rang', label: 'Rang' },
  { key: 'usage', label: 'Usage' },
  { key: 'mesure', label: 'Superficie ou nombre', right: true },
  { key: 'taux', label: 'Taux', right: true },
  { key: 'montant', label: 'Montant impôt', right: true },
  { key: 'total', label: 'Total impôt dû', right: true },
];

/** Horizontal padding for the 12-column foncier register. */
const FONCIER_PAD = (i: number, last: number) =>
  i === 0 ? 'pl-5 pr-2' : i === last ? 'pl-2 pr-5' : 'px-2';

/** "400 m²", "3 unités", with French grouping. */
const fmtMeasure = (kind: string, v: number) =>
  `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(v)} ${
    kind === 'superficie' ? 'm²' : v === 1 ? 'unité' : 'unités'
  }`;


const NO_MATCHES = new Map<string, string>();

/**
 * Locatif calculations grouped by contribuable, so each person's name and NIF
 * appear once, beside all of their declarations.
 */
function groupByContribuable(rows: TaxCalculation[]) {
  const keyOf = (c: TaxCalculation) =>
    `${c.contribuableType || ''}:${c.contribuableRefId || ''}:${(c.contribuableName || '').trim().toLowerCase()}` ||
    c.id;
  const groups = new Map<string, TaxCalculation[]>();
  rows.forEach((c) => {
    const k = c.contribuableName ? keyOf(c) : c.id;
    const g = groups.get(k);
    if (g) g.push(c);
    else groups.set(k, [c]);
  });
  return Array.from(groups.values()).flatMap((group) =>
    group.map((c, i) => ({ c, first: i === 0, group }))
  );
}

/**
 * Foncier calculations grouped by bailleur: each bailleur's declarations sit
 * together (in the order the bailleur first appears), so their name and NIF
 * are shown once, above all of them.
 */
function groupByBailleur(rows: FoncierCalculation[]) {
  const keyOf = (c: FoncierCalculation) => c.bailleurId || (c.bailleurName || '').trim().toLowerCase() || c.id;
  const groups = new Map<string, FoncierCalculation[]>();
  rows.forEach((c) => {
    const k = keyOf(c);
    const g = groups.get(k);
    if (g) g.push(c);
    else groups.set(k, [c]);
  });
  return Array.from(groups.values()).flatMap((group) =>
    group.map((c, i) => ({ c, first: i === 0, group }))
  );
}

/** Calcul d'impôts — one row per saved calculation. */
export const LocatifCalcTable: React.FC<{
  rows: TaxCalculation[];
  /** Why a row is shown, when a search matched it through the other lease party. */
  matchedVia?: Map<string, string>;
  /** Show the Bailleur / Locataire column (default). The Tax Payer Profile leaves it out. */
  showContribuable?: boolean;
}> = ({ rows, matchedVia = NO_MATCHES, showContribuable = true }) => {
  const headers = showContribuable ? CALC_HEADERS : CALC_HEADERS.filter((h) => h.key !== 'contribuable');
  const widths = showContribuable ? CALC_COLUMNS : CALC_COLUMNS_NO_PARTY;
  return (
          <div className="w-full overflow-x-auto">
            <table className="w-full table-fixed text-left border-collapse font-sans">
              <thead>
                <tr className="border-b border-line bg-surface2/50">
                  {headers.map((h, i) => (
                    <th
                      key={h.key}
                      scope="col"
                      className={`${widths[h.key]} ${CALC_PAD(i, headers.length - 1)} py-3.5 align-top ${
                        h.right ? 'text-right' : 'text-left'
                      }`}
                    >
                      {/* Every label reserves two lines, so the reference line
                          beneath sits on one row across all columns. */}
                      <span className="flex min-h-[26px] items-start text-[11px] font-bold uppercase tracking-[0.07em] leading-[13px] text-faint">
                        <span className={`w-full ${h.right ? 'text-right' : 'text-left'}`}>{h.label}</span>
                      </span>
                      <span className="block text-[11px] font-mono text-faint/80 mt-1 normal-case whitespace-nowrap">
                        {h.hint || '\u00a0'}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {groupByContribuable(rows).map(({ c, first, group }) => {
                  const overpaid = c.soldeUSD < 0;
                  // Locataires and search matches across all of this person's declarations.
                  const pour = Array.from(new Set(group.flatMap((g) => (g.locataires || []).map((l) => l.name))));
                  const via = group.map((g) => matchedVia.get(g.id)).find(Boolean);
                  return (
                    <tr key={c.id} className="hover:bg-surface2/30 transition-premium align-middle">
                      {/* One name / NIF cell per person, spanning all their declarations. */}
                      {first && showContribuable && (
                      <td rowSpan={group.length} className="pl-6 pr-3 py-4 align-top border-r border-line/60">
                        {c.contribuableName ? (
                          <>
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-xs font-semibold text-ink truncate" title={c.contribuableName}>
                                {c.contribuableName}
                              </span>
                              {c.contribuableType && (
                                <span
                                  className={`shrink-0 px-1.5 py-0.5 rounded-[6px] text-[10px] font-bold uppercase tracking-wide ${
                                    c.contribuableType === 'bailleur'
                                      ? 'bg-navy/10 text-navy'
                                      : 'bg-accent-soft text-accent'
                                  }`}
                                >
                                  {CONTRIBUABLE_TYPE_LABELS[c.contribuableType]}
                                </span>
                              )}
                            </div>
                            {pour.length > 0 && (
                              <div className="text-[11px] text-ink truncate mt-0.5" title={pour.join(', ')}>
                                <span className="text-muted">Pour :</span> {pour.join(', ')}
                              </div>
                            )}
                            {via && <div className="text-[11px] text-accent truncate mt-0.5">Trouvé via le {via}</div>}
                            <div
                              className="text-[11px] text-muted truncate mt-0.5"
                              title={[c.contribuableNif ? `NIF ${c.contribuableNif}` : '', c.contribuableLocation]
                                .filter(Boolean)
                                .join(' • ')}
                            >
                              {[c.contribuableNif ? `NIF ${c.contribuableNif}` : '', c.contribuableLocation]
                                .filter(Boolean)
                                .join(' • ') || '—'}
                            </div>
                          </>
                        ) : (
                          <span className="text-[12px] text-faint italic">Non renseigné</span>
                        )}
                        {group.length > 1 && (
                          <div className="text-[11px] text-muted mt-1">{group.length} déclarations</div>
                        )}
                      </td>
                      )}
                      <td className={`${showContribuable ? 'px-3' : 'pl-6 pr-3'} py-4 text-right`}>
                        <span className="text-xs text-ink tabular-nums whitespace-nowrap">
                          {fmtUSD(c.revenuBrutUSD)}
                        </span>
                      </td>
                      <td className="px-3 py-4 text-right">
                        <span className="text-xs text-ink tabular-nums whitespace-nowrap">
                          {fmtTaux(c.tauxPct)}
                        </span>
                      </td>
                      <td className="px-3 py-4 text-right">
                        <span className="text-xs font-semibold text-ink tabular-nums whitespace-nowrap">
                          {fmtUSD(c.impotDuUSD)}
                        </span>
                      </td>
                      <td className="px-3 py-4 text-right">
                        <span className="text-xs text-ink tabular-nums whitespace-nowrap">
                          {fmtUSD(c.retenuesUSD)}
                        </span>
                      </td>
                      <td className="px-3 py-4 text-right">
                        <span
                          className={`text-xs font-bold tabular-nums whitespace-nowrap ${
                            overpaid ? 'text-sage' : 'text-accent-dark'
                          }`}
                        >
                          {fmtUSD(c.soldeUSD)}
                        </span>
                        {overpaid && (
                          <div className="text-[11px] text-muted mt-0.5">trop-perçu</div>
                        )}
                      </td>
                      <td className="px-3 py-4">
                        <span className="block text-[12px] text-ink italic leading-snug">
                          {c.enToutesLettres}
                        </span>
                      </td>
                      <td className="pl-3 pr-6 py-4">
                        <span className="block text-xs text-ink leading-snug truncate">
                          {calcPaymentModeLabel(c.modePaiement)}
                        </span>
                        {/* The saved date is app information, not part of the printed form. */}
                        <span className="pp-noprint flex items-center gap-1 text-[11px] text-faint mt-1 min-w-0">
                          <Lock className="w-2.5 h-2.5 shrink-0" />
                          <span className="truncate">{new Date(c.createdAt).toLocaleDateString('fr-FR')}</span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
  );
};

/** Calculs d'impôts Fonciers — one row per property line, grouped by calculation. */
export const FoncierCalcTable: React.FC<{
  rows: FoncierCalculation[];
  matchedVia?: Map<string, string>;
}> = ({ rows, matchedVia = NO_MATCHES }) => (
            <div className="w-full overflow-x-auto">
              <table className="pp-auto-table w-full table-fixed text-left border-collapse font-sans">
                <thead>
                  <tr className="border-b border-line bg-surface2/50">
                    {FONCIER_HEADERS.map((h, i) => (
                      <th
                        key={h.key}
                        scope="col"
                        className={`${FONCIER_COLUMNS[h.key]} ${FONCIER_PAD(i, FONCIER_HEADERS.length - 1)} py-3.5 align-top ${
                          h.right ? 'text-right' : 'text-left'
                        }`}
                      >
                        {/* Labels like "Ville/territoire" have no space to wrap at, so
                            they break after the slash and stack on two lines inside
                            their own column instead of running into the next one. */}
                        <span className="flex min-h-[26px] items-start text-[11px] font-bold uppercase tracking-[0.04em] leading-[13px] text-faint">
                          <span
                            className={`w-full min-w-0 break-words ${h.right ? 'text-right' : 'text-left'}`}
                          >
                            {h.label.split('/').map((part, k, all) => (
                              <React.Fragment key={k}>
                                {part}
                                {k < all.length - 1 && (
                                  <>
                                    /<wbr />
                                  </>
                                )}
                              </React.Fragment>
                            ))}
                          </span>
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                {groupByBailleur(rows).map(({ c, first, group }) => {
                  const groupDates = Array.from(
                    new Set(
                      group
                        .map((g) => g.createdAt)
                        .sort()
                        .map((d) => new Date(d).toLocaleDateString('fr-FR'))
                    )
                  );
                  const via = group.map((g) => matchedVia.get(g.id)).find(Boolean);
                  const who = [c.bailleurNif ? `NIF ${c.bailleurNif}` : '', c.bailleurLocation]
                    .filter(Boolean)
                    .join(' • ');
                  const cell = 'py-3 text-xs text-ink align-middle';
                  const txt = (v?: string) => (
                    <span className="block truncate" title={v || undefined}>
                      {v || '—'}
                    </span>
                  );
                  return (
                    <tbody key={c.id} className="border-b border-line last:border-b-0">
                      {/* Who pays — one heading per bailleur: their declarations
                          follow under a single name and NIF. Shown on screen;
                          left off the printed document. */}
                      {first && (
                      <tr className="bg-surface2/40 pp-noprint">
                        <td colSpan={FONCIER_HEADERS.length} className="pl-5 pr-5 py-2">
                          {/* Bailleur, then their NIF and address, then the date saved. */}
                          <div className="flex items-baseline gap-2 min-w-0">
                            <span className="text-xs font-semibold text-ink truncate shrink-0 max-w-[40%]">
                              {c.bailleurName || 'Bailleur non renseigné'}
                            </span>
                            {who && <span className="text-[11px] text-muted truncate">{who}</span>}
                            {via && (
                              <span className="text-[11px] text-accent shrink-0">• Trouvé via le {via}</span>
                            )}
                            <span className="inline-flex items-center gap-1 text-[11px] text-faint shrink-0">
                              <span aria-hidden="true">•</span>
                              <Lock className="w-2.5 h-2.5 self-center" />
                              {groupDates.join(', ')}
                            </span>
                            {group.length > 1 && (
                              <span className="text-[11px] text-muted shrink-0">
                                • {group.length} déclarations
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                      )}
                      {c.lines.map((l, k) => (
                        <tr key={k} className="hover:bg-surface2/30 transition-premium border-t border-line/60">
                          <td className={`${cell} ${FONCIER_PAD(0, 11)}`}>
                            <span
                              className="block font-mono text-[12px] font-bold text-accent truncate"
                              title={l.nature ? natureDisplay(l.nature) : undefined}
                            >
                              {l.nature ? natureCode(l.nature) : '—'}
                            </span>
                          </td>
                          <td className={`${cell} ${FONCIER_PAD(1, 11)}`}>{txt(l.villeTerritoire)}</td>
                          <td className={`${cell} ${FONCIER_PAD(2, 11)}`}>{txt(l.communeChefferie)}</td>
                          <td className={`${cell} ${FONCIER_PAD(3, 11)}`}>{txt(l.quartierGroupement)}</td>
                          <td className={`${cell} ${FONCIER_PAD(4, 11)}`}>{txt(l.avenueLocalite)}</td>
                          <td className={`${cell} ${FONCIER_PAD(5, 11)}`}>
                            <span className="block font-mono truncate" title={l.numeroParcelle || undefined}>
                              {l.numeroParcelle || '—'}
                            </span>
                          </td>
                          <td className={`${cell} ${FONCIER_PAD(6, 11)}`}>
                            <span
                              className="block font-mono font-semibold truncate"
                              title={l.rangDesignation ? `${l.rang} — ${l.rangDesignation}` : l.rang}
                            >
                              {l.rang}
                            </span>
                          </td>
                          <td className={`${cell} ${FONCIER_PAD(7, 11)}`}>
                            {txt(l.usageDesignation || l.usage)}
                          </td>
                          <td className={`${cell} ${FONCIER_PAD(8, 11)} text-right`}>
                            <span className="block tabular-nums whitespace-nowrap truncate">
                              {fmtMeasure(l.measureKind, l.measureValue)}
                            </span>
                          </td>
                          <td className={`${cell} ${FONCIER_PAD(9, 11)} text-right`}>
                            <span className="block tabular-nums whitespace-nowrap truncate">
                              {fmtUSD(l.tauxUSD)}
                              <span className="text-faint">/{l.measureKind === 'superficie' ? 'm²' : 'u'}</span>
                            </span>
                          </td>
                          <td className={`${cell} ${FONCIER_PAD(10, 11)} text-right`}>
                            <span className="block font-semibold tabular-nums whitespace-nowrap">
                              {fmtUSD(l.montantImpotUSD)}
                            </span>
                          </td>
                          {/* One total per calculation, spanning its properties. */}
                          {k === 0 && (
                            <td
                              rowSpan={c.lines.length}
                              className={`${cell} ${FONCIER_PAD(11, 11)} text-right border-l border-line/60`}
                            >
                              <span className="block text-sm font-bold text-accent-dark tabular-nums whitespace-nowrap">
                                {fmtUSD(c.totalImpotDuUSD)}
                              </span>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  );
                })}
              </table>
            </div>
);

/**
 * The foncier Calcul d'impôts set vertically, for the printed Impôt foncier
 * declaration: one row per column of FoncierCalcTable — the heading on the
 * left — and one column per property line, in the same order. The total
 * impôt dû of each calculation — in figures, then in words right below —
 * spans the columns of its properties.
 */
/** "Quatre-vingt-dix dollars américains" — an amount in words, capitalised. */
const totalEnLettres = (usd: number) => {
  const w = amountInFrenchWords(roundMoney(usd));
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : '—';
};

export const FoncierCalcVerticalTable: React.FC<{ rows: FoncierCalculation[] }> = ({ rows }) => {
  const calcs = groupByBailleur(rows).map(({ c }) => c);
  const lines = calcs.flatMap((c) => c.lines.map((l) => ({ c, l })));
  const th =
    'pl-6 pr-3 py-2.5 bg-surface2/50 border-r border-line text-[12px] font-bold uppercase tracking-[0.05em] leading-tight text-faint text-left align-middle [overflow-wrap:normal] [word-break:normal] hyphens-none';
  const td = 'px-3 py-2.5 text-xs text-ink align-middle border-l border-line/60';
  const value = (key: keyof typeof FONCIER_COLUMNS, l: FoncierCalculation['lines'][number]): React.ReactNode => {
    switch (key) {
      case 'nature':
        return <span className="font-mono font-bold text-accent">{l.nature ? natureCode(l.nature) : '—'}</span>;
      case 'ville':
        return l.villeTerritoire || '—';
      case 'commune':
        return l.communeChefferie || '—';
      case 'quartier':
        return l.quartierGroupement || '—';
      case 'avenue':
        return l.avenueLocalite || '—';
      case 'numero':
        return <span className="font-mono">{l.numeroParcelle || '—'}</span>;
      case 'rang':
        return <span className="font-mono font-semibold">{l.rang || '—'}</span>;
      case 'usage':
        return l.usageDesignation || l.usage || '—';
      case 'mesure':
        return <span className="tabular-nums">{fmtMeasure(l.measureKind, l.measureValue)}</span>;
      case 'taux':
        return (
          <span className="tabular-nums">
            {fmtUSD(l.tauxUSD)}
            <span className="text-faint">/{l.measureKind === 'superficie' ? 'm²' : 'u'}</span>
          </span>
        );
      case 'montant':
        return <span className="font-semibold tabular-nums">{fmtUSD(l.montantImpotUSD)}</span>;
      default:
        return null;
    }
  };
  return (
    <div className="w-full">
      <table aria-label="Calcul d'impôts" className="np-vertical-table w-full table-auto text-left border-collapse font-sans">
        <tbody className="divide-y divide-line">
          {FONCIER_HEADERS.map((h) => (
            <React.Fragment key={h.key}>
              <tr>
                <th scope="row" className={`${th} w-[24%]`}>
                  {h.key === 'total' ? 'Total impôt dû en chiffres' : h.label}
                </th>
                {h.key === 'total'
                  ? // One total per calculation, across its properties.
                    calcs.map((c) => (
                      <td key={c.id} colSpan={c.lines.length} className={`${td} text-center`}>
                        <span className="text-sm font-bold text-accent-dark tabular-nums whitespace-nowrap">
                          {fmtUSD(c.totalImpotDuUSD)}
                        </span>
                      </td>
                    ))
                  : lines.map(({ c, l }, k) => (
                      <td key={`${c.id}-${k}`} className={td}>
                        {value(h.key, l)}
                      </td>
                    ))}
              </tr>
              {/* The same total in words, right below. */}
              {h.key === 'total' && (
                <tr>
                  <th scope="row" className={`${th} w-[24%]`}>
                    Total impôt dû en lettres
                  </th>
                  {calcs.map((c) => (
                    <td key={c.id} colSpan={c.lines.length} className={`${td} text-center`}>
                      <span className="font-semibold italic">{totalEnLettres(c.totalImpotDuUSD)}</span>
                    </td>
                  ))}
                </tr>
              )}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/**
 * The foncier Calcul d'impôts of the printed Impôt foncier declaration, across:
 * the headings along the top (Nature … Montant impôt) and one row per
 * property, as on screen. Below each calculation's properties, its total impôt
 * dû runs across the table — "Total impôt dû en chiffres", then "Total impôt
 * dû en lettres" right below — the heading on the left, the amount across the
 * rest of the width.
 */
const FONCIER_PRINT_HEADERS = FONCIER_HEADERS.filter((h) => h.key !== 'total');
/** Columns the "Total impôt dû …" heading spans; the amount spans the rest. */
const TOTAL_LABEL_SPAN = 3;

export const FoncierCalcPrintTable: React.FC<{
  rows: FoncierCalculation[];
  /** Shown across the table when there is no calculation. */
  emptyText?: string;
}> = ({ rows, emptyText = 'Aucun calcul.' }) => {
  const calcs = groupByBailleur(rows).map(({ c }) => c);
  const n = FONCIER_PRINT_HEADERS.length;
  const last = n - 1;
  const cell = 'py-2.5 text-xs text-ink align-middle';
  const totalTh =
    'pl-5 pr-3 py-2.5 bg-surface2/50 border-r border-line text-[12px] font-bold uppercase tracking-[0.05em] leading-tight text-faint text-left align-middle [overflow-wrap:normal] [word-break:normal] hyphens-none';
  const totalTd = 'px-3 py-2.5 text-xs text-ink text-center align-middle';
  const totals = (c?: FoncierCalculation) => (
    <>
      <tr className="border-t border-line">
        <th scope="row" colSpan={TOTAL_LABEL_SPAN} className={totalTh}>
          Total impôt dû en chiffres
        </th>
        <td colSpan={n - TOTAL_LABEL_SPAN} className={totalTd}>
          <span className="text-sm font-bold text-accent-dark tabular-nums whitespace-nowrap">
            {c ? fmtUSD(c.totalImpotDuUSD) : '—'}
          </span>
        </td>
      </tr>
      <tr className="border-t border-line">
        <th scope="row" colSpan={TOTAL_LABEL_SPAN} className={totalTh}>
          Total impôt dû en lettres
        </th>
        <td colSpan={n - TOTAL_LABEL_SPAN} className={totalTd}>
          <span className="font-semibold italic">{c ? totalEnLettres(c.totalImpotDuUSD) : '—'}</span>
        </td>
      </tr>
    </>
  );
  return (
    <div className="w-full">
      <table aria-label="Calcul d'impôts" className="pp-auto-table w-full table-fixed text-left border-collapse font-sans">
        <thead>
          <tr className="border-b border-line bg-surface2/50">
            {FONCIER_PRINT_HEADERS.map((h, i) => (
              <th
                key={h.key}
                scope="col"
                className={`${FONCIER_COLUMNS[h.key]} ${FONCIER_PAD(i, last)} py-3 align-top ${
                  h.right ? 'text-right' : 'text-left'
                }`}
              >
                <span className="flex items-start text-[11px] font-bold uppercase tracking-[0.04em] leading-[13px] text-faint">
                  <span className={`w-full min-w-0 break-words ${h.right ? 'text-right' : 'text-left'}`}>
                    {h.label.split('/').map((part, k, all) => (
                      <React.Fragment key={k}>
                        {part}
                        {k < all.length - 1 && (
                          <>
                            /<wbr />
                          </>
                        )}
                      </React.Fragment>
                    ))}
                  </span>
                </span>
              </th>
            ))}
          </tr>
        </thead>
        {calcs.length === 0 ? (
          <tbody>
            <tr>
              <td colSpan={n} className="px-5 py-4 text-[12px] text-muted italic text-center">
                {emptyText}
              </td>
            </tr>
            {totals()}
          </tbody>
        ) : (
          calcs.map((c) => (
            <tbody key={c.id} className="border-b border-line last:border-b-0">
              {c.lines.map((l, k) => (
                <tr key={k} className="border-t border-line/60">
                  {FONCIER_PRINT_HEADERS.map((h, i) => (
                    <td key={h.key} className={`${cell} ${FONCIER_PAD(i, last)} ${h.right ? 'text-right' : ''}`}>
                      {foncierValue(h.key, l)}
                    </td>
                  ))}
                </tr>
              ))}
              {totals(c)}
            </tbody>
          ))
        )}
      </table>
    </div>
  );
};

/** One foncier property line's value for a column of the register. */
function foncierValue(
  key: keyof typeof FONCIER_COLUMNS,
  l: FoncierCalculation['lines'][number]
): React.ReactNode {
  switch (key) {
    case 'nature':
      return <span className="font-mono font-bold text-accent">{l.nature ? natureCode(l.nature) : '—'}</span>;
    case 'ville':
      return l.villeTerritoire || '—';
    case 'commune':
      return l.communeChefferie || '—';
    case 'quartier':
      return l.quartierGroupement || '—';
    case 'avenue':
      return l.avenueLocalite || '—';
    case 'numero':
      return <span className="font-mono">{l.numeroParcelle || '—'}</span>;
    case 'rang':
      return <span className="font-mono font-semibold">{l.rang || '—'}</span>;
    case 'usage':
      return l.usageDesignation || l.usage || '—';
    case 'mesure':
      return <span className="tabular-nums whitespace-nowrap">{fmtMeasure(l.measureKind, l.measureValue)}</span>;
    case 'taux':
      return (
        <span className="tabular-nums whitespace-nowrap">
          {fmtUSD(l.tauxUSD)}
          <span className="text-faint">/{l.measureKind === 'superficie' ? 'm²' : 'u'}</span>
        </span>
      );
    case 'montant':
      return <span className="font-semibold tabular-nums whitespace-nowrap">{fmtUSD(l.montantImpotUSD)}</span>;
    default:
      return null;
  }
}

/**
 * A printed table set vertically: one row per heading — the heading on the
 * left — and one column per record, in order. Used for the Impôt locatif
 * declaration's tables.
 */
export const VerticalDataTable: React.FC<{
  /** Accessible name of the table. */
  label: string;
  rows: { key: string; heading: React.ReactNode; cells: React.ReactNode[] }[];
}> = ({ label, rows }) => (
  <div className="w-full">
    <table aria-label={label} className="np-vertical-table w-full table-auto text-left border-collapse font-sans">
      <tbody className="divide-y divide-line">
        {rows.map((r) => (
          <tr key={r.key}>
            <th
              scope="row"
              className="w-[24%] pl-6 pr-3 py-2.5 bg-surface2/50 border-r border-line text-[12px] font-bold uppercase tracking-[0.05em] leading-tight text-faint text-left align-middle [overflow-wrap:normal] [word-break:normal] hyphens-none"
            >
              {r.heading}
            </th>
            {r.cells.map((c, k) => (
              <td key={k} className="px-3 py-2.5 text-xs text-ink align-middle border-l border-line/60">
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

/**
 * The Calcul d'impôts of the printed Impôt locatif declaration, set
 * vertically: one row per column of LocatifCalcTable (without the Bailleur /
 * Locataire column) — the heading and its reference, (1) to (7) — and one
 * column per calculation.
 */
export const LocatifCalcVerticalTable: React.FC<{ rows: TaxCalculation[] }> = ({ rows }) => {
  const calcs = groupByContribuable(rows).map(({ c }) => c);
  const cell = (c: TaxCalculation, key: keyof typeof CALC_COLUMNS): React.ReactNode => {
    switch (key) {
      case 'revenu':
        return <span className="tabular-nums">{fmtUSD(c.revenuBrutUSD)}</span>;
      case 'taux':
        return <span className="tabular-nums">{fmtTaux(c.tauxPct)}</span>;
      case 'impot':
        return <span className="font-semibold tabular-nums">{fmtUSD(c.impotDuUSD)}</span>;
      case 'retenues':
        return <span className="tabular-nums">{fmtUSD(c.retenuesUSD)}</span>;
      case 'solde':
        return (
          <span className={`font-bold tabular-nums ${c.soldeUSD < 0 ? 'text-sage' : 'text-accent-dark'}`}>
            {fmtUSD(c.soldeUSD)}
            {c.soldeUSD < 0 && <span className="font-normal text-muted"> (trop-perçu)</span>}
          </span>
        );
      case 'lettres':
        return <span className="italic">{c.enToutesLettres}</span>;
      case 'mode':
        return calcPaymentModeLabel(c.modePaiement);
      default:
        return null;
    }
  };
  return (
    <VerticalDataTable
      label="Calcul d'impôts"
      rows={CALC_HEADERS.filter((h) => h.key !== 'contribuable').map((h) => ({
        key: h.key,
        heading: (
          <>
            {h.label}
            {h.hint && <span className="ml-1.5 font-mono normal-case tracking-normal font-normal">{h.hint}</span>}
          </>
        ),
        cells: calcs.map((c) => cell(c, h.key)),
      }))}
    />
  );
};
