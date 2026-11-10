import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, UserRound, Home, Printer } from 'lucide-react';
import {
  AddressRegistry,
  Business,
  natureCode,
  natureDisplay,
  PropertyParcel,
  RentalLease,
  UserRole,
} from '../types';
import { subscribeToBusinesses } from '../services/dbService';
import { subscribeToParcelsByOwner } from '../services/parcelService';
import { subscribeToLeases } from '../services/leaseService';
import { subscribeToAddressRegistry } from '../services/addressService';
import { grossRevenueUSD, monthsLetInExercise, shortDate } from '../services/rentalService';
import { formatMoney } from '../utils/money';
import { subscribeToTaxCalculations, TaxCalculation } from '../services/taxCalculationService';
import { FoncierCalculation, subscribeToFoncierCalculations } from '../services/foncierCalculationService';
import {
  FoncierCalcTable,
  FoncierCalcPrintTable,
  LocatifCalcTable,
  LocatifCalcVerticalTable,
} from './declarations/CalcTables';
import {
  BankConfirmation,
  confirmationId,
  subscribeToBankConfirmations,
} from '../services/bankConfirmationService';
import { Button, Panel } from './ui';
import { DepartementFinancesSeal } from './DepartementFinancesSeal';
import { IDENT_HEADINGS, identificationValues, VerticalBlankTable } from './notePerception/NpSectionTables';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { issueCpfDocumentCode } from '../services/declarationDocumentCode';

/**
 * The smallest a printed declaration is ever scaled to fit one page. Below it
 * the text would be too small to read, so a longer declaration continues on a
 * second page instead.
 */
const MIN_PRINT_ZOOM = 0.7;

/** First fiscal year offered by the Exercice fiscal picker. */
const FIRST_EXERCICE = 2025;
/** Years offered going forward: 2025 up to five years past the current one. */
const EXERCICE_YEARS = Array.from(
  { length: new Date().getFullYear() + 5 - FIRST_EXERCICE + 1 },
  (_, i) => FIRST_EXERCICE + i
);

/**
 * Tax Payer Profile — one taxpayer's whole file on one page.
 *
 * Search a name or NIF and the three Registration tables fill with what is
 * already on record for that taxpayer: their identification, the properties
 * declared in their name, and the tenancies on those properties. Read-only —
 * entries are made in Registration; this page brings them together.
 */

const TH = 'text-[11px] font-bold uppercase tracking-[0.07em] leading-tight text-faint px-3 py-3.5 align-middle';
const TD = 'px-3 py-3.5 align-middle text-xs text-ink';

const Cell: React.FC<{ v?: string; mono?: boolean; className?: string }> = ({ v, mono, className = '' }) => (
  <span className={`block truncate ${mono ? 'font-mono tabular-nums' : ''} ${className}`} title={v || undefined}>
    {v || '—'}
  </span>
);

/** An empty table keeps its headers, with one quiet line where rows will go. */
const EmptyRow: React.FC<{ cols: number; text: string }> = ({ cols, text }) => (
  <tr>
    <td colSpan={cols} className="px-6 py-8 text-center text-[12px] text-muted">
      {text}
    </td>
  </tr>
);

export const TaxpayerProfileView: React.FC<{ userRole: UserRole }> = () => {
  const [taxpayers, setTaxpayers] = useState<Business[]>([]);
  const [leases, setLeases] = useState<RentalLease[]>([]);
  const [addressRegistry, setAddressRegistry] = useState<AddressRegistry | null>(null);
  const [selected, setSelected] = useState<Business | null>(null);
  const [parcels, setParcels] = useState<PropertyParcel[]>([]);
  const [parcelsLoading, setParcelsLoading] = useState(false);

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => subscribeToBusinesses((d) => setTaxpayers(d || []), undefined, 1000), []);
  useEffect(() => subscribeToLeases((d) => setLeases(d || []), undefined, 1000), []);
  useEffect(() => subscribeToAddressRegistry(setAddressRegistry), []);

  // Saved tax calculations, from both Declarations subtabs.
  const [foncierCalcs, setFoncierCalcs] = useState<FoncierCalculation[]>([]);
  const [locatifCalcs, setLocatifCalcs] = useState<TaxCalculation[]>([]);
  useEffect(() => subscribeToFoncierCalculations((d) => setFoncierCalcs(d || [])), []);
  useEffect(() => subscribeToTaxCalculations((d) => setLocatifCalcs(d || [])), []);
  // Bank Agent confirmations — they fill the "Réservé à l'administration" box.
  const [confirmations, setConfirmations] = useState<BankConfirmation[]>([]);
  useEffect(() => subscribeToBankConfirmations((d) => setConfirmations(d || [])), []);

  // The selected taxpayer's declared properties, read on demand (uncapped).
  useEffect(() => {
    if (!selected) {
      setParcels([]);
      return;
    }
    setParcelsLoading(true);
    return subscribeToParcelsByOwner(
      selected.id,
      (d) => {
        setParcels(d || []);
        setParcelsLoading(false);
      },
      () => setParcelsLoading(false)
    );
  }, [selected]);

  // Keep the selected record live if it is edited in Registration.
  useEffect(() => {
    if (!selected) return;
    const fresh = taxpayers.find((t) => t.id === selected.id);
    if (fresh && fresh !== selected) setSelected(fresh);
  }, [taxpayers, selected]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  /** Same ville resolution as the Registration roll: the ville holding the commune. */
  const villeOf = useCallback(
    (t: Business): string => {
      // Picked on the enrolment card since its address became dropdowns.
      if (t.ville && t.ville.trim()) return t.ville.trim();
      const commune = (t.commune || '').trim().toLowerCase();
      if (!commune) return '';
      const villes = addressRegistry?.villes || [];
      const candidates = villes.filter((v) => v.communes.some((c) => c.name.trim().toLowerCase() === commune));
      if (candidates.length === 1) return candidates[0].name;
      if (candidates.length === 0) return '';
      const quartier = (t.quartier || '').trim().toLowerCase();
      const narrowed = candidates.filter((v) =>
        v.communes.some(
          (c) =>
            c.name.trim().toLowerCase() === commune &&
            c.quartiers.some((q) => q.name.trim().toLowerCase() === quartier)
        )
      );
      return narrowed.length === 1 ? narrowed[0].name : '';
    },
    [addressRegistry]
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || (selected && query === selected.businessName)) return [];
    const tokens = q.split(/\s+/);
    return taxpayers
      .filter((b) => {
        const hay = [b.businessName, b.ownerFullName, b.nif, b.nationalIdOrRccm].join(' ').toLowerCase();
        return tokens.every((t) => hay.includes(t));
      })
      .sort((a, b) => (a.businessName || '').localeCompare(b.businessName || ''))
      .slice(0, 30);
  }, [query, taxpayers, selected]);
  const showList = open && query.trim().length > 0 && !(selected && query === selected.businessName);

  const choose = (b: Business) => {
    setSelected(b);
    setQuery(b.businessName || '');
    setOpen(false);
    setHi(0);
  };
  const clear = () => {
    setSelected(null);
    setQuery('');
    setHi(0);
  };

  /**
   * Tenancies of this taxpayer: as bailleur — the leases on their properties —
   * and, when their name is on a lease, as locataire.
   */
  const leaseRows = useMemo(() => {
    if (!selected) return [];
    const name = (selected.businessName || '').trim().toLowerCase();
    const parcelIds = new Set(parcels.map((p) => p.id));
    return leases
      .map((l) => {
        const asBailleur = l.bailleurId === selected.id || parcelIds.has(l.parcelId);
        const asLocataire = !!name && (l.tenantNames || []).some((n) => n.trim().toLowerCase() === name);
        return asBailleur || asLocataire ? { lease: l, role: asBailleur ? 'Bailleur' : 'Locataire' } : null;
      })
      .filter((x): x is { lease: RentalLease; role: string } => !!x);
  }, [selected, leases, parcels]);
  const parcelById = useMemo(() => new Map(parcels.map((p) => [p.id, p])), [parcels]);

  /** Foncier slips filed for this taxpayer as bailleur. */
  const myFonciers = useMemo(
    () => (selected ? foncierCalcs.filter((c) => c.bailleurId === selected.id) : []),
    [selected, foncierCalcs]
  );
  /**
   * Locatif slips that concern this taxpayer: filed in their name (as
   * bailleur or locataire), or filed by a bailleur on their behalf.
   */
  const { myLocatifs, locatifVia } = useMemo(() => {
    const via = new Map<string, string>();
    if (!selected) return { myLocatifs: [] as TaxCalculation[], locatifVia: via };
    const name = (selected.businessName || '').trim().toLowerCase();
    const rows = locatifCalcs.filter((c) => {
      if (c.contribuableType === 'bailleur' && c.contribuableRefId === selected.id) return true;
      if ((c.contribuableName || '').trim().toLowerCase() === name && name) return true;
      const forMe = (c.locataires || []).some((l) => l.name.trim().toLowerCase() === name);
      if (forMe && name) {
        via.set(c.id, `locataire ${selected.businessName}`);
        return true;
      }
      return false;
    });
    return { myLocatifs: rows, locatifVia: via };
  }, [selected, locatifCalcs]);

  const emptyText = 'Recherchez un contribuable par nom ou NIF pour afficher ses informations.';

  /**
   * Type de déclaration — narrows the file to one tax:
   *   Impôt foncier  → identification, propriétés, calculs fonciers;
   *   Impôt locatif  → identification, baux, calculs locatifs.
   * With neither chosen, the whole file shows. Clicking the active choice
   * again clears it.
   */
  const [declType, setDeclType] = useState<'foncier' | 'locatif' | null>(null);
  const showFoncierTables = declType !== 'locatif';
  const showLocatifTables = declType !== 'foncier';
  /** The Impôt foncier print document. */
  const isFoncierDoc = declType === 'foncier';

  /**
   * Payments the bank has confirmed for the calculations on this document —
   * one line each in "Réservé à l'administration", oldest first. Follows the
   * Type de déclaration: a foncier document lists foncier payments only.
   */
  const paidLines = useMemo(() => {
    const byId = new Map(confirmations.map((c) => [c.id, c]));
    const ids = [
      ...(showFoncierTables ? myFonciers.map((c) => confirmationId('foncier', c.id)) : []),
      ...(showLocatifTables ? myLocatifs.map((c) => confirmationId('locatif', c.id)) : []),
    ];
    return ids
      .map((id) => byId.get(id))
      .filter((c): c is BankConfirmation => !!c)
      .sort((a, b) => a.confirmedAt.localeCompare(b.confirmedAt));
  }, [confirmations, myFonciers, myLocatifs, showFoncierTables, showLocatifTables]);

  /**
   * Print the taxpayer's file: the five tables, under a document heading, on
   * landscape A4. Only this page's file is printed — the app's navigation and
   * the search bar are left out. The landscape rule is added for this print
   * alone, so receipts and certificates keep their own page size.
   */
  const printRef = useRef<HTMLDivElement>(null);
  const { userProfile } = useAuth();
  const { showToast } = useToast();
  /** A document number is being reserved for the print. */
  const [printing, setPrinting] = useState(false);
  /**
   * Print the file on one A4 landscape sheet.
   *
   * A copy of the file is laid out on its own, at the paper's width and in the
   * compact print layout, so the rest of the app can never add blank pages.
   * It is measured and scaled to fit one page — but never below MIN_PRINT_ZOOM,
   * so the text stays readable. Only a declaration with a lot of properties,
   * leases or calculations goes past that limit, and it then continues on a
   * second page at that size.
   */
  const printFile = async () => {
    if (!selected || !printRef.current || printing) return;

    // An Impôt foncier or Impôt locatif declaration is a numbered document,
    // written at the top right of the page, right above the Identification du
    // redevable table. The same document (same taxpayer, same declaration,
    // same exercice fiscal) always prints with the same CPF number; a new
    // document takes the next one. Nothing is printed without its number.
    let code = '';
    if (declType) {
      setPrinting(true);
      try {
        code = await issueCpfDocumentCode(
          {
            declType,
            taxpayerId: selected.id,
            taxpayerName: selected.businessName,
            nif: selected.nif || undefined,
            exercice,
          },
          userProfile ? { uid: userProfile.uid, displayName: userProfile.displayName, role: userProfile.role } : null
        );
      } catch {
        showToast(
          'Le numéro du document n’a pas pu être attribué. Vérifiez la connexion, puis réessayez.',
          'error',
          'Impression annulée'
        );
        return;
      } finally {
        setPrinting(false);
      }
      if (!printRef.current) return;
    }

    // Printable area of a landscape page with 10 mm margins, sized to fit BOTH
    // A4 (277 × 190 mm) and US Letter (259 × 196 mm) — the printer or "Save as
    // PDF" may use either, so the file is laid out for the smaller of the two:
    // 259 × 190 mm, in CSS px. On A4 it simply sits centred with a little more
    // margin.
    const mm = (v: number) => Math.floor((v * 96) / 25.4);
    const PAGE_W = mm(259) - 8;
    const PAGE_H = mm(190) - 16;

    document.getElementById('pp-sheet')?.remove();
    const sheet = printRef.current.cloneNode(true) as HTMLElement;
    sheet.id = 'pp-sheet';
    sheet.classList.add('pp-compact');
    const codeSlot = sheet.querySelector('[data-cpf-code]');
    if (codeSlot) codeSlot.textContent = code;
    sheet.style.cssText = `position:absolute;left:-20000px;top:0;width:${PAGE_W}px;`;
    document.body.appendChild(sheet);
    const zoom = Math.max(MIN_PRINT_ZOOM, Math.min(1, PAGE_H / Math.max(1, sheet.scrollHeight)));
    sheet.style.cssText = `width:${PAGE_W}px;`;

    const page = document.createElement('style');
    page.setAttribute('data-profile-print', '');
    // The page is given as explicit A4 landscape dimensions rather than the
    // "landscape" keyword: with the keyword, the PDF can come out as an A4
    // portrait page with the document turned sideways on it (as macOS Preview
    // showed it). 297 × 210 mm is a landscape sheet in its own right.
    page.textContent = `@page { size: 297mm 210mm; margin: 10mm; }
      #pp-sheet { display: none; }
      @media print {
        html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
        body.print-profile > *:not(#pp-sheet) { display: none !important; }
        body.print-profile #pp-sheet {
          display: block !important;
          width: ${PAGE_W}px !important;
          max-width: ${PAGE_W}px !important;
          margin: 0 auto !important;
          zoom: ${zoom};
        }
        body.print-profile #pp-sheet table { width: 100% !important; }
      }`;
    document.head.appendChild(page);
    document.body.classList.add('print-profile');
    // The browser prints the page title in the page header: show CPF there.
    const prevTitle = document.title;
    document.title = 'CPF';

    const done = () => {
      document.title = prevTitle;
      document.body.classList.remove('print-profile');
      sheet.remove();
      page.remove();
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
  };
  /**
   * Exercice fiscal of the document — printed under the declaration title, and
   * the year the lease table counts months and revenu brut for.
   */
  const [exercice, setExercice] = useState<number>(
    Math.max(FIRST_EXERCICE, new Date().getFullYear())
  );

  return (
    <div ref={printRef} className="space-y-6 profile-print">
      {/* ---- Search and print ---- */}
      <div className="flex flex-wrap items-start gap-3 print:hidden">
      <div ref={box} className="relative max-w-xl flex-1 min-w-[280px]">
        <Search className="w-4 h-4 absolute left-3.5 top-[22px] -translate-y-1/2 text-faint pointer-events-none" />
        <input
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-autocomplete="list"
          autoComplete="off"
          autoFocus
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setHi(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              if (showList) setOpen(false);
              else clear();
              return;
            }
            if (!showList || matches.length === 0) return;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const n = matches.length;
              setHi((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              choose(matches[hi] ?? matches[0]);
            }
          }}
          aria-label="Rechercher un contribuable par nom ou NIF"
          className={`w-full h-11 pl-10 pr-10 rounded-[12px] border border-line bg-surface text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none transition-premium shadow-xs ${
            selected ? 'font-semibold' : ''
          }`}
        />
        {query && (
          <button
            type="button"
            onClick={clear}
            aria-label="Effacer la recherche"
            className="absolute right-2.5 top-[22px] -translate-y-1/2 p-1 rounded-md text-muted hover:text-ink hover:bg-surface2 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        {showList && (
          <ul
            role="listbox"
            className="absolute z-30 left-0 right-0 mt-1.5 max-h-72 overflow-y-auto rounded-[12px] border border-line bg-surface shadow-2xl py-1.5"
          >
            {matches.length === 0 ? (
              <li className="px-3.5 py-2.5 text-[12px] text-muted">
                Aucun contribuable ne correspond à <span className="font-semibold text-ink">« {query.trim()} »</span>.
              </li>
            ) : (
              matches.map((b, i) => (
                <li key={b.id} role="option" aria-selected={i === hi}>
                  <button
                    type="button"
                    onMouseEnter={() => setHi(i)}
                    onClick={() => choose(b)}
                    className={`w-full text-left px-3.5 py-2 cursor-pointer ${i === hi ? 'bg-accent-soft' : ''}`}
                  >
                    <span className="block text-xs font-semibold text-ink truncate">{b.businessName}</span>
                    <span className="block text-[11px] text-muted truncate mt-0.5">
                      {[b.nif ? `NIF ${b.nif}` : 'NIF en attente', [b.quartier, b.commune].filter(Boolean).join(', ')]
                        .filter(Boolean)
                        .join(' • ')}
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
        {selected && (
          <p className="text-[12px] text-muted mt-1.5 flex items-center gap-1.5">
            <UserRound className="w-3.5 h-3.5 text-accent" />
            Dossier de <strong className="text-ink">{selected.businessName}</strong>
            {selected.nif ? ` — NIF ${selected.nif}` : ''}
          </p>
        )}
      </div>

      <Button
        variant="primary"
        size="lg"
        icon={<Printer className="w-4 h-4" />}
        onClick={printFile}
        disabled={!selected || printing}
        title={selected ? `Imprimer le dossier de ${selected.businessName}` : 'Recherchez d’abord un contribuable'}
        className="shrink-0 h-11"
      >
        Imprimer le dossier
      </Button>

      <div className="shrink-0">
        <div
          role="radiogroup"
          aria-label="Type de déclaration"
          className="inline-flex items-center gap-1 p-1 h-11 rounded-[12px] bg-surface2 border border-line"
        >
          <span className="px-2 text-[11px] font-bold uppercase tracking-[0.08em] text-muted whitespace-nowrap">
            Type de déclaration
          </span>
          {([
            ['foncier', 'Impôt foncier'],
            ['locatif', 'Impôt locatif'],
          ] as const).map(([id, label]) => {
            const on = declType === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setDeclType(on ? null : id)}
                title={on ? 'Cliquez à nouveau pour afficher tout le dossier' : undefined}
                className={`h-full px-3.5 rounded-[9px] text-xs font-semibold whitespace-nowrap transition-premium cursor-pointer ${
                  on
                    ? 'bg-surface text-accent shadow-[0_2px_8px_oklch(20%_0.03_260/0.08)] border border-accent/20'
                    : 'text-muted hover:text-ink border border-transparent'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <label className="shrink-0 inline-flex items-center gap-2 h-11 pl-3 pr-1 rounded-[12px] bg-surface2 border border-line">
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted whitespace-nowrap">
          Exercice fiscal
        </span>
        <select
          value={exercice}
          onChange={(e) => setExercice(Number(e.target.value))}
          aria-label="Exercice fiscal"
          className="h-9 pl-2.5 pr-7 rounded-[9px] bg-surface border border-line text-xs font-semibold text-ink tabular-nums focus:border-accent focus:outline-none cursor-pointer"
        >
          {EXERCICE_YEARS.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      </div>

      {/* ---- Top of the document: masthead on the left, the taxpayer's
          identification on the right. On screen only the table shows. ---- */}
      <div className="pp-top">
        {selected && (
          <div className="hidden pp-top-left">
            {/* Country name, with "Département des Finances" centred beneath it:
                the wrapper is exactly as wide as the country name. */}
            <div className="w-max flex flex-col items-center">
              <div className="text-sm font-bold uppercase tracking-[0.08em] text-ink leading-snug whitespace-nowrap">
                République Démocratique du Congo
              </div>
              <div className="text-xs font-semibold text-ink mt-1.5 whitespace-nowrap">Département des Finances</div>
            </div>
            {/* Sceau du Département des Finances — centred right above the CPF-NK
                line: the wrapper is exactly as wide as that line. */}
            <div className="w-max flex flex-col items-center mt-1.5">
              <DepartementFinancesSeal className="w-[48px] h-[48px] text-ink" />
              <div className="text-xs font-semibold text-ink mt-1.5 whitespace-nowrap">
                Coordination Provinciale des Finances du Nord-Kivu (CPF-NK)
              </div>
            </div>
            <div className="text-xs font-semibold text-ink mt-1.5 whitespace-nowrap">Direction Provinciale des Recettes du Nord-Kivu (DPR-NK)</div>
            {/* The title may wrap: the masthead is as wide as its longest fixed
                line (CPF-NK), leaving the identification table room to breathe. */}
            <div className="text-[12px] font-bold uppercase tracking-[0.08em] text-ink mt-2.5">
              {declType === 'foncier'
                ? 'Déclaration de l’impôt foncier (IF)'
                : 'Déclaration de l’impôt sur les revenus locatifs (IRL)'}
            </div>
            <div className="text-[12px] font-semibold text-ink mt-1">Exercice fiscal : {exercice}</div>
          </div>
        )}
        <div className="pp-top-right">
      {/* Document number (CPF…) of the printed Impôt foncier / Impôt locatif
          declaration — top right of the page, right above the Identification
          du redevable table. Filled in on the printed copy by printFile. */}
      {selected && declType && (
        <div data-cpf-code className="hidden pp-printonly pp-doc-code" />
      )}
      {/* ---- 1. Identification du redevable ---- */}
      <Panel
        // On the printed Impôt foncier declaration this table is titled
        // "I) Identification du redevable" (with "II) Identification des
        // propriétés" below it); on screen it stays "Identification du redevable".
        title={
          isFoncierDoc ? (
            <>
              <span className="pp-noprint">Identification du redevable</span>
              <span className="hidden pp-printonly">I) Identification du redevable</span>
            </>
          ) : (
            'Identification du redevable'
          )
        }
        subtitle={selected ? '1 contribuable' : 'Aucun contribuable sélectionné'}
        padding="none"
      >
        {/* On screen: the table across. Printed: the same columns set vertically (below). */}
        {/* Twelve columns, each wide enough for its heading and its value:
            the card scrolls sideways (visible scrollbar) rather than squeezing them. */}
        <div className="w-full overflow-x-auto scroll-x-visible pp-noprint">
          <table className="w-full min-w-[1830px] table-fixed text-left border-collapse font-sans">
            <thead>
              <tr className="border-b border-line bg-surface2/50">
                {/* The columns of the Identification du redevable table in
                    Enregistrement, in its order. */}
                <th className={`${TH} w-[130px] pl-6`}>NIF</th>
                <th className={`${TH} w-[220px]`}>Noms ou dénomination sociale</th>
                <th className={`${TH} w-[110px]`}>Sigle</th>
                <th className={`${TH} w-[190px]`}>Numéro d'identification nationale</th>
                <th className={`${TH} w-[110px]`}>Ville</th>
                <th className={`${TH} w-[120px]`}>Commune</th>
                <th className={`${TH} w-[130px]`}>Quartier</th>
                <th className={`${TH} w-[150px]`}>Avenue</th>
                <th className={`${TH} w-[130px]`}>Numéro de parcelle</th>
                <th className={`${TH} w-[170px]`}>Téléphone</th>
                <th className={`${TH} w-[240px]`}>Email</th>
                <th className={`${TH} w-[180px] pr-6`}>Forme juridique</th>
              </tr>
            </thead>
            <tbody>
              {!selected ? (
                <EmptyRow cols={12} text={emptyText} />
              ) : (
                <tr>
                  <td className={`${TD} pl-6`}>
                    {selected.nif ? (
                      <Cell v={selected.nif} mono />
                    ) : (
                      <>
                        <Cell v={selected.nationalIdOrRccm} mono />
                        <span className="text-[11px] font-bold uppercase text-warn tracking-wider">NIF en attente</span>
                      </>
                    )}
                  </td>
                  <td className={TD}>
                    <Cell v={selected.businessName} className="font-bold" />
                  </td>
                  <td className={TD}>
                    <Cell v={selected.sigle} />
                  </td>
                  <td className={TD}>
                    <Cell v={selected.idNat} mono />
                  </td>
                  <td className={TD}>
                    <Cell v={villeOf(selected)} />
                  </td>
                  <td className={TD}>
                    <Cell v={selected.commune} />
                  </td>
                  <td className={TD}>
                    <Cell v={selected.quartier} />
                  </td>
                  <td className={TD}>
                    <Cell v={selected.physicalAddress} />
                  </td>
                  <td className={TD}>
                    <Cell v={selected.numeroParcelle} mono />
                  </td>
                  <td className={TD}>
                    <Cell
                      v={selected.phoneNumber && selected.phoneNumber.trim() !== '+243' ? selected.phoneNumber : ''}
                      mono
                    />
                  </td>
                  <td className={TD}>
                    <Cell v={selected.email} className="[overflow-wrap:anywhere]" />
                  </td>
                  <td className={`${TD} pr-6`}>
                    <Cell v={selected.taxpayerType} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {/* Printed declarations: Identification du redevable set vertically,
            like on the note de perception — one row per column above. */}
        {selected && (
          <div className="hidden pp-printonly">
            <VerticalBlankTable
              headings={IDENT_HEADINGS}
              label="Identification du redevable"
              headingWidth="52%"
              values={identificationValues(selected, villeOf(selected))}
            />
          </div>
        )}
      </Panel>
        </div>
      </div>

      {showFoncierTables && (
      <>
      {/* ---- 2. Identification des propriétés ---- */}
      <Panel
        title="Identification des Propriétés"
        // Shown on screen, but left off the Impôt foncier print document.
        className={isFoncierDoc ? 'pp-noprint' : ''}
        subtitle={
          !selected
            ? 'Aucun contribuable sélectionné'
            : parcelsLoading
              ? 'Chargement…'
              : `${parcels.length} propriété${parcels.length === 1 ? '' : 's'} déclarée${parcels.length === 1 ? '' : 's'}`
        }
        padding="none"
      >
        <div className="w-full overflow-x-auto">
          <table className="w-full table-fixed text-left border-collapse font-sans">
            <thead>
              <tr className="border-b border-line bg-surface2/50">
                <th className={`${TH} w-[12%] pl-6`}>Nature</th>
                <th className={`${TH} w-[13%]`}>Ville/territoire</th>
                <th className={`${TH} w-[17%]`}>Commune/chefferie</th>
                <th className={`${TH} w-[20%]`}>Quartier/groupement</th>
                <th className={`${TH} w-[20%]`}>Avenue/Localité</th>
                <th className={`${TH} w-[18%] pr-6 text-center`}>Numéro de parcelle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {!selected ? (
                <EmptyRow cols={6} text={emptyText} />
              ) : parcelsLoading ? (
                <EmptyRow cols={6} text="Chargement des propriétés déclarées…" />
              ) : parcels.length === 0 ? (
                <EmptyRow cols={6} text={`Aucune propriété n’est déclarée au nom de ${selected.businessName}.`} />
              ) : (
                parcels.map((p) => (
                  <tr key={p.id} className="hover:bg-surface2/30 transition-premium">
                    <td className={`${TD} pl-6`}>
                      <span className="flex items-center gap-1.5 min-w-0" title={natureDisplay(p.nature)}>
                        <span className="w-5 h-5 rounded-[6px] bg-accent-soft text-accent flex items-center justify-center shrink-0">
                          <Home className="w-3 h-3" />
                        </span>
                        <span className="font-mono font-bold truncate">{natureCode(p.nature)}</span>
                      </span>
                    </td>
                    <td className={TD}>
                      <Cell v={p.villeTerritoire} />
                    </td>
                    <td className={TD}>
                      <Cell v={p.communeChefferie} />
                    </td>
                    <td className={TD}>
                      <Cell v={p.quartierGroupement} />
                    </td>
                    <td className={TD}>
                      <Cell v={p.avenueLocalite} />
                    </td>
                    <td className={`${TD} pr-6 text-center`}>
                      <Cell v={p.numeroParcelle || p.rang} mono />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
      </>
      )}

      {showLocatifTables && (
      <>
      {/* ---- 3. Précision sur les propriétés données en location ---- */}
      <Panel
        title="Précision sur les propriétés données en location"
        subtitle={
          !selected
            ? 'Aucun contribuable sélectionné'
            : `${leaseRows.length} bail${leaseRows.length === 1 ? '' : 'x'} — exercice ${exercice}`
        }
        padding="none"
      >
        {/* The table across — on screen and on the printed Impôt locatif
            declaration alike. */}
        <div className="w-full overflow-x-auto">
          <table className="w-full table-fixed text-left border-collapse font-sans">
            <thead>
              <tr className="border-b border-line bg-surface2/50">
                <th className={`${TH} w-[104px] pl-6`}>Numero</th>
                <th className={`${TH} w-[12%]`}>Noms des locataires</th>
                <th className={`${TH} w-[7%]`}>Nature</th>
                <th className={`${TH} w-[8%]`}>Ville</th>
                <th className={`${TH} w-[8%]`}>Commune</th>
                <th className={`${TH} w-[10%]`}>Quartier</th>
                <th className={`${TH} w-[9%]`}>Avenue</th>
                <th className={`${TH} w-[7%]`}>Numero de parcelle</th>
                <th className={`${TH} w-[15%]`}>Période de location</th>
                <th className={`${TH} w-[8%] text-right`}>Loyer mensuel</th>
                <th className={`${TH} w-[11%] pr-6 text-right`}>Total revenu brut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {!selected ? (
                <EmptyRow cols={11} text={emptyText} />
              ) : leaseRows.length === 0 ? (
                <EmptyRow cols={11} text={`Aucune propriété de ${selected.businessName} n’est donnée en location.`} />
              ) : (
                leaseRows.map(({ lease: l, role }, i) => {
                  const p = parcelById.get(l.parcelId);
                  const months = monthsLetInExercise(l, exercice);
                  return (
                    <tr key={l.id} className="hover:bg-surface2/30 transition-premium align-top">
                      <td className={`${TD} pl-6 font-bold tabular-nums`}>{String(i + 1).padStart(2, '0')}</td>
                      <td className={TD}>
                        {(l.tenantNames || []).map((n, k) => (
                          <span key={k} className="block font-bold truncate" title={n}>
                            {n}
                          </span>
                        ))}
                        {role === 'Locataire' && (
                          <span className="block text-[11px] text-accent mt-0.5">Contribuable locataire</span>
                        )}
                      </td>
                      <td className={TD}>
                        <span className="font-mono font-bold" title={natureDisplay(l.nature)}>
                          {natureCode(l.nature)}
                        </span>
                      </td>
                      <td className={TD}>
                        <Cell v={l.villeTerritoire || p?.villeTerritoire} />
                      </td>
                      <td className={TD}>
                        <Cell v={l.communeChefferie || p?.communeChefferie} />
                      </td>
                      <td className={TD}>
                        <Cell v={l.quartierGroupement || p?.quartierGroupement} />
                      </td>
                      <td className={TD}>
                        <Cell v={p?.avenueLocalite || l.address} />
                      </td>
                      <td className={TD}>
                        <Cell v={l.numeroParcelle || p?.numeroParcelle} mono />
                      </td>
                      <td className={TD}>
                        {l.startDate ? (
                          <>
                            <span className="block text-[12px] font-medium tabular-nums whitespace-nowrap">
                              {shortDate(l.startDate)} → {l.endDate ? shortDate(l.endDate) : 'En cours'}
                            </span>
                            <span className="block text-[11px] text-muted mt-0.5">
                              {months} mois en {exercice}
                            </span>
                          </>
                        ) : (
                          <span className="text-[12px] text-faint italic">Non renseignée</span>
                        )}
                      </td>
                      <td className={`${TD} text-right`}>
                        {l.monthlyRentUSD > 0 ? (
                          <span className="tabular-nums">{formatMoney(l.monthlyRentUSD)}</span>
                        ) : (
                          <span className="text-[12px] text-faint italic">Non renseigné</span>
                        )}
                      </td>
                      <td className={`${TD} pr-6 text-right`}>
                        {l.monthlyRentUSD > 0 && l.startDate ? (
                          <>
                            <span className="block font-bold tabular-nums">{formatMoney(grossRevenueUSD(l, exercice))}</span>
                            <span className="block text-[11px] text-faint tabular-nums">
                              {formatMoney(l.monthlyRentUSD)} × {months}
                            </span>
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Panel>
      </>
      )}

      {showFoncierTables && (
      <>
      {/* ---- 4. Calculs d'impôts Fonciers ---- */}
      <Panel
        // On the printed Impôt foncier declaration this table is titled
        // "II) Identification des propriétés"; on screen it stays "Calcul d'impôts".
        title={
          isFoncierDoc ? (
            <>
              <span className="pp-noprint">Calcul d'impôts</span>
              <span className="hidden pp-printonly">II) Identification des propriétés</span>
            </>
          ) : (
            "Calcul d'impôts"
          )
        }
        subtitle={
          !selected
            ? 'Aucun contribuable sélectionné'
            : `${myFonciers.length} calcul${myFonciers.length === 1 ? '' : 's'} enregistré${myFonciers.length === 1 ? '' : 's'}`
        }
        padding="none"
      >
        {selected && myFonciers.length > 0 ? (
          <>
            {/* On screen: the register. Printed: across as well, with the
                total impôt dû in figures and in words as two rows below. */}
            <div className="pp-noprint">
              <FoncierCalcTable rows={myFonciers} />
            </div>
            <div className="hidden pp-printonly">
              <FoncierCalcPrintTable rows={myFonciers} />
            </div>
          </>
        ) : (
          <EmptyCalc
            headers={[
              'Nature',
              'Ville/territoire',
              'Commune/chefferie',
              'Quartier/groupement',
              'Avenue/localité',
              'Numéro de parcelle',
              'Rang',
              'Usage',
              'Superficie ou nombre',
              'Taux',
              'Montant impôt',
              'Total impôt dû',
            ]}
            // Printed: across, like the filled table — with its two total rows.
            printNode={
              <FoncierCalcPrintTable
                rows={[]}
                emptyText={selected ? `Aucun calcul d’impôt foncier pour ${selected.businessName}.` : emptyText}
              />
            }
            text={selected ? `Aucun calcul d’impôt foncier pour ${selected.businessName}.` : emptyText}
          />
        )}
      </Panel>
      </>
      )}

      {showLocatifTables && (
      <>
      {/* ---- 5. Calcul d'impôts ---- */}
      <Panel
        title="Calcul d'impôts"
        subtitle={
          !selected
            ? 'Aucun contribuable sélectionné'
            : `${myLocatifs.length} calcul${myLocatifs.length === 1 ? '' : 's'} enregistré${myLocatifs.length === 1 ? '' : 's'}`
        }
        padding="none"
      >
        {selected && myLocatifs.length > 0 ? (
          <>
            {/* On screen: the register across. Printed: set vertically (below). */}
            <div className="pp-noprint">
              <LocatifCalcTable rows={myLocatifs} matchedVia={locatifVia} showContribuable={false} />
            </div>
            <div className="hidden pp-printonly">
              <LocatifCalcVerticalTable rows={myLocatifs} />
            </div>
          </>
        ) : (
          <EmptyCalc
            headers={[
              'Revenu brut',
              'Taux',
              'Impôt dû',
              'Les retenues versées',
              'Solde à payer',
              'En toutes lettres',
              'Mode de paiement',
            ]}
            printHeaders={[
              <>Revenu brut<span className="ml-1.5 font-mono normal-case tracking-normal font-normal">(1)</span></>,
              <>Taux<span className="ml-1.5 font-mono normal-case tracking-normal font-normal">(2)</span></>,
              <>Impôt dû<span className="ml-1.5 font-mono normal-case tracking-normal font-normal">(3) = (1)×(2)</span></>,
              <>Les retenues versées<span className="ml-1.5 font-mono normal-case tracking-normal font-normal">(4)</span></>,
              <>Solde à payer<span className="ml-1.5 font-mono normal-case tracking-normal font-normal">(5) = (3)−(4)</span></>,
              <>En toutes lettres<span className="ml-1.5 font-mono normal-case tracking-normal font-normal">(6)</span></>,
              <>Mode de paiement<span className="ml-1.5 font-mono normal-case tracking-normal font-normal">(7)</span></>,
            ]}
            text={selected ? `Aucun calcul d’impôt locatif pour ${selected.businessName}.` : emptyText}
          />
        )}
      </Panel>
      </>
      )}

      {/* Signature block — printed only, under the last table: the seal on the
          left edge; place / date and the signatory centred under the table on
          the foncier document, on the right edge on the locatif document. */}
      {selected && (
        <div className={`hidden pp-sign${isFoncierDoc ? '' : ' pp-sign-edge'}`}>
          <span className="text-xs font-semibold text-ink whitespace-nowrap justify-self-start">
            {isFoncierDoc ? 'Sceau de l’entreprise' : 'Sceau de l’entreprise et signature'}
          </span>
          <div className="pp-sign-center">
            <div className="text-xs font-semibold text-ink whitespace-nowrap">
              Fait à .....................................le......./........./20.
            </div>
            <div className="text-xs font-semibold text-ink whitespace-nowrap mt-2">Nom et qualité du signataire</div>
          </div>
          {/* Foncier document: the signature on the right edge, on the "Fait à" line. */}
          {isFoncierDoc && (
            <span className="pp-sign-right text-xs font-semibold text-ink whitespace-nowrap">Signature</span>
          )}
        </div>
      )}

      {/* Notez — printed right above "Réservé à l'administration", one line
          each: the foncier document lists (1), (2) and (3) — nature, usage,
          measure; the locatif document lists (1), the nature codes, only. */}
      {selected && (
        <div className="hidden pp-notez">
          {NOTEZ_LEGENDS.filter(({ n }) => isFoncierDoc || n === 1).map(({ n, entries }) => (
            <div key={n}>
              <span className="font-bold">{`(${n}) Notez :`}</span>{' '}
              {entries.map(([code, label], i) => (
                <React.Fragment key={code}>
                  <span className="whitespace-nowrap">
                    <span className="font-bold">{code}</span>
                    {' : '}
                    <span>{label}</span>
                    {i === entries.length - 1 ? '.' : ','}
                  </span>
                  {i === entries.length - 1 ? '' : ' '}
                </React.Fragment>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Réservé à l'administration — printed only, at the bottom of the page,
          left blank for the receiving office to fill in by hand. */}
      {selected && (
        <div className="hidden pp-admin">
          <div className="text-[12px] font-bold uppercase tracking-[0.12em] text-ink mb-1.5">
            {/* Numbered III) on the printed Impôt foncier declaration, after
                "I) Identification du redevable" and "II) Identification des propriétés". */}
            {isFoncierDoc ? 'III) Réservé à l’administration' : 'Réservé à l’administration'}
          </div>
          {/* One layout for both declarations — foncier and locatif print the
              same box. */}
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr>
                <th className="w-[25%]">Numéro de la quittance ou BV</th>
                <th className="w-[20%]">Date de la quittance ou BV</th>
                <th className="w-[30%]">Nom et qualité de l’agent</th>
                <th className="w-[25%]">Cachet de l’administration</th>
              </tr>
            </thead>
            <tbody>
              {/* One line per confirmed payment (or one blank line). The agent
                  and the stamp are given once, so their cells span the box. */}
              {(paidLines.length ? paidLines : [null]).map((c, k, all) => (
                <tr key={c?.id || 'blank'}>
                  <td className={c ? 'pp-admin-filled' : ''}>{c?.reference || ''}</td>
                  <td className={c ? 'pp-admin-filled' : ''}>
                    {c ? new Date(c.confirmedAt).toLocaleDateString('fr-FR') : ''}
                  </td>
                  {k === 0 && <td rowSpan={all.length + 2} />}
                  {k === 0 && <td rowSpan={all.length + 2} />}
                </tr>
              ))}
              {/* Numéro du récépissé — titled like the column headings, under
                  the quittance / BV number, with its own space to fill in. */}
              <tr>
                <th className="pp-admin-subhead">Numéro du récépissé</th>
                <th className="pp-admin-subhead">Date du récépissé</th>
              </tr>
              <tr>
                <td className="pp-admin-short" />
                <td className="pp-admin-short" />
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

/** (1) Notez — the Nature codes printed under the foncier tables, in form order. */
const NOTEZ1_LEGEND: [string, string][] = [
  ['AC', 'Antenne de telecommunication'],
  ['AT', 'Autres'],
  ['EC', 'Etage et Chalet'],
  ['HT', 'Hotel'],
  ['TE', 'Terrain'],
  ['USN', 'Usine'],
  ['AP', 'Appartement'],
  ['BPQ', 'Beach Port et quai d’accostage'],
  ['INDUS', 'Industrie'],
  ['SS', 'Station service'],
  ['VI', 'Villa'],
];

/** (2) Notez — the Usage codes (fiscal destination of the property). */
const NOTEZ2_LEGEND: [string, string][] = [
  ['HAB', 'Habitation'],
  ['COM', 'Commerce'],
  ['IND', 'Industrie'],
  ['AGR', 'Agriculture'],
  ['ELE', 'Élevage'],
];

/** (3) Notez — how the duty is measured: surface or number. */
const NOTEZ3_LEGEND: [string, string][] = [
  ['SUP', 'La superficie pour villa, hôtel, industrie et usines'],
  ['NBR', 'Le nombre pour les autres propriétés'],
];

/** The three Notez lines, printed in order under the foncier tables. */
const NOTEZ_LEGENDS: { n: number; entries: [string, string][] }[] = [
  { n: 1, entries: NOTEZ1_LEGEND },
  { n: 2, entries: NOTEZ2_LEGEND },
  { n: 3, entries: NOTEZ3_LEGEND },
];

/** A calculation table with its headers and no rows yet. */
/**
 * An empty Calcul d'impôts. On screen: the headings across, with the message.
 * Printed: set vertically like a filled one — one row per heading
 * (`printHeaders`, defaulting to `headers`) — with the message beside them.
 */
const EmptyCalc: React.FC<{
  headers: string[];
  text: string;
  printHeaders?: React.ReactNode[];
  /** The printed version, when it is not the vertical list of headings. */
  printNode?: React.ReactNode;
}> = ({
  headers,
  text,
  printHeaders,
  printNode,
}) => (
  <>
  {printNode ? (
    <div className="hidden pp-printonly">{printNode}</div>
  ) : (
  <div className="hidden pp-printonly">
    <div className="w-full">
      <table aria-label="Calcul d'impôts" className="np-vertical-table w-full table-auto text-left border-collapse font-sans">
        <tbody className="divide-y divide-line">
          {(printHeaders || headers).map((h, i) => (
            <tr key={i}>
              <th
                scope="row"
                className="w-[24%] pl-6 pr-3 py-2.5 bg-surface2/50 border-r border-line text-[12px] font-bold uppercase tracking-[0.05em] leading-tight text-faint text-left align-middle [overflow-wrap:normal] [word-break:normal] hyphens-none"
              >
                {h}
              </th>
              {i === 0 && (
                <td
                  rowSpan={(printHeaders || headers).length}
                  className="px-3 py-2.5 text-[12px] text-muted italic text-center align-middle"
                >
                  {text}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
  )}
  <div className="w-full overflow-x-auto pp-noprint">
    <table className="w-full table-fixed text-left border-collapse font-sans">
      <thead>
        <tr className="border-b border-line bg-surface2/50">
          {headers.map((h, i) => (
            <th
              key={h}
              className={`${TH} ${i === 0 ? 'pl-6' : ''} ${i === headers.length - 1 ? 'pr-6' : ''} align-top break-words`}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <EmptyRow cols={headers.length} text={text} />
      </tbody>
    </table>
  </div>
  </>
);

