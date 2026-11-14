import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { Business } from '../../types';

/** Search the taxpayer roll by name, NIF, owner name or commune. */
export const TaxpayerSearch: React.FC<{
  id: string;
  label: string;
  hint: string;
  taxpayers: Business[];
  value: Business | null;
  onChange: (b: Business | null) => void;
  /** A taxpayer who cannot be chosen here (e.g. the current owner). */
  excludeId?: string;
  error?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /**
   * Open the list of registered taxpayers as soon as the field is focused,
   * before anything is typed (typing then narrows it). Off by default.
   */
  showAllOnFocus?: boolean;
}> = ({ id, label, hint, taxpayers, value, onChange, excludeId, error, disabled, autoFocus, showAllOnFocus = false }) => {
  const [query, setQuery] = useState(value?.businessName || '');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!value) setQuery('');
    else setQuery(value.businessName || '');
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
    const q = query.trim().toLowerCase();
    if (value || (!q && !showAllOnFocus)) return [];
    const tokens = q ? q.split(/\s+/) : [];
    return taxpayers
      .filter((b) => b.id !== excludeId)
      .filter((b) => {
        const hay = [b.businessName, b.ownerFullName, b.nif, b.nationalIdOrRccm, b.commune, b.quartier]
          .join(' ')
          .toLowerCase();
        return tokens.every((t) => hay.includes(t));
      })
      .sort((a, b) => (q ? 0 : (a.businessName || '').localeCompare(b.businessName || '', 'fr')))
      .slice(0, q ? 30 : 200);
  }, [query, value, taxpayers, excludeId, showAllOnFocus]);
  const showList = open && !value && (showAllOnFocus || query.trim().length > 0);
  const details = (b: Business) =>
    [b.nif ? `NIF ${b.nif}` : '', [b.physicalAddress, b.quartier, b.commune].filter(Boolean).join(', ')]
      .filter(Boolean)
      .join(' • ');

  const choose = (b: Business) => {
    onChange(b);
    setOpen(false);
    setHi(0);
  };

  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold text-ink mb-1.5">
        {label}
      </label>
      <div ref={box} className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-autocomplete="list"
          autoComplete="off"
          autoFocus={autoFocus}
          disabled={disabled}
          value={query}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setHi(0);
            setOpen(true);
            if (value) onChange(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && showList) {
              e.stopPropagation();
              setOpen(false);
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
          className={`w-full h-10 pl-9 pr-9 text-sm rounded-[10px] border bg-surface text-ink placeholder:text-faint focus:border-accent focus:outline-none transition-premium ${
            error ? 'border-danger' : 'border-line'
          } ${value ? 'font-semibold' : ''}`}
        />
        {value && !disabled && (
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label="Effacer"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted hover:text-ink hover:bg-surface2 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        {showList && (
          <ul
            role="listbox"
            className="absolute z-30 left-0 right-0 mt-1.5 max-h-64 overflow-y-auto rounded-[12px] border border-line bg-surface shadow-2xl py-1.5"
          >
            {matches.length === 0 && !query.trim() ? (
              <li className="px-3.5 py-2.5 text-[12px] text-muted">Aucun contribuable enregistré.</li>
            ) : matches.length === 0 ? (
              <li className="px-3.5 py-2.5 text-[12px] text-muted">
                Aucun contribuable ne correspond à{' '}
                <span className="font-semibold text-ink">« {query.trim()} »</span>.
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
                    <span className="block text-[11px] text-muted truncate mt-0.5">{details(b) || '—'}</span>
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
        <p className="text-[11px] text-muted truncate mt-1">{details(value) || 'Aucune adresse enregistrée'}</p>
      ) : (
        <p className="text-[11px] text-muted mt-1">{hint}</p>
      )}
    </div>
  );
};
