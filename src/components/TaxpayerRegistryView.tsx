import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Users,
  Search,
  Plus,
  X,
  Pencil,
  RefreshCw,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  MapPin,
  IdCard,
  Receipt,
  Ban,
  Undo2,
  AlertTriangle,
  Check,
  Copy,
  Trash2,
  Sparkles,
  Building2,
  Loader2,
} from 'lucide-react';
import {
  Business,
  BusinessSector,
  BusinessSizeClass,
  BusinessStatus,
  TaxpayerType,
  PatenteCategory,
  UserRole,
  AddressRegistry,
  Assessment,
  Payment,
  PropertyParcel,
  TaxRate,
  SECTOR_LABELS,
  SIZE_CLASS_LABELS,
  PATENTE_CATEGORY_LABELS,
  SIZE_TO_PATENTE_CATEGORY,
  normalizeBusinessStatus,
  normalizePatenteCategory,
  normalizeTaxpayerType,
} from '../types';
import {
  getBusinesses,
  subscribeToBusinesses,
  addBusiness,
  updateBusiness,
  deleteBusiness,
  logAuditEvent,
  getTaxRates,
  getAssessments,
  subscribeToAssessments,
  getPayments,
  subscribeToPayments,
  getNormalizedAssessmentStatus,
} from '../services/dbService';
import {
  computeTaxpayerFiscalProfiles,
  summarizeFiscalRoll,
  TaxpayerFiscalProfile,
} from '../services/taxpayerService';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { todayDateString } from '../utils/date';
import { PageHeader, Button, Badge, Panel, MetricStrip, EmptyState, TableSkeleton } from './ui';
import {
  ComplianceBadge,
  initialsOf,
  tintFor,
  TINT_CLASS,
  usd,
  prettyDate,
} from './registry/registryBits';
import { PropertyRegisterView } from './registry/PropertyRegisterView';
import { RentalLeasesView } from './registry/RentalLeasesView';
import { issueNextNif } from '../services/nifService';
import { subscribeToAddressRegistry } from '../services/addressService';
import { subscribeToParcelsByOwner } from '../services/parcelService';

interface TaxpayerRegistryViewProps {
  userRole: UserRole;
  /**
   * The subtabs shown, in their usual order. Omitted: all three (DPRNK). The
   * DGI portal, which does not deal with property or rental taxes, shows only
   * Identification du redevable.
   */
  subTabs?: RegistrySubTab[];
  /**
   * Whether the enrolment card has the NIF field (Generate NIF / Record a NIF).
   * Omitted: yes (DPRNK). The DGI portal's card has no NIF field.
   */
  nifOnCard?: boolean;
  /**
   * Whether the enrolment card has the Service and Numéro de dépôt fields,
   * above the name. Omitted: no (DPRNK). The DGI portal's card has them.
   */
  depotFieldsOnCard?: boolean;
  /**
   * Whether the enrolment card has Forme juridique and Numéro de parcelle.
   * Omitted: yes (DPRNK). The DGI portal's card has neither.
   */
  formeParcelleOnCard?: boolean;
  /**
   * The columns of the Identification du redevable table. Omitted: the DPRNK
   * roll. 'dgi': the fields of the DGI portal's enrolment card, in its order.
   */
  rollColumns?: 'dprnk' | 'dgi';
  /**
   * Whether the roll has the address filters beside the search field (All
   * cities, All communes, All neighborhoods, All avenues). Omitted: yes
   * (DPRNK). The DGI portal's roll has only the search field.
   */
  addressFilters?: boolean;
}

/** A column of the Identification du redevable table. */
type RollColumn =
  | 'nif'
  | 'service'
  | 'depot'
  | 'mois'
  | 'annee'
  | 'name'
  | 'impot'
  | 'sigle'
  | 'idnat'
  | 'ville'
  | 'commune'
  | 'quartier'
  | 'avenue'
  | 'numero'
  | 'phone'
  | 'email'
  | 'forme';

/** The DPRNK roll's columns. */
const DPRNK_ROLL: RollColumn[] = ['nif', 'name', 'sigle', 'idnat', 'ville', 'commune', 'quartier', 'avenue', 'numero', 'phone', 'email', 'forme'];
/**
 * The DGI roll's columns: the fields of the DGI enrolment card, in its order —
 * Service, Numéro de dépôt, Salaires du mois de, Année, Noms ou dénomination
 * sociale, Numéro impôt, Sigle, ID Nationale, Ville, Commune, Quartier, Avenue,
 * Téléphone, E-mail.
 */
const DGI_ROLL: RollColumn[] = ['service', 'depot', 'mois', 'annee', 'name', 'impot', 'sigle', 'idnat', 'ville', 'commune', 'quartier', 'avenue', 'phone', 'email'];

type SortKey =
  | 'service'
  | 'depot'
  | 'impot'
  | 'mois'
  | 'annee'
  | 'name'
  | 'nif'
  | 'sigle'
  | 'idnat'
  | 'ville'
  | 'commune'
  | 'quartier'
  | 'avenue'
  | 'numero'
  | 'phone'
  | 'email'
  | 'forme'
  | 'registered';
/** The four address levels the roll can be filtered by. */
type AddrDim = 'city' | 'commune' | 'quartier' | 'avenue';

interface FormState {
  /** Service — DGI portal card only. */
  service: string;
  /** Numéro de dépôt — DGI portal card only. */
  numeroDepot: string;
  /** Numéro impôt — DGI portal card only. */
  numeroImpot: string;
  /** Salaires du mois de — '1' (janvier) to '12' (décembre), '' if none. DGI portal card only. */
  salairesMois: string;
  /** Année — '2020' to '2035', '' if none. DGI portal card only. */
  annee: string;
  businessName: string;
  sigle: string;
  numeroParcelle: string;
  ownerFullName: string;
  nationalIdOrRccm: string;
  nif: string;
  /**
   * How the NIF now on the form got there. 'issued' is the roll's own sequence;
   * 'recorded' is a number the taxpayer already holds from the DPRNK central
   * service. The distinction belongs in the audit ledger, because only one of
   * them was ever guaranteed unique by this system.
   */
  nifSource: 'issued' | 'recorded' | '';
  idNat: string;
  email: string;
  taxpayerType: TaxpayerType;
  phoneNumber: string;
  /** The address, as names picked from the Settings → Adresse tree: ville › commune › quartier › avenue. */
  ville: string;
  /** The avenue. */
  physicalAddress: string;
  commune: string;
  quartier: string;
  activitySector: BusinessSector;
  sizeClass: BusinessSizeClass;
  patenteCategory: PatenteCategory;
  registrationDate: string;
  status: BusinessStatus;
  storefrontPhotoUrl: string;
}

const emptyForm = (): FormState => ({
  service: '',
  numeroDepot: '',
  numeroImpot: '',
  salairesMois: '',
  annee: '',
  businessName: '',
  sigle: '',
  numeroParcelle: '',
  ownerFullName: '',
  nationalIdOrRccm: '',
  nif: '',
  nifSource: '',
  idNat: '',
  email: '',
  taxpayerType: '' as TaxpayerType,
  phoneNumber: '+243 ',
  ville: '',
  physicalAddress: '',
  // Nothing on the address may be asserted for the officer: a commune chosen by
  // the code is a commune nobody checked, and this card is what an assessment is
  // later raised on.
  commune: '',
  quartier: '',
  activitySector: 'Commerce',
  sizeClass: 'Small',
  patenteCategory: 'Category_C_Petite',
  registrationDate: todayDateString(),
  status: 'Active',
  storefrontPhotoUrl: '',
});

/**
 * The options of the enrolment card's address dropdowns, read off the Settings →
 * Adresse tree: each level lists only what sits under the level picked above,
 * so a quartier can never be filed under the wrong commune.
 */
function addressChoices(registry: AddressRegistry | null, ville: string, commune: string, quartier: string) {
  const villes = registry?.villes || [];
  const v = villes.find((x) => x.name === ville);
  const c = v?.communes.find((x) => x.name === commune);
  const q = c?.quartiers.find((x) => x.name === quartier);
  return {
    villes: villes.map((x) => x.name),
    communes: v ? v.communes.map((x) => x.name) : [],
    quartiers: c ? c.quartiers.map((x) => x.name) : [],
    avenues: q ? q.avenues.map((x) => x.name) : [],
  };
}


/** Size class guard — legacy documents can carry an unrecognised value. */
function normalizeSizeClassSafe(val?: string | null): BusinessSizeClass {
  if (val === 'Medium' || val === 'Large') return val;
  return 'Small';
}

/** Section label inside the dossier drawer. */
const SectionTitle: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted mb-2.5 flex items-center gap-1.5">
    <span className="text-accent">{icon}</span>
    {children}
  </h3>
);

/**
 * Column sizing for the fiscal roll grid.
 *
 * The table is laid out with `table-layout: fixed`, so each column takes a
 * fixed share of the panel width and long values truncate with an ellipsis.
 *
 * The address chain is one column per level — ville, commune, quartier, avenue,
 * numéro — so every share of an address is readable on its own instead of
 * stacked two-deep in one cell. Seven columns do not fit beside the 264px
 * sidebar on a narrow window, so the table keeps a minimum width and scrolls
 * horizontally rather than hiding levels behind a breakpoint.
 */
const ROLL_COLUMNS = {
  // DGI roll only — together as wide as NIF, Numéro de parcelle and Forme
  // juridique, which the DGI roll does not have.
  service: 'w-[7%]',
  depot: 'w-[6%]',
  mois: 'w-[5%]',
  annee: 'w-[5%]',
  nif: 'w-[8%]',
  taxpayer: 'w-[15%]',
  // DGI roll only — Numéro impôt, right after the name.
  impot: 'w-[7%]',
  sigle: 'w-[6%]',
  idnat: 'w-[10%]',
  ville: 'w-[6%]',
  commune: 'w-[7%]',
  quartier: 'w-[7%]',
  avenue: 'w-[8%]',
  numero: 'w-[7%]',
  phone: 'w-[8%]',
  email: 'w-[10%]',
  forme: 'w-[8%]',
} as const;

/**
 * Subtabs inside the Taxpayer Registry: the contributor roll, the cadastral
 * property declaration, and the tenancies on the properties given for rent.
 */
export type RegistrySubTab = 'roll' | 'properties' | 'rentals';

/** The DPRNK portal's subtabs. */
const DPRNK_SUBTABS: RegistrySubTab[] = ['roll', 'properties', 'rentals'];

const REGISTRY_SUBTABS: { id: RegistrySubTab; label: string; hint: string }[] = [
  { id: 'roll', label: 'Identification du redevable', hint: 'Registered contributors & ledger standing' },
  { id: 'properties', label: 'Identification des Propriétés', hint: 'Cadastral property declaration & foncier duty' },
  {
    id: 'rentals',
    label: 'Précision sur les propriétés données en location',
    hint: 'Tenancies, rents and the IRL declaration they evidence',
  },
];

/** Segmented subtab control — the sliding accent pill marks the active view. */
const SubTabBar: React.FC<{
  active: RegistrySubTab;
  onChange: (id: RegistrySubTab) => void;
  tabs?: RegistrySubTab[];
}> = ({ active, onChange, tabs }) => (
  <div
    role="tablist"
    aria-label="Registry sections"
    className="inline-flex items-center gap-1 p-1 rounded-[12px] bg-surface2 border border-line"
  >
    {REGISTRY_SUBTABS.filter((tab) => !tabs || tabs.includes(tab.id)).map((tab) => {
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

export const TaxpayerRegistryView: React.FC<TaxpayerRegistryViewProps> = ({
  userRole,
  subTabs,
  nifOnCard = true,
  depotFieldsOnCard = false,
  formeParcelleOnCard = true,
  rollColumns = 'dprnk',
  addressFilters = true,
}) => {
  const rollCols = rollColumns === 'dgi' ? DGI_ROLL : DPRNK_ROLL;
  const showCol = (c: RollColumn) => rollCols.includes(c);
  const { currentUser, userProfile } = useAuth();
  const { showToast } = useToast();

  // ---- Ledger state -------------------------------------------------------
  const [taxpayers, setTaxpayers] = useState<Business[]>([]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [taxRates, setTaxRates] = useState<TaxRate[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // ---- Query state -------------------------------------------------------
  const [searchQuery, setSearchQuery] = useState('');
  // Address filters — '' means "all". City is the ville resolved from the
  // address tree; the other three read straight off the taxpayer record.
  const [cityFilter, setCityFilter] = useState('');
  const [communeFilter, setCommuneFilter] = useState('');
  const [quartierFilter, setQuartierFilter] = useState('');
  const [avenueFilter, setAvenueFilter] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' });

  /**
   * The address tree maintained in Settings → Adresse. A contributor record
   * stores a commune and a quartier but no ville, so the roll's Ville column
   * reads it off the tree by matching the commune it holds. A commune that is
   * not registered anywhere shows as "—" rather than being guessed at.
   */
  const [addressRegistry, setAddressRegistry] = useState<AddressRegistry | null>(null);
  useEffect(() => subscribeToAddressRegistry(setAddressRegistry), []);

  /**
   * Resolve a contributor's ville by walking the Settings → Adresse tree in the
   * order it is built: the commune they were enrolled under has to sit inside
   * the ville reported. Where two villes hold a commune of the same name the
   * contributor's quartier breaks the tie, and if nothing matches the cell is
   * left empty — a roll that guessed a town would put taxpayers in the wrong
   * jurisdiction.
   */
  const villeOf = useCallback(
    (t: Business): string => {
      // Picked on the enrolment card since it became a dropdown.
      if (t.ville && t.ville.trim()) return t.ville.trim();
      const commune = (t.commune || '').trim().toLowerCase();
      if (!commune) return '';
      const villes = addressRegistry?.villes || [];
      const holding = (ville: (typeof villes)[number]) =>
        ville.communes.some((c) => c.name.trim().toLowerCase() === commune);
      const candidates = villes.filter(holding);
      if (candidates.length === 0) return '';
      if (candidates.length === 1) return candidates[0].name;

      const quartier = (t.quartier || '').trim().toLowerCase();
      if (!quartier) return '';
      const narrowed = candidates.filter((ville) =>
        ville.communes.some(
          (c) =>
            c.name.trim().toLowerCase() === commune &&
            c.quartiers.some((q) => q.name.trim().toLowerCase() === quartier)
        )
      );
      return narrowed.length === 1 ? narrowed[0].name : '';
    },
    [addressRegistry]
  );

  // Which registry subtab is on screen: the contributor roll or the
  // cadastral property declaration.
  const [chosenSubTab, setSubTab] = useState<RegistrySubTab>('roll');
  // A subtab this portal does not offer is never shown.
  const visibleSubTabs = subTabs ?? DPRNK_SUBTABS;
  const subTab: RegistrySubTab = visibleSubTabs.includes(chosenSubTab) ? chosenSubTab : 'roll';

  // ---- Panel state -------------------------------------------------------
  const [drawerTaxpayer, setDrawerTaxpayer] = useState<Business | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editing, setEditing] = useState<Business | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const canModify = userRole === 'Admin' || userRole === 'Cashier';
  const canDelete = userRole === 'Admin';

  // ---- Real-time ledger subscriptions ------------------------------------
  useEffect(() => {
    setLoading(true);
    getTaxRates(true)
      .then((rates) => setTaxRates(rates || []))
      .catch((err) => console.warn('[Taxpayer Registry] Rate schedule load error:', err));

    const unsubBiz = subscribeToBusinesses(
      (data) => {
        setTaxpayers(data || []);
        setLoading(false);
      },
      (err) => {
        console.error('[Taxpayer Registry] Registry listener error:', err);
        setLoading(false);
      }
    );
    const unsubAssessments = subscribeToAssessments(
      (data) => setAssessments(data || []),
      (err) => console.warn('[Taxpayer Registry] Assessment listener error:', err)
    );
    const unsubPayments = subscribeToPayments(
      (data) => setPayments(data || []),
      (err) => console.warn('[Taxpayer Registry] Payment listener error:', err)
    );

    return () => {
      unsubBiz();
      unsubAssessments();
      unsubPayments();
    };
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [biz, ass, pay, rates] = await Promise.all([
        getBusinesses(),
        getAssessments(),
        getPayments(),
        getTaxRates(true),
      ]);
      setTaxpayers(biz || []);
      setAssessments(ass || []);
      setPayments(pay || []);
      setTaxRates(rates || []);
      showToast('Registry refreshed from the fiscal ledger.', 'success', 'Synced');
    } catch (err) {
      console.warn('[Taxpayer Registry] Reload error:', err);
      showToast('Could not refresh the registry. Showing the last synced data.', 'error', 'Sync Failed');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  // ---- Derived fiscal intelligence ---------------------------------------
  const profiles = useMemo(
    () => computeTaxpayerFiscalProfiles(taxpayers, assessments, payments, taxRates),
    [taxpayers, assessments, payments, taxRates]
  );
  const roll = useMemo(() => summarizeFiscalRoll(taxpayers, profiles), [taxpayers, profiles]);

  /** Patente class recorded at registration, backfilled from size when absent. */
  const categoryOf = useCallback((t: Business): PatenteCategory => {
    const recorded = t.patenteCategory;
    if (recorded) return normalizePatenteCategory(recorded);
    return SIZE_TO_PATENTE_CATEGORY[normalizeSizeClassSafe(t.sizeClass)];
  }, []);

  /** The value of one address level for a taxpayer. */
  const addrValue = useCallback(
    (t: Business, dim: AddrDim): string => {
      switch (dim) {
        case 'city':
          return villeOf(t).trim();
        case 'commune':
          return (t.commune || '').trim();
        case 'quartier':
          return (t.quartier || '').trim();
        default:
          return (t.physicalAddress || '').trim();
      }
    },
    [villeOf]
  );

  /**
   * Whether a taxpayer passes the address filters. `except` leaves one level
   * out, so each dropdown can list the values still reachable under the others.
   */
  const passesAddr = useCallback(
    (t: Business, except?: AddrDim) => {
      const f: Record<AddrDim, string> = {
        city: cityFilter,
        commune: communeFilter,
        quartier: quartierFilter,
        avenue: avenueFilter,
      };
      return (['city', 'commune', 'quartier', 'avenue'] as AddrDim[]).every(
        (d) => d === except || !f[d] || addrValue(t, d) === f[d]
      );
    },
    [addrValue, cityFilter, communeFilter, quartierFilter, avenueFilter]
  );

  /** Distinct, sorted options per level — narrowed by the other active filters. */
  const addrOptions = useMemo(() => {
    const selected: Record<AddrDim, string> = {
      city: cityFilter,
      commune: communeFilter,
      quartier: quartierFilter,
      avenue: avenueFilter,
    };
    const build = (dim: AddrDim) => {
      const set = new Set(
        taxpayers.filter((t) => passesAddr(t, dim)).map((t) => addrValue(t, dim)).filter(Boolean)
      );
      // Keep a chosen value visible even if the other filters would hide it,
      // so it can always be seen and cleared.
      if (selected[dim]) set.add(selected[dim]);
      return Array.from(set).sort((a, b) => a.localeCompare(b));
    };
    return {
      city: build('city'),
      commune: build('commune'),
      quartier: build('quartier'),
      avenue: build('avenue'),
    } as Record<AddrDim, string[]>;
  }, [taxpayers, passesAddr, addrValue, cityFilter, communeFilter, quartierFilter, avenueFilter]);

  const rows = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return taxpayers
      .map((t) => ({ taxpayer: t, profile: profiles.get(t.id), category: categoryOf(t) }))
      .filter(({ taxpayer: t }) => {
        if (q) {
          const haystack = [
            t.service,
            t.numeroDepot,
            t.numeroImpot,
            t.businessName,
            t.sigle,
            t.ownerFullName,
            t.nationalIdOrRccm,
            t.nif,
            t.idNat,
            t.phoneNumber,
            t.email,
            t.quartier,
            t.physicalAddress,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return passesAddr(t);
      });
  }, [taxpayers, profiles, searchQuery, categoryOf, passesAddr]);

  const sortedRows = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sort.key) {
        case 'service':
          return dir * (a.taxpayer.service || '').localeCompare(b.taxpayer.service || '');
        case 'depot':
          return dir * (a.taxpayer.numeroDepot || '').localeCompare(b.taxpayer.numeroDepot || '', undefined, { numeric: true });
        case 'impot':
          return dir * (a.taxpayer.numeroImpot || '').localeCompare(b.taxpayer.numeroImpot || '', undefined, { numeric: true });
        case 'mois':
          return dir * ((a.taxpayer.salairesMois || 0) - (b.taxpayer.salairesMois || 0));
        case 'annee':
          return dir * ((a.taxpayer.annee || 0) - (b.taxpayer.annee || 0));
        case 'name':
          return dir * (a.taxpayer.businessName || '').localeCompare(b.taxpayer.businessName || '');
        case 'nif':
          return (
            dir *
            (a.taxpayer.nif || a.taxpayer.nationalIdOrRccm || '').localeCompare(
              b.taxpayer.nif || b.taxpayer.nationalIdOrRccm || ''
            )
          );
        case 'sigle':
          return dir * (a.taxpayer.sigle || '').localeCompare(b.taxpayer.sigle || '');
        case 'idnat':
          return dir * (a.taxpayer.idNat || '').localeCompare(b.taxpayer.idNat || '');
        case 'commune':
          return dir * (a.taxpayer.commune || '').localeCompare(b.taxpayer.commune || '');
        case 'ville':
          return dir * villeOf(a.taxpayer).localeCompare(villeOf(b.taxpayer));
        case 'quartier':
          return dir * (a.taxpayer.quartier || '').localeCompare(b.taxpayer.quartier || '');
        case 'avenue':
          return dir * (a.taxpayer.physicalAddress || '').localeCompare(b.taxpayer.physicalAddress || '');
        case 'numero':
          return dir * (a.taxpayer.numeroParcelle || '').localeCompare(b.taxpayer.numeroParcelle || '');
        case 'phone':
          return dir * (a.taxpayer.phoneNumber || '').localeCompare(b.taxpayer.phoneNumber || '');
        case 'email':
          return dir * (a.taxpayer.email || '').localeCompare(b.taxpayer.email || '');
        case 'forme':
          return dir * (a.taxpayer.taxpayerType || '').localeCompare(b.taxpayer.taxpayerType || '');
        case 'registered':
          return dir * (a.taxpayer.registrationDate || '').localeCompare(b.taxpayer.registrationDate || '');
        default:
          return 0;
      }
    });
  }, [rows, sort, categoryOf, villeOf]);

  const filtersActive =
    !!searchQuery || !!cityFilter || !!communeFilter || !!quartierFilter || !!avenueFilter;

  const resetFilters = () => {
    setSearchQuery('');
    setCityFilter('');
    setCommuneFilter('');
    setQuartierFilter('');
    setAvenueFilter('');
  };

  const toggleSort = (key: SortKey) =>
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' }
    );

  // ---- Mutations ----------------------------------------------------------
  const patchForm = (patch: Partial<FormState>) => setForm((prev) => ({ ...prev, ...patch }));

  const openCreate = () => {
    setForm(emptyForm());
    setFormErrors({});
    setIsCreateOpen(true);
  };

  const openEdit = (taxpayer: Business) => {
    setEditing(taxpayer);
    setForm({
      service: taxpayer.service || '',
      numeroDepot: taxpayer.numeroDepot || '',
      numeroImpot: taxpayer.numeroImpot || '',
      salairesMois: taxpayer.salairesMois ? String(taxpayer.salairesMois) : '',
      annee: taxpayer.annee ? String(taxpayer.annee) : '',
      businessName: taxpayer.businessName || '',
      sigle: taxpayer.sigle || '',
      numeroParcelle: taxpayer.numeroParcelle || '',
      ownerFullName: taxpayer.ownerFullName || '',
      nationalIdOrRccm: taxpayer.nationalIdOrRccm || '',
      nif: taxpayer.nif || '',
      // An existing record's number is already fixed; its provenance is not a
      // live choice on this form.
      nifSource: '',
      idNat: taxpayer.idNat || '',
      email: taxpayer.email || '',
      taxpayerType: normalizeTaxpayerType(taxpayer.taxpayerType),
      phoneNumber: taxpayer.phoneNumber || '',
      ville: villeOf(taxpayer),
      physicalAddress: taxpayer.physicalAddress || '',
      commune: taxpayer.commune || '',
      quartier: taxpayer.quartier || '',
      activitySector: taxpayer.activitySector || 'Commerce',
      sizeClass: normalizeSizeClassSafe(taxpayer.sizeClass),
      patenteCategory: categoryOf(taxpayer),
      registrationDate: taxpayer.registrationDate || todayDateString(),
      status: normalizeBusinessStatus(taxpayer.status),
      storefrontPhotoUrl: taxpayer.storefrontPhotoUrl || '',
    });
    setFormErrors({});
    setDrawerTaxpayer(null);
    setIsEditOpen(true);
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    if (!form.businessName.trim()) errors.businessName = 'Registered taxpayer name is required.';
    if (!form.phoneNumber.trim() || form.phoneNumber.trim() === '+243') {
      errors.phoneNumber = 'A reachable contact number is required.';
    }
    // The address is picked from Settings → Adresse: each level must be one of
    // the options listed under the level above it.
    const addr = addressChoices(addressRegistry, form.ville, form.commune, form.quartier);
    if (!addr.villes.includes(form.ville)) errors.ville = 'Select the ville.';
    else if (!addr.communes.includes(form.commune)) errors.commune = 'Select the commune.';
    else if (!addr.quartiers.includes(form.quartier)) errors.quartier = 'Select the quartier.';
    else if (!addr.avenues.includes(form.physicalAddress)) errors.physicalAddress = 'Select the avenue.';
    // Forme juridique is required where the card asks for it (not on the DGI portal).
    if (formeParcelleOnCard && !form.taxpayerType) {
      errors.taxpayerType = 'State whether this is a company or an individual.';
    }
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      errors.email = 'Enter a valid email address.';
    }
    // The NIF is the fiscal roll key — it must not collide with another taxpayer.
    const nif = form.nif.trim().toLowerCase();
    if (nif) {
      const clash = taxpayers.find((t) => t.id !== editing?.id && (t.nif || '').trim().toLowerCase() === nif);
      if (clash) errors.nif = `NIF already registered to ${clash.businessName}.`;
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const auditActor = {
    uid: currentUser?.uid || 'anonymous',
    name: userProfile?.displayName || 'Tax Officer',
  };

  /**
   * Whether the roll minted the number or copied one from outside it. Recorded
   * in the ledger because the two carry different guarantees: an issued NIF is
   * unique by construction here, a recorded one only by the check at entry.
   */
  const nifProvenanceNote = (source: FormState['nifSource']): string => {
    if (source === 'recorded') {
      return ' NIF recorded from the taxpayer’s existing DPRNK identification; not issued by this roll.';
    }
    if (source === 'issued') {
      return ' NIF issued from this roll’s sequence.';
    }
    return '';
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canModify || submitting) return;
    if (!validate()) {
      showToast('Please correct the highlighted fields.', 'warning', 'Incomplete Record');
      return;
    }
    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const newId = 'biz_goma_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
      const record: Business = {
        id: newId,
        service: form.service.trim() || undefined,
        numeroDepot: form.numeroDepot.trim() || undefined,
        numeroImpot: form.numeroImpot.trim() || undefined,
        salairesMois: form.salairesMois ? Number(form.salairesMois) : undefined,
        annee: form.annee ? Number(form.annee) : undefined,
        businessName: form.businessName.trim(),
        sigle: form.sigle.trim() || undefined,
        numeroParcelle: form.numeroParcelle.trim() || undefined,
        ownerFullName: form.ownerFullName.trim(),
        nationalIdOrRccm: form.nationalIdOrRccm.trim(),
        nif: form.nif.trim() || undefined,
        idNat: form.idNat.trim() || undefined,
        email: form.email.trim() || undefined,
        taxpayerType: form.taxpayerType,
        phoneNumber: form.phoneNumber.trim(),
        ville: form.ville,
        physicalAddress: form.physicalAddress.trim(),
        commune: form.commune,
        quartier: form.quartier.trim(),
        activitySector: form.activitySector,
        sizeClass: form.sizeClass,
        patenteCategory: form.patenteCategory,
        registrationDate: form.registrationDate,
        status: form.status,
        storefrontPhotoUrl: form.storefrontPhotoUrl.trim() || undefined,
        registeredBy: auditActor.uid,
        registeredByName: auditActor.name,
        createdAt: now,
        updatedAt: now,
      };
      await addBusiness(record);
      await logAuditEvent(
        auditActor.uid,
        auditActor.name,
        userRole,
        'REGISTER_BUSINESS',
        'Taxpayer',
        record.id,
        `Taxpayer "${record.businessName}" (NIF: ${record.nif || 'pending'}) enrolled on the fiscal roll of ${record.commune} under ${PATENTE_CATEGORY_LABELS[form.patenteCategory].label}.${nifProvenanceNote(form.nifSource)}`
      );
      setIsCreateOpen(false);
      showToast(`${record.businessName} added to the taxpayer registry.`, 'success', 'Taxpayer Enrolled');
    } catch (err) {
      console.error('[Taxpayer Registry] Enrollment error:', err);
      showToast('The enrollment could not be saved. Please retry.', 'error', 'Enrollment Failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canModify || !editing || submitting) return;
    if (!validate()) {
      showToast('Please correct the highlighted fields.', 'warning', 'Incomplete Record');
      return;
    }
    setSubmitting(true);
    try {
      const updates: Partial<Business> = {
        service: form.service.trim() || undefined,
        numeroDepot: form.numeroDepot.trim() || undefined,
        numeroImpot: form.numeroImpot.trim() || undefined,
        salairesMois: form.salairesMois ? Number(form.salairesMois) : undefined,
        annee: form.annee ? Number(form.annee) : undefined,
        businessName: form.businessName.trim(),
        sigle: form.sigle.trim() || undefined,
        numeroParcelle: form.numeroParcelle.trim() || undefined,
        ownerFullName: form.ownerFullName.trim(),
        nationalIdOrRccm: form.nationalIdOrRccm.trim(),
        nif: form.nif.trim() || undefined,
        idNat: form.idNat.trim() || undefined,
        email: form.email.trim() || undefined,
        taxpayerType: form.taxpayerType,
        phoneNumber: form.phoneNumber.trim(),
        ville: form.ville,
        physicalAddress: form.physicalAddress.trim(),
        commune: form.commune,
        quartier: form.quartier.trim(),
        activitySector: form.activitySector,
        sizeClass: form.sizeClass,
        patenteCategory: form.patenteCategory,
        registrationDate: form.registrationDate,
        status: form.status,
        storefrontPhotoUrl: form.storefrontPhotoUrl.trim() || undefined,
      };
      await updateBusiness(editing.id, updates);
      await logAuditEvent(
        auditActor.uid,
        auditActor.name,
        userRole,
        'UPDATE_BUSINESS',
        'Taxpayer',
        editing.id,
        `Registry record amended for "${updates.businessName}" (NIF: ${updates.nif || 'pending'}).${nifProvenanceNote(form.nifSource)}`
      );
      setIsEditOpen(false);
      setEditing(null);
      showToast('Registry record updated.', 'success', 'Changes Saved');
    } catch (err) {
      console.error('[Taxpayer Registry] Update error:', err);
      showToast('The changes could not be saved. Please retry.', 'error', 'Update Failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (taxpayer: Business) => {
    if (!canDelete || submitting) return;
    setDeletingId(taxpayer.id);
    try {
      const result = await deleteBusiness(taxpayer.id, {
        uid: auditActor.uid,
        displayName: auditActor.name,
        role: userRole,
      });
      if (result?.success === false) {
        showToast(result.reason || 'This record cannot be deleted.', 'warning', 'Deletion Blocked');
      } else {
        setDrawerTaxpayer(null);
        showToast(`${taxpayer.businessName} removed from the registry.`, 'success', 'Record Deleted');
      }
    } catch (err: any) {
      showToast(err?.message || 'The record could not be deleted.', 'error', 'Deletion Failed');
    } finally {
      setDeletingId(null);
    }
  };

  // ---- Clipboard ----------------------------------------------------------
  const copyValue = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(key);
      window.setTimeout(() => setCopiedField(null), 1600);
    } catch {
      showToast('Clipboard access is unavailable in this browser.', 'error', 'Copy Failed');
    }
  };

  // ---- Render -------------------------------------------------------------
  const SortIcon: React.FC<{ column: SortKey }> = ({ column }) => {
    if (sort.key !== column) return <ArrowUpDown className="w-3 h-3 shrink-0 opacity-40" />;
    return sort.dir === 'asc' ? (
      <ArrowUp className="w-3 h-3 shrink-0 text-accent" />
    ) : (
      <ArrowDown className="w-3 h-3 shrink-0 text-accent" />
    );
  };

  const Th: React.FC<{
    column: SortKey;
    label: string;
    align?: 'left' | 'center' | 'right';
    widthClass?: string;
  }> = ({ column, label, align = 'left', widthClass = '' }) => (
    <th
      className={`${widthClass} text-[11px] font-bold uppercase tracking-[0.07em] leading-tight text-faint px-3 py-3.5 align-middle ${
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
      }`}
    >
      <button
        type="button"
        onClick={() => toggleSort(column)}
        aria-label={`Sort by ${label}`}
        title={`Sort by ${label}`}
        className={`inline-flex items-center gap-1.5 uppercase tracking-[0.07em] leading-tight text-left hover:text-ink transition-premium ${
          sort.key === column ? 'text-ink' : ''
        } ${align === 'right' ? 'flex-row-reverse text-right' : ''}`}
      >
        {label}
        <SortIcon column={column} />
      </button>
    </th>
  );

  const drawerProfile = drawerTaxpayer ? profiles.get(drawerTaxpayer.id) : undefined;

  return (
    <div className="space-y-8 font-sans">
      {subTab === 'roll' && (
        <PageHeader
          title="Registration"
          actions={
            <>
              <Button variant="ghost" size="md" icon={<RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />} onClick={reload}>
                Refresh
              </Button>
              {canModify && (
                <Button variant="primary" size="md" icon={<Plus className="w-4 h-4" />} onClick={openCreate}>
                  Enroll Taxpayer
                </Button>
              )}
            </>
          }
        />
      )}

      {/* ===== RENTED PROPERTIES ===== */}
      {subTab === 'rentals' ? (
        <>
          <SubTabBar active={subTab} onChange={setSubTab} tabs={visibleSubTabs} />
          <RentalLeasesView userRole={userRole} />
        </>
      ) : subTab === 'properties' ? (
        /* ===== CADASTRAL PROPERTY DECLARATION ===== */
        <>
          <SubTabBar active={subTab} onChange={setSubTab} tabs={visibleSubTabs} />
          <PropertyRegisterView userRole={userRole} />
        </>
      ) : (
        <>
          <MetricStrip
            columns={1}
            items={[
              {
                label: 'On The Roll',
                value: roll.total.toLocaleString('en-US'),
                trend: `${taxpayers.filter((t) => t.commune === 'Goma').length} in Goma`,
                trendType: 'muted',
                subline: 'Registered contributors',
                icon: <Users className="w-4 h-4 text-accent" />,
              },
            ]}
          />

          {/* The roll's own card begins below the KPI strip, so the subtab
              navigation sits directly above its header. */}
          <SubTabBar active={subTab} onChange={setSubTab} tabs={visibleSubTabs} />

      <Panel
        subtitle={`Displaying ${sortedRows.length} of ${taxpayers.length} registered taxpayer${taxpayers.length === 1 ? '' : 's'}`}
        padding="none"
      >
        {/* Query bar */}
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
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-[6px] text-muted hover:text-ink hover:bg-surface2 transition-premium cursor-pointer"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {addressFilters && (
          <div className="flex items-center gap-2 flex-wrap">
            {([
              { dim: 'city' as const, value: cityFilter, set: setCityFilter, all: 'All cities', label: 'Filter by city' },
              { dim: 'commune' as const, value: communeFilter, set: setCommuneFilter, all: 'All communes', label: 'Filter by commune' },
              { dim: 'quartier' as const, value: quartierFilter, set: setQuartierFilter, all: 'All neighborhoods', label: 'Filter by neighborhood' },
              { dim: 'avenue' as const, value: avenueFilter, set: setAvenueFilter, all: 'All avenues', label: 'Filter by avenue' },
            ]).map(({ dim, value, set: setValue, all, label }) => (
              <select
                key={dim}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-label={label}
                title={label}
                className={`px-3 py-2 text-xs rounded-[10px] border bg-surface font-medium text-ink focus:border-accent focus:outline-none transition-premium font-sans cursor-pointer max-w-[10rem] truncate ${
                  value ? 'border-accent text-accent' : 'border-line'
                }`}
              >
                <option value="">{all}</option>
                {addrOptions[dim].map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ))}
            {filtersActive && (
              <Button variant="secondary" size="sm" onClick={resetFilters} icon={<X className="w-3.5 h-3.5" />}>
                Clear
              </Button>
            )}
          </div>
          )}
        </div>
        {/* Table */}
        {loading ? (
          <TableSkeleton rows={6} cols={7} />
        ) : sortedRows.length === 0 ? (
          <div className="p-8">
            <EmptyState
              icon={<Users className="w-6 h-6" />}
              title={filtersActive ? 'No taxpayer matches these criteria' : 'The fiscal roll is empty'}
              description={
                filtersActive
                  ? 'No registered contributor matches your search and filters. Try widening the criteria.'
                  : 'No contributor has been enrolled yet. Register the first establishment to open the municipal roll.'
              }
              actionLabel={filtersActive ? 'Reset Filters' : canModify ? 'Enroll Taxpayer' : undefined}
              onAction={() => (filtersActive ? resetFilters() : openCreate())}
            />
          </div>
        ) : (
          <div className="w-full overflow-x-auto">
            {/* The DGI roll has one more column: it is laid out wider (it scrolls sideways). */}
            <table
              className={`premium-table w-full ${rollColumns === 'dgi' ? 'min-w-[1930px]' : 'min-w-[1560px]'} table-fixed text-left border-collapse font-sans`}
            >
              <thead>
                <tr className="border-b border-line bg-surface2/50">
                  {showCol('nif') && <Th column="nif" label="NIF" widthClass={ROLL_COLUMNS.nif} />}
                  {showCol('service') && <Th column="service" label="Service" widthClass={ROLL_COLUMNS.service} />}
                  {showCol('depot') && <Th column="depot" label="Numéro de dépôt" widthClass={ROLL_COLUMNS.depot} />}
                  {showCol('mois') && <Th column="mois" label="Salaires du mois de" widthClass={ROLL_COLUMNS.mois} />}
                  {showCol('annee') && <Th column="annee" label="Année" widthClass={ROLL_COLUMNS.annee} />}
                  <Th column="name" label="Noms ou dénomination sociale" widthClass={ROLL_COLUMNS.taxpayer} />
                  {showCol('impot') && <Th column="impot" label="Numéro impôt" widthClass={ROLL_COLUMNS.impot} />}
                  <Th column="sigle" label="Sigle" widthClass={ROLL_COLUMNS.sigle} />
                  <Th column="idnat" label="Numéro d'identification nationale" widthClass={ROLL_COLUMNS.idnat} />
                  <Th column="ville" label="Ville" widthClass={ROLL_COLUMNS.ville} />
                  <Th column="commune" label="Commune" widthClass={ROLL_COLUMNS.commune} />
                  <Th column="quartier" label="Quartier" widthClass={ROLL_COLUMNS.quartier} />
                  <Th column="avenue" label="Avenue" widthClass={ROLL_COLUMNS.avenue} />
                  {showCol('numero') && <Th column="numero" label="Numéro de parcelle" widthClass={ROLL_COLUMNS.numero} />}
                  <Th column="phone" label="Téléphone" widthClass={ROLL_COLUMNS.phone} />
                  <Th column="email" label="Email" widthClass={ROLL_COLUMNS.email} />
                  {showCol('forme') && <Th column="forme" label="Forme juridique" widthClass={ROLL_COLUMNS.forme} />}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sortedRows.map(({ taxpayer: t }) => {
                  const tint = TINT_CLASS[tintFor(t.businessName || t.id)];
                  return (
                    <tr key={t.id} className="hover:bg-surface2/30 transition-premium group">
                      {showCol('nif') && (
                      <td className={`${ROLL_COLUMNS.nif} px-3 py-4 align-middle`}>
                        {t.nif ? (
                          <div className="font-mono text-xs text-ink tabular-nums truncate" title={t.nif}>
                            {t.nif}
                          </div>
                        ) : (
                          <>
                            <div
                              className="font-mono text-xs text-ink tabular-nums truncate"
                              title={t.nationalIdOrRccm}
                            >
                              {t.nationalIdOrRccm}
                            </div>
                            <span className="text-[11px] font-bold uppercase text-warn tracking-wider">NIF pending</span>
                          </>
                        )}
                      </td>
                      )}

                      {showCol('service') && (
                        <td className={`${ROLL_COLUMNS.service} px-3 py-4 align-middle`}>
                          <div className="text-xs font-medium text-ink truncate" title={t.service || undefined}>
                            {t.service || '—'}
                          </div>
                        </td>
                      )}
                      {showCol('depot') && (
                        <td className={`${ROLL_COLUMNS.depot} px-3 py-4 align-middle`}>
                          <div className="font-mono text-xs text-ink tabular-nums truncate" title={t.numeroDepot || undefined}>
                            {t.numeroDepot || '—'}
                          </div>
                        </td>
                      )}
                      {showCol('mois') && (
                        <td className={`${ROLL_COLUMNS.mois} px-3 py-4 align-middle`}>
                          <div className="text-xs text-ink truncate">
                            {t.salairesMois && t.salairesMois >= 1 && t.salairesMois <= 12 ? MOIS[t.salairesMois - 1] : '—'}
                          </div>
                        </td>
                      )}
                      {showCol('annee') && (
                        <td className={`${ROLL_COLUMNS.annee} px-3 py-4 align-middle`}>
                          <div className="font-mono text-xs text-ink tabular-nums truncate">{t.annee || '—'}</div>
                        </td>
                      )}

                      <td className={`${ROLL_COLUMNS.taxpayer} px-3 py-4 align-middle`}>
                        {/* The name opens the dossier: with no Record column,
                            the row's identity is where the record is entered. */}
                        <button
                          type="button"
                          onClick={() => setDrawerTaxpayer(t)}
                          aria-label={`Open dossier for ${t.businessName}`}
                          title={`${t.businessName} — open dossier`}
                          className="group/name flex items-center gap-3 min-w-0 w-full text-left cursor-pointer"
                        >
                          <div
                            className={`w-[34px] h-[34px] rounded-[10px] font-display font-bold text-xs flex items-center justify-center shrink-0 ${tint}`}
                          >
                            {initialsOf(t.businessName)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <span className="block text-xs font-bold text-ink truncate group-hover/name:text-accent group-hover/name:underline underline-offset-2 transition-premium">
                              {t.businessName}
                            </span>
                          </div>
                        </button>
                      </td>

                      {showCol('impot') && (
                        <td className={`${ROLL_COLUMNS.impot} px-3 py-4 align-middle`}>
                          <div className="font-mono text-xs text-ink tabular-nums truncate" title={t.numeroImpot || undefined}>
                            {t.numeroImpot || '—'}
                          </div>
                        </td>
                      )}

                      <td className={`${ROLL_COLUMNS.sigle} px-3 py-4 align-middle`}>
                        <div className="text-xs font-semibold text-ink truncate" title={t.sigle || undefined}>
                          {t.sigle || '—'}
                        </div>
                      </td>

                      <td className={`${ROLL_COLUMNS.idnat} px-3 py-4 align-middle`}>
                        <div className="font-mono text-xs text-ink tabular-nums truncate" title={t.idNat || undefined}>
                          {t.idNat || '—'}
                        </div>
                      </td>

                      <td className={`${ROLL_COLUMNS.ville} px-3 py-4 align-middle`}>
                        <div className="text-xs font-medium text-ink truncate" title={villeOf(t) || undefined}>
                          {villeOf(t) || '—'}
                        </div>
                      </td>

                      <td className={`${ROLL_COLUMNS.commune} px-3 py-4 align-middle`}>
                        <div className="text-xs font-medium text-ink truncate" title={t.commune}>
                          {t.commune || '—'}
                        </div>
                      </td>

                      <td className={`${ROLL_COLUMNS.quartier} px-3 py-4 align-middle`}>
                        <div className="text-xs font-medium text-ink truncate" title={t.quartier}>
                          {t.quartier || '—'}
                        </div>
                      </td>

                      {/* The enrolment card labels this "Avenue & Street Address",
                          so the street line a contributor filed is the avenue. */}
                      <td className={`${ROLL_COLUMNS.avenue} px-3 py-4 align-middle`}>
                        <div className="text-xs text-ink truncate" title={t.physicalAddress}>
                          {t.physicalAddress || '—'}
                        </div>
                      </td>

                      {showCol('numero') && (
                      <td className={`${ROLL_COLUMNS.numero} px-3 py-4 align-middle`}>
                        <div
                          className="text-xs font-mono text-ink tabular-nums truncate"
                          title={t.numeroParcelle}
                        >
                          {t.numeroParcelle || '—'}
                        </div>
                      </td>
                      )}

                      <td className={`${ROLL_COLUMNS.phone} px-3 py-4 align-middle`}>
                        <div className="text-xs font-mono text-ink tabular-nums truncate" title={t.phoneNumber || undefined}>
                          {t.phoneNumber || '—'}
                        </div>
                      </td>

                      <td className={`${ROLL_COLUMNS.email} px-3 py-4 align-middle`}>
                        <div className="text-xs text-ink truncate" title={t.email || undefined}>
                          {t.email || '—'}
                        </div>
                      </td>

                      {showCol('forme') && (
                      <td className={`${ROLL_COLUMNS.forme} px-3 py-4 align-middle`}>
                        <div className="text-xs text-ink truncate" title={t.taxpayerType || undefined}>
                          {t.taxpayerType || '—'}
                        </div>
                      </td>
                      )}

                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
        </>
      )}

      {/* ================= TAXPAYER DOSSIER DRAWER ================= */}
      {drawerTaxpayer && (
        <TaxpayerDossier
          taxpayer={drawerTaxpayer}
          profile={drawerProfile}
          canModify={canModify}
          canDelete={canDelete}
          deleting={deletingId === drawerTaxpayer.id}
          copiedField={copiedField}
          onCopy={copyValue}
          onClose={() => setDrawerTaxpayer(null)}
          onEdit={() => openEdit(drawerTaxpayer)}
          onDelete={() => handleDelete(drawerTaxpayer)}
        />
      )}

      {/* ================= ENROLLMENT FORM ================= */}
      {(isCreateOpen || isEditOpen) && (
        <TaxpayerFormModal
          mode={isCreateOpen ? 'create' : 'edit'}
          form={form}
          errors={formErrors}
          submitting={submitting}
          canModify={canModify}
          existingNifs={taxpayers.map((t) => t.nif || '').filter(Boolean)}
          canRecordExistingNif={userRole === 'Admin'}
          showNif={nifOnCard}
          showDepotFields={depotFieldsOnCard}
          showFormeParcelle={formeParcelleOnCard}
          addressRegistry={addressRegistry}
          patch={patchForm}
          onClose={() => {
            if (isCreateOpen) setIsCreateOpen(false);
            else {
              setIsEditOpen(false);
              setEditing(null);
            }
          }}
          onSubmit={isCreateOpen ? handleCreate : handleUpdate}
        />
      )}
    </div>
  );
};






/* ==================================================================== */
/*  Taxpayer dossier drawer                                             */
/*  Centred record: fiscal identity, cadastre, registration provenance   */
/*  and the assessment ledger position of one contributor.               */
/* ==================================================================== */

interface DossierProps {
  taxpayer: Business;
  profile?: TaxpayerFiscalProfile;
  canModify: boolean;
  canDelete: boolean;
  deleting: boolean;
  copiedField: string | null;
  onCopy: (key: string, value: string) => void;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

/** Identity value with a one-click copy affordance. */
const CopyableFact: React.FC<{
  label: string;
  value: string;
  copyKey: string;
  copied: boolean;
  onCopy: (key: string, value: string) => void;
}> = ({ label, value, copyKey, copied, onCopy }) => (
  <div className="p-3 rounded-[10px] bg-surface2/60 border border-line">
    <div className="flex items-start justify-between gap-2">
      <div className="min-w-0">
        <span className="text-[11px] font-bold uppercase text-muted tracking-wider block mb-1">{label}</span>
        <span className="text-xs font-semibold text-ink font-mono tabular-nums break-all">{value || '—'}</span>
      </div>
      {value && (
        <button
          type="button"
          onClick={() => onCopy(copyKey, value)}
          aria-label={`Copy ${label}`}
          className="p-1 rounded-[6px] text-muted hover:text-accent hover:bg-accent-soft transition-premium cursor-pointer shrink-0"
        >
          {copied ? <Check className="w-3 h-3 text-sage" /> : <Copy className="w-3 h-3" />}
        </button>
      )}
    </div>
  </div>
);

const StatusPill: React.FC<{ status: BusinessStatus }> = ({ status }) => {
  const normalized = normalizeBusinessStatus(status);
  if (normalized === 'Active') return <Badge variant="sage">Active</Badge>;
  if (normalized === 'Closure Pending') return <Badge variant="danger">Closure Pending</Badge>;
  return <Badge variant="neutral">Inactive</Badge>;
};

const TaxpayerDossier: React.FC<DossierProps> = ({
  taxpayer: t,
  profile,
  canModify,
  canDelete,
  deleting,
  copiedField,
  onCopy,
  onClose,
  onEdit,
  onDelete,
}) => {
  // Escape closes the drawer, matching the modal convention in this app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const tint = TINT_CLASS[tintFor(t.businessName || t.id)];

  /**
   * The cadastre is the only place a taxpayer's assets are recorded, so the
   * dossier reads them live for this taxpayer's id. Keeping the subscription in
   * the dossier means opening the drawer costs one filtered query, not a copy of
   * the whole register; it is torn down when the drawer closes.
   */
  const [properties, setProperties] = useState<PropertyParcel[]>([]);
  const [propertiesLoading, setPropertiesLoading] = useState(true);
  const [propertiesError, setPropertiesError] = useState(false);

  useEffect(() => {
    setProperties([]);
    setPropertiesLoading(true);
    setPropertiesError(false);
    const unsubscribe = subscribeToParcelsByOwner(
      t.id,
      (rows) => {
        setProperties(rows);
        setPropertiesLoading(false);
      },
      () => {
        setPropertiesError(true);
        setPropertiesLoading(false);
      }
    );
    return unsubscribe;
  }, [t.id]);

  return (
    /*
      Centred dialog rather than a side drawer: a 520px panel pinned to the
      right edge covers part of the roll the officer is still reading, and on a
      short window its footer actions fall below the fold. Capped to the
      viewport with a scrolling body and a pinned footer so the whole dossier is
      always reachable without the page behind it shifting.
    */
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-navy/50 backdrop-blur-xs animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside className="relative bg-surface border border-line shadow-2xl rounded-[18px] w-full max-w-[560px] max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="shrink-0 px-6 py-5 border-b border-line flex items-start justify-between gap-3 bg-surface">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-[42px] h-[42px] rounded-[12px] font-display font-bold text-sm flex items-center justify-center shrink-0 ${tint}`}>
              {initialsOf(t.businessName)}
            </div>
            <div className="min-w-0">
              <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-accent font-sans">
                Taxpayer Dossier
              </span>
              <h2 className="font-display text-lg font-bold text-ink tracking-tight truncate">{t.businessName}</h2>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <StatusPill status={t.status} />
                <ComplianceBadge state={profile?.state || 'unassessed'} size="sm" />
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dossier"
            className="p-1.5 rounded-[8px] text-muted hover:text-ink hover:bg-surface2 transition-premium cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto p-6 space-y-6 scrollbar-thin">
          {t.storefrontPhotoUrl && (
            <div className="rounded-[12px] overflow-hidden border border-line max-h-44">
              <img src={t.storefrontPhotoUrl} alt={t.businessName} className="w-full h-44 object-cover" />
            </div>
          )}

          {/* ---- Fiscal identity ---- */}
          <section>
            <SectionTitle icon={<IdCard className="w-3.5 h-3.5" />}>Fiscal Identity</SectionTitle>
            {/*
              RCCM is deliberately absent: it was retired from the enrolment
              form, and a dossier that still offers it invites an officer to
              copy an identifier the DPRNK no longer collects. `nationalIdOrRccm`
              stays on the record — legacy notices and certificates still cite
              it — it is simply no longer surfaced here.
            */}
            <div className="grid grid-cols-2 gap-3">
              <CopyableFact
                label="NIF"
                value={t.nif || ''}
                copyKey="nif"
                copied={copiedField === 'nif'}
                onCopy={onCopy}
              />
            </div>
          </section>

          {/* ---- Registered properties ---- */}
          <section>
            <SectionTitle icon={<Building2 className="w-3.5 h-3.5" />}>
              Registered Properties{properties.length > 0 ? ` (${properties.length})` : ''}
            </SectionTitle>
            {propertiesLoading ? (
              <div className="rounded-[10px] border border-line bg-surface2/30 px-3.5 py-4 flex items-center gap-2 text-[12px] text-muted">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading properties…
              </div>
            ) : propertiesError ? (
              <div className="rounded-[10px] border border-danger/25 bg-danger/8 px-3.5 py-3 text-[12px] text-danger">
                Properties could not be loaded. Close the dossier and try again.
              </div>
            ) : properties.length === 0 ? (
              <div className="rounded-[10px] border border-dashed border-line bg-surface2/30 px-3.5 py-3 text-[12px] text-muted">
                No property is registered against this taxpayer.
              </div>
            ) : (
              <div className="rounded-[10px] border border-line overflow-hidden divide-y divide-line">
                {properties.map((p) => {
                  const address = [
                    p.avenueLocalite,
                    p.quartierGroupement,
                    p.communeChefferie,
                    p.villeTerritoire,
                  ]
                    .filter(Boolean)
                    .join(', ');
                  const measure =
                    p.measureKind === 'nombre'
                      ? `${(p.measureValue || 0).toLocaleString()} ${
                          p.measureValue === 1 ? 'unit' : 'units'
                        }`
                      : `${(p.measureValue || 0).toLocaleString()} m²`;
                  return (
                    <div key={p.id} className="px-3.5 py-3 bg-surface2/30">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[12px] font-bold text-ink font-mono truncate">
                            {p.numeroParcelle || p.rang || 'Unnumbered'}
                          </div>
                          <div className="text-[11px] text-muted mt-0.5 truncate">
                            {p.nature || 'Unclassified'} · {p.usage || 'Use not recorded'}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[12px] font-bold text-ink tabular-nums">{measure}</div>
                          <div className="text-[11px] text-muted">FY {p.exercice || '—'}</div>
                        </div>
                      </div>
                      <div className="mt-1.5 flex items-center gap-1 text-[11px] text-muted">
                        <MapPin className="w-3 h-3 shrink-0" />
                        <span className="truncate">{address || 'Address not recorded'}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ---- Closure notice ---- */}
          {normalizeBusinessStatus(t.status) === 'Closure Pending' && (
            <section>
              <SectionTitle icon={<AlertTriangle className="w-3.5 h-3.5" />}>Administrative Closure</SectionTitle>
              <div className="p-4 rounded-[10px] bg-danger/8 border border-danger/25">
                <p className="text-xs font-bold text-danger">Closure notice on file</p>
                <dl className="mt-2 space-y-1.5 text-[12px]">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Issued</dt>
                    <dd className="font-semibold text-ink tabular-nums">{prettyDate(t.deregisteredAt)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">By</dt>
                    <dd className="font-semibold text-ink text-right">{t.deregisteredByName || '—'}</dd>
                  </div>
                  <div className="pt-1.5 border-t border-danger/15">
                    <dt className="text-muted">Reason</dt>
                    <dd className="font-semibold text-ink mt-0.5 leading-relaxed">
                      {t.deregistrationReason || 'Not recorded'}
                    </dd>
                  </div>
                </dl>
              </div>
            </section>
          )}

          {/* ---- Assessment history ---- */}
          {profile && profile.assessments.length > 0 && (
            <section>
              <SectionTitle icon={<Receipt className="w-3.5 h-3.5" />}>
                Assessment History ({profile.assessments.length})
              </SectionTitle>
              <div className="rounded-[10px] border border-line overflow-hidden divide-y divide-line">
                {profile.assessments.slice(0, 6).map((a) => {
                  const state = getNormalizedAssessmentStatus(a);
                  const balance =
                    typeof a.remainingBalanceUSD === 'number'
                      ? Math.max(0, a.remainingBalanceUSD)
                      : Math.max(0, (a.amountDueUSD || 0) - (a.amountPaidUSD || 0));
                  return (
                    <div key={a.id} className="px-3.5 py-3 flex items-center justify-between gap-3 bg-surface2/30">
                      <div className="min-w-0">
                        <div className="text-[12px] font-bold text-ink font-mono truncate">
                          {a.assessmentNumber || a.noticeNumber || a.id}
                        </div>
                        <div className="text-[11px] text-muted tabular-nums">
                          FY {a.fiscalYear} • due {prettyDate(a.dueDate)}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[12px] font-bold text-ink tabular-nums">
                          {usd(a.amountDueUSD || 0)}
                        </div>
                        <Badge
                          size="sm"
                          variant={
                            state === 'Paid'
                              ? 'sage'
                              : state === 'Overdue'
                              ? 'danger'
                              : state === 'Cancelled'
                              ? 'neutral'
                              : 'warn'
                          }
                        >
                          {balance > 0 && state !== 'Cancelled' ? usd(balance) : state}
                        </Badge>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </div>

        {/* Footer actions — pinned below the scroll area, always reachable */}
        <div className="shrink-0 px-6 py-3.5 border-t border-line bg-surface2/40 flex flex-wrap items-center justify-between gap-2.5">
          {canDelete ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              disabled={deleting}
              className="text-danger hover:border-danger hover:text-danger"
              icon={<Trash2 className="w-3.5 h-3.5" />}
            >
              {deleting ? 'Removing...' : 'Remove'}
            </Button>
          ) : (
            <span className="text-[12px] text-muted flex items-center gap-1.5">
              <Ban className="w-3 h-3" /> Read-only access
            </span>
          )}
          <div className="flex items-center gap-2.5">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Close
            </Button>
            {canModify && (
              <Button variant="primary" size="sm" onClick={onEdit} icon={<Pencil className="w-3.5 h-3.5" />}>
                Amend Record
              </Button>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
};

/* ==================================================================== */
/*  Enrollment / amendment form                                         */
/* ==================================================================== */

interface FormModalProps {
  mode: 'create' | 'edit';
  form: FormState;
  errors: Record<string, string>;
  submitting: boolean;
  canModify: boolean;
  /** Every NIF already on the roll, so an issued one can never collide. */
  existingNifs: string[];
  /** Admin only may record a NIF the taxpayer already holds from the DPRNK. */
  canRecordExistingNif: boolean;
  /** Whether the card has the NIF field at all (not on the DGI portal). */
  showNif: boolean;
  /** Whether the card has Service and Numéro de dépôt (DGI portal only). */
  showDepotFields: boolean;
  /** Whether the card has Forme juridique and Numéro de parcelle (not on the DGI portal). */
  showFormeParcelle: boolean;
  /** Settings → Adresse — the only source of the address dropdowns. */
  addressRegistry: AddressRegistry | null;
  patch: (patch: Partial<FormState>) => void;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
}

/** Labelled input used throughout the enrollment form. */
const Field: React.FC<{
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

/** The months of the year, janvier to décembre — "Salaires du mois de". */
const MOIS = [
  'Janvier',
  'Février',
  'Mars',
  'Avril',
  'Mai',
  'Juin',
  'Juillet',
  'Août',
  'Septembre',
  'Octobre',
  'Novembre',
  'Décembre',
] as const;

/** The years offered by "Année": 2020 to 2035. */
const ANNEES: number[] = Array.from({ length: 2035 - 2020 + 1 }, (_, i) => 2020 + i);

const inputClass =
  'w-full px-3.5 py-2 bg-surface2 border border-line rounded-[10px] text-xs text-ink placeholder:text-muted focus:border-accent focus:outline-none transition-premium font-sans';

const SectionHeading: React.FC<{ icon: React.ReactNode; children: React.ReactNode }> = ({ icon, children }) => (
  <div className="text-[12px] font-bold uppercase tracking-wider text-muted mb-3 flex items-center gap-1.5 border-b border-line pb-1.5">
    <span className="text-accent">{icon}</span>
    {children}
  </div>
);

const TaxpayerFormModal: React.FC<FormModalProps> = ({
  mode,
  form,
  errors,
  submitting,
  canModify,
  existingNifs,
  canRecordExistingNif,
  showNif,
  showDepotFields,
  showFormeParcelle,
  addressRegistry,
  patch,
  onClose,
  onSubmit,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isCreate = mode === 'create';
  const addr = addressChoices(addressRegistry, form.ville, form.commune, form.quartier);
  const hasAddressTree = addr.villes.length > 0;
  /**
   * Pick one level and carry the choice down: what sits beneath is kept only
   * where it still belongs under the new pick, otherwise it is cleared.
   */
  const pickAddress = (level: 'ville' | 'commune' | 'quartier' | 'avenue', name: string) => {
    const next = {
      ville: form.ville,
      commune: form.commune,
      quartier: form.quartier,
      physicalAddress: form.physicalAddress,
      [level === 'avenue' ? 'physicalAddress' : level]: name,
    };
    const below = addressChoices(addressRegistry, next.ville, next.commune, next.quartier);
    if (!below.communes.includes(next.commune)) next.commune = '';
    const below2 = addressChoices(addressRegistry, next.ville, next.commune, next.quartier);
    if (!below2.quartiers.includes(next.quartier)) next.quartier = '';
    const below3 = addressChoices(addressRegistry, next.ville, next.commune, next.quartier);
    if (!below3.avenues.includes(next.physicalAddress)) next.physicalAddress = '';
    patch(next);
  };
  /** A stored value that is not in the tree shows as unpicked, so it has to be chosen again. */
  const shown = (value: string, list: string[]) => (list.includes(value) ? value : '');

  /**
   * An issued NIF is never silently replaced. On an amendment the number is
   * frozen once the record carries one, because it is quoted on notices,
   * certificates and receipts for years and a stray click must not change it.
   */
  const nifLocked = !isCreate && !!form.nif.trim();
  const [nifNotice, setNifNotice] = useState<string | null>(null);
  const [recordNifOpen, setRecordNifOpen] = useState(false);
  const [recordNifValue, setRecordNifValue] = useState('');

  /**
   * A taxpayer may already hold a NIF from the DPRNK central service. Only an
   * Admin may enter one, and it is checked against the roll before it is
   * accepted — a duplicate fiscal identity is far more expensive to unwind than
   * a refused keystroke.
   */
  const handleRecordExistingNif = () => {
    const value = recordNifValue.trim().toUpperCase();
    if (!/^[A-Z0-9-]{6,20}$/.test(value)) {
      setNifNotice('Enter the NIF exactly as issued: 6–20 characters, letters, digits or dash.');
      return;
    }
    const clash = existingNifs.find((n) => n.trim().toUpperCase() === value);
    if (clash) {
      setNifNotice(`NIF ${value} is already on the roll. Search the registry before recording it again.`);
      return;
    }
    patch({ nif: value, nifSource: 'recorded' });
    setNifNotice(`Recorded ${value} as this taxpayer's existing fiscal identification.`);
    setRecordNifOpen(false);
    setRecordNifValue('');
  };

  const handleGenerateNif = () => {
    const result = issueNextNif(existingNifs);
    if (result.error || !result.nif) {
      setNifNotice(result.error || 'Could not issue a NIF.');
      return;
    }
    patch({ nif: result.nif, nifSource: 'issued' });
    setNifNotice(`Issued ${result.nif} — check it before saving.`);
    setRecordNifOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/60 backdrop-blur-xs">
      <div className="bg-surface rounded-[18px] border border-line shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="px-6 py-4.5 border-b border-line flex items-center justify-between gap-3 bg-surface">
          <div className="min-w-0">
            <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-accent font-sans">
              {isCreate ? 'Fiscal Roll Enrollment' : 'Amend Registry Record'}
            </span>
            <h2 className="font-display text-lg font-bold text-ink tracking-tight">
              {isCreate ? 'Enroll a New Taxpayer' : 'Update Taxpayer Record'}
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
        <form id="taxpayer-form" onSubmit={onSubmit} className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin">
          {/* 1. Identity */}
          <div>
            <SectionHeading icon={<IdCard className="w-3.5 h-3.5" />}>1. Taxpayer Identity</SectionHeading>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {showNif && (
              <Field
                label="NIF"
                error={errors.nif}
                span
                hint="Numéro d'Identification Fiscale — issued by the register, never typed."
              >
                {/*
                  The fiscal number is displayed, never typed. A NIF is quoted on
                  notices, certificates and receipts for years, so one mistyped
                  character leaves a taxpayer with two identities; the roll owns
                  the sequence and the officer only draws from it.
                */}
                <div
                  className={`flex items-center min-h-[44px] px-3 rounded-[12px] border ${
                    form.nif.trim()
                      ? 'border-accent/40 bg-accent-soft/40'
                      : 'border-dashed border-line bg-surface2/40'
                  }`}
                >
                  {form.nif.trim() ? (
                    <span
                      id="enroll-nif-value"
                      className="font-mono text-sm font-bold text-ink tabular-nums tracking-tight"
                    >
                      {form.nif}
                    </span>
                  ) : (
                    <span className="text-xs text-muted">
                      Not yet issued — use Generate NIF below.
                    </span>
                  )}
                </div>

                {/* Issue the fiscal number from the register rather than asking
                    the officer to invent one. */}
                <div className="mt-2 flex flex-wrap items-center gap-2.5">
                  <Button
                    id="generate-nif-btn"
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={!canModify || submitting || nifLocked}
                    onClick={handleGenerateNif}
                    icon={<Sparkles className="w-3.5 h-3.5" />}
                    title={
                      nifLocked
                        ? 'This record already carries an issued NIF.'
                        : 'Issue the next NIF from the fiscal roll sequence'
                    }
                  >
                    {form.nif.trim() ? 'Regenerate NIF' : 'Generate NIF'}
                  </Button>
                  <span className="text-[11px] text-muted">
                    Format A#######X · next in sequence for this roll
                  </span>
                </div>

                {/*
                  A taxpayer already known to the DPRNK arrives with a number of
                  their own, and refusing to record it would mean enrolling them
                  twice under two identities. Restricted to Administrators, and
                  the reason is stated on the control rather than hidden.
                */}
                {canRecordExistingNif && !nifLocked && (
                  <div className="mt-2.5">
                    {!recordNifOpen ? (
                      <button
                        type="button"
                        id="record-nif-btn"
                        onClick={() => {
                          setRecordNifOpen(true);
                          setNifNotice(null);
                        }}
                        className="text-[12px] font-semibold text-muted hover:text-accent underline decoration-dotted underline-offset-2 cursor-pointer transition-premium"
                      >
                        Record a NIF this taxpayer already holds
                      </button>
                    ) : (
                      <div className="p-3 rounded-[12px] border border-line bg-surface2/50 flex flex-wrap items-end gap-2 animate-in fade-in slide-in-from-top-1 duration-150">
                        <label className="flex-1 min-w-[200px]">
                          <span className="block mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
                            Existing NIF as issued by the DPRNK
                          </span>
                          <input
                            autoFocus
                            id="record-nif-input"
                            type="text"
                            value={recordNifValue}
                            onChange={(e) => {
                              setRecordNifValue(e.target.value.toUpperCase().replace(/\s/g, ''));
                              setNifNotice(null);
                            }}
                            onKeyDown={(e) => {
                              // Enter records it rather than submitting the whole
                              // enrollment form behind the officer's back.
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleRecordExistingNif();
                              }
                            }}
                            placeholder="e.g. 6-12345-A"
                            className={`${inputClass} font-mono`}
                          />
                        </label>
                        <Button id="record-nif-confirm" type="button" size="sm" onClick={handleRecordExistingNif}>
                          Record NIF
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setRecordNifOpen(false);
                            setRecordNifValue('');
                            setNifNotice(null);
                          }}
                        >
                          Cancel
                        </Button>
                        <p className="w-full text-[11px] text-muted leading-relaxed">
                          Administrator only. A number from outside this roll is checked against it
                          for duplicates, but this system did not issue it and cannot guarantee its
                          format.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {nifNotice && (
                  <p className="text-[11px] text-accent mt-1.5 leading-relaxed">{nifNotice}</p>
                )}
                {nifLocked && (
                  <p className="text-[11px] text-muted mt-1.5 leading-relaxed">
                    Issued on enrolment and permanent: a NIF is cited on notices, certificates and
                    receipts, so it is never redrawn on an existing record.
                  </p>
                )}
              </Field>
              )}

              {showDepotFields && (
                <>
                  <Field label="Service" span>
                    <input
                      id="enroll-service"
                      type="text"
                      value={form.service}
                      onChange={(e) => patch({ service: e.target.value })}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Numéro de dépôt" span>
                    <input
                      id="enroll-numero-depot"
                      type="text"
                      value={form.numeroDepot}
                      onChange={(e) => patch({ numeroDepot: e.target.value })}
                      className={inputClass}
                    />
                  </Field>
                  <Field label="Salaires du mois de" span>
                    <select
                      id="enroll-salaires-mois"
                      value={form.salairesMois}
                      onChange={(e) => patch({ salairesMois: e.target.value })}
                      className={`${inputClass} cursor-pointer`}
                    >
                      <option value="">— Sélectionner —</option>
                      {MOIS.map((mois, i) => (
                        <option key={mois} value={String(i + 1)}>
                          {mois}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Année" span>
                    <select
                      id="enroll-annee"
                      value={form.annee}
                      onChange={(e) => patch({ annee: e.target.value })}
                      className={`${inputClass} cursor-pointer`}
                    >
                      <option value="">— Sélectionner —</option>
                      {ANNEES.map((annee) => (
                        <option key={annee} value={String(annee)}>
                          {annee}
                        </option>
                      ))}
                    </select>
                  </Field>
                </>
              )}

              <Field label="Noms ou dénomination sociale" required error={errors.businessName} span>
                <input
                  type="text"
                  value={form.businessName}
                  onChange={(e) => patch({ businessName: e.target.value })}
                  placeholder="e.g. Kin-Mart Supermarket Goma"
                  className={inputClass}
                />
              </Field>

              {/* Numéro impôt — DGI portal card only, right below the name. */}
              {showDepotFields && (
                <Field label="Numéro impôt" span>
                  <input
                    id="enroll-numero-impot"
                    type="text"
                    value={form.numeroImpot}
                    onChange={(e) => patch({ numeroImpot: e.target.value })}
                    className={inputClass}
                  />
                </Field>
              )}

              <Field label="Sigle">
                <input
                  type="text"
                  value={form.sigle}
                  onChange={(e) => patch({ sigle: e.target.value })}
                  placeholder="e.g. SAVOKIVU"
                  className={inputClass}
                />
              </Field>

              <Field label="ID Nationale">
                <input
                  type="text"
                  value={form.idNat}
                  onChange={(e) => patch({ idNat: e.target.value })}
                  placeholder="e.g. 01-83-N12345K"
                  className={`${inputClass} font-mono`}
                />
              </Field>
            </div>
          </div>

          {/* 2. Address */}
          <div>
            <SectionHeading icon={<MapPin className="w-3.5 h-3.5" />}>2. Adresse</SectionHeading>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Every level is picked from Settings → Adresse — nothing is typed. */}
              {!hasAddressTree && (
                <div className="sm:col-span-2 p-3.5 rounded-[12px] bg-warn/10 border border-warn/25 text-[12px] text-ink leading-relaxed flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-0.5" />
                  <span>
                    The address register in Settings → Adresse is empty, so there is nothing to pick from yet. Add a ville there and these fields will fill in.
                  </span>
                </div>
              )}

              <Field label="Ville" required error={errors.ville}>
                <select
                  value={shown(form.ville, addr.villes)}
                  onChange={(e) => pickAddress('ville', e.target.value)}
                  disabled={!hasAddressTree}
                  className={`${inputClass} cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${errors.ville ? 'border-danger' : ''}`}
                >
                  <option value="">— Sélectionner —</option>
                  {addr.villes.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </Field>

              <Field label="Commune" required error={errors.commune}>
                <select
                  value={shown(form.commune, addr.communes)}
                  onChange={(e) => pickAddress('commune', e.target.value)}
                  disabled={!addr.villes.includes(form.ville)}
                  className={`${inputClass} cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${errors.commune ? 'border-danger' : ''}`}
                >
                  <option value="">{addr.villes.includes(form.ville) ? '— Sélectionner —' : 'Choisir la ville d’abord'}</option>
                  {addr.communes.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </Field>

              <Field label="Quartier" required error={errors.quartier}>
                <select
                  value={shown(form.quartier, addr.quartiers)}
                  onChange={(e) => pickAddress('quartier', e.target.value)}
                  disabled={!addr.communes.includes(form.commune)}
                  className={`${inputClass} cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${errors.quartier ? 'border-danger' : ''}`}
                >
                  <option value="">{addr.communes.includes(form.commune) ? '— Sélectionner —' : 'Choisir la commune d’abord'}</option>
                  {addr.quartiers.map((q) => (
                    <option key={q} value={q}>{q}</option>
                  ))}
                </select>
              </Field>

              <Field label="Avenue" required error={errors.physicalAddress}>
                <select
                  value={shown(form.physicalAddress, addr.avenues)}
                  onChange={(e) => pickAddress('avenue', e.target.value)}
                  disabled={!addr.quartiers.includes(form.quartier)}
                  className={`${inputClass} cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed ${errors.physicalAddress ? 'border-danger' : ''}`}
                >
                  <option value="">{addr.quartiers.includes(form.quartier) ? '— Sélectionner —' : 'Choisir le quartier d’abord'}</option>
                  {addr.avenues.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
                {addr.quartiers.includes(form.quartier) && addr.avenues.length === 0 && (
                  <p className="text-[11px] text-warn mt-1 leading-relaxed">
                    No avenue is recorded under this quartier — add one in Settings → Adresse first.
                  </p>
                )}
              </Field>

              {showFormeParcelle && (
              <>
              <Field label="Forme Juridique" required error={errors.taxpayerType} span>
                <select
                  value={form.taxpayerType}
                  onChange={(e) => patch({ taxpayerType: e.target.value as TaxpayerType })}
                  className={inputClass}
                >
                  <option value="">— Sélectionner —</option>
                  <option value="Personne Morale">Personne Morale (company / society)</option>
                  <option value="Personne Physique">Personne Physique (individual)</option>
                </select>
              </Field>

              <Field label="Numéro de parcelle" span>
                <input
                  type="text"
                  value={form.numeroParcelle}
                  onChange={(e) => patch({ numeroParcelle: e.target.value })}
                  placeholder="e.g. Parcelle No 128"
                  className={inputClass}
                />
              </Field>
              </>
              )}

              <Field label="Telephone" required error={errors.phoneNumber}>
                <input
                  type="tel"
                  value={form.phoneNumber}
                  onChange={(e) => patch({ phoneNumber: e.target.value })}
                  placeholder="+243 998 123 456"
                  className={`${inputClass} font-mono`}
                />
              </Field>

              <Field label="Email" error={errors.email}>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => patch({ email: e.target.value })}
                  placeholder="contact@example.cd"
                  className={inputClass}
                />
              </Field>
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-line bg-surface2/40 flex items-center justify-between gap-2.5">
          <span className="text-[12px] text-muted hidden sm:block">
            {isCreate ? 'The taxpayer will appear on the municipal roll immediately.' : 'Changes are written to the audit ledger.'}
          </span>
          <div className="flex items-center gap-2.5 ml-auto">
            <Button variant="ghost" size="md" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              type="submit"
              form="taxpayer-form"
              onClick={onSubmit}
              disabled={submitting || !canModify}
            >
              {submitting ? 'Saving...' : isCreate ? 'Enroll Taxpayer' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
