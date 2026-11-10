import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Search,
  Plus,
  MapPinned,
  Percent,
  Landmark,
  X,
  Building2,
  Home,
  Store,
  Warehouse,
  Tag,
  Check,
  AlertTriangle,
  FileCheck2,
  ChevronRight,
  Receipt,
  Users,
  Pencil,
} from 'lucide-react';
import {
  PropertyParcel,
  PropertyNature,
  PropertyUsage,
  Note1Code,
  Note2Code,
  Note3Code,
  NoteGroup,
  NoteCodeEntry,
  NOTEZ1_CODES,
  NOTEZ2_CODES,
  NOTEZ3_CODES,
  NOTEZ_BY_CODE,
  natureDisplay,
  natureCode,
  impliedNote3Code,
  Assessment,
  TaxType,
  AddressRegistry,
  Business,
  normalizeBusinessStatus,
} from '../../types';
import {
  CADASTRAL_COLUMNS,
  computeMontantImpot,
  groupParcelsByOwner,
} from '../../services/propertyService';
import {
  subscribeToAddressRegistry,
  ensureAddressRegistrySeeded,
} from '../../services/addressService';
import {
  savePropertyParcel,
  subscribeToParcels,
} from '../../services/parcelService';
import {
  getTaxTypes,
  computeParcelTaxLines,
  buildTaxNotice,
  type TaxComputation,
} from '../../services/taxTypeService';
import {
  addAssessment,
  generateNextAssessmentNumber,
  subscribeToAssessments,
  subscribeToBusinesses,
  logAuditEvent,} from '../../services/dbService';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Button, Badge, Panel, EmptyState } from '../ui';
import { formatMoney } from '../../utils/money';

interface PropertyRegisterViewProps {
  userRole: string;
}

/** Icon per declared nature, so the register scans at a glance. */
const NATURE_ICON: Record<PropertyNature, React.ReactNode> = {
  'Immeuble commercial': <Building2 className="w-3.5 h-3.5" />,
  "Maison d'habitation": <Home className="w-3.5 h-3.5" />,
  'Étal / Kiosque': <Store className="w-3.5 h-3.5" />,
  'Hangar / Entrepôt': <Warehouse className="w-3.5 h-3.5" />,
  'Terrain nu': <MapPinned className="w-3.5 h-3.5" />,
  'Parcelle bâtie': <Landmark className="w-3.5 h-3.5" />,
};

/**
 * The cadastral register prints the NOTEZ code itself (EC, VI, INDUS…), the
 * abbreviation the classification is filed under. Shared with the lease
 * register so both print a nature the same way.
 */

/**
 * Tracks a CSS media query from React.
 *
 * The expanded detail row spans the table with a `colSpan`, which cannot be
 * expressed with responsive classes — so the breakpoint is read here and the
 * same flag drives both the column set and that span.
 */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() =>
    typeof window === 'undefined' ? true : window.matchMedia(query).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** The breakpoint at which the full six-column declaration is shown. */
const WIDE_QUERY = '(min-width: 1280px)';

/**
 * Column sizing for the cadastral declaration grid.
 *
 * The table is laid out with `table-layout: fixed`, so each column takes a
 * fixed share of the panel width and long values truncate with an ellipsis
 * instead of stretching the row past the viewport edge — which is what used to
 * force the horizontal scrollbar.
 *
 * Ville/territoire and Avenue/Localite are the two least discriminating
 * location columns (the city repeats on every row and the parcel is already
 * pinned by commune + quartier + avenue + numéro), so they step aside below
 * `xl`, where the 264px sidebar leaves too little room for six columns.
 */
const CADASTRAL_COL_CLASS: Record<string, string> = {
  nature: 'w-[12%] xl:w-[11%]',
  villeTerritoire: 'w-[12%]',
  communeChefferie: 'w-[18%]',
  quartierGroupement: 'w-[22%] xl:w-[20%]',
  avenueLocalite: 'w-[16%]',
  numeroParcelle: 'w-[15%]',
};

/** Columns dropped below `xl` to keep the declaration on a single page. */
const CADASTRAL_NARROW_HIDDEN = new Set(['villeTerritoire', 'avenueLocalite']);

/** The address levels a parcel can be filtered by, and how to read each one. */
type AddrDim = 'city' | 'commune' | 'quartier' | 'avenue';
const ADDR_DIMS: AddrDim[] = ['city', 'commune', 'quartier', 'avenue'];
const addrValueOf = (p: PropertyParcel, dim: AddrDim): string => {
  switch (dim) {
    case 'city':
      return (p.villeTerritoire || '').trim();
    case 'commune':
      return (p.communeChefferie || '').trim();
    case 'quartier':
      return (p.quartierGroupement || '').trim();
    default:
      return (p.avenueLocalite || '').trim();
  }
};

/**
 * The identifier a parcel is known by.
 *
 * Declarations now capture a `numeroParcelle`, but parcels filed before that
 * change only carry a `rang` — so both are read, in that order, everywhere a
 * parcel has to be named. A notice or a table cell must never come out blank
 * just because the record predates the field.
 */
function parcelRef(parcel: PropertyParcel): string {
  return (parcel.numeroParcelle || parcel.rang || '').trim();
}

export const PropertyRegisterView: React.FC<PropertyRegisterViewProps> = ({ userRole }) => {
  const { userProfile } = useAuth();
  const { showToast } = useToast();
  const [parcels, setParcels] = useState<PropertyParcel[]>([]);
  const isWide = useMediaQuery(WIDE_QUERY);
  const [searchQuery, setSearchQuery] = useState('');
  const [communeFilter, setCommuneFilter] = useState('ALL');
  // Address filters — 'ALL' means no restriction on that level.
  const [cityFilter, setCityFilter] = useState('ALL');
  const [quartierFilter, setQuartierFilter] = useState('ALL');
  const [avenueFilter, setAvenueFilter] = useState('ALL');
  const [isFormOpen, setIsFormOpen] = useState(false);
  /** The declaration open in the amendment form; null when none is being edited. */
  const [editingParcel, setEditingParcel] = useState<PropertyParcel | null>(null);

  /** Heads of tax levied as a percentage of a declared base (IF, IRL, …). */
  const [taxTypes, setTaxTypes] = useState<TaxType[]>([]);
  /** The administrative address tree (ville → commune → quartier → avenue). */
  const [addressRegistry, setAddressRegistry] = useState<AddressRegistry>(
    () => ({ id: 'addressHierarchy', villes: [], updatedAt: new Date(0).toISOString() })
  );
  /** Contributors on the roll, offered when assigning an asset to its owner. */
  const [contributors, setContributors] = useState<Business[]>([]);
  /** Notices already on the roll, so numbering continues rather than restarting. */
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  /** Parcel whose tax detail is expanded, keyed by parcel id. */
  const [expandedParcelId, setExpandedParcelId] = useState<string | null>(null);
  /** `parcelId:taxCode` of the notice currently being written. */
  const [issuingKey, setIssuingKey] = useState<string | null>(null);

  const canAdd = userRole === 'Admin' || userRole === 'Cashier' || userRole === 'Supervisor';
  /**
   * Amendments change the evidence behind a filed notice, so they are held to
   * the same roles that may issue one rather than to the wider counter roles.
   */
  const canEdit = userRole === 'Admin' || userRole === 'Supervisor';
  /** Only the roles that may issue a notice, mirroring the assessments module. */
  const canIssueNotice = userRole === 'Admin' || userRole === 'Supervisor';

  useEffect(() => {
    let cancelled = false;
    getTaxTypes()
      .then((types) => {
        if (!cancelled) setTaxTypes(types);
      })
      .catch((err) => console.warn('[Cadastre] Tax type load error:', err));

    // The address pickers read the Settings → Adresse tree. Seeded on first
    // read from the cadastral reference data, so a fresh database still offers
    // the places the register already knows about.
    void ensureAddressRegistrySeeded();
    const unsubAddresses = subscribeToAddressRegistry((registry) => {
      if (!cancelled) setAddressRegistry(registry);
    });

    const unsub = subscribeToAssessments(
      (data) => {
        if (!cancelled) setAssessments(data || []);
      },
      (err) => console.warn('[Cadastre] Assessments listener error:', err)
    );

    // The register itself is server-backed: a declaration that only lived in
    // this component disappeared on refresh, while the notice filed from it
    // survived — the ledger and its evidence disagreeing is the one state a
    // revenue system must never reach.
    const unsubParcels = subscribeToParcels(
      (data) => {
        if (!cancelled) setParcels(data || []);
      },
      (err) => console.warn('[Cadastre] Parcels listener error:', err)
    );

    return () => {
      cancelled = true;
      unsub();
      unsubAddresses();
      unsubParcels();
    };
  }, []);

  /**
   * Contributors on the roll, offered when assigning an asset to its owner.
   *
   * Subscribed rather than fetched: this is the same `/businesses` collection
   * the Taxpayer Registry roll reads, so a contributor enrolled in one place is
   * available here immediately. (`/taxpayers` is a separate, unused collection —
   * reading it is why the dropdown came up empty.)
   */
  useEffect(() => {
    const unsub = subscribeToBusinesses((data) => {
      setContributors(
        (data || [])
          .filter((b) => normalizeBusinessStatus(b.status) === 'Active')
          .sort((a, b) => (a.businessName || '').localeCompare(b.businessName || ''))
      );
    }, (err) => console.warn('[Cadastre] Contributors listener error:', err));

    return () => unsub();
  }, []);

  /**
   * File or amend a parcel declaration on the server.
   *
   * The row reaches the table through the listener rather than being prepended
   * here, so what an officer sees is what the database actually holds. A failed
   * write is reported instead of quietly kept in memory — the old behaviour,
   * which showed a declaration that vanished on the next refresh.
   */
  const saveParcel = async (
    parcel: PropertyParcel,
    mode: 'create' | 'update'
  ): Promise<boolean> => {
    if (!userProfile) {
      showToast('Sign in before filing a declaration.', 'error', 'Not Signed In');
      return false;
    }
    try {
      await savePropertyParcel(
        parcel,
        {
          uid: userProfile.uid,
          displayName: userProfile.displayName,
          role: userProfile.role,
        },
        mode
      );
      showToast(
        mode === 'update'
          ? `Parcel ${parcelRef(parcel)} updated on the cadastral register.`
          : `Parcel ${parcelRef(parcel)} filed on the cadastral register.`,
        'success',
        mode === 'update' ? 'Declaration Updated' : 'Declaration Filed'
      );
      return true;
    } catch (err) {
      console.error('[Cadastre] Parcel save failed:', err);
      showToast(
        `Declaration could not be saved: ${(err as Error)?.message || 'the server rejected the write'}`,
        'error',
        'Save Failed'
      );
      return false;
    }
  };

  /**
   * Issue an IF/IRL notice for one parcel.
   *
   * The notice denormalises the parcel identity, the declared base and the rate
   * — exactly as the patente flow denormalises business details — so a reprint
   * years later still shows the liability it was actually assessed at, even if
   * the parcel or the rate has since changed.
   */
  const issueTaxNotice = async (parcel: PropertyParcel, line: TaxComputation) => {
    if (!canIssueNotice) {
      showToast(
        'Only a Supervisor or Administrator may issue a tax notice.',
        'error',
        'Not Permitted'
      );
      return;
    }
    if (!userProfile) {
      showToast('Sign in before issuing a notice.', 'error', 'Not Signed In');
      return;
    }

    const key = `${parcel.id}:${line.taxType.code}`;
    if (issuingKey) return;

    const fiscalYear = parcel.exercice || new Date().getFullYear();
    const existing = assessments.find(
      (a) =>
        a.parcelId === parcel.id &&
        a.taxTypeCode === line.taxType.code &&
        a.fiscalYear === fiscalYear &&
        String(a.status) !== 'Cancelled'
    );
    if (existing) {
      showToast(
        `An ${line.taxType.code} notice for fiscal year ${fiscalYear} already exists for this parcel (${existing.assessmentNumber}). Cancel it before issuing a new one.`,
        'error',
        'Duplicate Notice'
      );
      return;
    }

    setIssuingKey(key);
    try {
      const number = generateNextAssessmentNumber(
        assessments,
        fiscalYear,
        line.taxType.numberPrefix
      );

      // Built by the shared factory so a notice is identical whichever screen
      // raised it — the rental register issues IRL notices through the same one.
      const notice = buildTaxNotice({
        taxType: line.taxType,
        ratePercent: line.ratePercent,
        baseUSD: line.baseUSD,
        subject: `${natureDisplay(parcel.nature)} — Parcelle ${parcelRef(parcel) || '—'}, ${parcel.quartierGroupement} (${parcel.communeChefferie})`,
        commune: parcel.communeChefferie,
        quartier: parcel.quartierGroupement,
        address: `${parcel.avenueLocalite}, ${parcel.quartierGroupement}`,
        parcelId: parcel.id,
        parcelRang: parcelRef(parcel),
        fiscalYear,
        assessmentNumber: number,
        assessor: { uid: userProfile.uid, displayName: userProfile.displayName },
      });

      await addAssessment(notice);
      setAssessments((prev) => [notice, ...prev]);

      await logAuditEvent(
        userProfile.uid,
        userProfile.displayName,
        userProfile.role,
        'CREATE_ASSESSMENT',
        'Assessment',
        notice.id,
        `Issuance of ${line.taxType.code} notice ${number} for parcel ${parcelRef(parcel) || '—'} (${parcel.quartierGroupement}, ${parcel.communeChefferie}): ${line.ratePercent}% of ${formatMoney(line.baseUSD)} = ${formatMoney(line.dutyUSD)}.`
      );

      showToast(
        `${line.taxType.code} notice ${number} issued — ${formatMoney(line.dutyUSD)} (${line.ratePercent}% of ${formatMoney(line.baseUSD)}).`,
        'success',
        'Notice Issued'
      );
    } catch (err) {
      console.error('[Cadastre] Notice issuance failed:', err);
      showToast(
        err instanceof Error ? err.message : 'Failed to issue the tax notice.',
        'error',
        'Issuance Failed'
      );
    } finally {
      setIssuingKey(null);
    }
  };

  /**
   * Current names for linked owners. A declaration keeps the owner name it was
   * filed under, so resolving the taxpayer id as well means a renamed
   * contributor is still found by the name the roll uses today.
   */
  const ownerNameByTaxpayerId = useMemo(() => {
    const names = new Map<string, string>();
    contributors.forEach((c) => {
      names.set(c.id, [c.businessName, c.ownerFullName].filter(Boolean).join(' '));
    });
    return names;
  }, [contributors]);

  /** Current filter value for one address level. */
  const addrFilterOf = (dim: AddrDim): string =>
    dim === 'city'
      ? cityFilter
      : dim === 'commune'
        ? communeFilter
        : dim === 'quartier'
          ? quartierFilter
          : avenueFilter;

  /**
   * Whether a parcel passes the address filters. `except` leaves one level out,
   * so each dropdown can list the values still reachable under the others.
   */
  const passesAddr = (p: PropertyParcel, except?: AddrDim) =>
    ADDR_DIMS.every((d) => {
      if (d === except) return true;
      const f = addrFilterOf(d);
      return f === 'ALL' || addrValueOf(p, d) === f;
    });

  /** Distinct, sorted options per level — narrowed by the other active filters. */
  const addrOptions = useMemo(() => {
    const build = (dim: AddrDim) => {
      const set = new Set(
        parcels.filter((p) => passesAddr(p, dim)).map((p) => addrValueOf(p, dim)).filter(Boolean)
      );
      const current = addrFilterOf(dim);
      if (current && current !== 'ALL') set.add(current); // keep a chosen value visible
      return Array.from(set).sort((a, b) => a.localeCompare(b));
    };
    return {
      city: build('city'),
      commune: build('commune'),
      quartier: build('quartier'),
      avenue: build('avenue'),
    } as Record<AddrDim, string[]>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcels, cityFilter, communeFilter, quartierFilter, avenueFilter]);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return parcels.filter((p) => {
      if (q) {
        const haystack = [
          // The owner is part of how a parcel is identified: searching a
          // proprietor's name must bring up every asset registered to them.
          p.ownerName,
          p.ownerTaxpayerId ? ownerNameByTaxpayerId.get(p.ownerTaxpayerId) : '',
          // Both spellings of the classification: the register shows the code,
          // so an officer searching "chalet" must still reach the EC row.
          p.nature,
          natureDisplay(p.nature),
          p.villeTerritoire,
          p.communeChefferie,
          p.quartierGroupement,
          p.avenueLocalite,
          parcelRef(p),
        ]
          .join(' ')
          .toLowerCase();
        // Every word must be present, in any order: "Byishimo Alfred" finds the
        // same proprietor as "Alfred Byishimo" without guessing at name order.
        if (!q.split(/\s+/).every((token) => haystack.includes(token))) return false;
      }
      return passesAddr(p);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcels, searchQuery, cityFilter, communeFilter, quartierFilter, avenueFilter, ownerNameByTaxpayerId]);

  /**
   * The filtered properties, grouped by proprietor: one person's assets occupy
   * a single block under their name instead of being scattered down the
   * register. A linked taxpayer's current roll name is preferred over the name
   * filed with the declaration.
   */
  const ownerGroups = useMemo(
    () =>
      groupParcelsByOwner(filtered).map((group) => ({
        ...group,
        displayName:
          (group.ownerTaxpayerId && ownerNameByTaxpayerId.get(group.ownerTaxpayerId)) ||
          group.ownerName ||
          '',
      })),
    [filtered, ownerNameByTaxpayerId]
  );

  /** Columns actually rendered — the header and every body row follow this. */
  const visibleColumns = useMemo(
    () => CADASTRAL_COLUMNS.filter((col) => isWide || !CADASTRAL_NARROW_HIDDEN.has(col.key)),
    [isWide]
  );

  /** Per-parcel tax lines, keyed by parcel id, for the expanded row. */
  const taxLinesByParcel = useMemo(() => {
    const map = new Map<string, TaxComputation[]>();
    filtered.forEach((p) => map.set(p.id, computeParcelTaxLines(p, taxTypes)));
    return map;
  }, [filtered, taxTypes]);

  const filtersActive =
    !!searchQuery ||
    communeFilter !== 'ALL' ||
    cityFilter !== 'ALL' ||
    quartierFilter !== 'ALL' ||
    avenueFilter !== 'ALL';

  const resetFilters = () => {
    setSearchQuery('');
    setCityFilter('ALL');
    setCommuneFilter('ALL');
    setQuartierFilter('ALL');
    setAvenueFilter('ALL');
  };

  return (
    <div className="space-y-8 font-sans">
      {/*
        The registry header above this subtab already carries the section title
        and description, so the cadastral view contributes only its actions.
      */}
      <div className="flex items-center justify-end gap-2.5 flex-wrap">
        {canAdd && (
          <Button
            variant="primary"
            size="md"
            icon={<Plus className="w-4 h-4" />}
            onClick={() => setIsFormOpen(true)}
          >
            Add Property
          </Button>
        )}
      </div>

      <Panel
        subtitle={`Displaying ${filtered.length} of ${parcels.length} registered properties`}
        padding="none"
      >
        {/* Filters */}
        <div className="p-4 sm:p-5 border-b border-line bg-surface2/30 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-9 py-2 bg-surface border border-line rounded-[10px] text-xs text-ink placeholder:text-muted focus:border-accent focus:outline-none transition-premium font-sans"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Effacer la recherche"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-[6px] text-muted hover:text-ink hover:bg-surface2 transition-premium cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {([
              { dim: 'city' as const, value: cityFilter, set: setCityFilter, all: 'Toutes les villes', label: 'Filtrer par ville' },
              { dim: 'commune' as const, value: communeFilter, set: setCommuneFilter, all: 'Toutes communes', label: 'Filtrer par commune' },
              { dim: 'quartier' as const, value: quartierFilter, set: setQuartierFilter, all: 'Tous les quartiers', label: 'Filtrer par quartier' },
              { dim: 'avenue' as const, value: avenueFilter, set: setAvenueFilter, all: 'Toutes les avenues', label: 'Filtrer par avenue' },
            ]).map(({ dim, value, set: setValue, all, label }) => (
              <select
                key={dim}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-label={label}
                title={label}
                className={`px-3 py-2 bg-surface border rounded-[10px] text-xs font-medium focus:border-accent focus:outline-none transition-premium font-sans cursor-pointer max-w-[10rem] truncate ${
                  value !== 'ALL' ? 'border-accent text-accent' : 'border-line text-ink'
                }`}
              >
                <option value="ALL">{all}</option>
                {addrOptions[dim].map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ))}

            {filtersActive && (
              <Button variant="secondary" size="sm" onClick={resetFilters} icon={<X className="w-3.5 h-3.5" />}>
                Effacer
              </Button>
            )}
          </div>
        </div>

        {/* Declaration table */}
        {filtered.length === 0 ? (
          <div className="p-8">
            <EmptyState
              icon={<MapPinned className="w-6 h-6" />}
              title={filtersActive ? 'Aucune parcelle ne correspond' : 'Le registre cadastral est vide'}
              description={
                filtersActive
                  ? 'No parcel matches the current criteria. Widen the filters to see the full declaration.'
                  : 'No taxable asset has been declared for this exercise yet.'
              }
              actionLabel={filtersActive ? 'Effacer les filtres' : undefined}
              onAction={filtersActive ? resetFilters : undefined}
            />
          </div>
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[640px] table-fixed text-left border-collapse font-sans">
              <thead>
                <tr className="border-b-2 border-line bg-surface2/60">
                  {visibleColumns.map((col) => (
                    <th
                      key={col.key}
                      title={`${col.label} — ${col.hint}`}
                      className={`${CADASTRAL_COL_CLASS[col.key]} text-[11px] font-bold uppercase tracking-[0.07em] leading-tight text-faint px-2.5 py-3.5 align-middle ${
                        col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'
                      }`}
                    >
                      {col.shortLabel}
                    </th>
                  ))}
                  {canEdit && (
                    <th
                      title="Edit a declaration"
                      className="w-[8%] px-2.5 py-3.5 text-right text-[11px] font-bold uppercase tracking-[0.07em] leading-tight text-faint align-middle"
                    >
                      Actions
                    </th>
                  )}
                </tr>
              </thead>

              <tbody className="divide-y divide-line">
                {ownerGroups.map((group) => (
                  <React.Fragment key={group.key}>
                    {/* ===== Propriétaire — one heading per person, whose
                        properties all sit beneath it. ===== */}
                    <tr className="bg-surface2/40">
                      <td
                        colSpan={visibleColumns.length + (canEdit ? 1 : 0)}
                        className="px-3 py-2 border-t border-line"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-5 h-5 rounded-[6px] bg-navy/10 text-navy flex items-center justify-center shrink-0">
                            <Users className="w-3 h-3" />
                          </span>
                          <span
                            className="text-xs font-bold text-ink truncate"
                            title={group.displayName || undefined}
                          >
                            {group.displayName || 'Sans contribuable rattaché'}
                          </span>
                          <span className="text-[11px] font-semibold text-muted whitespace-nowrap">
                            {group.parcels.length} propriété{group.parcels.length === 1 ? '' : 's'}
                          </span>
                        </div>
                      </td>
                    </tr>

                    {group.parcels.map((p) => {
                  const isExpanded = expandedParcelId === p.id;
                  const lines = taxLinesByParcel.get(p.id) || [];
                  const toggleExpanded = () =>
                    setExpandedParcelId((prev) => (prev === p.id ? null : p.id));

                  return (
                    <React.Fragment key={p.id}>
                    <tr
                      onClick={toggleExpanded}
                      onKeyDown={(e) => {
                        // Keys pressed inside the row's action button belong to
                        // that button, not to the row's expand/collapse handler.
                        if (e.target !== e.currentTarget) return;
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleExpanded();
                        }
                      }}
                      tabIndex={0}
                      aria-expanded={isExpanded}
                      title="View declared tax bases and issue an IF / IRL notice"
                      className={`cursor-pointer transition-premium ${
                        isExpanded ? 'bg-accent-soft/30' : 'hover:bg-surface2/30'
                      }`}
                    >
                      {/* Nature — the NOTEZ code, with its full label on hover */}
                      <td className="px-2.5 py-4 align-middle">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-7 h-7 rounded-[8px] bg-accent-soft text-accent flex items-center justify-center shrink-0">
                            {NATURE_ICON[p.nature as PropertyNature] ?? <Landmark className="w-3.5 h-3.5" />}
                          </span>
                          <span
                            className="text-xs font-bold text-ink font-mono tracking-wide truncate"
                            title={natureDisplay(p.nature)}
                          >
                            {natureCode(p.nature)}
                          </span>
                        </div>
                      </td>

                      {/* Ville / territoire */}
                      {isWide && (
                        <td className="px-2.5 py-4 align-middle">
                          <span className="text-xs font-medium text-ink truncate block" title={p.villeTerritoire}>
                            {p.villeTerritoire}
                          </span>
                        </td>
                      )}

                      {/* Commune / chefferie */}
                      <td className="px-2.5 py-4 align-middle">
                        <span
                          className="text-xs font-medium text-ink truncate block"
                          title={p.communeChefferie}
                        >
                          {p.communeChefferie}
                        </span>
                      </td>

                      {/* Quartier / groupement */}
                      <td className="px-2.5 py-4 align-middle">
                        <span className="text-xs text-ink truncate block" title={p.quartierGroupement}>
                          {p.quartierGroupement}
                        </span>
                      </td>

                      {/* Avenue / localite */}
                      {isWide && (
                        <td className="px-2.5 py-4 align-middle">
                          <span className="text-xs text-muted truncate block" title={p.avenueLocalite}>
                            {p.avenueLocalite}
                          </span>
                        </td>
                      )}

                      {/* Numéro de parcelle, and the row's expand affordance */}
                      <td className="px-2.5 py-4 text-center align-middle">
                        <div className="flex items-center justify-center gap-1.5">
                          <span className="text-xs font-bold text-ink font-mono tabular-nums truncate">
                            {parcelRef(p) || '—'}
                          </span>
                          <ChevronRight
                            className={`w-3.5 h-3.5 shrink-0 text-faint transition-premium ${
                              isExpanded ? 'rotate-90 text-accent' : ''
                            }`}
                          />
                        </div>
                      </td>

                      {/* Amendment action, separated from the row toggle */}
                      {canEdit && (
                        <td className="px-2.5 py-4 text-right align-middle">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingParcel(p);
                            }}
                            onKeyDown={(e) => e.stopPropagation()}
                            title={parcelRef(p) ? `Edit property ${parcelRef(p)}` : 'Edit property'}
                            aria-label={parcelRef(p) ? `Edit property ${parcelRef(p)}` : 'Edit property'}
                            className="p-1.5 rounded-[8px] text-muted hover:text-accent hover:bg-accent-soft transition-premium cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>

                    {/* ===== Declared tax bases & notice issuance ===== */}
                    {isExpanded && (
                      <tr className="bg-surface2/40">
                        <td
                          colSpan={visibleColumns.length + (canEdit ? 1 : 0)}
                          className="px-3 py-4"
                        >
                          <div className="rounded-[14px] border border-line bg-surface p-4">
                            <div className="flex items-start justify-between gap-3 flex-wrap">
                              <div className="min-w-0">
                                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-accent">
                                  Impôts déclaratifs
                                </div>
                                <div className="text-xs font-semibold text-ink mt-1">
                                  {natureDisplay(p.nature)} — Parcelle {parcelRef(p) || '—'},{' '}
                                  {p.quartierGroupement} ({p.communeChefferie})
                                </div>
                                <div className="text-[12px] text-muted mt-0.5">
                                  {p.avenueLocalite} • exercice {p.exercice}
                                </div>
                                <div className="text-[12px] text-muted mt-0.5 flex items-center gap-1.5">
                                  <Users className="w-3 h-3 shrink-0" />
                                  {p.ownerName ? (
                                    <span className="font-semibold text-ink">Propriétaire : {p.ownerName}</span>
                                  ) : (
                                    <span className="text-warn font-semibold">
                                      Aucun contribuable rattaché
                                    </span>
                                  )}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedParcelId(null);
                                }}
                                className="p-1.5 rounded-[8px] text-muted hover:text-ink hover:bg-surface2 transition-premium cursor-pointer shrink-0"
                                aria-label="Collapse"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            {lines.length === 0 ? (
                              <p className="mt-3 pt-3 border-t border-line text-[12px] text-muted">
                                No declared base recorded for this parcel, so no percentage tax is
                                computable. Declare the value of the asset and its rental income to
                                bring it into the IF / IRL assessment.
                              </p>
                            ) : (
                              <div className="mt-3 pt-3 border-t border-line grid grid-cols-1 md:grid-cols-2 gap-3">
                                {lines.map((line) => {
                                  const key = `${p.id}:${line.taxType.code}`;
                                  const issued = assessments.find(
                                    (a) =>
                                      a.parcelId === p.id &&
                                      a.taxTypeCode === line.taxType.code &&
                                      a.fiscalYear === p.exercice &&
                                      String(a.status) !== 'Cancelled'
                                  );
                                  const busy = issuingKey === key;

                                  return (
                                    <div
                                      key={line.taxType.code}
                                      className="rounded-[12px] border border-line bg-surface2/30 p-3"
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                          <Badge variant="accent" size="sm">
                                            {line.taxType.code}
                                          </Badge>
                                          <span className="text-xs font-bold text-ink tabular-nums">
                                            {line.ratePercent}%
                                          </span>
                                        </div>
                                        <span className="text-[11px] text-muted truncate">
                                          {line.taxType.labelEn}
                                        </span>
                                      </div>

                                      <dl className="mt-2 grid grid-cols-2 gap-2">
                                        <div>
                                          <dt className="text-[11px] uppercase tracking-wider text-muted">
                                            {line.taxType.baseDescription}
                                          </dt>
                                          <dd className="text-xs font-semibold text-ink tabular-nums">
                                            {formatMoney(line.baseUSD)}
                                          </dd>
                                        </div>
                                        <div className="text-right">
                                          <dt className="text-[11px] uppercase tracking-wider text-muted">
                                            Impôt dû ({line.ratePercent}%)
                                          </dt>
                                          <dd className="text-sm font-display font-bold text-accent tabular-nums">
                                            {formatMoney(line.dutyUSD)}
                                          </dd>
                                        </div>
                                      </dl>

                                      <div className="mt-3 flex items-center justify-between gap-2">
                                        {issued ? (
                                          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-sage">
                                            <FileCheck2 className="w-3.5 h-3.5" />
                                            Notice {issued.assessmentNumber} issued
                                          </span>
                                        ) : (
                                          <span className="text-[11px] text-muted">
                                            {canIssueNotice
                                              ? `Will be numbered ${line.taxType.numberPrefix}-${p.exercice}-…`
                                              : 'Supervisor or Admin required'}
                                          </span>
                                        )}
                                        <Button
                                          variant={issued ? 'ghost' : 'primary'}
                                          size="sm"
                                          disabled={!canIssueNotice || busy || !!issued}
                                          icon={<Receipt className="w-3.5 h-3.5" />}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void issueTaxNotice(p, line);
                                          }}
                                        >
                                          {issued ? 'Issued' : busy ? 'Issuing…' : 'Issue notice'}
                                        </Button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                    })}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {isFormOpen && (
        <AddPropertyModal
          mode="add"
          taxTypes={taxTypes}
          contributors={contributors}
          addressRegistry={addressRegistry}
          onClose={() => setIsFormOpen(false)}
          onSubmit={async (parcel) => {
            const saved = await saveParcel(parcel, 'create');
            if (saved) setIsFormOpen(false);
            return saved;
          }}
        />
      )}

      {editingParcel && (
        <AddPropertyModal
          key={editingParcel.id}
          mode="edit"
          initialParcel={editingParcel}
          taxTypes={taxTypes}
          contributors={contributors}
          addressRegistry={addressRegistry}
          onClose={() => setEditingParcel(null)}
          onSubmit={async (parcel) => {
            const saved = await saveParcel(parcel, 'update');
            if (saved) setEditingParcel(null);
            return saved;
          }}
        />
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Local presentation primitives                                     */
/* ------------------------------------------------------------------ */

/* ==================================================================== */
/*  Add Property modal                                                  */
/*  Declares a new parcel onto the cadastral register. The NOTEZ        */
/*  classification is the final, mandatory step — a declaration cannot  */
/*  be filed without it.                                                */
/* ==================================================================== */

interface AddPropertyModalProps {
  /** Whether this form creates a declaration or amends an existing one. */
  mode?: 'add' | 'edit';
  /** The filed declaration being amended (edit mode only). */
  initialParcel?: PropertyParcel;
  /** Active heads of tax, so the form can preview the IF / IRL liability. */
  taxTypes: TaxType[];
  /** Contributors on the roll, offered when assigning the asset to its owner. */
  contributors: Business[];
  /** The Settings → Adresse tree the location pickers read. */
  addressRegistry: AddressRegistry;
  onClose: () => void;
  onSubmit: (parcel: PropertyParcel) => Promise<boolean>;
}

/** One selectable node, as the pickers consume it. */
interface AddressOption {
  id: string;
  name: string;
}

/** The child list offered at each level, for the parent currently selected. */
interface AddressOptions {
  villes: AddressOption[];
  communes: AddressOption[];
  quartiers: AddressOption[];
  avenues: AddressOption[];
}

const NO_ADDRESS_OPTIONS: AddressOptions = { villes: [], communes: [], quartiers: [], avenues: [] };

/**
 * Options for each level, given the node selected at the level above.
 *
 * Read straight off the tree rather than filtered client-side, so a quartier can
 * never be offered under the wrong commune — the hierarchy is the only source of
 * truth for what belongs where.
 */
function addressOptionsFor(
  registry: AddressRegistry,
  villeId: string,
  communeId: string,
  quartierId: string
): AddressOptions {
  if (registry.villes.length === 0) return NO_ADDRESS_OPTIONS;

  const villes = registry.villes.map((v) => ({ id: v.id, name: v.name }));
  const ville = registry.villes.find((v) => v.id === villeId);
  const communes = ville ? ville.communes.map((c) => ({ id: c.id, name: c.name })) : [];
  const commune = ville?.communes.find((c) => c.id === communeId);
  const quartiers = commune ? commune.quartiers.map((q) => ({ id: q.id, name: q.name })) : [];
  const quartier = commune?.quartiers.find((q) => q.id === quartierId);
  const avenues = quartier ? quartier.avenues.map((a) => ({ id: a.id, name: a.name })) : [];

  return { villes, communes, quartiers, avenues };
}

/**
 * Resolve the ids of the nodes matching a parcel's stored names.
 *
 * The parcel records names, not ids, so a value prefilled from a contributor's
 * enrolment has to be matched back to a node before the picker can show it as
 * selected. Matching is by name at each level, walking down only as far as the
 * names resolve — a partial match still selects the levels it can.
 */
function resolveAddressIds(
  registry: AddressRegistry,
  villeName: string,
  communeName: string,
  quartierName: string,
  avenueName: string
): { villeId: string; communeId: string; quartierId: string; avenueId: string } {
  const blank = { villeId: '', communeId: '', quartierId: '', avenueId: '' };
  if (registry.villes.length === 0) return blank;

  const ville = registry.villes.find((v) => v.name === villeName);
  if (!ville) return blank;

  const commune = communeName ? ville.communes.find((c) => c.name === communeName) : undefined;
  if (communeName && !commune) return { ...blank, villeId: ville.id };

  const quartier = commune && quartierName ? commune.quartiers.find((q) => q.name === quartierName) : undefined;
  if (commune && quartierName && !quartier) return { ...blank, villeId: ville.id, communeId: commune.id };

  const avenue =
    quartier && avenueName ? quartier.avenues.find((a) => a.name === avenueName) : undefined;

  return {
    villeId: ville.id,
    communeId: commune?.id || '',
    quartierId: quartier?.id || '',
    avenueId: avenue?.id || '',
  };
}

/**
 * Full name of a contributor for the owner field: what the declaration records
 * and what the search box shows once they are chosen.
 *
 * Business name first — that is the name on the roll — then the proprietor for
 * a "Personne Physique", then the commune so same-name entries stay apart, then
 * the fiscal identifier if one has been assigned.
 */
function contributorOptionLabel(b: Business): string {
  const parts = [b.businessName];
  if (b.ownerFullName && b.ownerFullName !== b.businessName) parts.push(b.ownerFullName);
  if (b.commune) parts.push(b.commune);
  const label = parts.filter(Boolean).join(' — ');
  const nif = b.nif || b.nationalIdOrRccm;
  return nif ? `${label} • ${nif}` : label;
}

/** Labelled input used across the declaration form. */
const FormField: React.FC<{
  label: string;
  required?: boolean;
  error?: string;
  span?: boolean;
  hint?: string;
  children: React.ReactNode;
}> = ({ label, required, error, span, hint, children }) => (
  <div className={span ? 'sm:col-span-2' : ''}>
    <label className="block text-xs font-semibold text-ink mb-1">
      {label}
      {required && <span className="text-danger"> *</span>}
    </label>
    {children}
    {hint && !error && <p className="text-[11px] text-muted mt-1 leading-relaxed">{hint}</p>}
    {error && <p className="text-[12px] text-danger mt-1 font-medium">{error}</p>}
  </div>
);

const formInputClass =
  'w-full px-3.5 py-2 bg-surface2 border border-line rounded-[10px] text-xs text-ink placeholder:text-muted focus:border-accent focus:outline-none transition-premium font-sans';

const emptyDraft = (): PropertyParcel => ({
  id: '',
  nature: '' as PropertyNature,
  // Every address level and the declared use start unset: the officer states
  // them, the form does not guess them.
  villeTerritoire: '',
  communeChefferie: '',
  quartierGroupement: '',
  avenueLocalite: '',
  rang: '',
  numeroParcelle: '',
  usage: '' as PropertyUsage,
  measureKind: 'superficie',
  measureValue: 0,
  tauxUSD: 0,
  montantImpotUSD: 0,
  declaredValueUSD: 0,
  annualRentUSD: 0,
  note1Code: '' as Note1Code,
  note2Code: '' as Note2Code,
  note3Code: '' as Note3Code,
  exercice: 2026,
  registeredAt: new Date().toISOString(),
});

const AddPropertyModal: React.FC<AddPropertyModalProps> = ({
  mode = 'add',
  initialParcel,
  taxTypes,
  contributors,
  addressRegistry,
  onClose,
  onSubmit,
}) => {
  const isEdit = mode === 'edit';
  const [draft, setDraft] = useState<PropertyParcel>(() =>
    // Defaults first, then the filed declaration on top: a legacy record that
    // predates a field still opens with every input controlled.
    initialParcel ? { ...emptyDraft(), ...initialParcel } : emptyDraft()
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  /** Text in the owner search box, and whether its suggestions are showing. */
  const [ownerQuery, setOwnerQuery] = useState(() => {
    if (!initialParcel) return '';
    const owner = contributors.find((c) => c.id === initialParcel.ownerTaxpayerId);
    return owner ? contributorOptionLabel(owner) : (initialParcel.ownerName || '');
  });
  const [ownerOpen, setOwnerOpen] = useState(false);
  /** Highlighted suggestion, moved with the arrow keys. */
  const [ownerActive, setOwnerActive] = useState(0);
  const ownerBoxRef = useRef<HTMLDivElement>(null);

  /**
   * Which node is selected at each level. Held separately from the draft
   * because the parcel stores names while the pickers work in ids, and the
   * children offered depend on the parent chosen here.
   */
  const [addressIds, setAddressIds] = useState(() =>
    resolveAddressIds(
      addressRegistry,
      draft.villeTerritoire,
      draft.communeChefferie,
      draft.quartierGroupement,
      draft.avenueLocalite
    )
  );

  // A value prefilled from the contributor's enrolment has to be re-resolved
  // once the tree arrives — the ids cannot be known before then.
  const resolvedForRef = useRef('');
  useEffect(() => {
    if (addressRegistry.villes.length === 0) return;
    const signature = `${draft.villeTerritoire}|${draft.communeChefferie}|${draft.quartierGroupement}|${draft.avenueLocalite}`;
    if (resolvedForRef.current === signature) return;
    resolvedForRef.current = signature;
    setAddressIds(
      resolveAddressIds(
        addressRegistry,
        draft.villeTerritoire,
        draft.communeChefferie,
        draft.quartierGroupement,
        draft.avenueLocalite
      )
    );
  }, [addressRegistry, draft.villeTerritoire, draft.communeChefferie, draft.quartierGroupement, draft.avenueLocalite]);

  const options = useMemo(
    () => addressOptionsFor(addressRegistry, addressIds.villeId, addressIds.communeId, addressIds.quartierId),
    [addressRegistry, addressIds.villeId, addressIds.communeId, addressIds.quartierId]
  );

  const hasAddressTree = addressRegistry.villes.length > 0;

  /**
   * Choose a node at one level and carry the choice down.
   *
   * Changing a parent invalidates everything beneath it, but only where the
   * existing value no longer belongs: a commune still valid under the new ville
   * is kept rather than cleared, so switching the ville does not silently
   * discard a quartier the officer had already picked.
   */
  const selectAddress = (level: 'ville' | 'commune' | 'quartier' | 'avenue', nodeId: string) => {
    if (level === 'ville') {
      const ville = addressRegistry.villes.find((v) => v.id === nodeId);
      if (!ville) return;
      const keepCommune = ville.communes.find((c) => c.name === draft.communeChefferie);
      const keepQuartier = keepCommune?.quartiers.find((q) => q.name === draft.quartierGroupement);
      const keepAvenue = keepQuartier?.avenues.find((a) => a.name === draft.avenueLocalite);

      setAddressIds({
        villeId: ville.id,
        communeId: keepCommune?.id || '',
        quartierId: keepQuartier?.id || '',
        avenueId: keepAvenue?.id || '',
      });
      setDraft((prev) => ({
        ...prev,
        villeTerritoire: ville.name,
        communeChefferie: keepCommune?.name || '',
        quartierGroupement: keepQuartier?.name || '',
        avenueLocalite: keepAvenue?.name || '',
      }));
      setErrors((prev) => ({ ...prev, quartierGroupement: undefined, avenueLocalite: undefined }));
      return;
    }

    if (level === 'commune') {
      const node = addressRegistry.villes
        .find((v) => v.id === addressIds.villeId)
        ?.communes.find((c) => c.id === nodeId);
      if (!node) return;

      const keepQuartier = node.quartiers.find((q) => q.name === draft.quartierGroupement);
      const keepAvenue = keepQuartier?.avenues.find((a) => a.name === draft.avenueLocalite);

      setAddressIds({
        ...addressIds,
        communeId: node.id,
        quartierId: keepQuartier?.id || '',
        avenueId: keepAvenue?.id || '',
      });
      setDraft((prev) => ({
        ...prev,
        communeChefferie: node.name,
        quartierGroupement: keepQuartier?.name || '',
        avenueLocalite: keepAvenue?.name || '',
      }));
      setErrors((prev) => ({ ...prev, quartierGroupement: undefined, avenueLocalite: undefined }));
      return;
    }

    if (level === 'quartier') {
      const quartier = addressRegistry.villes
        .find((v) => v.id === addressIds.villeId)
        ?.communes.find((c) => c.id === addressIds.communeId)
        ?.quartiers.find((q) => q.id === nodeId);
      if (!quartier) return;

      const keepAvenue = quartier.avenues.find((a) => a.name === draft.avenueLocalite);

      setAddressIds({ ...addressIds, quartierId: quartier.id, avenueId: keepAvenue?.id || '' });
      setDraft((prev) => ({
        ...prev,
        quartierGroupement: quartier.name,
        avenueLocalite: keepAvenue?.name || '',
      }));
      setErrors((prev) => ({ ...prev, avenueLocalite: undefined }));
      return;
    }

    const avenue = addressRegistry.villes
      .find((v) => v.id === addressIds.villeId)
      ?.communes.find((c) => c.id === addressIds.communeId)
      ?.quartiers.find((q) => q.id === addressIds.quartierId)
      ?.avenues.find((a) => a.id === nodeId);
    if (!avenue) return;

    setAddressIds({ ...addressIds, avenueId: avenue.id });
    setDraft((prev) => ({ ...prev, avenueLocalite: avenue.name }));
    setErrors((prev) => ({ ...prev, avenueLocalite: undefined }));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Clicking past the search box dismisses its suggestions without clearing the
  // owner already named there.
  useEffect(() => {
    if (!ownerOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!ownerBoxRef.current?.contains(e.target as Node)) setOwnerOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [ownerOpen]);

  const patch = (next: Partial<PropertyParcel>) => setDraft((prev) => ({ ...prev, ...next }));

  /**
   * Contributors matching the owner query, every token of it satisfied.
   *
   * An empty query is not a search: it returns the whole roll, which is the
   * dropdown this field replaced. So suggestions appear only once the officer
   * has typed something, and a chosen owner keeps their name in the box.
   */
  const ownerMatches = useMemo(() => {
    const query = ownerQuery.trim().toLowerCase();
    if (!query) return [];
    const tokens = query.split(/\s+/);
    return contributors
      .filter((c) => {
        const haystack = [
          c.businessName,
          c.ownerFullName,
          c.nif,
          c.nationalIdOrRccm,
          c.commune,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return tokens.every((token) => haystack.includes(token));
      })
      .slice(0, 8);
  }, [contributors, ownerQuery]);

  /** Suggestions stay shut while the box still reads as the selected owner. */
  const ownerSelected = contributors.find((c) => c.id === draft.ownerTaxpayerId) || null;
  const showOwnerList =
    ownerOpen && ownerQuery.trim() !== (ownerSelected ? contributorOptionLabel(ownerSelected).trim() : '');

  /**
   * Name the contributor the asset belongs to — and nothing else. The parcel's
   * cadastral location and its numéro stay the officer's own assertion: an asset
   * is routinely not at its owner's registered address, and a declaration
   * inherits that error silently once the form fills it in for them.
   */
  const chooseOwner = (owner: Business) => {
    setDraft((prev) => ({
      ...prev,
      ownerTaxpayerId: owner.id,
      ownerName: owner.businessName,
    }));
    setErrors((prev) => ({ ...prev, ownerTaxpayerId: undefined }));
    setOwnerQuery(contributorOptionLabel(owner));
    setOwnerActive(0);
    setOwnerOpen(false);
  };

  /**
   * A declaration that predates the owner requirement may be amended without
   * forcing an owner onto it, but an owned asset cannot be saved ownerless.
   */
  const ownerRequired = !isEdit || !!initialParcel?.ownerTaxpayerId;

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    // An asset filed without an owner cannot be assessed, noticed or pursued —
    // so a new declaration is not accepted without one.
    if (ownerRequired && !draft.ownerTaxpayerId) {
      next.ownerTaxpayerId =
        contributors.length === 0
          ? 'No contributor is on the roll. Enrol a taxpayer before declaring an asset.'
          : 'Search by name and pick the contributor this property belongs to.';
    }
    if (!draft.quartierGroupement.trim()) next.quartierGroupement = 'Quartier / groupement is required.';
    if (!draft.avenueLocalite.trim()) next.avenueLocalite = 'Avenue / localite is required.';
    if (!draft.villeTerritoire.trim()) next.villeTerritoire = 'Ville / territoire is required.';
    if (!draft.communeChefferie.trim()) next.communeChefferie = 'Commune / chefferie is required.';
    // The declaration is identified by its numéro de parcelle now that the
    // measurement and tariff inputs are gone.
    if (!(draft.numeroParcelle || '').trim()) {
      next.numeroParcelle = 'Numéro de parcelle is required.';
    }
    // NOTEZ is mandatory: the asset cannot be filed unclassified.
    if (!draft.note1Code) next.note1Code = 'Select a Notez1 classification to file the declaration.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!validate()) return;
    setSaving(true);
    const filed = await onSubmit({
      ...draft,
      // An amendment keeps the filed parcel's id, so it overwrites the same
      // declaration instead of creating a second one.
      ...(isEdit
        ? {}
        : {
            id: 'par_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6),
            // No tariff is captured on a new declaration, so there is no derived
            // duty to file — the amount is assessed when a notice is raised.
            montantImpotUSD: 0,
          }),
      // Unanswered optional groups are recorded as absent, never as blanks.
      note2Code: (draft.note2Code || undefined) as Note2Code | undefined,
      note3Code: (draft.note3Code || undefined) as Note3Code | undefined,
    });
    // The modal stays open with the officer's input intact when the write fails,
    // so a rejected declaration can be corrected rather than retyped.
    if (!filed) setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/60 backdrop-blur-xs">
      <div className="bg-surface rounded-[18px] border border-line shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4.5 border-b border-line flex items-center justify-between gap-3 bg-surface">
          <div className="min-w-0">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-accent font-sans">
              {isEdit ? 'Modification cadastrale' : 'Déclaration cadastrale'}
            </span>
            <h2 className="font-display text-lg font-bold text-ink tracking-tight">
              {isEdit ? 'Edit Property' : 'Add Property'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close form"
            className="p-1.5 rounded-[8px] text-muted hover:text-ink hover:bg-surface2 transition-premium cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form id="add-property-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin">
          {/* 0. Propriétaire — who this asset is registered against. Placed first
              because every later section is read as a fact about that person. */}
          <div>
            <div className="text-[12px] font-bold uppercase tracking-wider text-muted mb-3 flex items-center gap-1.5 border-b border-line pb-1.5">
              <Users className="w-3.5 h-3.5 text-accent" />
              0. Propriétaire / Contribuable
            </div>

            {contributors.length === 0 ? (
              <div className="p-3.5 rounded-[12px] bg-warn/10 border border-warn/25 text-[12px] text-ink leading-relaxed flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-0.5" />
                <span>
                  No contributor is on the roll yet. Enrol the taxpayer first — a property cannot be
                  declared against an unknown owner.
                </span>
              </div>
            ) : (
              <>
                <FormField
                  label="Appartient au contribuable"
                  required={ownerRequired}
                  error={errors.ownerTaxpayerId}
                  hint="Search the roll by name, proprietor, NIF or commune. Only the owner is named here — the cadastral location and parcel number below are yours to state."
                >
                  <div ref={ownerBoxRef} className="relative">
                    <Search className="w-3.5 h-3.5 text-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="add-property-owner"
                      type="text"
                      role="combobox"
                      aria-expanded={showOwnerList}
                      aria-controls="add-property-owner-list"
                      aria-autocomplete="list"
                      autoComplete="off"
                      value={ownerQuery}
                      onFocus={(e) => {
                        setOwnerOpen(true);
                        // A chosen owner can be replaced by typing straight over
                        // their name, without erasing it first.
                        if (ownerSelected) e.target.select();
                      }}
                      onChange={(e) => {
                        setOwnerQuery(e.target.value);
                        setOwnerActive(0);
                        setOwnerOpen(true);
                        // Text that no longer reads as the chosen owner names
                        // nobody, so the selection goes with it.
                        if (draft.ownerTaxpayerId) patch({ ownerTaxpayerId: undefined, ownerName: undefined });
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          if (!showOwnerList) return;
                          // The list closes first; only a closed list lets Escape
                          // reach the form and dismiss the declaration.
                          e.stopPropagation();
                          setOwnerOpen(false);
                          return;
                        }
                        if (!showOwnerList || ownerMatches.length === 0) return;
                        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                          e.preventDefault();
                          const n = ownerMatches.length;
                          setOwnerActive((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
                        } else if (e.key === 'Enter') {
                          e.preventDefault();
                          chooseOwner(ownerMatches[ownerActive] ?? ownerMatches[0]);
                        }
                      }}
                      className={`${formInputClass} pl-9 pr-9 ${ownerSelected ? 'font-semibold' : ''} ${
                        errors.ownerTaxpayerId ? 'border-danger' : ''
                      }`}
                    />
                    {ownerSelected && (
                      <button
                        type="button"
                        aria-label="Retirer le contribuable choisi"
                        onClick={() => {
                          setOwnerQuery('');
                          setOwnerActive(0);
                          setOwnerOpen(false);
                          patch({ ownerTaxpayerId: undefined, ownerName: undefined });
                        }}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted hover:text-ink hover:bg-surface2 transition-premium cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {showOwnerList && (
                      <ul
                        id="add-property-owner-list"
                        role="listbox"
                        aria-label="Contribuables correspondants"
                        className="absolute z-20 left-0 right-0 mt-1.5 max-h-60 overflow-y-auto rounded-[12px] border border-line bg-surface shadow-2xl py-1.5 scrollbar-thin"
                      >
                        {ownerMatches.length === 0 ? (
                          <li className="px-3.5 py-2.5 text-[12px] text-muted">
                            Aucun contribuable ne correspond à{' '}
                            <span className="font-semibold text-ink">« {ownerQuery.trim()} »</span>.
                          </li>
                        ) : (
                          ownerMatches.map((c, i) => (
                            <li key={c.id} role="option" aria-selected={i === ownerActive}>
                              <button
                                type="button"
                                onMouseEnter={() => setOwnerActive(i)}
                                onClick={() => chooseOwner(c)}
                                className={`w-full text-left px-3.5 py-2 transition-premium cursor-pointer ${
                                  i === ownerActive ? 'bg-accent-soft' : ''
                                }`}
                              >
                                <span className="block text-xs font-semibold text-ink truncate">
                                  {c.businessName}
                                </span>
                                <span className="block text-[11px] text-muted font-mono truncate mt-0.5">
                                  {[
                                    c.ownerFullName && c.ownerFullName !== c.businessName ? c.ownerFullName : null,
                                    c.commune,
                                    c.nif || c.nationalIdOrRccm,
                                  ]
                                    .filter(Boolean)
                                    .join(' • ')}
                                </span>
                              </button>
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </div>
                </FormField>
              </>
            )}
          </div>

          {/* 1. Cadastral location */}
          <div>
            <div className="text-[12px] font-bold uppercase tracking-wider text-muted mb-3 flex items-center gap-1.5 border-b border-line pb-1.5">
              <MapPinned className="w-3.5 h-3.5 text-accent" />
              1. Localisation cadastrale
            </div>
            {/*
              One column, in the order the address register nests: ville, then
              its commune, then its quartier, then its avenue. Each answer opens
              the picker below it, so the eye never has to jump across a column
              to find the next level.
            */}
            <div className="grid grid-cols-1 gap-4">
              <FormField label="Nature">
                <select
                  value={draft.nature}
                  onChange={(e) => {
                    const code = e.target.value;
                    if (!code) {
                      patch({ nature: '' as PropertyNature });
                      return;
                    }
                    // NOTEZ 3 follows the classification: villa, hotel,
                    // industry and factory assets are rated on surface.
                    const implied = impliedNote3Code(code as Note1Code);
                    patch({
                      nature: code as PropertyNature,
                      note1Code: code as Note1Code,
                      ...(implied ? { note3Code: implied } : {}),
                    });
                  }}
                  className={formInputClass}
                >
                  <option value="">— Sélectionner —</option>
                  {draft.nature && !NOTEZ_BY_CODE.has(draft.nature) && (
                    <option value={draft.nature}>{natureDisplay(draft.nature)}</option>
                  )}
                  {/*
                    NOTEZ 1 only. Notez2 and Notez3 are still captured, but by
                    their own blocks further down the form — offering them here
                    as well put the same three answers in two places and let one
                    overwrite the other.
                  */}
                  <optgroup label="NOTEZ 1 — Classification cadastrale">
                    {NOTEZ1_CODES.map((entry) => (
                      <option key={entry.code} value={entry.code}>{entry.label} ({entry.code})</option>
                    ))}
                  </optgroup>
                </select>
              </FormField>

              {/*
                The four location fields are pickers over the Settings → Adresse
                tree, cascading ville → commune → quartier → avenue. Each list is
                read from the parent actually chosen, so a quartier can never be
                offered under the wrong commune.
              */}
              {!hasAddressTree && (
                <div className="p-3.5 rounded-[12px] bg-warn/10 border border-warn/25 text-[12px] text-ink leading-relaxed flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-0.5" />
                  <span>
                    The address register in Settings → Adresse is empty, so there is nothing to
                    pick from yet. Add a ville there and these fields will fill in.
                  </span>
                </div>
              )}

              <FormField label="Ville/territoire" required error={errors.villeTerritoire}>
                <select
                  id="add-property-ville"
                  value={addressIds.villeId}
                  onChange={(e) => selectAddress('ville', e.target.value)}
                  disabled={!hasAddressTree}
                  className={`${formInputClass} cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed`}
                >
                  <option value="">— Sélectionner —</option>
                  {options.villes.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField label="Commune/chefferie" required error={errors.communeChefferie}>
                <select
                  id="add-property-commune"
                  value={addressIds.communeId}
                  onChange={(e) => selectAddress('commune', e.target.value)}
                  disabled={!addressIds.villeId}
                  className={`${formInputClass} cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed`}
                >
                  <option value="">
                    {addressIds.villeId ? '— Sélectionner —' : 'Choisir la ville d’abord'}
                  </option>
                  {options.communes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField label="Quartier/groupement" required error={errors.quartierGroupement}>
                <select
                  id="add-property-quartier"
                  value={addressIds.quartierId}
                  onChange={(e) => selectAddress('quartier', e.target.value)}
                  disabled={!addressIds.communeId}
                  className={`${formInputClass} cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                    errors.quartierGroupement ? 'border-danger' : ''
                  }`}
                >
                  <option value="">
                    {addressIds.communeId ? '— Sélectionner —' : 'Choisir la commune d’abord'}
                  </option>
                  {options.quartiers.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.name}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField label="Avenue/Localite" required error={errors.avenueLocalite}>
                <select
                  id="add-property-avenue"
                  value={addressIds.avenueId}
                  onChange={(e) => selectAddress('avenue', e.target.value)}
                  disabled={!addressIds.quartierId}
                  className={`${formInputClass} cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${
                    errors.avenueLocalite ? 'border-danger' : ''
                  }`}
                >
                  <option value="">
                    {addressIds.quartierId ? '— Sélectionner —' : 'Choisir le quartier d’abord'}
                  </option>
                  {options.avenues.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
                {addressIds.quartierId && options.avenues.length === 0 && (
                  <p className="text-[11px] text-warn mt-1 leading-relaxed">
                    No avenue is recorded under this quartier — add one in Settings → Adresse before
                    the declaration can be filed.
                  </p>
                )}
              </FormField>

              <FormField
                label="Numéro de parcelle"
                required
                error={errors.numeroParcelle}
                hint="Cadastral parcel reference, stated by the officer — nothing is copied from the contributor's enrolment."
              >
                <input
                  id="add-property-numero-parcelle"
                  type="text"
                  value={draft.numeroParcelle || ''}
                  onChange={(e) => patch({ numeroParcelle: e.target.value })}
                  placeholder="e.g. 128"
                  className={`${formInputClass} font-mono ${
                    errors.numeroParcelle ? 'border-danger' : ''
                  }`}
                />
              </FormField>
            </div>
          </div>



          {/* NOTEZ 1 — mandatory primary classification */}
          <NotezGroup
            group={1}
            required
            codes={NOTEZ1_CODES}
            value={draft.note1Code}
            error={errors.note1Code}
            onChange={(code) => {
              // NOTEZ 3 follows the classification: villa, hotel, industry and
              // factory assets are rated on surface, everything else on units.
              const implied = impliedNote3Code(code);
              patch({
                note1Code: code,
                ...(implied ? { note3Code: implied } : {}),
              });
            }}
          />

          {/* NOTEZ 2 — declared fiscal destination */}
          <NotezGroup
            group={2}
            codes={NOTEZ2_CODES}
            value={draft.note2Code || ''}
            onChange={(code) => patch({ note2Code: code })}
          />

          {/* NOTEZ 3 — measurement basis for the duty */}
          <NotezGroup
            group={3}
            codes={NOTEZ3_CODES}
            value={draft.note3Code || ''}
            onChange={(code) => {
              // The basis the officer picked decides which column the measured
              // extent belongs in, so the two fields are kept in step.
              patch({
                note3Code: code,
                measureKind: code === 'SUP' ? 'superficie' : 'nombre',
              });
            }}
          />
        </form>

        {/* Footer — the duty readout is gone with the tariff inputs: a
            declaration files an identification, the amount is assessed when a
            notice is raised, so showing "$0" here would be misleading. */}
        <div className="px-6 py-3.5 border-t border-line bg-surface2/40 flex items-center justify-end gap-2.5">
          <Button variant="ghost" size="md" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
            <Button
              variant="primary"
              size="md"
              type="submit"
              form="add-property-form"
              disabled={saving}
            >
              {saving ? (isEdit ? 'Saving...' : 'Filing...') : isEdit ? 'Save Changes' : 'Save Property'}
            </Button>
        </div>
      </div>
    </div>
  );
};

/* ==================================================================== */
/*  NOTEZ group — one cadastral classification block                    */
/*                                                                      */
/*  The foncier declaration carries three of these: Notez1, Notez2 and  */
/*  Notez3. Each renders as a titled section whose heading IS the group */
/*  name, so the form reads exactly like the paper return.              */
/* ==================================================================== */

interface NotezGroupProps<T extends string> {
  /** Which NOTEZ block this is — 1, 2 or 3. Renders as the section title. */
  group: NoteGroup;
  /** Whether the block must be answered before the declaration is filed. */
  required?: boolean;
  codes: NoteCodeEntry<T>[];
  value: T | '';
  error?: string;
  onChange: (code: T) => void;
}

const NOTEZ_GROUP_HINT: Record<NoteGroup, string> = {
  1: 'Sélectionnez la classification cadastrale du bien. La déclaration ne peut être enregistrée sans Notez1.',
  2: 'Sélectionnez la destination fiscale déclarée du bien.',
  3: 'Sélectionnez la base de mesure du droit — superficie pour villa, hôtel, industrie et usines, nombre pour les autres propriétés.',
};

const NotezGroup = <T extends string>({
  group,
  required,
  codes,
  value,
  error,
  onChange,
}: NotezGroupProps<T>) => {
  const selected = codes.find((entry) => entry.code === value);

  return (
    <div>
      {/* Section title — the group name is the heading */}
      <div className="flex items-center justify-between gap-3 mb-3 border-b border-line pb-1.5">
        <div className="text-[12px] font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
          <Tag className="w-3.5 h-3.5 text-accent" />
          Notez{group}
          {required && <span className="text-danger">*</span>}
        </div>
        {selected && (
          <span className="text-[11px] font-bold uppercase tracking-wider text-accent font-sans">
            {selected.code} sélectionné
          </span>
        )}
      </div>

      <p className="text-[12px] text-muted mb-3 leading-relaxed">{NOTEZ_GROUP_HINT[group]}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {codes.map((entry) => {
          const active = entry.code === value;
          return (
            <button
              key={entry.code}
              type="button"
              onClick={() => onChange(entry.code)}
              aria-pressed={active}
              className={`group relative text-left px-3.5 py-3 rounded-[12px] border transition-premium cursor-pointer ${
                active
                  ? 'bg-accent-soft border-accent/40 shadow-[0_2px_10px_oklch(57%_0.16_36/0.16)]'
                  : 'bg-surface border-line hover:border-accent/30 hover:bg-surface2/50'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span
                  className={`font-display text-[14px] font-bold tracking-tight ${
                    active ? 'text-accent' : 'text-ink'
                  }`}
                >
                  {entry.code}
                </span>
                <span
                  className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-premium ${
                    active ? 'bg-accent border-accent' : 'border-line group-hover:border-accent/40'
                  }`}
                >
                  {active && <Check className="w-2.5 h-2.5 text-white" />}
                </span>
              </div>
              <div
                className={`text-[12px] font-semibold leading-snug ${
                  active ? 'text-ink' : 'text-muted'
                }`}
              >
                {entry.label}
              </div>
              <div className="text-[11px] text-muted leading-snug mt-0.5">{entry.description}</div>
            </button>
          );
        })}
      </div>

      {error && (
        <p className="text-[12px] text-danger mt-2 font-medium flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3" />
          {error}
        </p>
      )}
    </div>
  );
};
