import React from 'react';
import { DepartementFinancesSeal } from '../DepartementFinancesSeal';
import { Panel } from '../ui';
import { Business } from '../../types';
import {
  dateTaxationOf,
  montantPaiementEnLettres,
  montantPaiementUSD,
  NotePerception,
} from '../../services/notePerceptionService';
import { formatMoney } from '../../utils/money';
import {
  BlankValues,
  ComptableBlankTable,
  frDay,
  IDENT_HEADINGS,
  identificationValues,
  OrdonnateurBlankTable,
  TaxateurBlankTable,
  VerticalBlankTable,
} from './NpSectionTables';

/*
 * The printed note de perception. Its top band is the one on the Impôt foncier
 * print document — the same masthead (titles and the Département des Finances
 * seal) far left and the same Identification du redevable table far right,
 * built from the same classes, so both documents print alike (see index.css,
 * .pp-compact). Given a saved note, every part the system records is filled
 * in; the ordonnateur's part prints blank. Kept off screen;
 * printNotePerception() prints a copy of it.
 */

/** A drawn signature, as saved by the signature pad. */
const Sig: React.FC<{ src?: string }> = ({ src }) =>
  src && src.startsWith('data:image') ? <img src={src} alt="Signature" className="max-h-[58px] max-w-[220px] object-contain" /> : null;

/** The mark against the payment mode used. */
const CHECK = '✓';

/**
 * Everything a saved note fills in on the printed form. The ordonnateur's part
 * is not recorded in the system, so it always prints blank.
 */
function printValues(note: NotePerception, taxpayer: Business | null, ville: string) {
  const t = note.taxateur;
  const ident = identificationValues(taxpayer, ville, { name: t.contribuableName, nif: t.contribuableNif });
  const taxateur: BlankValues = {
    'Numéro facture ou note de taxation (débit)': t.numeroFacture,
    'Article budgétaire': t.articleBudgetaire,
    "Nombre d'actes": String(t.nombreActes),
    'Arrêté numéro': t.arreteNumero,
    'Montant taxe : en chiffres': formatMoney(t.montantUSD),
    'Montant taxe en lettres': t.montantEnLettres,
    'Date de taxation': frDay(dateTaxationOf(note)),
    "Nom de l'agent taxateur": t.nomAgent,
    Qualité: t.qualite,
    Signature: <Sig src={t.signature} />,
  };
  // The ordonnateur's part, once filled in — like the taxateur's. The name goes
  // in the "Nom et signature" row; the signature itself is still by hand.
  const ordonnateur: BlankValues = {};
  const o = note.ordonnateur;
  if (o) {
    Object.assign(ordonnateur, {
      "Avis de l'ordonnateur": o.avis,
      'Montant ordonné en chiffres': formatMoney(o.montantOrdonneUSD),
      'Montant ordonné en lettres': o.montantOrdonneEnLettres,
      'Le paiement doit intervenir au plus tard le': frDay(o.paiementAuPlusTardLe),
      "Nom et signature de l'ordonnateur": o.nomOrdonnateur,
    });
  }
  const comptable: BlankValues = {};
  const c = note.comptable;
  if (c) {
    const mode = c.modePaiementId;
    const num = c.modePaiementNumero || '';
    Object.assign(comptable, {
      'Code ou désignation du bureau comptable': c.bureauComptable,
      'a) Espèces': mode === 'especes' ? CHECK : '',
      'b) Chèque bancaire': mode === 'cheque_bancaire' ? num : '',
      'b) Chèque bancaire|du': mode === 'cheque_bancaire' ? frDay(c.modePaiementDateCheque) : '',
      'b) Chèque bancaire|de la banque': mode === 'cheque_bancaire' ? c.modePaiementBanque || '' : '',
      'c) Chèque postal numéro': mode === 'cheque_postal' ? num : '',
      'd) Bordereau de versement (B)': mode === 'bordereau_versement' ? CHECK : '',
      'e) Avis de crédit numéro': mode === 'avis_credit' ? num : '',
      'Quittance numéro': c.quittanceNumero,
      'Quittance numéro|du': frDay(c.date),
      'Montant ordonné en chiffres': formatMoney(montantPaiementUSD(c)),
      'Montant ordonné en lettres (francs fiscaux)': montantPaiementEnLettres(c),
      'Nom du comptable': c.nomComptable,
      Signature: <Sig src={c.signature} />,
      Date: frDay(c.date),
    });
  }
  return { ident, taxateur, ordonnateur, comptable };
}

/**
 * The note to print — blank when none is given. `ville` is the taxpayer's ville
 * (stored on the record, or resolved from Settings → Adresse by the caller).
 */
export const NotePerceptionPrintSheet = React.forwardRef<
  HTMLDivElement,
  { note?: NotePerception | null; taxpayer?: Business | null; ville?: string }
>(({ note, taxpayer = null, ville = '' }, ref) => {
  const v = note ? printValues(note, taxpayer, ville) : null;
  return (
  <div ref={ref} className="space-y-6">
    {/* ---- Top of the document: masthead on the left, the taxpayer's
        identification on the right. ---- */}
    <div className="pp-top">
      <div className="pp-top-left">
        {/* Country name, with "Département des Finances" centred beneath it:
            the wrapper is exactly as wide as the country name. */}
        <div className="w-max flex flex-col items-center">
          <div className="text-sm font-bold uppercase tracking-[0.08em] text-ink leading-snug whitespace-nowrap">
            République Démocratique du Congo
          </div>
          <div className="text-xs font-semibold uppercase text-ink mt-1.5 whitespace-nowrap">Département des Finances</div>
        </div>
        {/* Sceau du Département des Finances, centred right above the CPF-NK
            line. That line is in capitals and wraps inside the masthead's width,
            so the identification table beside it keeps its room. */}
        <div className="w-full flex flex-col items-center mt-1.5">
          {/* The DF monogram in red, as on the IF / IRL declarations. */}
          <DepartementFinancesSeal className="w-[120px] h-[120px] text-ink" monogramColor="#D00000" />
          <div className="text-xs font-semibold uppercase text-ink mt-1.5 text-center">
            Coordination Provinciale des Finances du Nord-Kivu (CPF-NK)
          </div>
        </div>
        <div className="text-xs font-semibold text-ink mt-1.5 whitespace-nowrap">
          Direction Provinciale des Recettes du Nord-Kivu (DPR-NK)
        </div>
        {/* The document's title — set like "Déclaration de l'impôt foncier (IF)" on the foncier document. */}
        {/* Lowered at print time to the line of the last identification row (E-mail) — see printNotePerception. */}
        <div className="np-doc-title text-[12px] font-bold uppercase tracking-[0.08em] text-ink mt-2.5">Note de perception</div>
      </div>
      <div className="pp-top-right">
        <div data-np-document-code className="text-right text-[12px] font-bold text-ink mb-1" />
        {/* ---- 1. Identification du redevable ---- */}
        {/* Every table title of the printed note is numbered I) to IV) and in
            capitals (CSS, so it is still translated in English). */}
        <Panel title={<span className="uppercase">I) Identification du redevable</span>} padding="none">
          {/* Set vertically, like the taxateur's table below: one row per
              column of the Identification du redevable table in Enregistrement. */}
          <VerticalBlankTable headings={IDENT_HEADINGS} label="Identification du redevable" headingWidth="52%" values={v?.ident} />
        </Panel>
      </div>
    </div>

    {/* ---- 2. Remplir par le service taxateur — the note de perception table ---- */}
    <Panel title={<span className="uppercase">II) Remplir par le service taxateur</span>} padding="none">
      <TaxateurBlankTable values={v?.taxateur} />
    </Panel>

    {/* ---- 3. Remplir par l'ordonnateur ---- */}
    <Panel title={<span className="uppercase">III) Remplir par l'ordonnateur</span>} padding="none">
      <OrdonnateurBlankTable values={v?.ordonnateur} />
    </Panel>

    {/* ---- 4. Remplir par le comptable ---- */}
    <Panel title={<span className="uppercase">IV) Remplir par le comptable</span>} padding="none">
      <ComptableBlankTable values={v?.comptable} />
    </Panel>

    {/* ---- QR code, centred at the foot of the page. The code and its
        reference are filled in at print time (printNotePerception). ---- */}
    <div className="np-qr-block flex flex-col items-center text-center">
      <img className="np-qr w-[88px] h-[88px] block" alt="Code QR de la note de perception" />
      <div className="np-qr-ref text-[11px] font-mono font-semibold text-ink mt-0.5 tracking-[0.04em]" />
    </div>
  </div>
  );
});
NotePerceptionPrintSheet.displayName = 'NotePerceptionPrintSheet';
