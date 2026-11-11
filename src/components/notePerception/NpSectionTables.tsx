import React from 'react';
import { BadgeCheck, Clock, Lock, Printer } from 'lucide-react';
import {
  montantPaiementEnLettres,
  montantPaiementUSD,
  NotePerception,
} from '../../services/notePerceptionService';
import { formatMoney } from '../../utils/money';
import { Business } from '../../types';

/**
 * The two parts of a note de perception, each as a table — the taxateur's and
 * the bureau comptable's (agent bancaire). Shared by the Taxateur subtab and the
 * Agent bancaire tab, so a column reads the same everywhere.
 *
 * Headers wrap between words only — never inside one — and the table scrolls
 * sideways rather than squeezing a column narrower than its longest word.
 */

interface Header {
  label: string;
  /** Width hint, as a share of the table. */
  w: string;
  right?: boolean;
}

const pad = (i: number, last: number) => (i === 0 ? 'pl-6 pr-3' : i === last ? 'pl-3 pr-6' : 'px-3');

/** YYYY-MM-DD → DD/MM/YYYY, read as a calendar date (no time-zone shift). */
export const frDay = (d?: string) =>
  d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10).split('-').reverse().join('/') : '—';

const SectionTable: React.FC<{
  headers: Header[];
  minWidth: string;
  rowCount: number;
  /** Shown across the whole table when there is no row (loading, empty state). */
  placeholder?: React.ReactNode;
  children: React.ReactNode;
  label?: string;
}> = ({ headers, minWidth, rowCount, placeholder, children, label }) => {
  const last = headers.length - 1;
  return (
    <div className="w-full overflow-x-auto">
      <table aria-label={label} className={`premium-table w-full ${minWidth} table-auto text-left border-collapse font-sans`}>
        <thead>
          <tr className="border-b border-line bg-surface2/50">
            {headers.map((h, i) => (
              <th
                key={h.label}
                scope="col"
                style={{ width: h.w }}
                className={`${pad(i, last)} py-3.5 text-[12px] font-bold uppercase tracking-[0.05em] leading-tight text-faint align-bottom [overflow-wrap:normal] [word-break:normal] hyphens-none ${
                  h.right ? 'text-right' : 'text-left'
                }`}
              >
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rowCount === 0 && placeholder !== undefined ? (
            <tr>
              <td colSpan={headers.length} className="p-0">
                {placeholder}
              </td>
            </tr>
          ) : (
            children
          )}
        </tbody>
      </table>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* 1 · Rempli par le service taxateur                                  */
/* ------------------------------------------------------------------ */

const TAXATEUR_HEADERS: Header[] = [
  { label: 'Numéro facture ou note de taxation (débit)', w: '14%' },
  { label: 'Article budgétaire', w: '9%' },
  { label: "Nombre d'actes", w: '7%', right: true },
  { label: 'Arrêté numéro', w: '9%' },
  { label: 'Montant taxe : en chiffres', w: '9%', right: true },
  { label: 'Montant taxe en lettres', w: '21%' },
  { label: 'Date de taxation', w: '8%' },
  { label: "Nom de l'agent taxateur", w: '13%' },
  { label: 'Qualité', w: '10%' },
];

export const TaxateurSectionTable: React.FC<{
  notes: NotePerception[];
  placeholder?: React.ReactNode;
  /** Prints one note — adds an Imprimer button at the end of each row. */
  onPrint?: (n: NotePerception) => void;
}> = ({ notes, placeholder, onPrint }) => {
  // On screen the taxpayer's name comes first, so whose note it is reads at a
  // glance. (The printed note's taxateur table keeps TAXATEUR_HEADERS only.)
  const shown: Header[] = [{ label: 'Nom du redevable', w: '11%' }, ...TAXATEUR_HEADERS];
  const headers = onPrint ? [...shown, { label: '', w: '1%' }] : shown;
  const last = headers.length - 1;
  return (
    <SectionTable
      headers={headers}
      minWidth="min-w-[1180px]"
      rowCount={notes.length}
      placeholder={placeholder}
      label="Rempli par le service taxateur"
    >
      {notes.map((n) => {
        const t = n.taxateur;
        return (
          <tr key={n.id} className="hover:bg-surface2/30 transition-premium align-top">
            <td className={`${pad(0, last)} py-3.5`}>
              <span className="block text-xs font-bold text-ink break-words">{redevableOf(n).name || '—'}</span>
            </td>
            <td className={`${pad(1, last)} py-3.5`}>
              <span className="block text-xs font-mono font-bold text-ink break-words">{t.numeroFacture}</span>
            </td>
            <td className={`${pad(2, last)} py-3.5`}>
              <span className="block text-xs font-mono text-ink break-words">{t.articleBudgetaire}</span>
            </td>
            <td className={`${pad(3, last)} py-3.5 text-right`}>
              <span className="text-xs text-ink tabular-nums">{t.nombreActes}</span>
            </td>
            <td className={`${pad(4, last)} py-3.5`}>
              <span className="block text-xs font-mono text-ink break-words">{t.arreteNumero}</span>
            </td>
            <td className={`${pad(5, last)} py-3.5 text-right`}>
              <span className="text-xs font-bold text-ink tabular-nums whitespace-nowrap">{formatMoney(t.montantUSD)}</span>
            </td>
            <td className={`${pad(6, last)} py-3.5`}>
              <span className="block text-[13px] italic text-ink leading-snug">{t.montantEnLettres}</span>
            </td>
            {/* Date de taxation — when the service taxateur filled the note */}
            <td className={`${pad(7, last)} py-3.5`}>
              <span className="text-xs font-mono text-ink tabular-nums whitespace-nowrap">
                {new Date(t.filledAt || n.createdAt).toLocaleDateString('fr-FR')}
              </span>
            </td>
            <td className={`${pad(8, last)} py-3.5`}>
              <span className="block text-xs font-semibold text-ink break-words">{t.nomAgent}</span>
            </td>
            <td className={`${pad(9, last)} py-3.5`}>
              <span className="block text-xs text-ink break-words">{t.qualite}</span>
            </td>
            {onPrint && (
              <td className={`${pad(10, last)} py-2.5 text-right whitespace-nowrap`}>
                <button
                  type="button"
                  onClick={() => onPrint(n)}
                  title="Imprimer la note de perception"
                  aria-label={`Imprimer la note de perception ${t.numeroFacture}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] border border-line bg-surface text-[12px] font-semibold text-ink hover:bg-surface2 hover:border-accent/30 cursor-pointer transition-premium"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Imprimer
                </button>
              </td>
            )}
          </tr>
        );
      })}
    </SectionTable>
  );
};

/** A row of a vertical blank table: its heading, and how tall its blank cell is (px) when it needs room — a signature. */
/**
 * A row of a vertical blank table: its heading, how tall its blank cell is (px)
 * when it needs room — a signature — and, when the row carries details of the
 * same thing (a cheque's date and bank), the labels of those details, set in
 * the same row after the first blank. `stacked` headings sit right under the
 * first in the same heading cell, sharing the row — each on its own line, with
 * its own blank (and details) on the same line to the right.
 */
type StackedLine = string | { label: string; parts?: string[] };
type BlankRow = string | { label: string; height?: number; parts?: string[]; stacked?: StackedLine[] };
const rowLabel = (r: BlankRow) => (typeof r === 'string' ? r : r.label);

/** A heading; a list letter in front of it ("a) Espèces") stays lower-case while the rest is in capitals. */
const RowHeading: React.FC<{ text: string }> = ({ text }) => {
  const m = /^([a-z]\))\s+(.*)$/.exec(text);
  if (!m) return <>{text}</>;
  return (
    <>
      <span className="normal-case">{m[1]}</span> {m[2]}
    </>
  );
};

/**
 * What a printed note fills in: the value of each row, keyed by its heading, and
 * of each detail, keyed "row heading|detail heading". Absent → the blank stays
 * blank, to be filled in by hand.
 */
export type BlankValues = Record<string, React.ReactNode>;

/** A filled-in value, or a blank. */
const Value: React.FC<{ v?: React.ReactNode }> = ({ v }) =>
  v === undefined || v === null || v === '' ? (
    <>&nbsp;</>
  ) : (
    <span className="np-value block text-xs font-semibold text-ink leading-tight break-words">{v}</span>
  );

/**
 * The blank side of a row: a blank, then each detail's heading — shaded like
 * the row headings, full height — followed by its own blank.
 */
const PartsLine: React.FC<{ parts?: string[]; rowKey: string; values?: BlankValues }> = ({ parts, rowKey, values }) => (
  <div className="flex items-stretch h-full">
    <span className="flex-1 flex items-center px-3 min-w-0">
      <Value v={values?.[rowKey]} />
    </span>
    {(parts || []).map((p) => (
      <React.Fragment key={p}>
        <span className="np-part-label flex items-center px-3 bg-surface2/50 border-x border-line text-[12px] font-bold uppercase tracking-[0.05em] leading-tight text-faint whitespace-nowrap">
          {/* Wrapped, so the space after the letter survives the flex layout. */}
          <span>
            <RowHeading text={p} />
          </span>
        </span>
        <span className="flex-1 flex items-center px-3 min-w-0">
          <Value v={values?.[`${rowKey}|${p}`]} />
        </span>
      </React.Fragment>
    ))}
  </div>
);

/**
 * A blank form table set vertically, for the printed note de perception: one
 * row per heading — the heading on the left, a blank cell to fill in on the
 * right.
 */
export const VerticalBlankTable: React.FC<{
  headings: BlankRow[];
  /** Accessible name of the table. */
  label: string;
  /** Share of the width taken by the heading column. */
  headingWidth?: string;
  /** The values of a printed note; without them every blank stays blank. */
  values?: BlankValues;
}> = ({ headings, label, headingWidth = '40%', values }) => (
  <div className="w-full">
    <table aria-label={label} className="np-vertical-table w-full table-fixed text-left border-collapse font-sans">
      <colgroup>
        <col style={{ width: headingWidth }} />
        <col />
      </colgroup>
      <tbody className="divide-y divide-line">
        {headings.map((r) => {
          const stacked = typeof r !== 'string' && r.stacked?.length ? r.stacked : null;
          if (stacked) {
            // Several headings sharing one row: one line per heading, and the
            // blank of each line on the same line to its right.
            const lines: { label: string; parts?: string[] }[] = [
              { label: rowLabel(r), parts: typeof r !== 'string' ? r.parts : undefined },
              ...stacked.map((l) => (typeof l === 'string' ? { label: l } : l)),
            ];
            return (
              <tr key={rowLabel(r)} className="np-print-blank-row">
                <th
                  scope="row"
                  className="np-stacked-cell pl-6 pr-3 py-0 bg-surface2/50 border-r border-line text-[12px] font-bold uppercase tracking-[0.05em] leading-tight text-faint align-middle [overflow-wrap:normal] [word-break:normal] hyphens-none"
                >
                  {lines.map((l) => (
                    <div key={l.label} className="np-line h-[21px] flex items-center">
                      <span>
                        <RowHeading text={l.label} />
                      </span>
                    </div>
                  ))}
                </th>
                <td className="np-parts-cell p-0 text-xs text-ink align-middle">
                  {lines.map((l) => (
                    <div key={l.label} className="np-line h-[21px]">
                      <PartsLine parts={l.parts} rowKey={l.label} values={values} />
                    </div>
                  ))}
                </td>
              </tr>
            );
          }
          return (
            <tr key={rowLabel(r)} className="np-print-blank-row">
              <th
                scope="row"
                className="pl-6 pr-3 py-2.5 bg-surface2/50 border-r border-line text-[12px] font-bold uppercase tracking-[0.05em] leading-tight text-faint align-middle [overflow-wrap:normal] [word-break:normal] hyphens-none"
              >
                <RowHeading text={rowLabel(r)} />
              </th>
              {typeof r !== 'string' && r.parts?.length ? (
                <td className="np-parts-cell p-0 text-xs text-ink align-middle">
                  <PartsLine parts={r.parts} rowKey={rowLabel(r)} values={values} />
                </td>
              ) : (
                <td
                  className="pl-3 pr-6 py-2.5 text-xs text-ink align-middle"
                  style={typeof r !== 'string' && r.height ? { height: `${r.height}px` } : undefined}
                >
                  <Value v={values?.[rowLabel(r)]} />
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

/**
 * Identification du redevable, as printed on the note de perception and on the
 * Impôt foncier / Impôt locatif documents: the columns of the Identification
 * du redevable table in Enregistrement, in its order — NIF through Forme juridique.
 */
export const IDENT_HEADINGS = [
  'NIF',
  'Noms ou dénomination sociale',
  'Sigle',
  "Numéro d'identification nationale",
  'Ville',
  'Commune',
  'Quartier',
  'Avenue',
  'Numéro de parcelle',
  'Téléphone',
  'Email',
  'Forme juridique',
];

/** The taxpayer's values for IDENT_HEADINGS; `fallback` covers a note whose taxpayer is no longer on the roll. */
export function identificationValues(
  b: Business | null,
  ville: string,
  fallback: { name?: string; nif?: string } = {}
): BlankValues {
  return {
    NIF: b?.nif || fallback.nif || '',
    'Noms ou dénomination sociale': b?.businessName || fallback.name || '',
    Sigle: b?.sigle || '',
    "Numéro d'identification nationale": b?.idNat || '',
    Ville: ville,
    Commune: b?.commune || '',
    Quartier: b?.quartier || '',
    Avenue: b?.physicalAddress || '',
    'Numéro de parcelle': b?.numeroParcelle || '',
    Téléphone: b?.phoneNumber && b.phoneNumber.trim() !== '+243' ? b.phoneNumber : '',
    Email: b?.email || '',
    'Forme juridique': b?.taxpayerType || '',
  };
}

/**
 * The taxateur's table for the printed note de perception, set vertically: one
 * row per column of TaxateurSectionTable, in the same order and with the same
 * headings — then the Signature, with room to sign by hand once printed.
 */
export const TaxateurBlankTable: React.FC<{ values?: BlankValues }> = ({ values }) => (
  <VerticalBlankTable
    values={values}
    headings={[...TAXATEUR_HEADERS.map((h) => h.label), { label: 'Signature', height: 66 }]}
    label="Remplir par le service taxateur"
  />
);

/**
 * The ordonnateur's table for the printed note de perception, set vertically
 * like the taxateur's — with room to write the avis and to sign by hand.
 */
export const OrdonnateurBlankTable: React.FC<{ values?: BlankValues }> = ({ values }) => (
  <VerticalBlankTable
    values={values}
    headings={[
      { label: "Avis de l'ordonnateur", height: 48 },
      'Montant ordonné en chiffres',
      'Montant ordonné en lettres',
      'Le paiement doit intervenir au plus tard le',
      { label: "Nom et signature de l'ordonnateur", height: 64 },
    ]}
    label="Remplir par l'ordonnateur"
  />
);

/**
 * The comptable's table for the printed note de perception, set vertically
 * like the others: the bureau comptable, the payment modes a) to e), the
 * quittance, the amount, then the comptable's name, signature and the date.
 */
export const ComptableBlankTable: React.FC<{ values?: BlankValues }> = ({ values }) => (
  <VerticalBlankTable
    values={values}
    headings={[
      'Code ou désignation du bureau comptable',
      'a) Espèces',
      // The cheque's date and bank refer to the cheque: same row as its number.
      { label: 'b) Chèque bancaire', parts: ['du', 'de la banque'] },
      // Likewise the postal cheque's date and issuer: same row as its number.
      { label: 'c) Chèque postal numéro', parts: ['du', 'de'] },
      // The avis de crédit sits right under the bordereau, in the same cell.
      { label: 'd) Bordereau de versement (B)', stacked: [{ label: 'e) Avis de crédit numéro', parts: ['du'] }] },
      // The quittance's number, then its date — "du" in the middle of the row.
      { label: 'Quittance numéro', parts: ['du'] },
      'Montant ordonné en chiffres',
      'Montant ordonné en lettres (francs fiscaux)',
      'Nom du comptable',
      // Room to sign by hand once printed, like the taxateur's signature.
      { label: 'Signature', height: 66 },
      'Date',
    ]}
    label="Remplir par le comptable"
  />
);

/* ------------------------------------------------------------------ */
/* 2 · Rempli par l'ordonnateur                                        */
/* ------------------------------------------------------------------ */

const ORDONNATEUR_HEADERS: Header[] = [
  // Whose note it is — the taxpayer of the ordonnance.
  { label: 'Nom du redevable', w: '15%' },
  { label: "Avis de l'ordonnateur", w: '18%' },
  { label: 'Montant ordonné en chiffres', w: '10%', right: true },
  { label: 'Montant ordonné en lettres', w: '17%' },
  { label: 'Le paiement doit intervenir au plus tard le', w: '12%' },
  { label: "Date d'ordonnancement", w: '12%' },
  { label: "Nom de l'ordonnateur", w: '16%' },
];

/** Notes without an ordonnateur part are skipped. */
export const OrdonnateurSectionTable: React.FC<{ notes: NotePerception[]; placeholder?: React.ReactNode }> = ({
  notes,
  placeholder,
}) => {
  const rows = notes.filter((n) => !!n.ordonnateur);
  const last = ORDONNATEUR_HEADERS.length - 1;
  return (
    <SectionTable
      headers={ORDONNATEUR_HEADERS}
      minWidth="min-w-[1120px]"
      rowCount={rows.length}
      placeholder={placeholder}
      label="Rempli par l'ordonnateur"
    >
      {rows.map((n) => {
        const o = n.ordonnateur!;
        return (
          <tr key={n.id} className="hover:bg-surface2/30 transition-premium align-top">
            <td className={`${pad(0, last)} py-3.5`}>
              <span className="block text-xs font-bold text-ink break-words">
                {(o.contribuableName || '').trim() || redevableOf(n).name || '—'}
              </span>
            </td>
            <td className={`${pad(1, last)} py-3.5`}>
              <span className="block text-xs text-ink leading-snug whitespace-pre-line break-words">{o.avis}</span>
            </td>
            <td className={`${pad(2, last)} py-3.5 text-right`}>
              <span className="text-xs font-bold text-ink tabular-nums whitespace-nowrap">
                {formatMoney(o.montantOrdonneUSD)}
              </span>
            </td>
            <td className={`${pad(3, last)} py-3.5`}>
              <span className="block text-[13px] italic text-ink leading-snug">{o.montantOrdonneEnLettres}</span>
            </td>
            <td className={`${pad(4, last)} py-3.5`}>
              <span className="text-xs font-mono text-ink tabular-nums whitespace-nowrap">{frDay(o.paiementAuPlusTardLe)}</span>
            </td>
            <td className={`${pad(5, last)} py-3.5`}>
              <span className="text-xs font-mono text-ink tabular-nums whitespace-nowrap">{frDay(o.dateOrdonnancement)}</span>
            </td>
            <td className={`${pad(6, last)} py-3.5`}>
              <span className="block text-xs font-semibold text-ink break-words">{o.nomOrdonnateur}</span>
            </td>
          </tr>
        );
      })}
    </SectionTable>
  );
};

/* ------------------------------------------------------------------ */
/* 3 · Rempli par l'agent bancaire (bureau comptable)                  */
/* ------------------------------------------------------------------ */

const COMPTABLE_HEADERS: Header[] = [
  // Who the payment is for — the taxpayer named on the note de perception.
  { label: 'Nom du redevable', w: '14%' },
  { label: 'Code ou désignation du bureau comptable', w: '15%' },
  { label: 'Mode de paiement', w: '14%' },
  { label: 'Quittance numéro', w: '10%' },
  { label: 'Montant en chiffres', w: '10%', right: true },
  { label: 'Montant en lettres', w: '16%' },
  { label: 'Nom du comptable', w: '12%' },
  { label: 'Date', w: '9%' },
];

/**
 * The Comptable tab's list adds "Paiement" at the right edge: the payment is
 * confirmed there once the comptable has filled in the note.
 */
const COMPTABLE_LIST_HEADERS: Header[] = [
  { label: 'Nom du redevable', w: '12%' },
  { label: 'Code ou désignation du bureau comptable', w: '13%' },
  { label: 'Mode de paiement', w: '12%' },
  { label: 'Quittance numéro', w: '9%' },
  { label: 'Montant en chiffres', w: '9%', right: true },
  { label: 'Montant en lettres', w: '14%' },
  { label: 'Nom du comptable', w: '10%' },
  { label: 'Date', w: '8%' },
  { label: 'Paiement', w: '13%' },
];

/** The taxpayer a note de perception is for: the taxateur's part, else the ordonnance's. */
const redevableOf = (n: NotePerception): { name: string; nif: string } => ({
  name: (n.taxateur?.contribuableName || n.ordonnateur?.contribuableName || '').trim(),
  nif: (n.taxateur?.contribuableNif || n.ordonnateur?.contribuableNif || '').trim(),
});

/**
 * The bank agent's list: every note de perception the taxateur and the
 * ordonnateur have filled in. One awaiting the bank's part comes first, marked
 * "En attente de paiement", with a button to fill it in; a paid one shows its
 * payment. (Notes paid before payments required an ordonnance also show.)
 */
export const ComptableSectionTable: React.FC<{
  notes: NotePerception[];
  placeholder?: React.ReactNode;
  /** Opens the payment card on a note awaiting payment — absent for read-only roles. */
  onFill?: (n: NotePerception) => void;
  /** Opens "Confirmer le paiement" on a note the comptable has filled in — absent for read-only roles. */
  onConfirm?: (n: NotePerception) => void;
}> = ({ notes, placeholder, onFill, onConfirm }) => {
  const awaiting = notes.filter((n) => !!n.taxateur && !!n.ordonnateur && !n.comptable);
  const paid = notes.filter((n) => !!n.comptable);
  const rows = [...awaiting, ...paid];
  const last = COMPTABLE_LIST_HEADERS.length - 1;
  return (
    <SectionTable
      headers={COMPTABLE_LIST_HEADERS}
      minWidth="min-w-[1300px]"
      rowCount={rows.length}
      placeholder={placeholder}
      label="Rempli par l'agent bancaire (bureau comptable)"
    >
      {rows.map((n) => {
        const r = redevableOf(n);
        if (!n.comptable) {
          // Ready for the bank: taxateur and ordonnateur parts filled, payment not yet recorded.
          return (
            <tr key={n.id} className="bg-warn/5 hover:bg-warn/10 transition-premium align-top">
              <td className={`${pad(0, last)} py-3.5`}>
                <span className="block text-xs font-bold text-ink break-words">{r.name || '—'}</span>
                {r.nif && <span className="block text-[11px] font-mono text-muted mt-0.5 break-words">NIF {r.nif}</span>}
              </td>
              <td colSpan={last} className={`${pad(1, last)} py-3`}>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-warn/15 text-warn border border-warn/30 text-[11px] font-bold uppercase tracking-[0.08em]">
                    En attente de paiement
                  </span>
                  <span className="text-xs text-ink">
                    Note <span className="font-mono font-bold">{n.taxateur.numeroFacture}</span>
                  </span>
                  <span className="text-xs text-ink">
                    Montant <span className="font-bold tabular-nums">{formatMoney(n.taxateur.montantUSD)}</span>
                  </span>
                  {n.ordonnateur?.paiementAuPlusTardLe && (
                    <span className="text-xs text-muted">
                      À payer au plus tard le{' '}
                      <span className="font-mono text-ink">{frDay(n.ordonnateur.paiementAuPlusTardLe)}</span>
                    </span>
                  )}
                  {onFill && (
                    <button
                      type="button"
                      onClick={() => onFill(n)}
                      className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-accent text-white text-[12px] font-semibold hover:brightness-110 cursor-pointer transition-premium"
                    >
                      Remplir
                    </button>
                  )}
                </div>
              </td>
            </tr>
          );
        }
        const c = n.comptable;
        return (
          <tr key={n.id} className="hover:bg-surface2/30 transition-premium align-top">
            <td className={`${pad(0, last)} py-3.5`}>
              <span className="block text-xs font-bold text-ink break-words">{r.name || '—'}</span>
              {r.nif && <span className="block text-[11px] font-mono text-muted mt-0.5 break-words">NIF {r.nif}</span>}
            </td>
            <td className={`${pad(1, last)} py-3.5`}>
              <span className="block text-xs font-semibold text-ink break-words">{c.bureauComptable}</span>
            </td>
            <td className={`${pad(2, last)} py-3.5`}>
              <span className="block text-xs text-ink break-words">{c.modePaiement}</span>
            </td>
            <td className={`${pad(3, last)} py-3.5`}>
              <span className="block text-xs font-mono font-bold text-ink break-words">{c.quittanceNumero}</span>
            </td>
            <td className={`${pad(4, last)} py-3.5 text-right`}>
              <span className="text-xs font-bold text-ink tabular-nums whitespace-nowrap">
                {formatMoney(montantPaiementUSD(c))}
              </span>
            </td>
            <td className={`${pad(5, last)} py-3.5`}>
              <span className="block text-[13px] italic text-ink leading-snug">{montantPaiementEnLettres(c)}</span>
            </td>
            <td className={`${pad(6, last)} py-3.5`}>
              <span className="block text-xs font-semibold text-ink break-words">{c.nomComptable}</span>
            </td>
            <td className={`${pad(7, last)} py-3.5`}>
              <span className="text-xs font-mono text-ink tabular-nums whitespace-nowrap">{frDay(c.date)}</span>
            </td>
            {/* Paiement — confirmed once the comptable has filled in the note. */}
            <td className={`${pad(8, last)} py-3.5`}>
              {n.confirmation ? (
                <div className="min-w-0">
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[6px] bg-sage/12 text-sage text-[11px] font-bold uppercase tracking-wide">
                    <BadgeCheck className="w-3 h-3" />
                    Payé
                  </span>
                  <div className="text-[12px] font-mono text-ink truncate mt-1" title={n.confirmation.reference}>
                    Réf. {n.confirmation.reference}
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-faint mt-0.5">
                    <Lock className="w-2.5 h-2.5" />
                    {new Date(n.confirmation.confirmedAt).toLocaleDateString('fr-FR')}
                  </div>
                </div>
              ) : onConfirm ? (
                <button
                  type="button"
                  onClick={() => onConfirm(n)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-accent text-white text-[12px] font-semibold hover:brightness-110 cursor-pointer transition-premium whitespace-nowrap"
                >
                  <BadgeCheck className="w-3.5 h-3.5" />
                  Confirmer le paiement
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[6px] bg-warn/10 text-warn text-[11px] font-bold uppercase tracking-wide">
                  <Clock className="w-3 h-3" />
                  En attente
                </span>
              )}
            </td>
          </tr>
        );
      })}
    </SectionTable>
  );
};
