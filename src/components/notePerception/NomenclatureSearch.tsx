import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpenText, Search, X } from 'lucide-react';
import { formatTaux, NomenclatureImpot } from '../../services/nomenclatureService';

/** Accents and case ignored, so "redevance" finds "Redevance" and "impot" finds "Impôt". */
const fold = (s?: string) =>
  (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const tauxOf = (n: NomenclatureImpot) => formatTaux(n.taux, n.devise || 'USD');

/** The second line of an entry: its title, rate and periodicity — each its own text, so each translates. */
const Details: React.FC<{ n: NomenclatureImpot }> = ({ n }) => {
  const parts = [n.titre?.trim(), tauxOf(n) !== '—' ? `Taux : ${tauxOf(n)}` : '', n.periodicite?.trim()].filter(
    (x): x is string => !!x
  );
  if (parts.length === 0) return <>—</>;
  return (
    <>
      {parts.map((x, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span aria-hidden="true"> • </span>}
          <span>{x}</span>
        </React.Fragment>
      ))}
    </>
  );
};

/**
 * Search the Nomenclatures des Impôts registered in the system — by article
 * budgétaire, libellé, titre or fait générateur — and pick one. Focusing the
 * empty field lists every registered nomenclature.
 */
export const NomenclatureSearch: React.FC<{
  id: string;
  nomenclatures: NomenclatureImpot[];
  loading: boolean;
  value: NomenclatureImpot | null;
  onChange: (n: NomenclatureImpot | null) => void;
  error?: string;
  disabled?: boolean;
}> = ({ id, nomenclatures, loading, value, onChange, error, disabled }) => {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  /** Set while typing lets go of a picked tax, so the typed text is kept. */
  const typing = useRef(false);

  useEffect(() => {
    if (typing.current) {
      typing.current = false;
      return;
    }
    setQuery(value ? value.articleBudgetaire : '');
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const matches = useMemo(() => {
    if (value) return [];
    const tokens = fold(query).trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return nomenclatures;
    return nomenclatures.filter((n) => {
      const hay = fold([n.articleBudgetaire, n.libelle, n.titre, n.faitGenerateur].join(' '));
      return tokens.every((t) => hay.includes(t));
    });
  }, [query, value, nomenclatures]);

  const showList = open && !value && !disabled;

  // Keep the highlighted entry in view while moving with the arrow keys.
  useEffect(() => {
    if (!showList) return;
    list.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [hi, showList]);

  const choose = (n: NomenclatureImpot) => {
    onChange(n);
    setOpen(false);
    setHi(0);
  };

  return (
    <div>
      <div ref={box} className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-autocomplete="list"
          aria-controls={`${id}-list`}
          autoComplete="off"
          disabled={disabled}
          value={query}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setHi(0);
            setOpen(true);
            if (value) {
              typing.current = true;
              onChange(null);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && showList) {
              e.stopPropagation();
              setOpen(false);
              return;
            }
            if (e.key === 'ArrowDown' && !showList && !value) {
              e.preventDefault();
              setOpen(true);
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
          className={`w-full h-[42px] pl-9 pr-9 text-sm rounded-[10px] border bg-surface text-ink placeholder:text-faint focus:border-accent focus:outline-none transition-premium ${
            error ? 'border-danger' : 'border-line'
          } ${value ? 'font-mono font-semibold' : ''}`}
        />
        {value && !disabled && (
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setOpen(true);
            }}
            aria-label="Effacer"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted hover:text-ink hover:bg-surface2 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        {showList && (
          <ul
            id={`${id}-list`}
            ref={list}
            role="listbox"
            className="absolute z-30 left-0 right-0 mt-1.5 max-h-72 overflow-y-auto rounded-[12px] border border-line bg-surface shadow-2xl py-1.5"
          >
            {loading ? (
              <li className="px-3.5 py-2.5 text-[12px] text-muted">Chargement de la nomenclature…</li>
            ) : nomenclatures.length === 0 ? (
              <li className="px-3.5 py-2.5 text-[12px] text-muted leading-relaxed">
                Aucune nomenclature des impôts n'est enregistrée. Ajoutez-en d'abord dans l'onglet Nomenclatures des
                Impôts.
              </li>
            ) : matches.length === 0 ? (
              <li className="px-3.5 py-2.5 text-[12px] text-muted">
                Aucun impôt ne correspond à <span className="font-semibold text-ink">« {query.trim()} »</span>.
              </li>
            ) : (
              matches.map((n, i) => (
                <li key={n.id} role="option" aria-selected={i === hi} data-i={i}>
                  <button
                    type="button"
                    onMouseEnter={() => setHi(i)}
                    onClick={() => choose(n)}
                    className={`w-full text-left px-3.5 py-2 cursor-pointer ${i === hi ? 'bg-accent-soft' : ''}`}
                  >
                    <span className="flex items-baseline gap-2 min-w-0">
                      <span className="text-xs font-mono font-bold text-ink shrink-0">{n.articleBudgetaire}</span>
                      <span className="text-xs font-semibold text-ink truncate">{n.libelle?.trim() || n.faitGenerateur}</span>
                    </span>
                    <span className="block text-[11px] text-muted truncate mt-0.5">
                      <Details n={n} />
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      {error ? (
        <p className="text-[12px] text-danger mt-1">{error}</p>
      ) : value ? (
        <div className="mt-1.5 rounded-[10px] bg-surface2/60 border border-line px-3 py-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12px]">
          {value.titre?.trim() && (
            <>
              <span className="text-muted">Titre</span>
              <span className="text-ink text-right break-words">{value.titre}</span>
            </>
          )}
          {value.libelle?.trim() && (
            <>
              <span className="text-muted">Libellé</span>
              <span className="text-ink font-semibold text-right break-words">{value.libelle}</span>
            </>
          )}
          <span className="text-muted">Fait générateur</span>
          <span className="text-ink text-right break-words">{value.faitGenerateur || '—'}</span>
          <span className="text-muted">Périodicité</span>
          <span className="text-ink text-right break-words">{value.periodicite || '—'}</span>
          <span className="text-muted">Taux</span>
          <span className="text-ink font-bold text-right tabular-nums">{tauxOf(value)}</span>
        </div>
      ) : (
        <p className="text-[11px] text-muted mt-1 flex items-center gap-1">
          <BookOpenText className="w-3 h-3 shrink-0" />
          {loading
            ? 'Chargement de la nomenclature…'
            : `${nomenclatures.length} impôt${nomenclatures.length === 1 ? '' : 's'} dans la nomenclature — recherchez par article budgétaire, libellé ou titre.`}
        </p>
      )}
    </div>
  );
};
