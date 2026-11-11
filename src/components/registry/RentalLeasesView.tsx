import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  X,
  Users,
  Landmark,
  FileCheck2,
  AlertTriangle,
  CheckCircle2,
  Building2,
  Home,
  Store,
  Warehouse,
  MapPinned,
  Plus,
  ChevronRight,
  Lock,
  CalendarPlus,
} from 'lucide-react';
import {
  Business,
  PropertyParcel,
  RentalLease,
  UserRole,
  natureCode,
  natureDisplay,
} from '../../types';
import { computeRentalRoll, groupRentalRowsByTenant, monthsLetInExercise, shortDate } from '../../services/rentalService';
import {
  addLease,
  adjustLeasePeriod,
  isLeaseTermsLocked,
  periodsOverlap,
  subscribeToLeases,
  updateLeaseTerms,
} from '../../services/leaseService';
import { subscribeToParcels, subscribeToParcelsByOwner } from '../../services/parcelService';
import { subscribeToBusinesses } from '../../services/dbService';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { Button, EmptyState, Panel, MetricStrip } from '../ui';
import { usd } from './registryBits';
import { parseAmount } from '../../utils/taxCalc';

interface RentalLeasesViewProps {
  userRole: UserRole;
}

const EXERCICE = 2026;

/** Address levels the rental register can be filtered by. */
type LeaseAddrDim = 'city' | 'commune' | 'quartier' | 'avenue';
const LEASE_ADDR_DIMS: LeaseAddrDim[] = ['city', 'commune', 'quartier', 'avenue'];

/**
 * Icon per rented nature.
 *
 * Keyed by string, not `PropertyNature`: a declaration files a NOTEZ 1 code
 * (EC, VI, INDUS…) while older records carry the legacy nature name, and both
 * appear on this register. Anything unrecognised still gets a mark, so the row
 * never shows an empty square.
 */
const NATURE_ICON: Record<string, React.ReactNode> = {
  // NOTEZ 1 classifications
  VI: <Home className="w-3.5 h-3.5" />,
  AP: <Home className="w-3.5 h-3.5" />,
  EC: <Home className="w-3.5 h-3.5" />,
  HT: <Building2 className="w-3.5 h-3.5" />,
  SS: <Building2 className="w-3.5 h-3.5" />,
  INDUS: <Warehouse className="w-3.5 h-3.5" />,
  USN: <Warehouse className="w-3.5 h-3.5" />,
  AC: <Warehouse className="w-3.5 h-3.5" />,
  BPQ: <Warehouse className="w-3.5 h-3.5" />,
  TE: <MapPinned className="w-3.5 h-3.5" />,
  AT: <Landmark className="w-3.5 h-3.5" />,
  // legacy nature names, filed before the codes existed
  'Immeuble commercial': <Building2 className="w-3.5 h-3.5" />,
  "Maison d'habitation": <Home className="w-3.5 h-3.5" />,
  'Étal / Kiosque': <Store className="w-3.5 h-3.5" />,
  'Hangar / Entrepôt': <Warehouse className="w-3.5 h-3.5" />,
  'Terrain nu': <MapPinned className="w-3.5 h-3.5" />,
  'Parcelle bâtie': <Landmark className="w-3.5 h-3.5" />,
};

/** Icon for a nature value of either scheme, with a neutral fallback. */
function natureIcon(nature?: string | null): React.ReactNode {
  const value = (nature || '').trim();
  return NATURE_ICON[value.toUpperCase()] ?? NATURE_ICON[value] ?? NATURE_ICON.AT;
}


/** Display label for a bailleur, matching the taxpayer search convention. */
function bailleurLabel(b: Business): string {
  return [
    b.businessName,
    b.ownerFullName && b.ownerFullName !== b.businessName ? b.ownerFullName : null,
    b.commune,
  ]
    .filter(Boolean)
    .join(' — ');
}

/**
 * Label for one declared property in the picker.
 *
 * Leads with the parcel reference, then what it is and where — the three things
 * an officer needs to tell two buildings of the same owner apart.
 */
function parcelOptionLabel(p: PropertyParcel): string {
  const ref = p.numeroParcelle || p.rang || 'sans référence';
  return [
    `Parcelle ${ref}`,
    p.nature ? natureDisplay(p.nature) : null,
    `${p.quartierGroupement}, ${p.communeChefferie}`,
  ]
    .filter(Boolean)
    .join(' — ');
}

/**
 * Column sizing for the lease register.
 *
 * `table-layout: fixed`, so the eight columns divide the panel into exactly
 * equal shares — 12.5% each. Long values ellipsize instead of widening a row
 * into a scrollbar, and no column carries more empty space than another.
 */
const LEASE_COLUMNS = {
  number: 'w-[7%]',
  tenants: 'w-[11%]',
  nature: 'w-[7%]',
  ville: 'w-[7%]',
  commune: 'w-[8%]',
  quartier: 'w-[10%]',
  avenue: 'w-[9%]',
  parcel: 'w-[7%]',
  // Sized to "01/01/2026 → 30/04/2026" on one line, with no dead space after it.
  period: 'w-[15%]',
  rent: 'w-[8%]',
  gross: 'w-[11%]',
} as const;

/** Every column of the register — the span of a full-width row. */
const LEASE_COLUMN_COUNT = Object.keys(LEASE_COLUMNS).length;

/** Money on the register is shown to the cent. */
const usdExact = (n: number) => usd(n, { decimals: true });

/**
 * Parse a rent typed by an officer: "1 250,50", "1250.5" and "1,250.50" all
 * read as 1250.5. Returns NaN for anything that is not a number.
 *
 * Delegates to the shared `parseAmount` rather than keeping a local copy: the
 * local one treated a lone comma as a decimal mark unconditionally, so a rent
 * typed with French thousands grouping ("1,250") was read as 1.25 — a 1000×
 * understatement of the loyer mensuel, and so of the revenu brut the IRL
 * assessment is built on.
 */
function parseRent(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  return parseAmount(trimmed);
}

/** Validate a période + loyer pair; returns the problems found. */
function termsError(
  start: string,
  end: string,
  rent: string,
  bad: { start?: boolean; end?: boolean } = {}
): { period?: string; rent?: string } {
  const out: { period?: string; rent?: string } = {};
  if (bad.start || bad.end) {
    out.period = `Date ${bad.start ? 'de début' : 'de fin'} invalide — ce jour n’existe pas dans le calendrier (ex. 31/04).`;
  } else if (end && !start) out.period = 'Saisissez la date de début avant la date de fin.';
  else if (start && end && end < start) out.period = 'La date de fin précède la date de début.';
  const r = parseRent(rent);
  if (!Number.isFinite(r) || r < 0) out.rent = 'Montant invalide.';
  return out;
}

export const RentalLeasesView: React.FC<RentalLeasesViewProps> = ({ userRole }) => {
  const { userProfile } = useAuth();
  const { showToast } = useToast();

  const [leases, setLeases] = useState<RentalLease[]>([]);
  const [parcels, setParcels] = useState<PropertyParcel[]>([]);

  const [searchQuery, setSearchQuery] = useState('');
  // Address filters — '' means no restriction on that level.
  const [cityFilter, setCityFilter] = useState('');
  const [communeFilter, setCommuneFilter] = useState('');
  const [quartierFilter, setQuartierFilter] = useState('');
  const [avenueFilter, setAvenueFilter] = useState('');
  /** Lease whose bailleur detail is expanded beneath its row. */
  const [expandedLeaseId, setExpandedLeaseId] = useState<string | null>(null);
  /** The lease whose next période de location is being filed as a new record. */
  const [adjustTarget, setAdjustTarget] = useState<RentalLease | null>(null);

  /**
   * Lease registration — a tenancy is filed against one declared property and
   * takes its address from that property. Period and rent are captured
   * separately, so a tenancy may be filed before either is entered.
   */
  const [leaseOpen, setLeaseOpen] = useState(false);
  /**
   * Locataires on the contract, picked from the taxpayer roll. One contract may
   * name co-tenants: each is searched and added in turn.
   */
  const [tenants, setTenants] = useState<Business[]>([]);
  const [tenantQuery, setTenantQuery] = useState('');
  const [tenantOpen, setTenantOpen] = useState(false);
  const [tenantActive, setTenantActive] = useState(0);
  const tenantBoxRef = useRef<HTMLDivElement>(null);
  const [leaseErrors, setLeaseErrors] = useState<{
    tenants?: string;
    bailleur?: string;
    parcel?: string;
    period?: string;
    rent?: string;
  }>({});
  /** Période de location (YYYY-MM-DD) and loyer mensuel, as typed. */
  const [leaseStart, setLeaseStart] = useState('');
  const [leaseEnd, setLeaseEnd] = useState('');
  const [leaseRent, setLeaseRent] = useState('');
  /** True while a date field holds an impossible date the browser cannot read. */
  const [leaseStartBad, setLeaseStartBad] = useState(false);
  const [leaseEndBad, setLeaseEndBad] = useState(false);
  const [savingLease, setSavingLease] = useState(false);

  /** Bailleurs come from the taxpayer roll; the property belongs to one. */
  const [bailleurs, setBailleurs] = useState<Business[]>([]);
  const [bailleurQuery, setBailleurQuery] = useState('');
  const [selectedBailleur, setSelectedBailleur] = useState<Business | null>(null);
  const [bailleurOpen, setBailleurOpen] = useState(false);
  const [bailleurActive, setBailleurActive] = useState(0);
  const bailleurBoxRef = useRef<HTMLDivElement>(null);

  /** Properties declared against the selected bailleur — the pickable set. */
  const [ownerParcels, setOwnerParcels] = useState<PropertyParcel[]>([]);
  const [ownerParcelsLoading, setOwnerParcelsLoading] = useState(false);
  const [selectedParcel, setSelectedParcel] = useState<PropertyParcel | null>(null);

  const canManage = userRole !== 'Auditor';

  useEffect(() => {
    const unsub = subscribeToParcels(
      (data) => setParcels(data || []),
      (err) => console.warn('[Rentals] Parcel listener error:', err)
    );
    return unsub;
  }, []);

  /** The register is driven by the leases on file, newest first. */
  useEffect(() => {
    const unsub = subscribeToLeases(
      (data) => setLeases(data || []),
      (err) => console.warn('[Rentals] Lease listener error:', err)
    );
    return unsub;
  }, []);

  /**
   * The pickable properties for the selected bailleur, read on selection.
   *
   * Read on demand rather than filtered from the register subscription: that
   * window is capped at the newest parcels, and a bailleur's property must not
   * silently drop out of the picker because other contributors filed since.
   */
  useEffect(() => {
    if (!leaseOpen || !selectedBailleur) {
      setOwnerParcels([]);
      setOwnerParcelsLoading(false);
      return;
    }
    setOwnerParcelsLoading(true);
    const unsub = subscribeToParcelsByOwner(
      selectedBailleur.id,
      (data) => {
        setOwnerParcels(data || []);
        setOwnerParcelsLoading(false);
      },
      () => setOwnerParcelsLoading(false)
    );
    return unsub;
  }, [leaseOpen, selectedBailleur]);

  useEffect(() => {
    const unsub = subscribeToBusinesses(
      (data) => {
        setBailleurs(
          (data || [])
            .slice()
            .sort((a, b) => (a.businessName || '').localeCompare(b.businessName || ''))
        );
      },
      (err) => console.warn('[Rentals] Bailleur listener error:', err)
    );
    return unsub;
  }, []);

  useEffect(() => {
    if (!leaseOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !savingLease) setLeaseOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [leaseOpen, savingLease]);

  useEffect(() => {
    if (!bailleurOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (bailleurBoxRef.current && !bailleurBoxRef.current.contains(event.target as Node)) {
        setBailleurOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [bailleurOpen]);

  useEffect(() => {
    if (!tenantOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (tenantBoxRef.current && !tenantBoxRef.current.contains(event.target as Node)) {
        setTenantOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [tenantOpen]);

  /**
   * Locataire search over the same taxpayer roll. Taxpayers already on the
   * contract, and the selected bailleur, are not offered.
   */
  const tenantMatches = useMemo(() => {
    const q = tenantQuery.trim().toLowerCase();
    if (!q) return [];
    const tokens = q.split(/\s+/);
    const taken = new Set(tenants.map((t) => t.id));
    return bailleurs
      .filter((b) => !taken.has(b.id) && b.id !== selectedBailleur?.id)
      .filter((b) => {
        const haystack = [b.businessName, b.ownerFullName, b.nif, b.nationalIdOrRccm, b.commune, b.quartier]
          .join(' ')
          .toLowerCase();
        return tokens.every((token) => haystack.includes(token));
      })
      .slice(0, 8);
  }, [bailleurs, tenantQuery, tenants, selectedBailleur]);

  const showTenantList = tenantOpen && tenantQuery.trim().length > 0;

  /** Tokenised search over the roll, so name order does not matter. */
  const bailleurMatches = useMemo(() => {
    const q = bailleurQuery.trim().toLowerCase();
    if (!q) return [];
    const tokens = q.split(/\s+/);
    return bailleurs
      .filter((b) => {
        const haystack = [
          b.businessName,
          b.ownerFullName,
          b.nif,
          b.nationalIdOrRccm,
          b.commune,
          b.quartier,
        ]
          .join(' ')
          .toLowerCase();
        return tokens.every((token) => haystack.includes(token));
      })
      .slice(0, 8);
  }, [bailleurs, bailleurQuery]);

  const showBailleurList =
    bailleurOpen &&
    bailleurQuery.trim() !== (selectedBailleur ? bailleurLabel(selectedBailleur).trim() : '');

  /** Cadastral fields the lease row does not duplicate are read from its parcel. */
  const parcelById = useMemo(
    () => new Map(parcels.map((parcel) => [parcel.id, parcel])),
    [parcels]
  );

  /** Bailleur records from the taxpayer roll, for the expanded row detail. */
  const bailleurById = useMemo(
    () => new Map(bailleurs.map((bailleur) => [bailleur.id, bailleur])),
    [bailleurs]
  );

  /**
   * One address level for a lease — the same value the row prints: the lease's
   * own field, or the parcel's when the lease did not carry it.
   */
  const addrValueOf = useCallback(
    (l: RentalLease, dim: LeaseAddrDim): string => {
      const parcel = parcelById.get(l.parcelId);
      switch (dim) {
        case 'city':
          return (l.villeTerritoire || parcel?.villeTerritoire || '').trim();
        case 'commune':
          return (l.communeChefferie || parcel?.communeChefferie || '').trim();
        case 'quartier':
          return (l.quartierGroupement || parcel?.quartierGroupement || '').trim();
        default:
          return (parcel?.avenueLocalite || l.address || '').trim();
      }
    },
    [parcelById]
  );

  const addrFilterOf = (dim: LeaseAddrDim): string =>
    dim === 'city'
      ? cityFilter
      : dim === 'commune'
        ? communeFilter
        : dim === 'quartier'
          ? quartierFilter
          : avenueFilter;

  /** Whether a lease passes the address filters; `except` leaves one level out. */
  const passesAddr = useCallback(
    (l: RentalLease, except?: LeaseAddrDim) =>
      LEASE_ADDR_DIMS.every((d) => {
        if (d === except) return true;
        const f = d === 'city' ? cityFilter : d === 'commune' ? communeFilter : d === 'quartier' ? quartierFilter : avenueFilter;
        return !f || addrValueOf(l, d) === f;
      }),
    [addrValueOf, cityFilter, communeFilter, quartierFilter, avenueFilter]
  );

  /** Distinct, sorted options per level — narrowed by the other active filters. */
  const addrOptions = useMemo(() => {
    const selected: Record<LeaseAddrDim, string> = {
      city: cityFilter,
      commune: communeFilter,
      quartier: quartierFilter,
      avenue: avenueFilter,
    };
    const build = (dim: LeaseAddrDim) => {
      const set = new Set(
        leases.filter((l) => passesAddr(l, dim)).map((l) => addrValueOf(l, dim)).filter(Boolean)
      );
      if (selected[dim]) set.add(selected[dim]);
      return Array.from(set).sort((a, b) => a.localeCompare(b));
    };
    return {
      city: build('city'),
      commune: build('commune'),
      quartier: build('quartier'),
      avenue: build('avenue'),
    } as Record<LeaseAddrDim, string[]>;
  }, [leases, passesAddr, addrValueOf, cityFilter, communeFilter, quartierFilter, avenueFilter]);

  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return leases.filter((l) => {
      if (q) {
        const parcel = parcelById.get(l.parcelId);
        const haystack = [
          ...l.tenantNames,
          l.nature,
          natureDisplay(l.nature),
          l.address,
          l.quartierGroupement,
          l.communeChefferie,
          l.rang,
          l.numeroParcelle || '',
          l.villeTerritoire || '',
          l.unitLabel || '',
          parcel?.villeTerritoire || '',
          parcel?.avenueLocalite || '',
          parcel?.numeroParcelle || '',
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return passesAddr(l);
    });
  }, [leases, searchQuery, parcelById, passesAddr]);

  // The roll always follows the filtered rows, so its totals can never
  // contradict the table printed above them.
  const roll = useMemo(
    () => computeRentalRoll(filtered, EXERCICE),
    [filtered]
  );

  /**
   * The roll, grouped by locataire: a tenant with several documents gets one
   * block — their name printed once, each document listed beneath it — instead
   * of the name repeated on every row. `number` is the running document number.
   */
  const tenantGroups = useMemo(() => {
    const groups = groupRentalRowsByTenant(roll.rows);
    let n = 0;
    return groups.map((group) => ({
      ...group,
      rows: group.rows.map((row) => ({ ...row, number: ++n })),
    }));
  }, [roll.rows]);

  const filtersActive =
    !!searchQuery || !!cityFilter || !!communeFilter || !!quartierFilter || !!avenueFilter;

  const resetFilters = () => {
    setSearchQuery('');
    setCityFilter('');
    setCommuneFilter('');
    setQuartierFilter('');
    setAvenueFilter('');
  };

  const openLeaseModal = () => {
    if (!canManage) {
      showToast('Auditors have read-only access to the rental register.', 'warning', 'Restricted action');
      return;
    }
    setTenants([]);
    setTenantQuery('');
    setTenantOpen(false);
    setTenantActive(0);
    setLeaseErrors({});
    setLeaseStart('');
    setLeaseEnd('');
    setLeaseRent('');
    setLeaseStartBad(false);
    setLeaseEndBad(false);
    setBailleurQuery('');
    setSelectedBailleur(null);
    setBailleurOpen(false);
    setBailleurActive(0);
    setSelectedParcel(null);
    setLeaseOpen(true);
  };

  const closeLeaseModal = () => {
    if (savingLease) return;
    setLeaseOpen(false);
  };

  const chooseBailleur = (b: Business) => {
    setSelectedBailleur(b);
    setBailleurQuery(bailleurLabel(b));
    setBailleurOpen(false);
    setBailleurActive(0);
    // The property belongs to the bailleur, so a new bailleur invalidates the
    // choice that was made for the previous one — and the previous bailleur's
    // properties must not linger in the picker while the new ones load.
    setSelectedParcel(null);
    setOwnerParcels([]);
    setLeaseErrors((prev) => ({ ...prev, bailleur: undefined, parcel: undefined }));
  };

  const clearBailleur = () => {
    setBailleurQuery('');
    setSelectedBailleur(null);
    setSelectedParcel(null);
    setOwnerParcels([]);
    setBailleurActive(0);
    setBailleurOpen(false);
    setLeaseErrors((prev) => ({ ...prev, bailleur: undefined, parcel: undefined }));
  };

  /** Add a taxpayer from the roll to the contract as a locataire. */
  const chooseTenant = (b: Business) => {
    setTenants((prev) => (prev.some((t) => t.id === b.id) ? prev : [...prev, b]));
    setTenantQuery('');
    setTenantActive(0);
    setTenantOpen(false);
    setLeaseErrors((prev) => ({ ...prev, tenants: undefined }));
  };

  const removeTenant = (id: string) => {
    setTenants((prev) => prev.filter((t) => t.id !== id));
  };

  /**
   * One property answers the picker: select it silently.
   *
   * A bailleur who owns a single declared asset has nothing to choose between,
   * so asking would be a click that cannot change the outcome. Every other
   * count still requires a deliberate pick — guessing which building a tenant
   * occupies is exactly the mistake this form exists to prevent.
   */
  useEffect(() => {
    if (ownerParcels.length === 1 && !selectedParcel) {
      setSelectedParcel(ownerParcels[0]);
    }
  }, [ownerParcels, selectedParcel]);

  // A bailleur change drops the parcel with it — the effect above re-selects
  // once the new owner's properties arrive.
  useEffect(() => {
    if (
      selectedParcel &&
      selectedBailleur &&
      selectedParcel.ownerTaxpayerId &&
      selectedParcel.ownerTaxpayerId !== selectedBailleur.id
    ) {
      setSelectedParcel(null);
    }
  }, [selectedParcel, selectedBailleur]);

  const submitLease = async (event: React.FormEvent) => {
    event.preventDefault();
    if (savingLease) return;

    // Locataires are taxpayers picked from the roll — never free text.
    const submittedNames = tenants.map((t) => (t.businessName || '').trim()).filter(Boolean);

    const next: {
      tenants?: string;
      bailleur?: string;
      parcel?: string;
      period?: string;
      rent?: string;
    } = { ...termsError(leaseStart, leaseEnd, leaseRent, { start: leaseStartBad, end: leaseEndBad }) };
    if (tenants.length === 0) next.tenants = 'Search for the locataire on the taxpayer roll.';
    else if (selectedBailleur && tenants.some((t) => t.id === selectedBailleur.id)) {
      next.tenants = 'The bailleur cannot also be the locataire of their own property.';
    }
    if (!selectedBailleur) {
      next.bailleur = 'Select the property owner from the taxpayer roll.';
    }
    if (selectedBailleur && !ownerParcelsLoading && ownerParcels.length === 0) {
      next.parcel = 'No declared property for this bailleur.';
    } else if (selectedBailleur && !selectedParcel) {
      next.parcel = 'Select the property being let.';
    }
    setLeaseErrors(next);
    if (Object.keys(next).length > 0) return;

    if (!userProfile) {
      showToast('Sign in before registering a lease.', 'error', 'Not Signed In');
      return;
    }
    // Narrowed by the validation above; asserted so the call site stays honest.
    const parcel = selectedParcel as PropertyParcel;

    setSavingLease(true);
    try {
      await addLease(
        {
          tenantNames: submittedNames,
          tenantIds: tenants.map((t) => t.id),
          parcel,
          ...(leaseStart ? { startDate: leaseStart } : {}),
          ...(leaseEnd ? { endDate: leaseEnd } : {}),
          monthlyRentUSD: parseRent(leaseRent) || 0,
          exercice: EXERCICE,
        },
        { uid: userProfile.uid, displayName: userProfile.displayName, role: userProfile.role }
      );
      showToast(
        `Bail enregistré pour ${submittedNames.join(', ')} — ${
          parcel.numeroParcelle || parcel.rang
        }, ${parcel.quartierGroupement}.`,
        'success',
        'Lease Registered'
      );
      setLeaseOpen(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not register the lease.';
      showToast(message, 'error', 'Registration Failed');
    } finally {
      setSavingLease(false);
    }
  };

  return (
    <div className="space-y-8 font-sans">
      {/* ---- Summary ---------------------------------------------------- */}
      <MetricStrip
        columns={2}
        items={[
          {
            label: 'Locataires enregistrés',
            value: roll.totalTenants.toLocaleString('en-US'),
            subline: `${roll.totalLeases} document${roll.totalLeases === 1 ? '' : 's'} de bail`,
            icon: <FileCheck2 className="w-4 h-4 text-accent" />,
          },
          {
            label: 'Total revenu brut',
            value: usd(roll.totalGrossUSD),
            subline: 'loyers × mois loués',
            trendType: 'warn',
            icon: <Landmark className="w-4 h-4 text-warn" />,
          },
        ]}
      />

      {/* ---- Lease register --------------------------------------------- */}
      <Panel
        subtitle={`Précision sur les propriétés données en location — exercice ${EXERCICE}`}
        padding="none"
      >
        {/* Toolbar */}
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
                  value ? 'border-accent text-accent' : 'border-line text-ink'
                }`}
              >
                <option value="">{all}</option>
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

            {canManage && (
              <Button
                variant="primary"
                size="sm"
                icon={<Plus className="w-3.5 h-3.5" />}
                onClick={openLeaseModal}
              >
                Add Locataire
              </Button>
            )}
          </div>
        </div>

        {/* Keep the full headings readable; narrow screens scroll inside the panel. */}
        <div className="w-full overflow-x-auto">
          <table className="premium-table w-full min-w-[1000px] table-fixed text-left border-collapse font-sans">
            <thead>
              <tr className="border-b border-line bg-surface2/50">
                <th className={`${LEASE_COLUMNS.number} text-[11px] font-bold uppercase tracking-[0.07em] leading-tight text-faint px-2 py-3.5 align-middle text-left whitespace-nowrap`}>
                  Numero
                </th>
                <th className={`${LEASE_COLUMNS.tenants} text-[11px] font-bold uppercase tracking-[0.07em] leading-tight text-faint px-2 py-3.5 align-middle text-left overflow-hidden`}>
                  Noms des Locataires
                </th>
                <th className={`${LEASE_COLUMNS.nature} text-[11px] font-bold uppercase tracking-[0.07em] leading-tight text-faint px-2 py-3.5 align-middle text-left overflow-hidden`}>
                  Nature
                </th>
                <th className={`${LEASE_COLUMNS.ville} text-[11px] font-bold uppercase tracking-[0.07em] leading-tight text-faint px-2 py-3.5 align-middle text-left overflow-hidden`}>
                  ville
                </th>
                <th className={`${LEASE_COLUMNS.commune} text-[11px] font-bold uppercase tracking-[0.07em] leading-tight text-faint px-2 py-3.5 align-middle text-left overflow-hidden`}>
                  commune
                </th>
                <th className={`${LEASE_COLUMNS.quartier} text-[11px] font-bold uppercase tracking-[0.07em] leading-tight text-faint px-2 py-3.5 align-middle text-left overflow-hidden`}>
                  Quartier
                </th>
                <th className={`${LEASE_COLUMNS.avenue} text-[11px] font-bold uppercase tracking-[0.07em] leading-tight text-faint px-2 py-3.5 align-middle text-left overflow-hidden`}>
                  Avenue
                </th>
                <th className={`${LEASE_COLUMNS.parcel} text-[11px] font-bold uppercase tracking-[0.07em] leading-tight text-faint px-2 py-3.5 align-middle text-left overflow-hidden`}>
                  Numero de parcelle
                </th>
                <th className={`${LEASE_COLUMNS.period} text-[11px] font-bold uppercase tracking-[0.07em] leading-tight text-faint px-2 py-3.5 align-middle text-left overflow-hidden`}>
                  Période de location
                </th>
                <th className={`${LEASE_COLUMNS.rent} text-[11px] font-bold uppercase tracking-[0.07em] leading-tight text-faint px-2 py-3.5 align-middle text-right overflow-hidden`}>
                  Loyer mensuel
                </th>
                <th className={`${LEASE_COLUMNS.gross} text-[11px] font-bold uppercase tracking-[0.07em] leading-tight text-faint px-2 py-3.5 pr-7 align-middle text-right overflow-hidden`}>
                  Total revenu brut
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {roll.rows.length === 0 ? (
                <tr>
                  <td colSpan={LEASE_COLUMN_COUNT} className="px-4 py-6">
                    <EmptyState
                      icon={<FileCheck2 className="w-6 h-6" />}
                      title={filtersActive ? 'Aucun bail ne correspond' : 'Aucun bail enregistré'}
                      description={
                        filtersActive
                          ? 'No lease matches the current criteria. Widen the filters to see the full register.'
                          : 'No tenancy has been declared for this exercise yet. Name the locataire, pick the property owner, and the property address fills itself in.'
                      }
                      actionLabel={filtersActive ? 'Effacer les filtres' : canManage ? 'Add Locataire' : undefined}
                      onAction={filtersActive ? resetFilters : canManage ? openLeaseModal : undefined}
                    />
                  </td>
                </tr>
              ) : (
                tenantGroups.map((group) => {
                  const expandedRow =
                    group.rows.find((r) => r.lease.id === expandedLeaseId) || null;
                  const expandedParcel = expandedRow
                    ? parcelById.get(expandedRow.lease.parcelId)
                    : undefined;
                  const expandedBailleur = expandedRow
                    ? bailleurById.get(
                        expandedRow.lease.bailleurId || expandedParcel?.ownerTaxpayerId || ''
                      ) || null
                    : null;
                  const expandedBailleurName = expandedRow
                    ? expandedRow.lease.bailleurName ||
                      expandedBailleur?.businessName ||
                      expandedParcel?.ownerName ||
                      ''
                    : '';
                  const expandedBailleurAddress = [
                    expandedBailleur?.physicalAddress,
                    [expandedBailleur?.commune, expandedBailleur?.quartier]
                      .filter(Boolean)
                      .join(', '),
                  ]
                    .filter(Boolean)
                    .join(' • ');

                  return (
                    <React.Fragment key={group.key}>
                    {group.rows.map(({ lease, monthsLet, grossUSD, number: displayNumber }, rowIndex) => {
                      const parcel = parcelById.get(lease.parcelId);
                      const isFirstOfGroup = rowIndex === 0;
                      const isExpanded = expandedLeaseId === lease.id;
                      const toggleExpanded = () =>
                        setExpandedLeaseId((prev) => (prev === lease.id ? null : lease.id));

                      return (
                        <tr
                          key={lease.id}
                          onClick={toggleExpanded}
                          onKeyDown={(e) => {
                            if (e.target !== e.currentTarget) return;
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              toggleExpanded();
                            }
                          }}
                          tabIndex={0}
                          aria-expanded={isExpanded}
                          title="View the bailleur for this lease"
                          className={`cursor-pointer transition-premium align-top ${
                            isExpanded ? 'bg-accent-soft/30' : 'hover:bg-surface2/30'
                          }`}
                        >
                          {/* Numero */}
                          <td className="px-2 py-3.5 align-top">
                            <span className="text-xs font-bold text-ink tabular-nums">
                              {String(displayNumber).padStart(2, '0')}
                            </span>
                          </td>

                          {/* Noms des Locataires — one cell for the whole locataire,
                              spanning every document filed under them. */}
                          {isFirstOfGroup && (
                            <td
                              rowSpan={group.rows.length}
                              className="px-2 py-3.5 align-top border-r border-line/40"
                            >
                              <div className="min-w-0">
                                {group.tenantNames.map((name, i) => (
                                  <div
                                    key={`${group.key}_${i}`}
                                    className="text-xs font-bold text-ink truncate"
                                    title={name}
                                  >
                                    {name}
                                  </div>
                                ))}
                                {group.rows.length > 1 ? (
                                  <div className="text-[11px] font-semibold text-accent mt-0.5">
                                    {group.rows.length} documents
                                  </div>
                                ) : (
                                  lease.unitLabel && (
                                    <div className="text-[11px] text-muted truncate mt-0.5">
                                      {lease.unitLabel}
                                    </div>
                                  )
                                )}
                              </div>
                            </td>
                          )}

                          {/* Nature — abbreviated to its NOTEZ code, full label on hover */}
                          <td className="px-2 py-3.5 align-top">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="w-5 h-5 rounded-[6px] bg-accent-soft text-accent flex items-center justify-center shrink-0">
                                {natureIcon(lease.nature)}
                              </span>
                              <span
                                className="text-xs font-bold text-ink font-mono truncate"
                                title={natureDisplay(lease.nature)}
                              >
                                {natureCode(lease.nature)}
                              </span>
                            </div>
                          </td>

                          {/* ville */}
                          <td className="px-2 py-3.5 align-top">
                            <span
                              className="block text-xs text-ink truncate"
                              title={lease.villeTerritoire || parcel?.villeTerritoire || undefined}
                            >
                              {lease.villeTerritoire || parcel?.villeTerritoire || '—'}
                            </span>
                          </td>

                          {/* commune */}
                          <td className="px-2 py-3.5 align-top">
                            <span
                              className="block text-xs text-ink truncate"
                              title={lease.communeChefferie || parcel?.communeChefferie || undefined}
                            >
                              {lease.communeChefferie || parcel?.communeChefferie || '—'}
                            </span>
                          </td>

                          {/* Quartier */}
                          <td className="px-2 py-3.5 align-top">
                            <span
                              className="block text-xs text-ink truncate"
                              title={lease.quartierGroupement || parcel?.quartierGroupement || undefined}
                            >
                              {lease.quartierGroupement || parcel?.quartierGroupement || '—'}
                            </span>
                          </td>

                          {/* Avenue */}
                          <td className="px-2 py-3.5 align-top">
                            <span
                              className="block text-xs text-ink truncate"
                              title={parcel?.avenueLocalite || lease.address}
                            >
                              {parcel?.avenueLocalite || lease.address || '—'}
                            </span>
                          </td>

                          {/* Numero de parcelle */}
                          <td className="px-2 py-3.5 align-top">
                            <span className="block text-xs font-mono text-ink truncate">
                              {lease.numeroParcelle || parcel?.numeroParcelle || '—'}
                            </span>
                          </td>

                          {/* Période de location — dates, then the months counted in the exercise */}
                          <td className="px-2 py-3.5 align-top">
                            {lease.startDate ? (
                              <>
                                <div className="text-[12px] font-medium text-ink tabular-nums whitespace-nowrap">
                                  {shortDate(lease.startDate)} →{' '}
                                  {lease.endDate ? shortDate(lease.endDate) : 'En cours'}
                                </div>
                                <div className="text-[11px] text-muted tabular-nums mt-0.5 flex items-center gap-1">
                                  {isLeaseTermsLocked(lease) && (
                                    <Lock className="w-2.5 h-2.5 text-faint shrink-0" aria-label="Verrouillé" />
                                  )}
                                  {monthsLet} mois en {EXERCICE}
                                </div>
                              </>
                            ) : (
                              <span className="text-[12px] text-faint italic">Non renseignée</span>
                            )}
                            {lease.vacatedAt && (
                              <div
                                className="mt-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-[6px] bg-warn/15 text-warn text-[10px] font-bold uppercase tracking-wide whitespace-nowrap"
                                title={`Locataire retiré de cette propriété${
                                  lease.moveOutDate ? ` — départ le ${shortDate(lease.moveOutDate)}` : ''
                                }${lease.vacatedReason ? ` (${lease.vacatedReason})` : ''}`}
                              >
                                Locataire parti{lease.moveOutDate ? ` · ${shortDate(lease.moveOutDate)}` : ''}
                              </div>
                            )}
                          </td>

                          {/* Loyer mensuel */}
                          <td className="px-2 py-3.5 align-top text-right">
                            {lease.monthlyRentUSD > 0 ? (
                              <span className="text-xs font-medium text-ink tabular-nums">
                                {usdExact(lease.monthlyRentUSD)}
                              </span>
                            ) : (
                              <span className="text-[12px] text-faint italic">Non renseigné</span>
                            )}
                          </td>

                          {/* Total revenu brut = loyer mensuel × mois loués, and the expand affordance */}
                          <td className="px-2 py-3.5 align-top">
                            <div className="flex items-start justify-end gap-1.5 min-w-0">
                              <div className="text-right min-w-0">
                                {lease.monthlyRentUSD > 0 && lease.startDate ? (
                                  <>
                                    <div className="text-xs font-bold text-ink tabular-nums truncate">
                                      {usdExact(grossUSD)}
                                    </div>
                                    <div className="text-[11px] text-faint tabular-nums mt-0.5 truncate">
                                      {usdExact(lease.monthlyRentUSD)} × {monthsLet}
                                    </div>
                                  </>
                                ) : (
                                  <span className="text-[12px] text-faint">—</span>
                                )}
                              </div>
                              <ChevronRight
                                className={`w-3.5 h-3.5 mt-0.5 shrink-0 text-faint transition-premium ${
                                  isExpanded ? 'rotate-90 text-accent' : ''
                                }`}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}

                    {/* ===== Bailleur detail — the document currently being viewed ===== */}
                    {expandedRow && (
                      <tr className="bg-surface2/40">
                        <td colSpan={LEASE_COLUMN_COUNT} className="px-3 py-4">
                          <div className="rounded-[14px] border border-line bg-surface p-4">
                            <div className="flex items-start justify-between gap-3 flex-wrap">
                              <div className="min-w-0">
                                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-accent">
                                  Bailleur
                                </div>
                                <div className="text-sm font-bold text-ink mt-1">
                                  {expandedBailleurName || 'Aucun bailleur rattaché'}
                                </div>
                                <div className="text-[12px] text-muted mt-0.5">
                                  {expandedBailleur?.nif
                                    ? `NIF ${expandedBailleur.nif}`
                                    : 'NIF non renseigné'}
                                  {expandedBailleur?.phoneNumber ? ` • ${expandedBailleur.phoneNumber}` : ''}
                                </div>
                                {expandedBailleurAddress && (
                                  <div className="text-[12px] text-muted mt-0.5">
                                    {expandedBailleurAddress}
                                  </div>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => setExpandedLeaseId(null)}
                                className="p-1.5 rounded-[8px] text-muted hover:text-ink hover:bg-surface2 transition-premium cursor-pointer shrink-0"
                                aria-label="Collapse"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            <div className="mt-3 pt-3 border-t border-line grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div>
                                <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                                  Locataire{expandedRow.lease.tenantNames.length === 1 ? '' : 's'}
                                </div>
                                <div className="text-xs font-semibold text-ink mt-0.5">
                                  {group.tenantNames.join(', ')}
                                </div>
                              </div>
                              <div>
                                <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                                  Bien loué
                                </div>
                                <div className="text-xs font-semibold text-ink mt-0.5">
                                  Parcelle{' '}
                                  {expandedRow.lease.numeroParcelle ||
                                    expandedParcel?.numeroParcelle ||
                                    '—'}{' '}
                                  — {expandedRow.lease.quartierGroupement}
                                </div>
                                <div className="text-[12px] text-muted mt-0.5">
                                  {expandedParcel?.avenueLocalite || expandedRow.lease.address || '—'}{' '}
                                  • exercice {expandedRow.lease.exercice}
                                </div>
                              </div>
                            </div>

                            <LeaseTermsEditor
                              key={expandedRow.lease.id}
                              lease={expandedRow.lease}
                              canEdit={canManage}
                              onSave={async (terms) => {
                                if (!userProfile) {
                                  throw new Error('Connectez-vous avant de modifier un bail.');
                                }
                                await updateLeaseTerms(expandedRow.lease, terms, {
                                  uid: userProfile.uid,
                                  displayName: userProfile.displayName,
                                  role: userProfile.role,
                                });
                                showToast(
                                  `Période et loyer enregistrés pour ${expandedRow.lease.tenantNames.join(', ')}.`,
                                  'success',
                                  'Bail mis à jour'
                                );
                              }}
                              onError={(message) => showToast(message, 'error', 'Échec')}
                              onNewPeriod={() => setAdjustTarget(expandedRow.lease)}
                            />

                            {!expandedBailleurName && (
                              <p className="mt-3 pt-3 border-t border-line text-[12px] text-warn">
                                This lease has no bailleur on file. Attach the property to a
                                taxpayer in its cadastral declaration so the owner can be shown here.
                              </p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>

          </table>
        </div>

        <div className="px-4 py-3 border-t border-line bg-surface2/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <p className="text-[11px] text-muted leading-relaxed max-w-[70ch]">
            Le revenu brut d'un bail correspond au loyer mensuel multiplié par le nombre de mois
            loués au cours de l'exercice — un bail résilié en cours d'année ne compte que les mois
            réellement loués.
          </p>
          <span className="text-[11px] text-muted tabular-nums whitespace-nowrap">
            Exercice {EXERCICE}
          </span>
        </div>
      </Panel>

      {adjustTarget && (
        <NextPeriodModal
          lease={adjustTarget}
          siblings={leases.filter(
            (other) =>
              other.id !== adjustTarget.id &&
              other.parcelId === adjustTarget.parcelId &&
              // Same tenancy = a shared locataire on the same parcelle.
              other.tenantNames.some((name) =>
                adjustTarget.tenantNames.some((own) => own.toLowerCase() === name.toLowerCase())
              )
          )}
          onClose={() => setAdjustTarget(null)}
          onError={(message) => showToast(message, 'error', 'Échec')}
          onSubmit={async (terms) => {
            if (!userProfile) {
              throw new Error('Connectez-vous avant d’ajuster une période.');
            }
            const created = await adjustLeasePeriod(adjustTarget, terms, {
              uid: userProfile.uid,
              displayName: userProfile.displayName,
              role: userProfile.role,
            });
            setAdjustTarget(null);
            // Collapse the old row so the newly filed period is what stands out.
            setExpandedLeaseId(null);
            showToast(
              `Nouveau bail créé pour ${created.tenantNames.join(', ')} : ${shortDate(
                created.startDate
              )} → ${created.endDate ? shortDate(created.endDate) : 'en cours'}. Le bail précédent reste inchangé.`,
              'success',
              'Période ajustée'
            );
          }}
        />
      )}

      {leaseOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-navy/70 backdrop-blur-xs animate-in fade-in duration-150"
            onClick={closeLeaseModal}
            aria-hidden="true"
          />
          {/* Height-capped so the footer stays reachable on a short window;
              the form body scrolls instead of the panel growing past the edge. */}
          <div className="relative bg-surface rounded-[18px] border border-line shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="shrink-0 px-6 py-5 border-b border-line flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-[13px] bg-accent/12 text-accent flex items-center justify-center">
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-accent font-sans">
                    Rental Register
                  </span>
                  <h3 className="font-display text-lg font-bold text-ink tracking-tight">Add Locataire</h3>
                </div>
              </div>
              <button
                type="button"
                onClick={closeLeaseModal}
                disabled={savingLease}
                aria-label="Close lease form"
                className="p-1.5 rounded-[8px] text-muted hover:text-ink hover:bg-surface2 transition-premium cursor-pointer shrink-0 disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* The form is the flex column: fields scroll, actions stay pinned
                and remain inside the form so the submit button keeps working. */}
            <form onSubmit={submitLease} className="flex-1 min-h-0 flex flex-col">
              <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-4 scrollbar-thin">
              {/* ---- Locataire — searched on the taxpayer roll ---- */}
              <div className="block">
                <span className="block text-xs font-bold text-ink mb-1.5">Locataire</span>
                <div ref={tenantBoxRef} className="relative">
                  <div
                    className={`flex flex-wrap items-center gap-1.5 min-h-10 pl-9 pr-2 py-1.5 rounded-[10px] bg-surface2 border focus-within:border-accent ${
                      leaseErrors.tenants ? 'border-danger' : 'border-line'
                    }`}
                  >
                    <Search className="w-4 h-4 text-muted absolute left-3 top-[20px] -translate-y-1/2 pointer-events-none" />
                    {tenants.map((t) => (
                      <span
                        key={t.id}
                        title={[t.nif ? `NIF ${t.nif}` : '', t.commune].filter(Boolean).join(' • ') || undefined}
                        className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-accent/12 text-accent text-[12px] font-semibold"
                      >
                        {t.businessName}
                        <button
                          type="button"
                          onClick={() => removeTenant(t.id)}
                          aria-label={`Remove ${t.businessName}`}
                          className="p-0.5 rounded-full hover:bg-accent/20 transition-premium cursor-pointer"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                    <input
                      type="text"
                      role="combobox"
                      aria-label="Locataire"
                      aria-expanded={showTenantList}
                      aria-controls="lease-tenant-list"
                      aria-autocomplete="list"
                      autoComplete="off"
                      value={tenantQuery}
                      onFocus={() => setTenantOpen(true)}
                      onChange={(e) => {
                        setTenantQuery(e.target.value);
                        setTenantActive(0);
                        setTenantOpen(true);
                        if (leaseErrors.tenants) setLeaseErrors((prev) => ({ ...prev, tenants: undefined }));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          if (!showTenantList) return;
                          e.stopPropagation();
                          setTenantOpen(false);
                          return;
                        }
                        // Backspace on an empty search removes the last locataire.
                        if (e.key === 'Backspace' && !tenantQuery && tenants.length > 0) {
                          e.preventDefault();
                          removeTenant(tenants[tenants.length - 1].id);
                          return;
                        }
                        if (!showTenantList || tenantMatches.length === 0) {
                          // Enter never submits the form from here.
                          if (e.key === 'Enter') e.preventDefault();
                          return;
                        }
                        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                          e.preventDefault();
                          const n = tenantMatches.length;
                          setTenantActive((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
                        } else if (e.key === 'Enter') {
                          e.preventDefault();
                          chooseTenant(tenantMatches[tenantActive] ?? tenantMatches[0]);
                        }
                      }}
                      className="flex-1 min-w-[10rem] h-7 bg-transparent border-none text-sm text-ink placeholder:text-muted focus:outline-none"
                      autoFocus
                    />
                  </div>

                  {showTenantList && (
                    <ul
                      id="lease-tenant-list"
                      role="listbox"
                      aria-label="Matching taxpayers"
                      className="absolute z-30 left-0 right-0 mt-1.5 max-h-56 overflow-y-auto rounded-[12px] border border-line bg-surface shadow-2xl py-1.5 scrollbar-thin"
                    >
                      {tenantMatches.length === 0 ? (
                        <li className="px-3.5 py-2.5 text-[12px] text-muted">
                          No taxpayer matches{' '}
                          <span className="font-semibold text-ink">“{tenantQuery.trim()}”</span>.
                        </li>
                      ) : (
                        tenantMatches.map((b, i) => (
                          <li key={b.id} role="option" aria-selected={i === tenantActive}>
                            <button
                              type="button"
                              onMouseEnter={() => setTenantActive(i)}
                              onClick={() => chooseTenant(b)}
                              className={`w-full text-left px-3.5 py-2 transition-premium cursor-pointer ${
                                i === tenantActive ? 'bg-accent-soft' : ''
                              }`}
                            >
                              <span className="block text-xs font-semibold text-ink truncate">{b.businessName}</span>
                              <span className="block text-[11px] text-muted font-mono truncate mt-0.5">
                                {[
                                  b.ownerFullName && b.ownerFullName !== b.businessName ? b.ownerFullName : null,
                                  b.commune,
                                  b.nif || b.nationalIdOrRccm,
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
                {leaseErrors.tenants ? (
                  <p className="text-[12px] text-danger mt-1 font-medium">{leaseErrors.tenants}</p>
                ) : (
                  <p className="text-[11px] text-muted mt-1 leading-relaxed">
                    Searched on the taxpayer roll. One contract may name several locataires — search and add each one.
                  </p>
                )}
              </div>

              {/* ---- Bailleur ---- */}
              <div className="block">
                <span className="block text-xs font-bold text-ink mb-1.5">Bailleur</span>
                <div ref={bailleurBoxRef} className="relative">
                  <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    role="combobox"
                    aria-expanded={showBailleurList}
                    aria-controls="lease-bailleur-list"
                    aria-autocomplete="list"
                    autoComplete="off"
                    value={bailleurQuery}
                    onFocus={() => setBailleurOpen(true)}
                    onChange={(e) => {
                      setBailleurQuery(e.target.value);
                      setBailleurActive(0);
                      setBailleurOpen(true);
                      // Typing over a chosen bailleur detaches them, and the
                      // property chosen for them with it.
                      if (selectedBailleur) {
                        setSelectedBailleur(null);
                        setSelectedParcel(null);
                      }
                      if (leaseErrors.bailleur || leaseErrors.parcel) {
                        setLeaseErrors((prev) => ({
                          ...prev,
                          bailleur: undefined,
                          parcel: undefined,
                        }));
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        if (!showBailleurList) return;
                        e.stopPropagation();
                        setBailleurOpen(false);
                        return;
                      }
                      if (!showBailleurList || bailleurMatches.length === 0) return;
                      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        e.preventDefault();
                        const n = bailleurMatches.length;
                        setBailleurActive((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n);
                      } else if (e.key === 'Enter') {
                        e.preventDefault();
                        chooseBailleur(bailleurMatches[bailleurActive] ?? bailleurMatches[0]);
                      }
                    }}
                    className={`w-full h-10 pl-9 pr-9 rounded-[10px] bg-surface2 border text-sm text-ink placeholder:text-muted focus:border-accent outline-none ${
                      leaseErrors.bailleur ? 'border-danger' : 'border-line'
                    } ${selectedBailleur ? 'font-semibold' : ''}`}
                  />
                  {selectedBailleur && (
                    <button
                      type="button"
                      aria-label="Clear bailleur"
                      onClick={clearBailleur}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-muted hover:text-ink hover:bg-surface2 transition-premium cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {showBailleurList && (
                    <ul
                      id="lease-bailleur-list"
                      role="listbox"
                      aria-label="Bailleurs correspondants"
                      className="absolute z-20 left-0 right-0 mt-1.5 max-h-56 overflow-y-auto rounded-[12px] border border-line bg-surface shadow-2xl py-1.5 scrollbar-thin"
                    >
                      {bailleurMatches.length === 0 ? (
                        <li className="px-3.5 py-2.5 text-[12px] text-muted">
                          No taxpayer matches{' '}
                          <span className="font-semibold text-ink">“{bailleurQuery.trim()}”</span>.
                        </li>
                      ) : (
                        bailleurMatches.map((b, i) => (
                          <li key={b.id} role="option" aria-selected={i === bailleurActive}>
                            <button
                              type="button"
                              onMouseEnter={() => setBailleurActive(i)}
                              onClick={() => chooseBailleur(b)}
                              className={`w-full text-left px-3.5 py-2 transition-premium cursor-pointer ${
                                i === bailleurActive ? 'bg-accent-soft' : ''
                              }`}
                            >
                              <span className="block text-xs font-semibold text-ink truncate">
                                {b.businessName}
                              </span>
                              <span className="block text-[11px] text-muted font-mono truncate mt-0.5">
                                {[
                                  b.ownerFullName && b.ownerFullName !== b.businessName
                                    ? b.ownerFullName
                                    : null,
                                  b.commune,
                                  b.nif || b.nationalIdOrRccm,
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
                {leaseErrors.bailleur ? (
                  <p className="text-[12px] text-danger mt-1 font-medium">{leaseErrors.bailleur}</p>
                ) : (
                  <p className="text-[11px] text-muted mt-1 leading-relaxed">
                    The property owner — searched on the taxpayer roll. Their declared properties
                    become the pickable set below.
                  </p>
                )}
              </div>

              {/* ---- The property being let ---- */}
              <div className="block">
                <span className="block text-xs font-bold text-ink mb-1.5">Propriété louée</span>

                {!selectedBailleur ? (
                  <div className="h-10 px-3 flex items-center rounded-[10px] bg-surface2/60 border border-line text-xs text-muted">
                    Select a bailleur first
                  </div>
                ) : ownerParcelsLoading ? (
                  <div className="h-10 px-3 flex items-center rounded-[10px] bg-surface2/60 border border-line text-xs text-muted">
                    Loading declared properties…
                  </div>
                ) : ownerParcels.length === 0 ? (
                  <div className="p-3 rounded-[10px] bg-warn/10 border border-warn/25 text-[12px] text-ink leading-relaxed flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-0.5" />
                    <span>
                      No property is declared <strong>against this bailleur</strong>. Declare it under{' '}
                      <strong>Identification des Propriétés</strong> and name this bailleur as the
                      owner — a lease takes its address from that declaration, so an unlinked
                      property cannot be picked here.
                    </span>
                  </div>
                ) : ownerParcels.length === 1 ? (
                  // One asset, so there is nothing to choose — show it, don't ask.
                  <div className="h-10 px-3 flex items-center gap-2 rounded-[10px] bg-accent-soft/50 border border-accent/25 text-xs text-ink font-semibold">
                    <Home className="w-3.5 h-3.5 text-accent shrink-0" />
                    <span className="truncate">
                      {parcelOptionLabel(ownerParcels[0])}
                    </span>
                  </div>
                ) : (
                  <select
                    id="lease-parcel"
                    value={selectedParcel?.id || ''}
                    onChange={(e) => {
                      const next = ownerParcels.find((p) => p.id === e.target.value) || null;
                      setSelectedParcel(next);
                      setLeaseErrors((prev) => ({ ...prev, parcel: undefined }));
                    }}
                    className={`w-full h-10 px-3 rounded-[10px] bg-surface2 border text-sm text-ink focus:border-accent outline-none cursor-pointer ${
                      leaseErrors.parcel ? 'border-danger' : 'border-line'
                    }`}
                  >
                    <option value="">— Sélectionner la propriété —</option>
                    {ownerParcels.map((p) => (
                      <option key={p.id} value={p.id}>
                        {parcelOptionLabel(p)}
                      </option>
                    ))}
                  </select>
                )}

                {leaseErrors.parcel && ownerParcels.length > 0 && (
                  <p className="text-[12px] text-danger mt-1 font-medium">{leaseErrors.parcel}</p>
                )}
              </div>

              {/* ---- Address carried across from the property ---- */}
              {selectedParcel && (
                <div className="rounded-[12px] border border-line bg-surface2/40 p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                      Adresse du bien loué
                    </span>
                    <span className="text-[11px] text-accent font-semibold">auto-remplie</span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                    <AutoField
                      label="Nature"
                      value={selectedParcel.nature ? natureDisplay(selectedParcel.nature) : 'non classifiée'}
                    />
                    <AutoField label="Ville" value={selectedParcel.villeTerritoire} />
                    <AutoField label="Commune" value={selectedParcel.communeChefferie} />
                    <AutoField label="Quartier" value={selectedParcel.quartierGroupement} />
                    <AutoField label="Avenue" value={selectedParcel.avenueLocalite} />
                    <AutoField
                      label="Numéro de parcelle"
                      value={selectedParcel.numeroParcelle || selectedParcel.rang}
                      mono
                    />
                  </div>
                  <p className="text-[11px] text-muted mt-2 leading-relaxed">
                    Copied from the declaration.
                  </p>
                </div>
              )}

              {/* ---- Période de location ---- */}
              <div className="block">
                <span className="block text-xs font-bold text-ink mb-1.5">Période de location</span>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block">
                    <span className="block text-[11px] text-muted mb-1">Du</span>
                    <DateField
                      value={leaseStart}
                      onDateChange={(value, bad) => {
                        setLeaseStart(value);
                        setLeaseStartBad(bad);
                        setLeaseErrors((prev) => ({ ...prev, period: undefined }));
                      }}
                      className={`w-full h-10 px-3 rounded-[10px] bg-surface2 border text-sm text-ink focus:border-accent outline-none ${
                        leaseErrors.period || leaseStartBad ? 'border-danger' : 'border-line'
                      }`}
                    />
                  </label>
                  <label className="block">
                    <span className="block text-[11px] text-muted mb-1">Au (vide si en cours)</span>
                    <DateField
                      value={leaseEnd}
                      min={leaseStart || undefined}
                      onDateChange={(value, bad) => {
                        setLeaseEnd(value);
                        setLeaseEndBad(bad);
                        setLeaseErrors((prev) => ({ ...prev, period: undefined }));
                      }}
                      className={`w-full h-10 px-3 rounded-[10px] bg-surface2 border text-sm text-ink focus:border-accent outline-none ${
                        leaseErrors.period || leaseEndBad ? 'border-danger' : 'border-line'
                      }`}
                    />
                  </label>
                </div>
                {leaseErrors.period && (
                  <p className="text-[12px] text-danger mt-1 font-medium">{leaseErrors.period}</p>
                )}
              </div>

              {/* ---- Loyer mensuel, and the revenue it yields ---- */}
              <div className="block">
                <span className="block text-xs font-bold text-ink mb-1.5">Loyer mensuel (USD)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={leaseRent}
                  onChange={(e) => {
                    setLeaseRent(e.target.value);
                    setLeaseErrors((prev) => ({ ...prev, rent: undefined }));
                  }}
                  placeholder="0,00"
                  className={`w-full h-10 px-3 rounded-[10px] bg-surface2 border text-sm text-ink tabular-nums placeholder:text-muted focus:border-accent outline-none ${
                    leaseErrors.rent ? 'border-danger' : 'border-line'
                  }`}
                />
                <p className="text-[11px] text-muted mt-1 leading-relaxed flex items-start gap-1">
                  <Lock className="w-3 h-3 shrink-0 mt-px" />
                  Saisis ensemble, la période et le loyer sont verrouillés à l’enregistrement et ne
                  pourront plus être modifiés.
                </p>
                {leaseErrors.rent ? (
                  <p className="text-[12px] text-danger mt-1 font-medium">{leaseErrors.rent}</p>
                ) : (
                  <GrossPreview
                    start={leaseStart}
                    end={leaseEnd}
                    rent={leaseRent}
                    startBad={leaseStartBad}
                    endBad={leaseEndBad}
                  />
                )}
              </div>

              </div>

              <div className="shrink-0 px-6 py-4 border-t border-line bg-surface2/40 flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="md"
                  onClick={closeLeaseModal}
                  disabled={savingLease}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  icon={<CheckCircle2 className="w-4 h-4" />}
                  disabled={savingLease}
                >
                  {savingLease ? 'Saving…' : 'Save Locataire'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/*  Local presentation primitives                                     */
/* ------------------------------------------------------------------ */

/**
 * One read-only field in the auto-completed address block.
 *
 * Deliberately not an input: these values are copied from the declaration and
 * are not the officer's to type here. Editing them would let a lease describe
 * an address the cadastre does not hold.
 */
const AutoField: React.FC<{ label: string; value?: string; mono?: boolean }> = ({
  label,
  value,
  mono,
}) => (
  <div className="min-w-0">
    <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted">{label}</div>
    <div
      className={`text-[12px] font-semibold text-ink truncate ${mono ? 'font-mono tabular-nums' : ''}`}
      title={value || '—'}
    >
      {value || '—'}
    </div>
  </div>
);

/**
 * A date input that also reports when it holds a date the browser cannot read.
 *
 * Typing an impossible date such as 31/04/2026 leaves the field showing it
 * while its value silently becomes "" — which the revenue math would read as
 * "no end date" and count to December. `validity.badInput` is the only signal,
 * and the value may not change while it flips, so it is re-read on every
 * keystroke and on blur, not only on change.
 */
const DateField: React.FC<
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'value'> & {
    value: string;
    onDateChange: (value: string, bad: boolean) => void;
  }
> = ({ value, onDateChange, ...rest }) => {
  const report = (el: HTMLInputElement) => onDateChange(el.value, el.validity.badInput);
  return (
    <input
      {...rest}
      type="date"
      value={value}
      onChange={(e) => report(e.currentTarget)}
      onInput={(e) => report(e.currentTarget)}
      onKeyUp={(e) => report(e.currentTarget)}
      onBlur={(e) => report(e.currentTarget)}
    />
  );
};

/** Live "Total revenu brut" line under the rent field. */
const GrossPreview: React.FC<{
  start: string;
  end: string;
  rent: string;
  startBad?: boolean;
  endBad?: boolean;
}> = ({ start, end, rent, startBad, endBad }) => {
  if (startBad || endBad) {
    return (
      <p className="text-[12px] text-danger mt-1 font-medium">
        {termsError(start, end, rent, { start: startBad, end: endBad }).period}
      </p>
    );
  }
  const r = parseRent(rent);
  if (!start || !Number.isFinite(r) || r <= 0 || (end && end < start)) {
    return (
      <p className="text-[11px] text-muted mt-1 leading-relaxed">
        Total revenu brut = loyer mensuel × mois loués en {EXERCICE}.
      </p>
    );
  }
  const months = monthsLetInExercise(
    { startDate: start, endDate: end || null } as RentalLease,
    EXERCICE
  );
  return (
    <p className="text-[12px] text-ink mt-1 tabular-nums">
      Total revenu brut {EXERCICE} : {usdExact(r)} × {months} mois ={' '}
      <strong>{usdExact(Math.round(r * months * 100) / 100)}</strong>
    </p>
  );
};

/**
 * Période de location and loyer mensuel of a lease already on file, shown in
 * the row's detail. Editable for officers, so a lease filed before its terms
 * were known can be completed rather than re-filed.
 */
const LeaseTermsEditor: React.FC<{
  lease: RentalLease;
  canEdit: boolean;
  onSave: (terms: { startDate: string; endDate: string; monthlyRentUSD: number }) => Promise<void>;
  onError: (message: string) => void;
  /** Open the "next period" filing — a new record, never an edit. */
  onNewPeriod: () => void;
}> = ({ lease, canEdit, onSave, onError, onNewPeriod }) => {
  const [start, setStart] = useState(lease.startDate?.slice(0, 10) || '');
  const [end, setEnd] = useState(lease.endDate?.slice(0, 10) || '');
  const [rent, setRent] = useState(lease.monthlyRentUSD > 0 ? String(lease.monthlyRentUSD) : '');
  const [errors, setErrors] = useState<{ period?: string; rent?: string }>({});
  const [saving, setSaving] = useState(false);
  const [startBad, setStartBad] = useState(false);
  const [endBad, setEndBad] = useState(false);
  /** Saving locks the terms, so it takes a second, deliberate click. */
  const [confirming, setConfirming] = useState(false);
  const locked = isLeaseTermsLocked(lease);

  const dirty =
    start !== (lease.startDate?.slice(0, 10) || '') ||
    end !== (lease.endDate?.slice(0, 10) || '') ||
    (parseRent(rent) || 0) !== (lease.monthlyRentUSD || 0);

  const validate = () => {
    const next = termsError(start, end, rent, { start: startBad, end: endBad });
    // Saving locks the terms, so they must be complete.
    if (!next.period && !start) next.period = 'Saisissez la date de début de la location.';
    if (!next.rent && !(parseRent(rent) > 0)) next.rent = 'Saisissez le loyer mensuel.';
    setErrors(next);
    return !next.period && !next.rent;
  };

  const save = async () => {
    if (!validate()) {
      setConfirming(false);
      return;
    }
    setConfirming(false);
    setSaving(true);
    try {
      await onSave({ startDate: start, endDate: end, monthlyRentUSD: parseRent(rent) || 0 });
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Impossible d’enregistrer le bail.');
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'w-full h-9 px-2.5 rounded-[9px] bg-surface2 border text-xs text-ink tabular-nums focus:border-accent outline-none disabled:opacity-60';

  if (locked) {
    const months = monthsLetInExercise(lease, EXERCICE);
    return (
      <div className="mt-3 pt-3 border-t border-line">
        <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
          <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
            Période de location & loyer mensuel
          </div>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface2 border border-line text-[11px] font-semibold text-muted">
            <Lock className="w-3 h-3" />
            Verrouillé
            {lease.termsLockedAt ? ` le ${shortDate(lease.termsLockedAt)}` : ''}
            {lease.termsLockedByName ? ` par ${lease.termsLockedByName}` : ''}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <AutoField label="Du" value={shortDate(lease.startDate)} mono />
          <AutoField label="Au" value={lease.endDate ? shortDate(lease.endDate) : 'En cours'} mono />
          <AutoField label="Loyer mensuel" value={usdExact(lease.monthlyRentUSD)} mono />
        </div>
        <p className="text-[12px] text-ink mt-2 tabular-nums">
          Total revenu brut {EXERCICE} : {usdExact(lease.monthlyRentUSD)} × {months} mois ={' '}
          <strong>{usdExact(Math.round(lease.monthlyRentUSD * months * 100) / 100)}</strong>
        </p>

        {/* A second declaration is a new row: this period is locked and stays
            exactly as assessed, so the next one is filed beside it. */}
        {canEdit && (
          <div className="mt-3 flex items-start justify-between gap-3 flex-wrap">
            <p className="text-[11px] text-muted leading-relaxed max-w-[52ch]">
              Le locataire déclare une nouvelle période ? Elle est enregistrée comme un{' '}
              <strong className="text-ink">nouveau bail</strong> — celui-ci reste inchangé.
            </p>
            <Button
              variant="secondary"
              size="sm"
              icon={<CalendarPlus className="w-3.5 h-3.5" />}
              onClick={onNewPeriod}
            >
              Ajuster la période
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="mt-3 pt-3 border-t border-line"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted mb-2">
        Période de location & loyer mensuel
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
        <label className="block">
          <span className="block text-[11px] text-muted mb-1">Du</span>
          <DateField
            value={start}
            disabled={!canEdit || saving}
            onDateChange={(value, bad) => {
              setStart(value);
              setStartBad(bad);
              setErrors((prev) => ({ ...prev, period: undefined }));
            }}
            className={`${inputClass} ${errors.period || startBad ? 'border-danger' : 'border-line'}`}
          />
        </label>
        <label className="block">
          <span className="block text-[11px] text-muted mb-1">Au (vide si en cours)</span>
          <DateField
            value={end}
            min={start || undefined}
            disabled={!canEdit || saving}
            onDateChange={(value, bad) => {
              setEnd(value);
              setEndBad(bad);
              setErrors((prev) => ({ ...prev, period: undefined }));
            }}
            className={`${inputClass} ${errors.period || endBad ? 'border-danger' : 'border-line'}`}
          />
        </label>
        <label className="block">
          <span className="block text-[11px] text-muted mb-1">Loyer mensuel (USD)</span>
          <input
            type="text"
            inputMode="decimal"
            value={rent}
            placeholder="0,00"
            disabled={!canEdit || saving}
            onChange={(e) => setRent(e.target.value)}
            className={`${inputClass} ${errors.rent ? 'border-danger' : 'border-line'}`}
          />
        </label>
        {canEdit && !confirming && (
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => validate() && setConfirming(true)}
            disabled={(!dirty && !startBad && !endBad) || saving}
            icon={<CheckCircle2 className="w-3.5 h-3.5" />}
          >
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        )}
      </div>
      {canEdit && confirming && (
        <div className="mt-2 p-3 rounded-[10px] bg-warn/10 border border-warn/25 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[12px] text-ink flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-warn shrink-0" />
            Une fois enregistrés, la période et le loyer seront verrouillés et ne pourront plus
            être modifiés.
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Annuler
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={save}
              icon={<Lock className="w-3.5 h-3.5" />}
            >
              Enregistrer et verrouiller
            </Button>
          </div>
        </div>
      )}
      {(errors.period || errors.rent) && (
        <p className="text-[12px] text-danger mt-1 font-medium">{errors.period || errors.rent}</p>
      )}
      {!errors.period && !errors.rent && (
        <GrossPreview start={start} end={end} rent={rent} startBad={startBad} endBad={endBad} />
      )}
    </div>
  );
};

/**
 * File the next période de location of a tenancy already on the register.
 *
 * Deliberately a **new record**: the period drives the revenu brut (loyer × mois
 * loués), so editing a saved lease would rewrite an assessment already made.
 * This card says so plainly, shows the period it continues, and defaults the new
 * start to the day after the old one ends.
 */
const NextPeriodModal: React.FC<{
  lease: RentalLease;
  /** Other periods on file for the same tenancy, used to warn about overlap. */
  siblings: RentalLease[];
  onClose: () => void;
  onSubmit: (terms: { startDate: string; endDate: string; monthlyRentUSD: number }) => Promise<void>;
  onError: (message: string) => void;
}> = ({ lease, siblings, onClose, onSubmit, onError }) => {
  /** A tenant declaring again is continuing, so default to the next day. */
  const dayAfter = (() => {
    if (!lease.endDate) return '';
    const d = new Date(`${lease.endDate.slice(0, 10)}T12:00:00`);
    if (Number.isNaN(d.getTime())) return '';
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  })();

  const [start, setStart] = useState(dayAfter);
  const [end, setEnd] = useState('');
  const [rent, setRent] = useState(lease.monthlyRentUSD > 0 ? String(lease.monthlyRentUSD) : '');
  const [errors, setErrors] = useState<{ period?: string; rent?: string }>({});
  const [startBad, setStartBad] = useState(false);
  const [endBad, setEndBad] = useState(false);
  const [saving, setSaving] = useState(false);

  /** Warns, never blocks: an overlapping filing can still be a correction. */
  const clash = useMemo(() => {
    if (!start) return null;
    return siblings.find((s) => periodsOverlap({ startDate: start, endDate: end || null }, s)) || null;
  }, [start, end, siblings]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const next = termsError(start, end, rent, { start: startBad, end: endBad });
    if (!next.period && !start) next.period = 'Saisissez la date de début de la nouvelle période.';
    if (!next.rent && !(parseRent(rent) > 0)) next.rent = 'Saisissez le loyer mensuel.';
    setErrors(next);
    if (next.period || next.rent) return;

    setSaving(true);
    try {
      await onSubmit({ startDate: start, endDate: end, monthlyRentUSD: parseRent(rent) });
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Impossible d’enregistrer la nouvelle période.');
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'w-full h-10 px-3 rounded-[10px] bg-surface2 border text-sm text-ink tabular-nums focus:border-accent outline-none disabled:opacity-60';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/70 backdrop-blur-xs">
      <div className="bg-surface rounded-[22px] border border-line shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        <div className="px-6 py-5 border-b border-line flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[13px] bg-accent/12 text-accent flex items-center justify-center">
              <CalendarPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-display text-lg font-bold text-ink tracking-tight">
                Ajuster la période de location
              </h3>
              <p className="text-xs text-muted mt-0.5">
                {lease.tenantNames.join(', ')} — parcelle {lease.numeroParcelle || lease.rang}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-muted hover:text-ink hover:bg-surface2 cursor-pointer"
            aria-label="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={submit} className="p-6 space-y-4">
          <div className="p-3 rounded-[12px] bg-surface2 border border-line">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
              <Lock className="w-3 h-3" />
              Bail déjà enregistré — laissé inchangé
            </div>
            <div className="text-xs text-ink mt-1 tabular-nums">
              {shortDate(lease.startDate)} → {lease.endDate ? shortDate(lease.endDate) : 'En cours'} ·{' '}
              {usdExact(lease.monthlyRentUSD)} / mois
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="block text-xs font-bold text-ink mb-1.5">Du</span>
              <DateField
                value={start}
                disabled={saving}
                onDateChange={(value, bad) => {
                  setStart(value);
                  setStartBad(bad);
                  setErrors((prev) => ({ ...prev, period: undefined }));
                }}
                className={`${inputClass} ${errors.period || startBad ? 'border-danger' : 'border-line'}`}
              />
            </label>
            <label className="block">
              <span className="block text-xs font-bold text-ink mb-1.5">
                Au <span className="font-normal text-muted">(facultatif)</span>
              </span>
              <DateField
                value={end}
                disabled={saving}
                onDateChange={(value, bad) => {
                  setEnd(value);
                  setEndBad(bad);
                  setErrors((prev) => ({ ...prev, period: undefined }));
                }}
                className={`${inputClass} ${errors.period || endBad ? 'border-danger' : 'border-line'}`}
              />
            </label>
          </div>
          {errors.period && <p className="text-[12px] text-danger">{errors.period}</p>}

          <label className="block">
            <span className="block text-xs font-bold text-ink mb-1.5">Loyer mensuel (USD)</span>
            <input
              type="text"
              inputMode="decimal"
              value={rent}
              disabled={saving}
              onChange={(event) => {
                setRent(event.target.value);
                setErrors((prev) => ({ ...prev, rent: undefined }));
              }}
              className={`${inputClass} ${errors.rent ? 'border-danger' : 'border-line'}`}
              placeholder="Repris du bail précédent"
            />
          </label>
          {errors.rent && <p className="text-[12px] text-danger">{errors.rent}</p>}

          {clash && (
            <div className="p-3 rounded-[12px] bg-warn/10 border border-warn/30 flex gap-2">
              <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-0.5" />
              <p className="text-[12px] leading-relaxed text-ink">
                Cette période chevauche un bail déjà enregistré ({shortDate(clash.startDate)} →{' '}
                {clash.endDate ? shortDate(clash.endDate) : 'en cours'}). Les mois communs compteraient
                deux fois dans le revenu brut.
              </p>
            </div>
          )}

          <div className="p-4 rounded-[14px] bg-sage/8 border border-sage/20 flex gap-3">
            <CalendarPlus className="w-4 h-4 text-sage mt-0.5 shrink-0" />
            <p className="text-xs leading-relaxed text-muted">
              Un <strong className="text-ink">nouveau bail</strong> sera créé pour cette période. Le bail
              existant n’est ni modifié ni supprimé — son revenu brut reste celui qui a été déclaré.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="md" onClick={onClose} disabled={saving}>
              Annuler
            </Button>
            <Button type="submit" variant="primary" size="md" icon={<CalendarPlus className="w-4 h-4" />} disabled={saving}>
              {saving ? 'Enregistrement…' : 'Créer le nouveau bail'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
