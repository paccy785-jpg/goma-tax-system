import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Plus, ScrollText, Search, SearchX, Stamp, X } from 'lucide-react';
import { AddressRegistry, Business, UserRole } from '../types';
import { subscribeToAddressRegistry } from '../services/addressService';
import { subscribeToBusinesses } from '../services/dbService';
import {
  NotePerception,
  normalizeNumero,
  subscribeToNotesPerception,
} from '../services/notePerceptionService';
import { Button, EmptyState, PageHeader, Panel } from './ui';
import { NotePerceptionModal } from './notePerception/NotePerceptionModal';
import { TaxateurSectionTable } from './notePerception/NpSectionTables';
import { OrdonnateurTable } from './notePerception/OrdonnateurTable';
import { OrdonnanceModal } from './notePerception/OrdonnanceModal';
import { noteMatches, searchTokens } from './notePerception/noteSearch';
import { printNotePerception } from './notePerception/printNotePerception';
import { NotePerceptionPrintSheet } from './notePerception/NotePerceptionPrintSheet';
/** Subtabs of the Note de Perception page — one per service filling the note. */
type NpSubTab = 'taxateur' | 'ordonnateur';

const NP_SUBTABS: { id: NpSubTab; label: string; hint: string }[] = [
  { id: 'taxateur', label: 'Taxateur', hint: 'Remplir par le service Taxateur' },
  { id: 'ordonnateur', label: 'Ordonnateur', hint: "Partie de l'ordonnateur" },
];

/** Same segmented control as the Declarations and Registration subtabs. */
const NpSubTabs: React.FC<{ active: NpSubTab; onChange: (id: NpSubTab) => void }> = ({ active, onChange }) => (
  <div
    role="tablist"
    aria-label="Sections de la note de perception"
    className="inline-flex items-center gap-1 p-1 rounded-[12px] bg-surface2 border border-line"
  >
    {NP_SUBTABS.map((tab) => {
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

export const NotePerceptionView: React.FC<{ userRole: UserRole }> = ({ userRole }) => {
  const canAdd = userRole === 'Admin' || userRole === 'Supervisor' || userRole === 'Cashier';

  const [notes, setNotes] = useState<NotePerception[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [subTab, setSubTab] = useState<NpSubTab>('taxateur');
  const close = useCallback(() => setOpen(false), []);
  // The ordonnance card (Ordonnateur subtab).
  const [ordOpen, setOrdOpen] = useState(false);
  const closeOrd = useCallback(() => setOrdOpen(false), []);
  /** The printed note de perception, kept off screen; a row's Imprimer button prints a copy of it. */
  const printSheetRef = useRef<HTMLDivElement>(null);
  /** The note on the print sheet. */
  const [printNote, setPrintNote] = useState<NotePerception | null>(null);

  useEffect(
    () =>
      subscribeToNotesPerception(
        (rows) => {
          setNotes(rows || []);
          setLoading(false);
        },
        () => setLoading(false)
      ),
    []
  );

  // The taxpayer register — for the note de perception card's taxpayer search,
  // and for the taxpayer's details on a printed note.
  const [taxpayers, setTaxpayers] = useState<Business[]>([]);
  useEffect(() => {
    return subscribeToBusinesses(
      (d) =>
        setTaxpayers(
          (d || []).slice().sort((a, b) => (a.businessName || '').localeCompare(b.businessName || ''))
        ),
      undefined,
      1000
    );
  }, []);

  // Settings → Adresse — resolves the ville of a taxpayer enrolled before the
  // card recorded it, for the printed note.
  const [addressRegistry, setAddressRegistry] = useState<AddressRegistry | null>(null);
  useEffect(() => subscribeToAddressRegistry(setAddressRegistry), []);

  const printTaxpayer = useMemo(
    () => (printNote ? taxpayers.find((t) => t.id === printNote.taxateur?.contribuableId) || null : null),
    [printNote, taxpayers]
  );
  const printVille = useMemo(() => {
    if (!printTaxpayer) return '';
    if (printTaxpayer.ville) return printTaxpayer.ville;
    const commune = (printTaxpayer.commune || '').trim().toLowerCase();
    const holding = (addressRegistry?.villes || []).filter((v) =>
      v.communes.some((c) => c.name.trim().toLowerCase() === commune)
    );
    return holding.length === 1 ? holding[0].name : '';
  }, [printTaxpayer, addressRegistry]);

  /** Print one note: put it on the sheet, then print a copy of the sheet. */
  const printOne = useCallback((n: NotePerception) => {
    flushSync(() => setPrintNote(n));
    void printNotePerception(printSheetRef.current, { id: n.id, numero: n.taxateur.numeroFacture });
  }, []);

  /** The search above the subtabs — it filters every registered note. */
  const [search, setSearch] = useState('');
  const tokens = useMemo(() => searchTokens(search), [search]);
  const searching = tokens.length > 0;
  const found = useMemo(() => (searching ? notes.filter((n) => noteMatches(n, tokens)) : notes), [notes, tokens, searching]);
  const clearSearch = useCallback(() => setSearch(''), []);

  const existingNumeros = useMemo(
    () => new Set(notes.map((n) => normalizeNumero(n.taxateur?.numeroFacture || ''))),
    [notes]
  );

  return (
    <div className="space-y-8 font-sans">
      <PageHeader
        title="Note de Perception"
        actions={
          // Taxateur: add a note (and the demo data). Ordonnateur: record an ordonnance.
          subTab === 'ordonnateur' ? (
            canAdd ? (
              <Button variant="primary" size="md" icon={<Stamp className="w-4 h-4" />} onClick={() => setOrdOpen(true)}>
                Enregistrer l'ordonnance
              </Button>
            ) : undefined
          ) : subTab === 'taxateur' ? (
            <div className="flex items-center gap-2">
              {canAdd && (
                <Button variant="primary" size="md" icon={<Plus className="w-4 h-4" />} onClick={() => setOpen(true)}>
                  Ajouter une note de perception
                </Button>
              )}
            </div>
          ) : undefined
        }
      />

      {/* Search every registered note de perception. */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
        <input
          id="np-search"
          type="search"
          role="searchbox"
          aria-label="Rechercher dans les notes de perception"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && search) {
              e.preventDefault();
              setSearch('');
            }
          }}
          autoComplete="off"
          spellCheck={false}
          className="w-full h-12 pl-11 pr-11 text-sm rounded-[12px] border border-line bg-surface text-ink placeholder:text-faint focus:border-accent focus:outline-none transition-premium font-sans [&::-webkit-search-cancel-button]:appearance-none"
        />
        {search && (
          <button
            type="button"
            onClick={clearSearch}
            title="Effacer la recherche"
            aria-label="Effacer la recherche"
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted hover:text-ink hover:bg-surface2 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <NpSubTabs active={subTab} onChange={setSubTab} />

      {subTab === 'ordonnateur' ? (
        // The search above filters this list too.
        <OrdonnateurTable
          notes={found}
          loading={loading}
          onAdd={canAdd ? () => setOrdOpen(true) : undefined}
        />
      ) : (
      <Panel
        title="Notes de perception"
        subtitle={
          loading
            ? 'Chargement…'
            : searching
              ? `${found.length} note${found.length <= 1 ? '' : 's'} de perception sur ${notes.length}`
              : `${notes.length} note${notes.length === 1 ? '' : 's'} de perception enregistrée${notes.length === 1 ? '' : 's'}`
        }
        padding="none"
      >
        <TaxateurSectionTable
          notes={loading ? [] : found}
          onPrint={printOne}
          placeholder={
            loading ? (
              <div className="px-6 py-10 text-center text-xs text-muted">Chargement…</div>
            ) : searching && notes.length > 0 ? (
              <div className="p-6">
                <EmptyState
                  icon={<SearchX className="w-5 h-5" />}
                  title="Aucune note de perception ne correspond à la recherche"
                  description={`Aucune note de perception enregistrée ne correspond à « ${search.trim()} ».`}
                  actionLabel="Effacer la recherche"
                  onAction={clearSearch}
                />
              </div>
            ) : (
              <div className="p-6">
                <EmptyState
                  icon={<ScrollText className="w-5 h-5" />}
                  title="Aucune note de perception"
                  description="Cliquez sur « Ajouter une note de perception » et remplissez la partie du service taxateur : la note apparaît ici une fois enregistrée."
                  actionLabel={canAdd ? 'Ajouter une note de perception' : undefined}
                  onAction={canAdd ? () => setOpen(true) : undefined}
                />
              </div>
            )
          }
        />
      </Panel>
      )}

      {!canAdd && (
        <p className="text-[12px] text-faint">Votre rôle consulte les notes de perception en lecture seule.</p>
      )}

      {/* The note de perception as printed — never shown on screen. */}
      <div className="hidden" aria-hidden="true">
        <NotePerceptionPrintSheet ref={printSheetRef} note={printNote} taxpayer={printTaxpayer} ville={printVille} />
      </div>

      {canAdd && <NotePerceptionModal isOpen={open} onClose={close} existingNumeros={existingNumeros} taxpayers={taxpayers} />}
      {canAdd && <OrdonnanceModal isOpen={ordOpen} onClose={closeOrd} notes={notes} />}
    </div>
  );
};
