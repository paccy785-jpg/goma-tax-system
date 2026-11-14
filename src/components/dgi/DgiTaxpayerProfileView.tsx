import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Printer } from 'lucide-react';
import { Button, PageHeader } from '../ui';
import { TaxpayerSearch } from '../transfer/TaxpayerSearch';
import { subscribeToBusinesses } from '../../services/dbService';
import { moisLabel, subscribeToDgiCalculsImpot, type DgiCalculImpot } from '../../services/dgiCalculImpotService';
import { impotTotalDuOf, subscribeToDgiDeclarations, type DgiDeclaration } from '../../services/dgiDeclarationService';
import { formatMontant } from './DgiCalculImpotView';
import { printOnePage } from '../../utils/printOnePage';
import { DepartementFinancesSeal } from '../DepartementFinancesSeal';
import type { Business } from '../../types';

/** The button that opens the document. */
const DOC_TITLE = 'IMPÔTS PROFESSIONNEL ET EXCEPTIONNEL SUR LES RÉMUNÉRATIONS';

/** The title printed on the document itself. */
const DOC_HEADING = 'DECLARATION MENSUELLE DES IMPÔTS PROFESSIONNEL ET EXCEPTIONNEL SUR LES RÉMUNÉRATIONS';

/** Width the document is laid out at, on screen and in the PDF. */
const LAYOUT_W = 860;

/** yyyy-mm-dd → dd/mm/yyyy, without going through a time zone. */
const frDay = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('/') : d || '—');

/** "—" for an empty value. */
const v = (x?: string | number | null) => (x === undefined || x === null || String(x).trim() === '' ? '—' : String(x));

/**
 * The Tax Payer Profile tab of the DGI portal: a search of the registered
 * taxpayers (the field carries no placeholder or hint text), the "Imprimer le
 * PDF" button, and the "IMPÔTS PROFESSIONNEL ET EXCEPTIONNEL SUR LES
 * RÉMUNÉRATIONS" button that opens that document for the taxpayer searched:
 *   I)   Identification du redevable — from the taxpayer's enrolment;
 *   II)  Déclaration — their Calcul d'impôt (Declarations tab);
 *   III) Partie comptable — their declarations filled in on the Accountant tab.
 */
export const DgiTaxpayerProfileView: React.FC = () => {
  const [taxpayers, setTaxpayers] = useState<Business[]>([]);
  const [calculs, setCalculs] = useState<DgiCalculImpot[]>([]);
  const [comptable, setComptable] = useState<DgiDeclaration[]>([]);
  const [selected, setSelected] = useState<Business | null>(null);
  const [showDoc, setShowDoc] = useState(false);
  const [calculId, setCalculId] = useState('');
  const [searchError, setSearchError] = useState('');
  const [printPending, setPrintPending] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Live: the registered taxpayers, their calculs d'impôt and accountant declarations.
  useEffect(() => subscribeToBusinesses((b) => setTaxpayers(b || [])), []);
  useEffect(() => subscribeToDgiCalculsImpot(setCalculs), []);
  useEffect(() => subscribeToDgiDeclarations(setComptable), []);

  // The taxpayer's own records, newest first (both lists arrive newest first).
  const mesCalculs = useMemo(
    () => (selected ? calculs.filter((c) => c.contribuableId === selected.id) : []),
    [calculs, selected],
  );
  const mesComptables = useMemo(
    () => (selected ? comptable.filter((d) => d.contribuableId === selected.id) : []),
    [comptable, selected],
  );
  // The declaration shown: the one chosen, else the most recent.
  const calcul = mesCalculs.find((c) => c.id === calculId) || mesCalculs[0] || null;

  const choose = (b: Business | null) => {
    setSelected(b);
    setCalculId('');
    setSearchError('');
    if (!b) setShowDoc(false);
  };

  const openDoc = () => {
    if (!selected) {
      setSearchError('Choisissez un contribuable.');
      return;
    }
    setShowDoc(true);
  };

  // Print once the document is on screen (it may have just been opened).
  const print = () => {
    if (!selected) {
      setSearchError('Choisissez un contribuable.');
      return;
    }
    setShowDoc(true);
    setPrintPending(true);
  };
  useEffect(() => {
    if (!printPending || !showDoc || !sheetRef.current) return;
    setPrintPending(false);
    const name = (selected?.businessName || 'Contribuable').trim();
    printOnePage(sheetRef.current, { layoutWidth: LAYOUT_W, title: `IPER — ${name}` });
  }, [printPending, showDoc, selected]);

  return (
    <div className="space-y-8 font-sans">
      <PageHeader title="Tax Payer Profile" />

      {/* The look of a Panel, without its overflow clipping: the search's list
          of taxpayers opens below the field and must show in full, over the
          page, instead of being cut off at the card's bottom edge. */}
      <section className="relative z-20 bg-surface border border-line rounded-[18px] shadow-[0_10px_30px_oklch(20%_0.03_260/0.07)] p-6">
        <div className="flex flex-col lg:flex-row lg:items-start gap-3">
          <div className="flex-1 min-w-0">
            <TaxpayerSearch
              id="dgi-profile-search"
              label="Rechercher un contribuable"
              hint=""
              taxpayers={taxpayers}
              value={selected}
              onChange={choose}
              error={searchError || undefined}
              showAllOnFocus
            />
          </div>
          {/* Level with the search field: below its label. */}
          <div className="flex flex-wrap items-center gap-2.5 shrink-0 lg:pt-[22px]">
            <Button variant="ghost" size="md" icon={<Printer className="w-4 h-4" />} onClick={print}>
              Imprimer le PDF
            </Button>
            <Button
              variant={showDoc ? 'primary' : 'navy'}
              size="md"
              icon={<FileText className="w-4 h-4" />}
              onClick={openDoc}
              aria-pressed={showDoc}
              className="text-xs tracking-wide"
            >
              <span data-no-i18n>{DOC_TITLE}</span>
            </Button>
          </div>
        </div>
      </section>

      {showDoc && selected && (
        <div className="space-y-3">
          {mesCalculs.length > 1 && (
            <div className="flex items-center gap-2.5">
              <label htmlFor="dgi-profile-calcul" className="text-xs font-semibold text-ink">
                Déclaration
              </label>
              <select
                id="dgi-profile-calcul"
                value={calcul?.id || ''}
                onChange={(e) => setCalculId(e.target.value)}
                className="px-3 py-1.5 bg-surface2 border border-line rounded-[10px] text-xs text-ink focus:border-accent focus:outline-none cursor-pointer"
              >
                {mesCalculs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {moisLabel(c.salairesMois)} {c.annee}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="overflow-x-auto scroll-x-visible">
            <IperSheet ref={sheetRef} taxpayer={selected} calcul={calcul} comptables={mesComptables} />
          </div>
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------------ */
/* The document                                                              */
/* ------------------------------------------------------------------------ */

const th = 'border border-ink/70 px-2 py-1.5 text-[10px] font-bold uppercase tracking-[0.04em] text-ink bg-surface2 text-left align-bottom';
const td = 'border border-ink/70 px-2 py-1.5 text-[11px] text-ink align-top';

/** "LABEL : value" on one line, above the identification table. */
const Pair: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-baseline gap-1.5">
    <span className="text-[10px] font-bold uppercase tracking-[0.04em] text-ink whitespace-nowrap">{label} :</span>
    <span className="text-[11px] text-ink tabular-nums">{value}</span>
  </div>
);

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="mt-5 mb-1.5 text-[12px] font-bold uppercase tracking-[0.06em] text-ink">{children}</h3>
);

/**
 * "IMPÔTS PROFESSIONNEL ET EXCEPTIONNEL SUR LES RÉMUNÉRATIONS" for one
 * taxpayer. Always in French (data-no-i18n), as an official document.
 */
const IperSheet = React.forwardRef<
  HTMLDivElement,
  { taxpayer: Business; calcul: DgiCalculImpot | null; comptables: DgiDeclaration[] }
>(({ taxpayer: t, calcul, comptables }, ref) => {
  // The payment this document attests: the one that settles the calculation
  // on it. The newest payment of the taxpayer may belong to another period,
  // and a document headed with one month and dated with another mixes two
  // fiscal periods.
  const documentPayment = useMemo(
    () => comptables.find((d) => !!calcul && d.calculId === calcul.id) || comptables[0] || null,
    [comptables, calcul]
  );
  const ident: [string, string][] = [
    // Two per row, left then right: Sigle sits right below Noms ou
    // dénomination sociale, in the left column.
    ['Nom ou Raison sociale', v(t.businessName)],
    // Numéro impôt — from the enrolment card (Registration).
    ['Numéro impôt', v(t.numeroImpot)],
    ['Sigle', v(t.sigle)],
    ['Numéro d’identification nationale', v(t.idNat)],
    ['Ville', v(t.ville)],
    ['Commune', v(t.commune)],
    ['Quartier', v(t.quartier)],
    ['Avenue', v(t.physicalAddress)],
    ['Téléphone', v(t.phoneNumber)],
    ['E-mail', v(t.email)],
  ];
  // Numéro de dépôt, Salaires du mois de and Année: out of the table, on one
  // line right above it.
  // Two label/value pairs per row.
  const identRows: [string, string][][] = [];
  for (let i = 0; i < ident.length; i += 2) identRows.push(ident.slice(i, i + 2));

  return (
    <div
      ref={ref}
      data-no-i18n
      className="bg-white text-ink border border-line rounded-[6px] p-8 font-sans mx-auto"
      style={{ width: LAYOUT_W }}
    >
      {/* Masthead — the same as on the Impôt foncier declaration (Tax Payer
          Profile print): country, Département des Finances, the seal with its
          red DF monogram, CPF-NK and DPR-NK, in one centred column. */}
      <div className="mx-auto w-max flex flex-col items-center text-center">
        <div className="text-sm font-bold uppercase tracking-[0.08em] text-ink leading-snug whitespace-nowrap">
          République Démocratique du Congo
        </div>
        <div className="text-xs font-semibold uppercase text-ink mt-1.5 whitespace-nowrap">Département des Finances</div>
        <div className="mt-1.5">
          <DepartementFinancesSeal className="w-[120px] h-[120px] text-ink" monogramColor="#D00000" />
        </div>
        <div className="text-xs font-semibold uppercase text-ink mt-1.5 whitespace-nowrap">
          Coordination Provinciale des Finances du Nord-Kivu (CPF-NK)
        </div>
        <div className="text-xs font-semibold text-ink mt-1.5 whitespace-nowrap">
          Direction Provinciale des Impôts/DPI-NK
        </div>
      </div>

      {/* Service (left) and Numéro de dépôt (right edge), on one line; the
          document's title right below them; then the 2px rule that closes the
          header, as on the foncier. */}
      <div className="mt-4 pb-2.5 border-b-2 border-ink">
        <div className="flex items-baseline justify-between gap-8">
          <Pair label="Service" value={v(t.service)} />
          <Pair label="Numéro de dépôt" value={v(t.numeroDepot)} />
        </div>
        <h2 className="mt-2.5 text-[12px] font-bold uppercase tracking-[0.08em] text-ink whitespace-nowrap">{DOC_HEADING}</h2>
      </div>

      {/* Salaires du mois de · Année — right above the Identification du
          redevable table: taken from the declaration being printed (II), so the
          period heading and the slip it introduces always match. */}
      <div className="mt-4 flex items-baseline gap-x-8">
        <Pair label="Salaires du mois de" value={calcul?.salairesMois ? moisLabel(calcul.salairesMois) : '—'} />
        <Pair label="Année" value={v(calcul?.annee)} />
      </div>

      {/* I) Identification du redevable */}
      <SectionTitle>I) Identification du redevable</SectionTitle>
      <table className="w-full border-collapse table-fixed">
        <colgroup>
          <col style={{ width: '22%' }} />
          <col style={{ width: '28%' }} />
          <col style={{ width: '22%' }} />
          <col style={{ width: '28%' }} />
        </colgroup>
        <tbody>
          {identRows.map((pair, i) => (
            <tr key={i}>
              {pair.map(([label, value]) => (
                <React.Fragment key={label}>
                  <th scope="row" className={th.replace('align-bottom', 'align-top')}>
                    {label}
                  </th>
                  <td className={`${td} break-words ${label === 'Nom ou Raison sociale' ? 'font-bold' : ''}`}>{value}</td>
                </React.Fragment>
              ))}
              {pair.length === 1 && <td colSpan={2} className={td} />}
            </tr>
          ))}
        </tbody>
      </table>

      {/* II) Déclaration */}
      <SectionTitle>II) Calcul de l’impôt</SectionTitle>
      {calcul ? (
        <>
          <table className="w-full border-collapse table-fixed">
            <colgroup>
              <col style={{ width: '20%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '14.4%' }} />
              <col style={{ width: '14.4%' }} />
              <col style={{ width: '14.4%' }} />
              <col style={{ width: '14.4%' }} />
              <col style={{ width: '14.4%' }} />
            </colgroup>
            <thead>
              <tr>
                <th className={th}>Catégorie salariale</th>
                <th className={`${th} text-right`}>Nombre</th>
                <th className={`${th} text-right`}>Rémunérations brutes</th>
                <th className={`${th} text-right`}>Rémunérations imposables</th>
                <th className={`${th} text-right`}>Montant I.P.R</th>
                <th className={`${th} text-right`}>Montant I.E.R</th>
                <th className={`${th} text-right`}>Impôt total dû</th>
              </tr>
            </thead>
            <tbody>
              {calcul.lignes.map((l, i) => (
                <tr key={i}>
                  <td className={td}>{l.categorie}</td>
                  <td className={`${td} text-right tabular-nums`}>{l.nombre}</td>
                  <td className={`${td} text-right tabular-nums`}>{formatMontant(l.remunerationsBrutes)}</td>
                  <td className={`${td} text-right tabular-nums`}>{formatMontant(l.remunerationsImposables)}</td>
                  <td className={`${td} text-right tabular-nums`}>{formatMontant(l.montantIpr)}</td>
                  <td className={`${td} text-right tabular-nums`}>{formatMontant(l.montantIer)}</td>
                  <td className={`${td} text-right tabular-nums font-bold`}>{formatMontant(l.impotTotalDu)}</td>
                </tr>
              ))}
            </tbody>
            {/* Montant total à payer — the sum of the "Impôt total dû" column,
                per currency (USD and CDF are never added together). */}
            <tfoot>
              <tr>
                <th colSpan={6} scope="row" className={`${th} text-right align-middle`}>
                  Montant total à payer
                </th>
                <td className={`${td} bg-surface2 text-right tabular-nums font-bold whitespace-nowrap align-middle`}>
                  {impotTotalDuOf(calcul).length === 0 ? (
                    '—'
                  ) : (
                    <span className="inline-flex flex-col items-end gap-0.5">
                      {impotTotalDuOf(calcul).map((m) => (
                        <span key={m.devise}>{formatMontant(m)}</span>
                      ))}
                    </span>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </>
      ) : (
        <div className={`${td} border text-center text-muted py-3`}>Aucune déclaration enregistrée pour ce contribuable.</div>
      )}

      {/* Mode de paiement — taken out of the Réservé à l'administration table
          and set right below the Calcul de l'impôt table: the mode(s) of the
          payments the accountant recorded for this taxpayer. */}
      <SectionTitle>III) Mode de paiement</SectionTitle>
      <table className="w-full border-collapse table-fixed">
        <colgroup>
          {/* Label as wide as the Identification table's label column. */}
          <col style={{ width: '22%' }} />
          <col style={{ width: '78%' }} />
        </colgroup>
        <tbody>
          <tr>
            <th scope="row" className={th.replace('align-bottom', 'align-middle')}>
              Mode de paiement
            </th>
            <td className={`${td} align-middle`}>
              {v([...new Set(comptables.map((d) => d.modePaiement).filter(Boolean))].join(', '))}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Place / date, then the signatory — centred, as on the Impôt foncier
          declaration — right above "Réservé à l'administration", with room
          between the two lines to sign. */}
      <div className="mt-6 flex flex-col items-center">
        {/* The date fills itself in: the Date of the accountant's latest
            payment for this taxpayer (it is not in the table below). */}
        <div className="text-xs font-semibold text-ink whitespace-nowrap">
          {/* The place is always Goma. */}
          Fait à Goma, le{' '}
          {documentPayment?.date && /^\d{4}-\d{2}-\d{2}$/.test(documentPayment.date) ? (
            <span className="tabular-nums">{frDay(documentPayment.date)}</span>
          ) : (
            '......./........./20.'
          )}
        </div>
      </div>
      {/* "Nom et qualité du signataire" still centred; "Signature" on the same
          line, at the right edge of the page. */}
      <div className="mt-8 grid grid-cols-[1fr_auto_1fr] items-baseline gap-x-6">
        <div className="text-xs font-semibold text-ink whitespace-nowrap col-start-2">Nom et qualité du signataire</div>
        <div className="text-xs font-semibold text-ink whitespace-nowrap justify-self-end">Signature</div>
        {/* The Qualité of whoever completed the document (the accountant's
            latest payment for this taxpayer), right below the label — it is
            not in the table below. */}
        {documentPayment?.qualite?.trim() && (
          <div className="col-start-2 justify-self-center text-xs font-bold text-ink whitespace-nowrap mt-1">
            {documentPayment.qualite.trim()}
          </div>
        )}
      </div>

      {/* IV) Réservé à l'administration */}
      <div className="mt-8" />
      <SectionTitle>IV) Réservé à l’administration</SectionTitle>
      <table className="w-full border-collapse table-fixed">
        <colgroup>
          <col style={{ width: '33%' }} />
          <col style={{ width: '33%' }} />
          <col style={{ width: '34%' }} />
        </colgroup>
        <thead>
          <tr>
            <th className={th}>Numéro de la quittance</th>
            <th className={th}>Date de la quittance</th>
            {/* Left empty on screen and in print: room for the stamp. */}
            <th className={th}>Cachet de l’Administration</th>
          </tr>
        </thead>
        <tbody>
          {comptables.length === 0 ? (
            <tr>
              <td colSpan={3} className={`${td} text-center text-muted py-3`}>
                Aucune déclaration remplie par le comptable pour ce contribuable.
              </td>
            </tr>
          ) : (
            comptables.map((d) => (
              <tr key={d.id}>
                <td className={`${td} tabular-nums break-words`}>{v(d.numeroQuittance)}</td>
                <td className={`${td} tabular-nums whitespace-nowrap`}>{frDay(d.dateQuittance)}</td>
                <td className={`${td} h-16`} />
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* The office's address — at the bottom of every document printed from
          this tab, always the same. */}
      <div className="mt-6 pt-2.5 border-t border-ink/60 text-center text-[10px] leading-relaxed text-ink">
        <div>
          Adresse ∶ 005, Av. du Port, Commune de Goma, Rond-Point Tshukudu, Bâtiment Jeanpy BACHU, Route Stade les
          Volcans.
        </div>
        <div>Email. cpfdiptaxnk@gmail.com Tel. +243 847 636 930, +243 812 238 766.</div>
      </div>
    </div>
  );
});
IperSheet.displayName = 'IperSheet';
