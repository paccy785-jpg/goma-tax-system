import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpenText, Loader2, Pencil, Plus, Search, SearchX, Trash2, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { UserRole } from '../types';
import { Button, EmptyState, PageHeader, Panel } from './ui';
import {
  deleteNomenclature,
  formatTaux,
  NomenclatureImpot,
  subscribeToNomenclatures,
} from '../services/nomenclatureService';
import { NomenclatureModal } from './NomenclatureModal';


/**
 * Width hints for the columns. The table lays itself out to the card's width
 * (no sideways scroll): every column keeps at least its longest word, and the
 * delete column takes only the room its button needs.
 */
const COLUMNS: { label: string; width: string }[] = [
  { label: 'Art. budgétaire', width: 'w-[14%]' },
  { label: 'Libellé', width: 'w-[27%]' },
  { label: 'Fait générateur', width: 'w-[26%]' },
  { label: 'Périodicité', width: 'w-[12%]' },
  { label: 'Taux', width: 'w-[11%]' },
];

const pad = (i: number) => (i === 0 ? 'pl-6 pr-3' : 'px-3');

/** Accents, case and spacing ignored, so "redevance" finds "Redevance" and "impot" finds "Impôt". */
const fold = (s?: string) =>
  (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');

/** Everything a tax can be found by: its title, article, libellé, fait générateur, périodicité and taux. */
const searchText = (r: NomenclatureImpot) =>
  fold(
    [r.titre, r.articleBudgetaire, r.libelle, r.faitGenerateur, r.periodicite, r.taux, formatTaux(r.taux, r.devise || 'USD')].join(
      ' '
    )
  );

/**
 * Nomenclatures des Impôts — the list of taxes with their budget article,
 * taxable event (fait générateur), periodicity and rate.
 */
export const NomenclaturesImpotsView: React.FC<{ userRole: UserRole }> = ({ userRole }) => {
  /** The nomenclature is reference data: administrators and supervisors maintain it. */
  const canAdd = userRole === 'Admin' || userRole === 'Supervisor';

  const [rows, setRows] = useState<NomenclatureImpot[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  /** The entry being corrected in the card; null when adding. */
  const [editing, setEditing] = useState<NomenclatureImpot | null>(null);
  const close = useCallback(() => {
    setOpen(false);
    setEditing(null);
  }, []);
  const openAdd = () => {
    setEditing(null);
    setOpen(true);
  };
  const { userProfile } = useAuth();
  const { showToast } = useToast();
  /** The row waiting for its delete to be confirmed, and the one being deleted. */
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const remove = async (r: NomenclatureImpot) => {
    if (!userProfile) {
      showToast('Connectez-vous avant de supprimer une nomenclature.', 'error', 'Non connecté');
      return;
    }
    setDeletingId(r.id);
    try {
      await deleteNomenclature(r, { uid: userProfile.uid, displayName: userProfile.displayName, role: userProfile.role });
      showToast(`Article budgétaire ${r.articleBudgetaire} supprimé de la nomenclature.`, 'success', 'Nomenclature supprimée');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Impossible de supprimer la nomenclature.', 'error', 'Échec');
    } finally {
      setDeletingId(null);
      setConfirmId(null);
    }
  };
  const colCount = COLUMNS.length + (canAdd ? 1 : 0);

  /** The search at the top of the tab — every word typed must appear in the tax. */
  const [search, setSearch] = useState('');
  const tokens = useMemo(() => fold(search).trim().split(' ').filter(Boolean), [search]);
  const searching = tokens.length > 0;
  const shown = useMemo(
    () => (searching ? rows.filter((r) => { const hay = searchText(r); return tokens.every((t) => hay.includes(t)); }) : rows),
    [rows, tokens, searching]
  );

  useEffect(
    () =>
      subscribeToNomenclatures(
        (data) => {
          setRows(data);
          setLoading(false);
        },
        () => setLoading(false)
      ),
    []
  );

  /**
   * The table's sections. Taxes without a title come first, on their own;
   * then one section per title (same title, ignoring case and spacing), in the
   * order of each title's first article. Rows keep their article order.
   */
  const sections = useMemo(() => {
    const untitled: NomenclatureImpot[] = [];
    const byTitle = new Map<string, { titre: string; rows: NomenclatureImpot[] }>();
    for (const r of shown) {
      const t = (r.titre || '').trim().replace(/\s+/g, ' ');
      if (!t) {
        untitled.push(r);
        continue;
      }
      const key = t.toLocaleLowerCase('fr');
      const g = byTitle.get(key);
      if (g) g.rows.push(r);
      else byTitle.set(key, { titre: t, rows: [r] });
    }
    return [
      ...(untitled.length ? [{ key: '', titre: null as string | null, rows: untitled }] : []),
      ...Array.from(byTitle.entries()).map(([key, g]) => ({ key, titre: g.titre as string | null, rows: g.rows })),
    ];
  }, [shown]);

  /** One tax row; `grouped` rows sit under a title and are indented. */
  const renderRow = (r: NomenclatureImpot, grouped: boolean) => (
      <tr key={r.id} className={`transition-premium align-middle ${confirmId === r.id ? 'bg-danger/5' : 'hover:bg-surface2/30'}`}>
        <td className={`${grouped ? 'pl-10 pr-3' : pad(0)} py-3`}>
          <span className="block text-xs font-mono font-bold text-ink break-words">{r.articleBudgetaire}</span>
        </td>
        <td className={`${pad(1)} py-3`}>
          {r.libelle ? (
            <span className="block text-xs font-semibold text-ink leading-snug break-words">{r.libelle}</span>
          ) : (
            <span className="text-xs text-faint">—</span>
          )}
        </td>
        <td className={`${pad(2)} py-3`}>
          <span className="block text-xs text-ink leading-snug whitespace-pre-line break-words">{r.faitGenerateur}</span>
        </td>
        <td className={`${pad(3)} py-3`}>
          <span className="block text-xs text-ink break-words">{r.periodicite}</span>
        </td>
        <td className={`${pad(4)} py-3`}>
          <span className="block text-xs font-semibold text-ink tabular-nums break-words">{formatTaux(r.taux, r.devise || 'USD')}</span>
        </td>
        {canAdd && (
          <td className="pl-3 pr-6 py-2 text-right whitespace-nowrap">
            {confirmId === r.id ? (
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => remove(r)}
                  disabled={deletingId === r.id}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] bg-danger text-white text-[12px] font-semibold cursor-pointer hover:opacity-90 disabled:opacity-60"
                >
                  {deletingId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  Confirmer
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmId(null)}
                  disabled={deletingId === r.id}
                  title="Annuler"
                  aria-label="Annuler"
                  className="p-1.5 rounded-[8px] text-muted hover:text-ink hover:bg-surface2 cursor-pointer disabled:opacity-60"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="inline-flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setEditing(r);
                  setOpen(true);
                }}
                disabled={!!deletingId}
                title="Modifier"
                aria-label={`Modifier l'article ${r.articleBudgetaire}`}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] text-[12px] font-semibold text-ink hover:bg-surface2 cursor-pointer disabled:opacity-50"
              >
                <Pencil className="w-3.5 h-3.5" />
                Modifier
              </button>
              <button
                type="button"
                onClick={() => setConfirmId(r.id)}
                disabled={!!deletingId}
                title="Supprimer"
                aria-label={`Supprimer l'article ${r.articleBudgetaire}`}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[8px] text-[12px] font-semibold text-danger hover:bg-danger/10 cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Supprimer
              </button>
              </div>
            )}
          </td>
        )}
      </tr>
  );

  return (
    <div className="space-y-8 font-sans">
      <PageHeader
        title="Nomenclatures des Impôts"
        actions={
          canAdd ? (
            <Button variant="primary" size="md" icon={<Plus className="w-4 h-4" />} onClick={openAdd}>
              Ajouter une nomenclature
            </Button>
          ) : undefined
        }
      />

      {/* Search the nomenclature — by title, article, libellé, fait générateur, périodicité or taux. */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
        <input
          id="nom-search"
          type="search"
          role="searchbox"
          aria-label="Rechercher dans les nomenclatures des impôts"
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
            onClick={() => setSearch('')}
            title="Effacer la recherche"
            aria-label="Effacer la recherche"
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-muted hover:text-ink hover:bg-surface2 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <Panel
        title="Nomenclature"
        subtitle={
          loading
            ? 'Chargement…'
            : searching
              ? `${shown.length} impôt${shown.length <= 1 ? '' : 's'} sur ${rows.length}`
              : `${rows.length} impôt${rows.length === 1 ? '' : 's'}`
        }
        padding="none"
      >
        <div className="w-full overflow-x-auto">
          <table className="w-full table-auto text-left border-collapse font-sans">
            <thead>
              <tr className="border-b border-line bg-surface2/50">
                {COLUMNS.map((c, i) => (
                  <th
                    key={c.label}
                    scope="col"
                    className={`${c.width} ${pad(i)} py-3.5 text-[12px] font-bold uppercase tracking-[0.05em] leading-tight text-faint align-middle [overflow-wrap:normal] [word-break:normal]`}
                  >
                    {c.label}
                  </th>
                ))}
                {canAdd && (
                  <th scope="col" className="w-[1%] pl-3 pr-6 py-3.5">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {loading ? (
                <tr>
                  <td colSpan={colCount} className="px-6 py-10 text-center text-xs text-muted">
                    Chargement…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="p-6">
                    <EmptyState
                      icon={<BookOpenText className="w-5 h-5" />}
                      title="Aucun impôt dans la nomenclature"
                      description="Les impôts de la nomenclature, avec leur article budgétaire, leur libellé, leur fait générateur, leur périodicité et leur taux, apparaîtront ici."
                      actionLabel={canAdd ? 'Ajouter une nomenclature' : undefined}
                      onAction={canAdd ? openAdd : undefined}
                    />
                  </td>
                </tr>
              ) : shown.length === 0 ? (
                <tr>
                  <td colSpan={colCount} className="p-6">
                    <EmptyState
                      icon={<SearchX className="w-5 h-5" />}
                      title="Aucun impôt ne correspond à la recherche"
                      description={`Aucun impôt de la nomenclature ne correspond à « ${search.trim()} ».`}
                      actionLabel="Effacer la recherche"
                      onAction={() => setSearch('')}
                    />
                  </td>
                </tr>
              ) : (
                sections.map((sec) =>
                  sec.titre === null ? (
                    sec.rows.map((r) => renderRow(r, false))
                  ) : (
                    <React.Fragment key={`t:${sec.key}`}>
                      {/* Title band — the taxes under it follow, indented. */}
                      <tr className="bg-surface2/70 border-t-2 border-line">
                        <td colSpan={colCount} className="pl-6 pr-6 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <span className="w-1.5 h-4 rounded-full bg-accent shrink-0" />
                            <span className="text-[13px] font-bold uppercase tracking-[0.06em] text-ink">{sec.titre}</span>
                            <span className="ml-1 px-2 py-0.5 rounded-full bg-accent-soft text-accent text-[11px] font-semibold tabular-nums">
                              {`${sec.rows.length} impôt${sec.rows.length === 1 ? '' : 's'}`}
                            </span>
                          </div>
                        </td>
                      </tr>
                      {sec.rows.map((r) => renderRow(r, true))}
                    </React.Fragment>
                  )
                )
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {canAdd && <NomenclatureModal isOpen={open} onClose={close} existingRows={rows} editing={editing} />}
    </div>
  );
};
