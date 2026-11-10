import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X, UserRound } from 'lucide-react';
import { Business, PropertyParcel, RentalLease } from '../../types';
import { subscribeToBusinesses } from '../../services/dbService';
import { subscribeToParcels } from '../../services/parcelService';
import { subscribeToLeases } from '../../services/leaseService';

/** A bailleur as the foncier slip records them. */
export interface PickedBailleur {
  id: string;
  name: string;
  nif?: string;
  location?: string;
}

interface Candidate extends PickedBailleur {
  haystack: string;
  /** Declared properties on file for this bailleur. */
  parcelCount: number;
}

/**
 * Bailleurs: taxpayers who own declared property — named as owner on a
 * declared parcel, or as bailleur on a lease.
 */
function buildBailleurs(
  businesses: Business[],
  parcels: PropertyParcel[],
  leases: RentalLease[]
): Candidate[] {
  const byId = new Map(businesses.map((b) => [b.id, b]));
  const ids = new Set<string>();
  parcels.forEach((p) => p.ownerTaxpayerId && ids.add(p.ownerTaxpayerId));
  leases.forEach((l) => l.bailleurId && ids.add(l.bailleurId));

  const out: Candidate[] = [];
  ids.forEach((id) => {
    const b = byId.get(id);
    const owned = parcels.filter((p) => p.ownerTaxpayerId === id);
    const name =
      b?.businessName ||
      owned.find((p) => p.ownerName)?.ownerName ||
      leases.find((l) => l.bailleurId === id && l.bailleurName)?.bailleurName ||
      '';
    if (!name.trim()) return;
    const location = [b?.physicalAddress, b?.quartier, b?.commune].filter(Boolean).join(', ');
    out.push({
      id,
      name,
      nif: b?.nif || undefined,
      location: location || undefined,
      parcelCount: owned.length,
      haystack: [name, b?.ownerFullName, b?.nif, b?.commune, b?.quartier].join(' ').toLowerCase(),
    });
  });
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const fieldClass =
  'w-full h-10 px-3 text-sm rounded-[10px] border border-line bg-surface text-ink placeholder:text-faint focus:border-accent focus:outline-none transition-premium font-sans';

export const BailleurPicker: React.FC<{
  active: boolean;
  value: PickedBailleur | null;
  onChange: (b: PickedBailleur | null) => void;
  error?: string;
  disabled?: boolean;
}> = ({ active, value, onChange, error, disabled }) => {
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [parcels, setParcels] = useState<PropertyParcel[]>([]);
  const [leases, setLeases] = useState<RentalLease[]>([]);
  const [query, setQuery] = useState(value?.name || '');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    const u1 = subscribeToBusinesses((d) => setBusinesses(d || []), undefined, 1000);
    const u2 = subscribeToParcels((d) => setParcels(d || []), undefined, 1000);
    const u3 = subscribeToLeases((d) => setLeases(d || []), undefined, 1000);
    return () => {
      u1();
      u2();
      u3();
    };
  }, [active]);

  // Keep the field in step with a reset from the parent.
  useEffect(() => {
    if (!value) setQuery('');
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const candidates = useMemo(() => buildBailleurs(businesses, parcels, leases), [businesses, parcels, leases]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || value) return [];
    const tokens = q.split(/\s+/);
    return candidates.filter((c) => tokens.every((t) => c.haystack.includes(t))).slice(0, 30);
  }, [candidates, query, value]);
  const showList = open && !value && query.trim().length > 0;

  const choose = (c: Candidate) => {
    onChange({ id: c.id, name: c.name, nif: c.nif, location: c.location });
    setQuery(c.name);
    setOpen(false);
    setHi(0);
  };
  const clear = () => {
    onChange(null);
    setQuery('');
    setHi(0);
  };
  const details = (c: { nif?: string; location?: string }) =>
    [c.nif ? `NIF ${c.nif}` : '', c.location].filter(Boolean).join(' • ');

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-ink">
          <span className="w-5 h-5 rounded-[6px] bg-accent-soft text-accent flex items-center justify-center">
            <UserRound className="w-3 h-3" />
          </span>
          <label htmlFor="foncier-bailleur">Contribuable</label>
        </span>
      </div>
      <div ref={boxRef} className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
        <input
          id="foncier-bailleur"
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls="foncier-bailleur-list"
          aria-autocomplete="list"
          autoComplete="off"
          autoFocus
          disabled={disabled}
          value={query}
          onFocus={() => setOpen(true)}
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
          className={`${fieldClass} pl-9 pr-9 ${error ? 'border-danger' : ''} ${value ? 'font-semibold' : ''}`}
        />
        {value && (
          <button
            type="button"
            onClick={clear}
            disabled={disabled}
            aria-label="Effacer le bailleur"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted hover:text-ink hover:bg-surface2 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}

        {showList && (
          <ul
            id="foncier-bailleur-list"
            role="listbox"
            className="absolute z-20 left-0 right-0 mt-1.5 max-h-64 overflow-y-auto rounded-[12px] border border-line bg-surface shadow-2xl py-1.5"
          >
            {matches.length === 0 ? (
              <li className="px-3.5 py-2.5 text-[12px] text-muted">
                Aucun bailleur ne correspond à{' '}
                <span className="font-semibold text-ink">« {query.trim()} »</span>.
              </li>
            ) : (
              matches.map((c, i) => (
                <li key={c.id} role="option" aria-selected={i === hi}>
                  <button
                    type="button"
                    onMouseEnter={() => setHi(i)}
                    onClick={() => choose(c)}
                    className={`w-full text-left px-3.5 py-2 flex items-start justify-between gap-3 cursor-pointer ${
                      i === hi ? 'bg-accent-soft' : ''
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-ink truncate">{c.name}</span>
                      <span className="block text-[11px] text-muted truncate mt-0.5">{details(c) || '—'}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-faint mt-0.5">
                      {c.parcelCount} propriété{c.parcelCount === 1 ? '' : 's'}
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
        <p className="text-[11px] text-muted truncate mt-1">{details(value) || 'Aucune adresse enregistrée'}</p>
      ) : (
        <p className="text-[11px] text-muted mt-1">
          Le propriétaire qui paiera l’impôt foncier — recherché parmi les bailleurs enregistrés.
        </p>
      )}
    </div>
  );
};
