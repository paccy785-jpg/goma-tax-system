export type UserRole = 'Admin' | 'Supervisor' | 'Cashier' | 'Auditor';
export type UserStatus = 'Active' | 'Suspended';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  phone?: string;
  role: UserRole;
  assignedOffice?: string;
  status?: UserStatus;
  active?: boolean;
  /**
   * Filed by the account itself on a portal it has no access to: the profile is
   * created suspended, and an administrator of that portal activates it.
   */
  accessRequested?: boolean;
  accessRequestedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export function normalizeUserStatus(user?: Partial<UserProfile> | null): UserStatus {
  if (!user) return 'Active';
  if (user.status === 'Suspended' || user.active === false) {
    return 'Suspended';
  }
  return 'Active';
}

export type PatenteCategory = 
  | 'Category_A_Grande' 
  | 'Category_B_Moyenne' 
  | 'Category_C_Petite' 
  | 'Category_D_Micro';

export type GomaCommune = 'Goma' | 'Karisimbi';

export interface Taxpayer {
  id: string;
  businessName: string;
  tradeName: string;
  /** @deprecated RCCM is retired from the DPRNK roll. Kept so legacy records still load. */
  rccm?: string;
  idNat: string; // National Identification Number
  nif: string; // Tax Identification Number (NIF)
  category: PatenteCategory;
  commune: GomaCommune;
  quarter: string; // Neighborhood quarter (e.g. Himbi, Katindo, Birere, Mabanga)
  avenue: string;
  phoneNumber: string;
  ownerName: string;
  registeredBy: string;
  registeredByName?: string;
  registeredAt: string;
  status: 'Active' | 'Suspended' | 'Pending';
}

export type AssessmentStatus = 
  | 'Pending' 
  | 'Paid' 
  | 'Overdue' 
  | 'Cancelled' 
  | 'Draft' 
  | 'Pending_Approval' 
  | 'Approved';

export interface Assessment {
  id: string;
  businessId?: string; // Link to /businesses/{businessId}
  businessName: string;
  ownerFullName?: string;
  nationalIdOrRccm?: string;
  commune?: string; // 'Goma' | 'Karisimbi'
  quartier?: string;
  physicalAddress?: string;
  phoneNumber?: string;
  activitySector?: BusinessSector;
  sizeClass?: BusinessSizeClass;
  taxpayerId?: string;
  taxpayerName?: string;
  assessmentNumber: string; // Unique sequential e.g. PAT-2026-00001
  noticeNumber: string;
  fiscalYear: number;
  category?: PatenteCategory | string;
  baseAnnualFeeUSD: number; // Tariff schedule standard rate
  amountDueUSD: number; // Prorated or full amount
  isProrated: boolean;
  proratedMonths: number; // 1 to 12
  proratedNotes?: string;
  registrationDate?: string;
  issueDate: string;
  dueDate: string;
  status: AssessmentStatus;
  assessedBy: string;
  assessedByName: string;
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: string;
  cancelledBy?: string;
  cancelledByName?: string;
  cancelledAt?: string;
  cancellationReason?: string;
  rateId?: string;
  rateVersion?: number;
  /**
   * Head of tax this notice was raised under. Absent on legacy records, which
   * are Business License Tax (patente) — that is what the whole roll was
   * before tax types existed, so absence must keep the old behaviour.
   */
  taxTypeCode?: TaxTypeCode | string;
  /** Rate applied when the tax type is percentage-based, e.g. 15 for 15%. */
  taxRatePercent?: number;
  /** The declared base the percentage was applied to, in USD. */
  taxableBaseUSD?: number;
  /** Denormalised description of the base, so a notice can explain itself. */
  taxableBaseLabel?: string;
  /** Cadastral parcel this notice was raised against, for IF/IRL notices. */
  parcelId?: string;
  parcelRang?: string;
  amountPaidUSD?: number; // Total accumulated payments in USD
  remainingBalanceUSD?: number; // Remaining balance due in USD
  lastPaymentDate?: string;
  createdAt: string;
  updatedAt?: string;
}

export type PaymentMethod = 
  | 'Other'
  | 'Cash_Guichet' 
  | 'Mobile_Money_Airtel' 
  | 'Mobile_Money_Orange' 
  | 'Bank_Transfer_Rawbank' 
  | 'Bank_Transfer_EquityBCDC';

export type PaymentType = 'full' | 'partial';

/**
 * French wording of each payment channel, used on the declaration slip where
 * the mode of payment is printed in the same language as the amount.
 */
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  Other: 'Autre / non précisé',
  Cash_Guichet: 'Espèces (Guichet)',
  Mobile_Money_Airtel: 'Mobile Money — Airtel',
  Mobile_Money_Orange: 'Mobile Money — Orange',
  Bank_Transfer_Rawbank: 'Virement bancaire — Rawbank',
  Bank_Transfer_EquityBCDC: 'Virement bancaire — Equity BCDC',
};

export interface Payment {
  id: string;
  receiptNumber: string; // Non-reusable sequential e.g. REC-2026-00043
  sequenceNumber?: number;
  sessionId?: string; // Links to /cashSessions/{sessionId} when recorded in active cash shift
  assessmentId: string;
  assessmentNumber?: string;
  businessId?: string;
  businessName?: string;
  taxpayerId: string;
  taxpayerName: string;
  /**
   * Head of tax settled, denormalised from the notice so a receipt can name it
   * without a second read. Absent on legacy receipts — those are patente.
   */
  taxTypeCode?: TaxTypeCode | string;
  taxRatePercent?: number;
  fiscalYear?: number;
  amountPaidUSD: number;
  currency: 'USD';
  paymentType: PaymentType;
  isPartial?: boolean;
  assessmentTotalUSD?: number;
  previousPaidUSD?: number;
  remainingBalanceUSD?: number;
  paymentMethod: PaymentMethod;
  cashierId?: string;
  cashierName?: string;
  receivedBy: string;
  receivedByName: string;
  paymentDate?: string;
  paidAt: string;
  verified: boolean;
  offlineCreated?: boolean;
  reconciledAt?: string;
  notes?: string;
  isVoided?: boolean;
  voidedAt?: string;
  voidedBy?: string;
  voidedByName?: string;
  voidReason?: string;
}

export interface ReceiptCounter {
  id: string;
  currentSequence: number;
  lastReceiptNumber?: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  userRole: UserRole;
  action: string;
  entityType: 
    | 'Business' 
    | 'Taxpayer' 
    | 'Assessment' 
    | 'Payment' 
    | 'User' 
    | 'TaxRateConfig' 
    | 'TaxRate' 
    | 'TaxType'
    | 'PropertyParcel'
    | 'Lease'
    | 'Lessor'
    | 'Rang'
    | 'Usage'
    | 'AddressNode'
    | 'Auth'
    | 'Compliance'
    | 'Deregistration'
    | 'CashSession'
    | 'TreasuryDeposit'
    | 'ReceiptAnomaly'
    | 'ApprovalRequest'
    | 'Certificate'
    | 'Expense'
    | 'RecurringExpense'
    | 'Reception'
    | 'Announcement'
    | 'ScheduleEvent'
    | 'TaxCalculation'
    | 'RevenueDeclaration'
    | 'PropertyTransfer'
    | 'BankConfirmation'
    | 'DeclarationAdmin'
    | 'NotePerception'
    | 'NomenclatureImpot';
  entityId: string;
  details: string;
  beforeValue?: Record<string, any> | string | null;
  afterValue?: Record<string, any> | string | null;
  timestamp: string;
}

export type CashSessionStatus = 'open' | 'closed' | 'approved';
export type CashCustodyStatus = 'in_drawer' | 'pending_audit' | 'in_custody' | 'deposited';

export interface CashSession {
  id: string; // e.g. "CS-2026-0001"
  sessionNumber: string; // e.g. "SESS-2026-0313-001"
  cashierId: string;
  cashierName: string;
  cashierEmail?: string;
  stationOffice: string; // e.g. "Main Counter - City Hall" or "Karisimbi Counter"
  
  // Shift opening
  openedAt: string;
  openingBalanceUSD: number;
  openingNotes?: string;
  
  // Recorded collections during shift
  paymentIds?: string[];
  totalPaymentsCashUSD: number;
  totalPaymentsOtherUSD: number;
  paymentCount: number;
  firstReceiptNumber?: string;
  lastReceiptNumber?: string;

  // Shift closing (physically counted)
  closedAt?: string;
  countedCashUSD?: number;
  
  // Computed expected vs counted
  expectedCashUSD?: number; // openingBalanceUSD + totalPaymentsCashUSD
  varianceUSD?: number; // countedCashUSD - expectedCashUSD
  hasVariance?: boolean;
  closingNotes?: string;
  varianceExplanation?: string;

  // Supervisor sign-off & approval
  status: CashSessionStatus; // 'open' | 'closed' | 'approved'
  approvedBy?: string;
  approvedByName?: string;
  approvedAt?: string;
  supervisorNotes?: string;

  // Cash Custody & Treasury Deposit Tracking
  cashStatus: CashCustodyStatus; // 'in_drawer' | 'pending_audit' | 'in_custody' | 'deposited'
  depositId?: string; // Links to /treasuryDeposits/{depositId} once deposited
  depositedAt?: string;

  createdAt: string;
  updatedAt?: string;
}

export interface TreasuryDeposit {
  id: string; // e.g. "TDP-2026-0001"
  depositReference: string; // e.g. "DEP-BCC-2026-0042"
  depositAmountUSD: number;
  date: string; // YYYY-MM-DD
  depositedAt: string; // ISO timestamp
  depositorId: string;
  depositorName: string; // Cashier or courier delivering physical funds
  bankName: string; // e.g. "Banque Centrale du Congo (BCC)"
  bankDepositSlipRef: string; // Bordereau de versement ref number
  bankDepositSlipUrl?: string;
  approvingSupervisorId: string;
  approvingSupervisorName: string;
  sessionIds: string[]; // Linked CashSession IDs
  cashierNames?: string[];
  notes?: string;
  createdAt: string;
}

export type BusinessSector = 
  | 'Commerce' 
  | 'Food Service' 
  | 'Services' 
  | 'Crafts' 
  | 'Industry' 
  | 'Other'
  | (string & {});

export type BusinessSizeClass = 'Small' | 'Medium' | 'Large';

export type BusinessStatus = 'Active' | 'Inactive' | 'Closure Pending';

/** Fiscal nature of the registered contributor. */
export type TaxpayerType = 'Personne Physique' | 'Personne Morale';

/**
 * Derived fiscal standing of a taxpayer, resolved from the assessment ledger
 * rather than from the raw administrative status.
 */
export type TaxpayerComplianceState =
  | 'compliant'
  | 'outstanding'
  | 'overdue'
  | 'suspended'
  | 'closure'
  | 'unassessed';

/**
 * Lifecycle of a taxpayer's fiscal declaration for the current cycle.
 *
 * A declaration is not a stored document: it is the standing of a contributor
 * on the roll, derived from the assessment (Avis d'Imposition) raised against
 * them. A contributor with no notice for the cycle has therefore not
 * declared, and a cancelled notice means the declaration was void and has to
 * be filed again.
 */
export type DeclarationStatus =
  | 'not_declared'
  | 'declared'
  | 'draft'
  | 'pending_approval'
  | 'assessed'
  | 'settled'
  | 'overdue'
  | 'void';

/**
 * A revenue return filed by a contributor.
 *
 * This is the "déclaration de revenus" slip: the contributor declares the
 * gross revenue they operated (1), the rate that applies to it (2), the tax
 * that yields from the two (3), the withholdings already remitted (4), and
 * what is left to pay (5). The amount in words is carried on the record
 * because it is printed on the slip.
 */
export interface RevenueDeclaration {
  id: string;
  /** Human reference of the slip, e.g. `DEC-2026-0007`. */
  declarationNumber: string;
  fiscalYear: number;
  businessId: string;
  taxpayerName: string;
  nif?: string;
  commune?: string;
  quartier?: string;

  /** (1) Gross revenue declared for the exercise, in USD. */
  grossRevenueUSD: number;
  /** (2) Rate applied to the declared base, in percent. */
  ratePercent: number;
  /** (3) Tax due = (1) × (2). */
  taxDueUSD: number;
  /** (4) Withholdings already remitted against this declaration. */
  withholdingsUSD: number;
  /** (5) Net payable = (3) − (4). Negative when a credit is carried forward. */
  netPayableUSD: number;
  /** (5) spelled out in French words, as printed on the slip. */
  netPayableInWords: string;

  paymentMethod: PaymentMethod;
  declaredBy: string;
  declaredByName: string;
  declaredAt: string;
  notes?: string;
}

/** One row of the declarations register. */
export interface TaxDeclaration {
  /** Same id as the business the declaration belongs to. */
  id: string;
  businessId: string;
  taxpayerName: string;
  nif: string;
  commune?: string;
  quartier?: string;
  activitySector: BusinessSector;
  sizeClass: BusinessSizeClass;
  patenteCategory: PatenteCategory;
  status: DeclarationStatus;
  fiscalYear: number;
  /** Human reference shown in the register, e.g. `DEC-2026-0007`. */
  declarationRef: string;
  assessmentId?: string;
  assessmentNumber?: string;
  noticeNumber?: string;
  /** Date the declaration was filed, i.e. the notice issue date. */
  declaredOn?: string;
  dueDate?: string;
  assessedAmountUSD: number;
  paidAmountUSD: number;
  balanceUSD: number;
  /** Published annual tariff for this sector + size combination. */
  tariffUSD: number;
  assessedByName?: string;
  cancellationReason?: string;
}

export interface Business {
  id: string;
  businessName: string;
  ownerFullName: string;
  /**
   * @deprecated Combined legacy identifier: a national ID, or an RCCM number
   * for records enrolled before RCCM was retired. The UI presents it as the
   * Nat ID; kept so legacy notices and certificates still resolve.
   */
  nationalIdOrRccm: string;
  phoneNumber: string;
  physicalAddress: string;
  /**
   * Ville — picked from Settings → Adresse on the enrolment card. Absent on
   * records enrolled before the card asked for it; the roll then resolves it
   * from the commune.
   */
  ville?: string;
  commune: string; // 'Goma' | 'Karisimbi'
  quartier: string; // e.g. Himbi, Les Volcans, Katindo, Birere, Mabanga
  activitySector: BusinessSector;
  sizeClass: BusinessSizeClass; // Small, Medium, Large (drives fee tier)
  registrationDate: string; // YYYY-MM-DD or ISO string
  status: BusinessStatus; // Active, Inactive, Closure Pending
  storefrontPhotoUrl?: string; // photo of storefront if available

  // --- Fiscal taxpayer identity (DPRNK roll) ---
  // Optional so pre-existing registry documents keep loading unchanged.
  nif?: string; // Numéro d'Identification Fiscale — the fiscal roll key
  sigle?: string; // Sigle — the trading initials/acronym of the business name
  /** Service — DGI portal enrolment card. */
  service?: string;
  /** Numéro de dépôt — DGI portal enrolment card. */
  numeroDepot?: string;
  /** Numéro impôt — DGI portal enrolment card (below Noms ou dénomination sociale). */
  numeroImpot?: string;
  /** Salaires du mois de — month 1 (janvier) to 12 (décembre); DGI portal enrolment card. */
  salairesMois?: number;
  /** Année — 2020 to 2035; DGI portal enrolment card. */
  annee?: number;
  numeroParcelle?: string; // Numéro de parcelle — cadastral plot number of the establishment
  idNat?: string; // Numéro d'Identification Nationale
  email?: string;
  taxpayerType?: TaxpayerType;
  patenteCategory?: PatenteCategory; // tariff class applied at registration

  registeredBy?: string;
  registeredByName?: string;
  deregisteredAt?: string;
  deregisteredBy?: string;
  deregisteredByName?: string;
  deregistrationReason?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TaxRate {
  id: string;
  activitySector: BusinessSector;
  sizeClass: BusinessSizeClass;
  annualFeeUSD: number;
  effectiveStartDate: string; // YYYY-MM-DD
  effectiveEndDate?: string | null; // YYYY-MM-DD or null if currently active
  version: number; // incremental integer: 1, 2, 3...
  isActive: boolean; // true if current active rate for this sector + size combination
  legalBasis?: string; // e.g. "Urban Decree No. 01/2026 City of Goma"
  notes?: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt?: string;
}

export const SECTOR_LABELS: Record<string, string> = {
  Commerce: 'Commerce',
  'Food Service': 'Food Service',
  Services: 'Services',
  Crafts: 'Crafts',
  Industry: 'Industry',
  Other: 'Other',
};

export const SIZE_CLASS_LABELS: Record<BusinessSizeClass, { label: string; tier: string; badgeColor: string }> = {
  Small: { label: 'Small Business', tier: 'Class 3', badgeColor: 'bg-blue-50 text-blue-700 border-blue-200' },
  Medium: { label: 'Medium Business', tier: 'Class 2', badgeColor: 'bg-amber-50 text-amber-700 border-amber-200' },
  Large: { label: 'Large Business', tier: 'Class 1', badgeColor: 'bg-purple-50 text-purple-700 border-purple-200' },
};

/**
 * Patente tariff classes. These mirror `DEFAULT_TAX_RATES` in dbService — the
 * annual figure shown here is the published tariff, never a computed balance.
 */
export const PATENTE_CATEGORY_LABELS: Record<
  PatenteCategory,
  { short: string; label: string; description: string }
> = {
  Category_A_Grande: {
    short: 'Cat. A',
    label: 'Grande Patente',
    description: 'Wholesalers, large hotels, import-export agencies, mining offices',
  },
  Category_B_Moyenne: {
    short: 'Cat. B',
    label: 'Moyenne Patente',
    description: 'Pharmacies, supermarkets, repair workshops, restaurants, printing presses',
  },
  Category_C_Petite: {
    short: 'Cat. C',
    label: 'Petite Patente',
    description: 'Alimentations, salons, tailoring workshops, cybercafés, hardware stores',
  },
  Category_D_Micro: {
    short: 'Cat. D',
    label: 'Micro Patente',
    description: 'Corner kiosks, mobile money stalls, fixed market tables',
  },
};

/** Suggested patente class for an establishment size, used to prefill forms. */
export const SIZE_TO_PATENTE_CATEGORY: Record<BusinessSizeClass, PatenteCategory> = {
  Large: 'Category_A_Grande',
  Medium: 'Category_B_Moyenne',
  Small: 'Category_C_Petite',
};

/** Canonical list of Goma city communes for the registry filters. */
export const GOMA_COMMUNES = ['Goma', 'Karisimbi'] as const;

/* ==========================================================
   CADASTRAL PROPERTY REGISTER (Identification des Propriétés)
   The impôt foncier declaration sheet: what the asset is,
   exactly where it sits in the cadastre, how it is used, its
   measured extent, the tariff applied and the duty owed.
   ========================================================== */

/** Nature of the registered asset. */
export type PropertyNature =
  | 'Terrain nu'
  | 'Parcelle bâtie'
  | "Maison d'habitation"
  | 'Immeuble commercial'
  | 'Hangar / Entrepôt'
  | 'Étal / Kiosque';

/** Declared fiscal use of the asset — drives the applicable rate. */
export type PropertyUsage =
  | 'Résidentiel'
  | 'Commercial'
  | 'Industriel'
  | 'Agricole'
  | 'Administratif';

/**
 * A parcel measured by surface area (m²) versus one counted as a unit
 * (a kiosk, a stall). The two are never summed together.
 */
export type PropertyMeasureKind = 'superficie' | 'nombre';

export interface PropertyParcel {
  id: string;
  /**
   * Contributing taxpayer this asset belongs to — a join to /taxpayers/{id}.
   * Optional only so pre-existing declarations stay valid; every new
   * declaration filed through the Add Property form must name one.
   */
  ownerTaxpayerId?: string;
  /**
   * Owner's name as it stood when the declaration was filed. Denormalised
   * deliberately: a taxpayer may be renamed or re-enrolled, and the filed
   * declaration must keep describing the person it was registered against.
   */
  ownerName?: string;
  nature: PropertyNature;
  /** City or rural territory the parcel falls under. */
  villeTerritoire: string;
  /** Commune or sector/chiefdom. */
  communeChefferie: string;
  /** Quarter or grouping. */
  quartierGroupement: string;
  avenueLocalite: string;
  /** Cadastral lot number within the block. */
  rang: string;
  /**
   * Numéro de parcelle — the identifier carried on the declaration.
   *
   * Separate from `rang`: `rang` is the lot number inside a block, while the
   * numéro de parcelle is the reference the contributor's enrolment already
   * holds (see `Business.numeroParcelle`). New declarations capture the latter
   * and no longer ask for a rang.
   */
  numeroParcelle?: string;
  usage: PropertyUsage;
  measureKind: PropertyMeasureKind;
  /** Surface in m² when superficie, unit count when nombre. */
  measureValue: number;
  /** Tariff applied per m² or per unit, in USD. */
  tauxUSD: number;
  /** Duty owed = measureValue × tauxUSD, rounded to whole USD. */
  montantImpotUSD: number;
  /**
   * Declared value of the asset in USD — the taxable base for the
   * Impôt Foncier (IF) head of tax.
   */
  declaredValueUSD: number;
  /**
   * Declared gross annual rental income in USD — the taxable base for the
   * Impôt sur les Revenus Locatifs (IRL) head of tax. Zero when the asset
   * is not let.
   */
  annualRentUSD: number;
  /**
   * NOTEZ 1 — primary cadastral classification. Required: an asset cannot
   * be filed unclassified.
   */
  note1Code: Note1Code;
  /** NOTEZ 2 — declared fiscal destination of the asset. */
  note2Code?: Note2Code;
  /** NOTEZ 3 — measurement basis (surface vs unit count) for the duty. */
  note3Code?: Note3Code;
  /** Assessment exercise this declaration belongs to. */
  exercice: number;
  registeredAt: string;
}

/** Which dimension a column total aggregates. */
export type PropertyTotalKind = 'superficie' | 'nombre' | 'montant';

/**
 * An entry in the rang register — the numbered cadastral lots an officer may
 * assign to a property. Maintained in Settings so a rang is a chosen reference
 * value rather than free text typed differently on every declaration.
 */
export interface RangEntry {
  /** Rang number, also the document id (e.g. "128"). */
  id: string;
  /** What this rang is called / where it runs. */
  designation: string;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
}

/* ==================================================================== */
/*  USAGE REGISTER                                                      */
/* ==================================================================== */

/**
 * An entry in the usage register — the declared fiscal use of a property
 * (Résidentiel, Commercial, …). Kept as data rather than as a hard-coded list
 * because the uses a commune actually levies on grow without a deployment.
 */
export interface UsageEntry {
  /** Usage code, also the document id (e.g. "COM"). */
  id: string;
  /** What the administration calls this use. */
  designation: string;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
}

/* ==================================================================== */
/*  ADDRESS HIERARCHY                                                   */
/*  ville → commune → quartier → avenue                                 */
/* ==================================================================== */

/**
 * The four administrative levels, in the order they nest.
 *
 * These are not a UI invention: they are exactly the four columns a property
 * declaration stores (`villeTerritoire`, `communeChefferie`,
 * `quartierGroupement`, `avenueLocalite`) and the same four the taxpayer
 * enrollment card asks for. Keeping them as one governed tree is what stops the
 * same quartier being filed as "Les Cubi", "Les Coubi" and "Cubi" across three
 * registers that are meant to join on it.
 */
export type AddressLevel = 'ville' | 'commune' | 'quartier' | 'avenue';

export interface AddressAvenue {
  id: string;
  name: string;
}

export interface AddressQuartier {
  id: string;
  name: string;
  avenues: AddressAvenue[];
}

export interface AddressCommune {
  id: string;
  name: string;
  quartiers: AddressQuartier[];
}

export interface AddressVille {
  id: string;
  name: string;
  communes: AddressCommune[];
}

/**
 * One document holds the whole tree. A commune is never meaningful without its
 * ville and a quartier never without its commune, so splitting the levels into
 * sibling collections would force every reader to reassemble four queries to
 * answer one question. The tree is small, read whole, and edited by one Admin.
 */
export interface AddressRegistry {
  id: string;
  villes: AddressVille[];
  updatedAt: string;
  updatedBy?: string;
}

/**
 * Where a node sits, as the ids from the ville down:
 * `['GOM']` is a ville, `['GOM','GMA','LC']` is an avenue.
 */
export type AddressPath = string[];

/* ==================================================================== */
/*  RENTAL LEASES                                                       */
/*  (Précision sur les propriétés données en location)                  */
/* ==================================================================== */

/**
 * One lease on a declared property.
 *
 * This register is the *evidence* behind the IRL declaration. The cadastre says
 * a parcel earns rent; these rows say who pays it, for how long, and how much.
 * Keeping the two apart is the point — a parcel declaring 24,000 USD of
 * rent whose leases only evidence 12,000,000 is the single most useful thing a
 * rental register can tell an assessor, and it is invisible if the two are
 * collapsed into one number.
 */
/**
 * A lessor (locateur) who receives rent for a declared property.
 *
 * Kept separate from the taxpayer roll: the person who lets the asset is not
 * necessarily the person enrolled for patente, and the lease register needs one
 * stable identity to attach tenancies to. The NIF is the deduplication key.
 */
export interface Lessor {
  id: string;
  /** The locateur's name as filed on this register. */
  name: string;
  /** @deprecated Early records captured the locateur's own NIF; the form now links a bailleur instead. */
  nif?: string;
  /** Owner (bailleur) this locateur acts for, selected from the taxpayer roll. */
  bailleurId?: string;
  bailleurName?: string;
  bailleurNif?: string;
  createdAt: string;
  createdBy: string;
  createdByName: string;
}

export interface RentalLease {
  id: string;
  /** Cadastral parcel the lease sits on — the join back to the register. */
  parcelId: string;
  /** Denormalised parcel identity, so a row reads on its own. */
  rang: string;
  /**
   * Numéro de parcelle carried across from the declaration that named it.
   *
   * Distinct from `rang`: the register's identifier column is the numéro, and a
   * row must still show it when the parcel itself has not loaded.
   */
  numeroParcelle?: string;
  /**
   * Ville / territoire the rented property falls under.
   *
   * Carried from the parcel for the same reason as the rest of the address:
   * the register's address columns must not disappear whenever the cadastre is
   * paginated away.
   */
  villeTerritoire?: string;
  communeChefferie: string;
  quartierGroupement: string;
  /** Adresse du bien loué — the avenue / localité of the declared parcel. */
  address: string;
  /**
   * "Nat" — the rented property's classification, copied from the declaration.
   *
   * Typed `string`, not `PropertyNature`: a declaration filed since the Nature
   * picker was narrowed carries a NOTEZ 1 code (`EC`, `VI`, `INDUS`…), while an
   * older one carries a legacy nature name. Print it through `natureDisplay`,
   * which resolves both.
   */
  nature: string;
  /** Noms de locataires — one contract may name co-tenants. */
  tenantNames: string[];
  /**
   * The locataires' taxpayer ids, in the order of `tenantNames`, when they were
   * picked from the taxpayer roll. Absent on leases filed with typed names.
   */
  tenantIds?: string[];
  /**
   * Bailleur — the taxpayer the let property belongs to.
   *
   * Copied from the parcel's recorded owner at filing time, so the register can
   * print whose building is let without loading the cadastre. Equal to the
   * bailleur the officer selected: the picker only offers that owner's parcels.
   */
  bailleurId?: string;
  bailleurName?: string;
  /** Which part of the parcel is let, when only part of it is. */
  unitLabel?: string;
  /**
   * Lease start, YYYY-MM-DD.
   *
   * Optional: a tenancy may be filed before its period is entered. The register
   * shows the period as unset rather than inventing a date, and an absent start
   * contributes no months to the revenue roll.
   */
  startDate?: string;
  /** Lease end, YYYY-MM-DD; null while the tenancy is open-ended. */
  endDate?: string | null;
  /**
   * Loyer mensuel, in USD.
   *
   * 0 while the rent has not been entered. A lease that carries no rent yet
   * evidences nothing, and is reported as un-priced rather than as a variance.
   */
  monthlyRentUSD: number;
  /**
   * When the période de location and loyer mensuel were saved and locked.
   *
   * Once set, those terms are final: the register shows them read-only and the
   * Firestore rules refuse any change to them.
   */
  termsLockedAt?: string;
  /** Who saved — and so locked — the terms. */
  termsLockedByName?: string;
  /**
   * When the locataire was removed from this property — the tenancy ended.
   *
   * Absent while the lease is live. A removed lease is never deleted: it is the
   * evidence behind an IRL assessment, so the register keeps the row and simply
   * marks it ended. The locataire is then free to be registered on another
   * property, under another bailleur, whenever that happens.
   */
  vacatedAt?: string;
  /** YYYY-MM-DD the locataire actually left, when the officer recorded one. */
  moveOutDate?: string;
  /** Who recorded the removal of the locataire. */
  vacatedByName?: string;
  /** Optional note on the removal — e.g. the locataire moved to another bailleur. */
  vacatedReason?: string;
  notes?: string;
  /**
   * The lease this one continues, when it was filed as a new période de
   * location for a tenancy already on the register.
   *
   * A second declaration is a **new record**, never an edit: the période and
   * loyer of a saved lease are locked, and the revenu brut is derived from the
   * period, so changing it in place would rewrite what was already assessed.
   * This pointer keeps the chain readable without touching the earlier row.
   */
  previousLeaseId?: string;
  exercice: number;
  registeredAt: string;
}

export const PROPERTY_NATURE_LABELS: Record<PropertyNature, string> = {
  'Terrain nu': 'Terrain nu',
  'Parcelle bâtie': 'Parcelle bâtie',
  "Maison d'habitation": "Maison d'habitation",
  'Immeuble commercial': 'Immeuble commercial',
  'Hangar / Entrepôt': 'Hangar / Entrepôt',
  'Étal / Kiosque': 'Étal / Kiosque',
};

export const PROPERTY_USAGE_LABELS: Record<PropertyUsage, string> = {
  Résidentiel: 'Résidentiel',
  Commercial: 'Commercial',
  Industriel: 'Industriel',
  Agricole: 'Agricole',
  Administratif: 'Administratif',
};

/* ------------------------------------------------------------------
   NOTEZ — cadastral classification codes (Nature du bien)

   The declaration carries three independent NOTEZ classifications.
   Each is a short code the officer stamps on the return to classify
   the asset, exactly as it appears on the DRC foncier form. The
   code is the key; the label is only a caption.
   ------------------------------------------------------------------ */

/** NOTEZ 1 — primary cadastral classification of the asset. */
export type Note1Code =
  | 'AC'
  | 'AT'
  | 'EC'
  | 'HT'
  | 'TE'
  | 'USN'
  | 'AP'
  | 'BPQ'
  | 'INDUS'
  | 'SS'
  | 'VI';

/** One selectable entry in a NOTEZ group. */
export interface NoteCodeEntry<T extends string = string> {
  code: T;
  label: string;
  description: string;
}

/** Which of the three NOTEZ classifications a group belongs to. */
export type NoteGroup = 1 | 2 | 3;

export const NOTEZ1_CODES: NoteCodeEntry<Note1Code>[] = [
  { code: 'AC', label: 'Antenne de telecommunication', description: 'Telecommunications mast or antenna structure' },
  { code: 'AT', label: 'Autres', description: 'Any asset not covered by another classification' },
  { code: 'EC', label: 'Etage et Chalet', description: 'Storey of a building, or an individual chalet' },
  { code: 'HT', label: 'Hotel', description: 'Hotel, lodge or hospitality premises' },
  { code: 'TE', label: 'Terrain', description: 'Undeveloped land parcel' },
  { code: 'USN', label: 'Usine', description: 'Factory or manufacturing plant' },
  { code: 'AP', label: 'Apartment', description: 'Apartment unit within a shared building' },
  { code: 'BPQ', label: 'Beach Port et quai d’accostage', description: 'Lakeside port or mooring quay' },
  { code: 'INDUS', label: 'Industrie', description: 'Industrial premises and installations' },
  { code: 'SS', label: 'Station Service', description: 'Fuel / service station' },
  { code: 'VI', label: 'Villa', description: 'Detached private villa' },
];

export const NOTEZ1_LABELS: Record<Note1Code, string> = NOTEZ1_CODES.reduce(
  (acc, entry) => {
    acc[entry.code] = entry.label;
    return acc;
  },
  {} as Record<Note1Code, string>
);

/** Resolve a NOTEZ 1 code, tolerating casing and stray whitespace. */
export function resolveNote1Code(value?: string | null): Note1Code | null {
  if (!value) return null;
  const upper = value.trim().toUpperCase();
  return NOTEZ1_CODES.some((entry) => entry.code === upper) ? (upper as Note1Code) : null;
}

/* ------------------------------------------------------------------
   NOTEZ 2 — declared fiscal destination of the asset.
   ------------------------------------------------------------------ */

/** NOTEZ 2 — the economic purpose the asset is put to. */
export type Note2Code =
  | 'HAB'
  | 'COM'
  | 'IND'
  | 'AGR'
  | 'ELE';

export const NOTEZ2_CODES: NoteCodeEntry<Note2Code>[] = [
  { code: 'HAB', label: 'Habitation', description: 'Used as a dwelling or residence' },
  { code: 'COM', label: 'Commerce', description: 'Used for trade, retail or commercial activity' },
  { code: 'IND', label: 'Industrie', description: 'Used for manufacturing or industrial activity' },
  { code: 'AGR', label: 'Agriculture', description: 'Used for farming, cultivation or livestock' },
  { code: 'ELE', label: 'Elevate', description: 'Livestock rearing / animal husbandry' },
];

export const NOTEZ2_LABELS: Record<Note2Code, string> = NOTEZ2_CODES.reduce(
  (acc, entry) => {
    acc[entry.code] = entry.label;
    return acc;
  },
  {} as Record<Note2Code, string>
);

/** Resolve a NOTEZ 2 code, tolerating casing and stray whitespace. */
export function resolveNote2Code(value?: string | null): Note2Code | null {
  if (!value) return null;
  const upper = value.trim().toUpperCase();
  return NOTEZ2_CODES.some((entry) => entry.code === upper) ? (upper as Note2Code) : null;
}

/* ------------------------------------------------------------------
   NOTEZ 3 — the basis on which the duty is measured.

   Villa, hotel, industry and factory assets are rated on measured
   surface; every other asset is rated on a unit count. This is the
   rule that decides whether the officer fills the superficie column
   or the nombre column on the declaration.
   ------------------------------------------------------------------ */

/** NOTEZ 3 — measurement basis for the assessment. */
export type Note3Code = 'SUP' | 'NBR';

export const NOTEZ3_CODES: NoteCodeEntry<Note3Code>[] = [
  {
    code: 'SUP',
    label: 'La superficial pour villa, Hotel, industrie et Usines',
    description: 'Rated on measured surface area (m²)',
  },
  {
    code: 'NBR',
    label: 'Pour les autres proprietez nombre',
    description: 'Rated on a unit count for all other assets',
  },
];

export const NOTEZ3_LABELS: Record<Note3Code, string> = NOTEZ3_CODES.reduce(
  (acc, entry) => {
    acc[entry.code] = entry.label;
    return acc;
  },
  {} as Record<Note3Code, string>
);

/** Resolve a NOTEZ 3 code, tolerating casing and stray whitespace. */
export function resolveNote3Code(value?: string | null): Note3Code | null {
  if (!value) return null;
  const upper = value.trim().toUpperCase();
  return NOTEZ3_CODES.some((entry) => entry.code === upper) ? (upper as Note3Code) : null;
}

/**
 * Assets whose NOTEZ 3 basis is measured surface. Everything else falls
 * back to a unit count.
 */
export const SUPERFICIE_BASED_NOTE1_CODES: Note1Code[] = ['VI', 'HT', 'INDUS', 'USN'];

/**
 * Measurement basis implied by a NOTEZ 1 classification, used to preselect
 * NOTEZ 3 so the officer is not asked the same question twice.
 */
export function impliedNote3Code(note1Code?: string | null): Note3Code | null {
  const resolved = resolveNote1Code(note1Code);
  if (!resolved) return null;
  return SUPERFICIE_BASED_NOTE1_CODES.includes(resolved) ? 'SUP' : 'NBR';
}

/**
 * The combined NOTEZ 1+2+3 catalog, keyed by code.
 *
 * A declaration's `nature` holds a NOTEZ 1 classification code (`EC`, `VI`,
 * `INDUS`…), not one of the legacy `PropertyNature` names — the Add Property
 * form has filed codes since the Nature picker was narrowed to NOTEZ 1. Every
 * screen that prints a nature must therefore resolve through here, never
 * through `PROPERTY_NATURE_LABELS` alone, or a coded parcel renders blank.
 */
export const NOTEZ_BY_CODE: Map<string, NoteCodeEntry> = new Map(
  [...NOTEZ1_CODES, ...NOTEZ2_CODES, ...NOTEZ3_CODES].map((entry) => [entry.code, entry])
);

/**
 * Display label for a property nature.
 *
 * Resolves, in order: a NOTEZ code, a legacy `PropertyNature` name (declarations
 * filed before the codes), then the raw value — so no record ever prints as
 * blank just because it predates a classification scheme.
 */
export function natureDisplay(nature?: string | null): string {
  const value = (nature || '').trim();
  if (!value) return '—';
  return (
    NOTEZ_BY_CODE.get(value.toUpperCase())?.label ??
    PROPERTY_NATURE_LABELS[value as PropertyNature] ??
    value
  );
}

/**
 * The nature as a register prints it in a narrow column: the NOTEZ code itself
 * (`EC`, `VI`, `INDUS`…), which is the abbreviation the classification is filed
 * under.
 *
 * A legacy value that predates the codes has no abbreviation, so it falls back
 * to its label — the full text, not a truncation. Callers that show this in a
 * constrained cell should also expose `natureDisplay` as a tooltip.
 */
export function natureCode(nature?: string | null): string {
  const code = (nature || '').trim().toUpperCase();
  return code && NOTEZ_BY_CODE.has(code) ? code : natureDisplay(nature);
}






export interface TaxRateConfig {
  id: string;
  category: PatenteCategory;
  categoryLabel: string;
  description: string;
  annualRateUSD: number;
  updatedBy: string;
  updatedAt: string;
}

/* ==================================================================== */
/*  TAX TYPES                                                           */
/*                                                                      */
/*  A tax type is a *head of tax* the DPRNK levies, with its own          */
/*  percentage rate and its own taxable base. It is deliberately a      */
/*  different concept from the two flat-amount schedules already in     */
/*  the system:                                                         */
/*                                                                      */
/*    TaxRate        — patente tariff matrix (sector × size), flat USD  */
/*    TaxRateConfig  — patente Category A–D schedule, flat USD          */
/*    TaxType        — percentage of a declared base (IF, IRL, …)       */
/*                                                                      */
/*  Keeping these separate means a percentage tax never has to be       */
/*  forced through the proration maths that only makes sense for an     */
/*  annual flat fee.                                                    */
/* ==================================================================== */

export type TaxTypeCode = 'PATENTE' | 'IF' | 'IRL';

/**
 * Which declared figure the percentage is applied to.
 *
 * `flat_tariff` marks a head of tax that is not percentage-based (patente):
 * its amount comes from the tariff schedule, so `ratePercent` is 0.
 */
export type TaxBaseKind =
  | 'flat_tariff'
  | 'declared_property_value'
  | 'annual_rental_income';

export const TAX_BASE_KIND_LABELS: Record<TaxBaseKind, string> = {
  flat_tariff: 'Tariff schedule (flat annual fee)',
  declared_property_value: 'Declared property value',
  annual_rental_income: 'Declared annual rental income',
};

/** Currency the declared base is recorded in — USD system-wide. */
export type TaxBaseCurrency = 'USD';

export interface TaxType {
  id: string;
  /** Short code printed on notices and receipts, e.g. "IF". */
  code: TaxTypeCode | string;
  /** Official French declaration wording, as it reads on the paper return. */
  label: string;
  /** English working label used on internal screens. */
  labelEn: string;
  /**
   * Percentage applied to the base — 15 means 15%. Zero for heads of tax
   * that are tariff-based rather than percentage-based.
   */
  ratePercent: number;
  baseKind: TaxBaseKind;
  /** Human description of the base, shown beside the rate. */
  baseDescription: string;
  /** Prefix for generated assessment numbers, e.g. "IF" → IF-2026-00001. */
  numberPrefix: string;
  isActive: boolean;
  /** Legal reference underpinning the rate. */
  legalBasis?: string;
  notes?: string;
  updatedBy?: string;
  updatedAt: string;
}

/** True when the head of tax is computed as a percentage of a declared base. */
export function isPercentageTaxType(taxType?: TaxType | null): boolean {
  return !!taxType && taxType.baseKind !== 'flat_tariff' && taxType.ratePercent > 0;
}

/**
 * One dated version of a head of tax's rate.
 *
 * Mirrors the patente `TaxRate` versioning exactly: a rate change never
 * overwrites the previous figure. The old version is closed out with an end
 * date and a new one opens, so a notice issued under an earlier rate can always
 * be traced to the figure it was billed at.
 *
 * `TaxType.ratePercent` always mirrors the active version — it is the working
 * value the duty computation reads, so a register never has to walk the trail.
 */
export interface TaxTypeRateVersion {
  id: string;
  taxTypeId: string;
  taxTypeCode: string;
  ratePercent: number;
  baseKind: TaxBaseKind;
  version: number;
  isActive: boolean;
  /** YYYY-MM-DD. */
  effectiveStartDate: string;
  /** YYYY-MM-DD, or null while this version is the active one. */
  effectiveEndDate?: string | null;
  legalBasis?: string;
  notes?: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt?: string;
}

export type NavigationItem = 
  | 'dashboard'
  | 'businesses'
  | 'taxpayers'
  | 'declarations'
  | 'taxpayer-profile'
  | 'transfer'
  | 'bank-agent'
  | 'note-perception'
  | 'notifications'
  | 'assessments'
  | 'payments'
  | 'payroll'
  | 'expenses'
  | 'reception'
  | 'announcements'
  | 'verify-receipt'
  | 'certificates'
  | 'reports'
  | 'cash-reconciliation'
  | 'receipt-anomalies'
  | 'approvals'
  | 'compliance'
  | 'audit-log'
  | 'settings'
  | 'users';

export type RolePermissionsMap = Record<UserRole, NavigationItem[]>;

export type AnomalyType = 'gap' | 'duplicate' | 'voided_receipt';
export type AnomalyResolutionStatus = 'Unresolved' | 'Explained' | 'non_resolu' | 'explique';

export interface ReceiptAnomaly {
  id: string; // e.g. "ANOM-GAP-REC-2026-00043" or "ANOM-DUP-REC-2026-00055"
  type: AnomalyType; // 'gap' | 'duplicate'
  cashierId: string;
  cashierName: string;
  stationOffice?: string;
  
  // For gap: expected number(s) missing between previous and next
  expectedReceiptNumber: string; // e.g. "REC-2026-00043" or "REC-2026-00043 to REC-2026-00045"
  expectedSequenceNumber?: number; // e.g. 43
  startSequence?: number;
  endSequence?: number;
  
  // For duplicate: the actual receipt number duplicated
  actualReceiptNumber: string; // e.g. "REC-2026-00055"
  duplicatePaymentIds?: string[]; // IDs of conflicting payments
  duplicateCount?: number;
  
  // Date range of detected sequence
  startDate: string;
  endDate: string;
  detectedAt: string;
  
  // Resolution workflow
  status: AnomalyResolutionStatus; // 'non_resolu' | 'explique'
  resolutionNote?: string; // Required when marked "explained", e.g., "receipt cancelled, see #1234"
  resolvedBy?: string;
  resolvedByName?: string;
  resolvedAt?: string;
  
  // Source: offline sync or scan
  source: 'sync_offline' | 'manual_scan' | 'automatic_check';
}

export interface SequenceCheckSummary {
  checkedAt: string;
  totalPaymentsScanned: number;
  totalCashiersScanned: number;
  gapsCount: number;
  duplicatesCount: number;
  newAnomaliesCount: number;
  anomalies: ReceiptAnomaly[];
}

// ==========================================
// PHASE 10: MAKER-CHECKER APPROVAL SYSTEM
// ==========================================

export type ApprovalRequestType =
  | 'assessment_cancellation'
  | 'business_deregistration'
  | 'tax_rate_override'
  | 'certificate_revocation'
  | 'user_admin_promotion'
  | 'user_admin_suspension'
  | 'user_admin_reactivation';

export type ApprovalRequestStatus = 'Pending' | 'Approved' | 'Rejected';

export interface ApprovalRequest {
  id: string; // e.g. "AR-2026-0001"
  requestType: ApprovalRequestType;
  entityType: 'Assessment' | 'Business' | 'TaxRate' | 'TaxRateConfig' | 'Certificate' | 'User';
  entityId: string;
  entityTitle: string; // e.g. "Notice No. TAX-2026-00005 (Hotel Serena)" or "Quincaillerie Moderne (Nat ID: 20-B-0442)"
  
  // Requester (Maker)
  requesterId: string;
  requesterName: string;
  requesterRole: UserRole;
  justification: string;
  
  // Status and values diff
  status: ApprovalRequestStatus;
  beforeValue: Record<string, any>;
  afterValue: Record<string, any>;
  
  // Additional helpful metadata for display
  targetDetails?: {
    businessName?: string;
    assessmentNumber?: string;
    certificateNumber?: string;
    commune?: string;
    quartier?: string;
    activitySector?: string;
    sizeClass?: string;
    amountUSD?: number;
    fiscalYear?: number;
    [key: string]: any;
  };
  
  createdAt: string; // ISO date
  
  // Reviewer (Checker: must be distinct from requester)
  reviewedBy?: string;
  reviewerName?: string;
  reviewerRole?: UserRole;
  reviewedAt?: string;
  reviewComment?: string;
}

// ==========================================
// PHASE 11: BUSINESS LICENSE CERTIFICATES
// ==========================================

export type CertificateStatus = 'Valid' | 'Expired' | 'Revoked';

export interface BusinessLicenseCertificate {
  id: string; // e.g. "cert_2026_00001"
  certificateNumber: string; // Unique, sequential, never reused: e.g. "CERT-PAT-2026-00001"
  sequenceNumber: number; // Monotonically incrementing integer
  assessmentId: string;
  assessmentNumber: string; // Ref to assessment e.g. "PAT-2026-00001"
  receiptNumber?: string; // Ref to payment receipt e.g. "REC-2026-00001"
  
  businessId: string;
  businessName: string;
  tradeName?: string;
  ownerName: string;
  businessRegistrationNumber: string; // National ID (idNat) — printed as the Nat ID
  commune: string;
  quartier: string;
  avenue?: string;
  
  activitySector: BusinessSector | string;
  sizeClass: BusinessSizeClass | string;
  taxYearCovered: number; // e.g. 2026
  
  issuingOffice: string; // e.g. "DPRNK — Goma Division"
  issuedBy: string; // uid or username
  issuedByName: string;
  issueDate: string; // YYYY-MM-DD
  expiryDate: string; // YYYY-MM-DD (End of tax year: 31-12-YYYY)
  
  status: CertificateStatus; // 'Valid' | 'Expired' | 'Revoked'
  
  // Amounts certified
  amountPaidUSD: number;
  
  // Revocation details (if revoked via Maker-Checker)
  revokedAt?: string;
  revokedBy?: string;
  revokedByName?: string;
  revokedRole?: UserRole;
  revocationReason?: string;
  revocationRequestId?: string;
  
  // Security & verification
  qrVerificationCode: string;
  securityHash?: string;
  notes?: string;
  
  createdAt: string;
  updatedAt?: string;
}

export interface CertificateCounter {
  id: string;
  currentSequence: number;
  lastCertificateNumber?: string;
  updatedAt: string;
}

export interface CertificateVerificationResult {
  isValid: boolean;
  certificate?: BusinessLicenseCertificate;
  /**
   * 'Tampered' is a verification finding, not a stored state: the record was
   * found but its integrity token no longer matches the one embedded in its own
   * QR payload, so the document was altered after it was issued. It is kept out
   * of `CertificateStatus` because no issued certificate is ever *stored* as
   * tampered — only ever found to be so.
   */
  status: CertificateStatus | 'NotFound' | 'Tampered';
  verificationMessage: string;
  verifiedAt: string;
}

// ==========================================
// RECURRING EXPENSES & EXPENSE LEDGER
// ==========================================

export type ExpenseCategory =
  | 'Salaries'
  | 'Rent'
  | 'Utilities'
  | 'Fuel'
  | 'Maintenance'
  | 'Office Supplies'
  | 'Transport'
  | 'Communication'
  | 'Bank Charges'
  | 'Taxes & Fees'
  | 'Other';

export type ExpenseFrequency =
  | 'Daily'
  | 'Weekly'
  | 'Monthly'
  | 'Quarterly'
  | 'SemiAnnual'
  | 'Yearly';

export type RecurringExpenseStatus = 'Active' | 'Paused' | 'Completed' | 'Cancelled';

export type ExpenseRecordStatus = 'Scheduled' | 'Due' | 'Overdue' | 'Paid' | 'Cancelled';

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'Salaries',
  'Rent',
  'Utilities',
  'Fuel',
  'Maintenance',
  'Office Supplies',
  'Transport',
  'Communication',
  'Bank Charges',
  'Taxes & Fees',
  'Other',
];

export const EXPENSE_FREQUENCIES: ExpenseFrequency[] = [
  'Daily',
  'Weekly',
  'Monthly',
  'Quarterly',
  'SemiAnnual',
  'Yearly',
];

export const EXPENSE_FREQUENCY_LABELS: Record<ExpenseFrequency, string> = {
  Daily: 'Daily',
  Weekly: 'Weekly',
  Monthly: 'Monthly',
  Quarterly: 'Quarterly',
  SemiAnnual: 'Every 6 months',
  Yearly: 'Yearly',
};

export interface RecurringExpense {
  id: string;
  title: string;
  category: ExpenseCategory;
  payee: string;
  amountUSD: number;
  currency: 'USD';
  frequency: ExpenseFrequency;
  startDate: string; // YYYY-MM-DD
  nextDueDate: string; // YYYY-MM-DD — advanced by one period per recorded payment
  endDate?: string | null; // YYYY-MM-DD — optional hard stop
  occurrencesPlanned?: number | null; // optional stop after N payments
  occurrencesLogged: number;
  totalPaidUSD: number;
  paymentMethod: string;
  status: RecurringExpenseStatus;
  notes?: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt?: string;
  pausedAt?: string;
  cancelledAt?: string;
  cancelReason?: string;
}

export interface ExpenseRecord {
  id: string;
  scheduleId: string | null; // null = manually logged one-off expense
  title: string;
  category: ExpenseCategory;
  payee?: string;
  amountUSD: number;
  currency: 'USD';
  dueDate: string; // YYYY-MM-DD
  paidDate?: string | null; // YYYY-MM-DD once paid
  status: ExpenseRecordStatus;
  paymentMethod?: string;
  reference?: string;
  notes?: string;
  recordedBy: string;
  recordedByName: string;
  createdAt: string;
  updatedAt?: string;
}

export function normalizeExpenseCategory(val?: string | null): ExpenseCategory {
  if (!val) return 'Other';
  const found = EXPENSE_CATEGORIES.find(
    (c) => c.toLowerCase() === val.toLowerCase().trim()
  );
  return found || 'Other';
}

export function normalizeExpenseFrequency(val?: string | null): ExpenseFrequency {
  if (!val) return 'Monthly';
  const lower = val.toLowerCase().trim();
  if (lower === 'daily' || lower === 'day') return 'Daily';
  if (lower === 'weekly' || lower === 'week') return 'Weekly';
  if (lower === 'monthly' || lower === 'month') return 'Monthly';
  if (lower === 'quarterly' || lower === 'quarter') return 'Quarterly';
  if (lower === 'semiannual' || lower === 'semi-annual' || lower === 'biannual') return 'SemiAnnual';
  if (lower === 'yearly' || lower === 'annual' || lower === 'year') return 'Yearly';
  const found = EXPENSE_FREQUENCIES.find((f) => f.toLowerCase() === lower);
  return found || 'Monthly';
}

// ==========================================
// RECEPTION QUEUE & VISITOR WAIT TRACKING
// ==========================================

export type ReceptionService =
  | 'Business Registration'
  | 'Tax Assessment'
  | 'Payment at Counter'
  | 'Receipt Verification'
  | 'License Certificate'
  | 'Complaint / Inquiry'
  | 'Document Pickup'
  | 'Deregistration Request'
  | 'Other';

export type ReceptionPriority = 'Normal' | 'Priority';

export type ReceptionStatus = 'Scheduled' | 'Waiting' | 'InService' | 'Completed' | 'Cancelled' | 'NoShow';

export const RECEPTION_SERVICES: ReceptionService[] = [
  'Business Registration',
  'Tax Assessment',
  'Payment at Counter',
  'Receipt Verification',
  'License Certificate',
  'Complaint / Inquiry',
  'Document Pickup',
  'Deregistration Request',
  'Other',
];

export interface ReceptionEntry {
  id: string;
  visitorName: string;
  phone?: string;
  /** Free text: the desk records the service the visitor actually names. */
  service: string;
  priority: ReceptionPriority;
  status: ReceptionStatus;
  scheduledFor?: string;
  scheduledTime?: string;
  scheduledAt?: string;
  scheduledBy?: string;
  originalCheckedInAt?: string;
  checkedInAt: string; // ISO timestamp — waiting clock starts here
  calledAt?: string | null; // ISO — moved Waiting -> InService
  completedAt?: string | null; // ISO — moved InService -> Completed
  servedBy?: string;
  servedByName?: string;
  window?: string; // counter / desk assigned
  notes?: string;
  registeredBy: string;
  registeredByName: string;
  createdAt: string;
  updatedAt?: string;
}

/**
 * Known desk services are canonicalised so the filter and legacy labels stay
 * consistent. Anything else the desk types is kept verbatim; only a blank field
 * falls back to "Other".
 */
export function normalizeReceptionService(val?: string | null): string {
  const trimmed = (val || '').trim();
  if (!trimmed) return 'Other';
  const found = RECEPTION_SERVICES.find(
    (s) => s.toLowerCase() === trimmed.toLowerCase()
  );
  return found || trimmed;
}

export function normalizeReceptionStatus(val?: string | null): ReceptionStatus {
  if (!val) return 'Waiting';
  const lower = val.toLowerCase().trim();
  if (lower === 'scheduled' || lower === 'planifié') return 'Scheduled';
  if (lower === 'waiting' || lower === 'en attente') return 'Waiting';
  if (lower === 'inservice' || lower === 'in_service' || lower === 'in service' || lower === 'serving') return 'InService';
  if (lower === 'completed' || lower === 'done' || lower === 'terminé' || lower === 'termine') return 'Completed';
  if (lower === 'cancelled' || lower === 'canceled' || lower === 'annulé' || lower === 'annule') return 'Cancelled';
  if (lower === 'noshow' || lower === 'no_show' || lower === 'no show' || lower === 'absent') return 'NoShow';
  return 'Waiting';
}

// ==========================================
// ANNOUNCEMENT BOARD (INTER-DEPARTMENT COMMS)
// ==========================================

/** Audience a board post is addressed to. */
export type BoardDepartment = 'General' | 'HR' | 'Finance';

export type BoardCategory = 'Announcement' | 'Issue' | 'Memo' | 'Urgent';

export type BoardStatus = 'Open' | 'Resolved';

export const BOARD_DEPARTMENTS: BoardDepartment[] = ['General', 'HR', 'Finance'];

export const BOARD_DEPARTMENT_LABELS: Record<BoardDepartment, string> = {
  General: 'All staff',
  HR: 'HR Department',
  Finance: 'Finance Department',
};

export const BOARD_CATEGORIES: BoardCategory[] = ['Announcement', 'Issue', 'Memo', 'Urgent'];

export interface BoardReply {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: string;
  body: string;
  createdAt: string;
}

export interface BoardAnnouncement {
  id: string;
  title: string;
  body: string;
  category: BoardCategory;
  department: BoardDepartment;
  /** Issues/urgents track Open -> Resolved; plain announcements stay Open. */
  status: BoardStatus;
  pinned: boolean;
  authorId: string;
  authorName: string;
  authorRole: string;
  replies: BoardReply[];
  createdAt: string;
  updatedAt?: string;
}

export function normalizeBoardDepartment(val?: string | null): BoardDepartment {
  if (!val) return 'General';
  const found = BOARD_DEPARTMENTS.find(
    (d) => d.toLowerCase() === val.toLowerCase().trim()
  );
  return found || 'General';
}

export function normalizeBoardCategory(val?: string | null): BoardCategory {
  if (!val) return 'Announcement';
  const found = BOARD_CATEGORIES.find(
    (c) => c.toLowerCase() === val.toLowerCase().trim()
  );
  return found || 'Announcement';
}

// ==========================================
// BOARD SCHEDULE (MEETINGS + REPORT DEADLINES)
// ==========================================

export type ScheduleEventKind = 'Meeting' | 'Deadline';

export type ScheduleEventStatus = 'Scheduled' | 'Done' | 'Cancelled';

export const SCHEDULE_EVENT_KINDS: ScheduleEventKind[] = ['Meeting', 'Deadline'];

export interface ScheduleEvent {
  id: string;
  title: string;
  kind: ScheduleEventKind;
  /** Calendar day as YYYY-MM-DD (local day, no timezone shift). */
  date: string;
  /** 24h "HH:MM" — mainly for meetings. */
  time?: string;
  /** Audience the meeting/deadline concerns. */
  department: BoardDepartment;
  location?: string;
  notes?: string;
  status: ScheduleEventStatus;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt?: string;
}

export function normalizeScheduleEventKind(val?: string | null): ScheduleEventKind {
  if (!val) return 'Meeting';
  const lower = val.toLowerCase().trim();
  if (lower.startsWith('deadline') || lower.startsWith('due') || lower === 'report') return 'Deadline';
  return 'Meeting';
}

export function normalizeScheduleEventStatus(val?: string | null): ScheduleEventStatus {
  if (!val) return 'Scheduled';
  const lower = val.toLowerCase().trim();
  if (lower === 'done' || lower === 'completed') return 'Done';
  if (lower === 'cancelled' || lower === 'canceled') return 'Cancelled';
  return 'Scheduled';
}

// ==========================================
// MIGRATION & NORMALIZATION HELPERS
// ==========================================

export function normalizeSector(val?: string | null): BusinessSector {
  if (!val) return 'Commerce';
  const lower = val.toLowerCase().trim();
  if (lower === 'commerce' || lower === 'trade') return 'Commerce';
  if (lower === 'restauration' || lower === 'food service' || lower === 'food_service' || lower === 'foodservice') return 'Food Service';
  if (lower === 'services') return 'Services';
  if (lower === 'artisanat' || lower === 'crafts') return 'Crafts';
  if (lower === 'industrie' || lower === 'industry') return 'Industry';
  if (lower === 'autre' || lower === 'other') return 'Other';
  return val.trim();
}

export function normalizeSizeClass(val?: string | null): BusinessSizeClass {
  if (!val) return 'Small';
  const lower = val.toLowerCase().trim();
  if (lower === 'petite' || lower === 'small') return 'Small';
  if (lower === 'moyenne' || lower === 'medium') return 'Medium';
  if (lower === 'grande' || lower === 'large') return 'Large';
  return 'Small';
}

export function normalizePatenteCategory(val?: string | null): PatenteCategory {
  if (!val) return 'Category_C_Petite';
  const lower = val.toLowerCase().trim();
  if (lower.includes('a_grande') || lower === 'a' || lower.includes('grande')) return 'Category_A_Grande';
  if (lower.includes('b_moyenne') || lower === 'b' || lower.includes('moyenne')) return 'Category_B_Moyenne';
  if (lower.includes('d_micro') || lower === 'd' || lower.includes('micro')) return 'Category_D_Micro';
  if (lower.includes('c_petite') || lower === 'c' || lower.includes('petite')) return 'Category_C_Petite';
  return 'Category_C_Petite';
}

export function normalizeTaxpayerType(val?: string | null): TaxpayerType {
  if (!val) return 'Personne Morale';
  const lower = val.toLowerCase().trim();
  if (lower.includes('physique') || lower === 'individual' || lower === 'personne_physique') {
    return 'Personne Physique';
  }
  return 'Personne Morale';
}

export function normalizeBusinessStatus(val?: string | null): BusinessStatus {
  if (!val) return 'Active';
  const lower = val.toLowerCase().trim();
  if (lower === 'actif' || lower === 'active') return 'Active';
  if (lower === 'inactif' || lower === 'inactive') return 'Inactive';
  if (
    lower === 'en radiation' ||
    lower === 'deregistration pending' ||
    lower === 'deregistered' ||
    lower === 'closure pending' ||
    lower === 'closure_pending' ||
    lower === 'in_closure' ||
    lower === 'in_deregistration' ||
    lower === 'closed'
  ) return 'Closure Pending';
  return 'Active';
}

export function normalizeAssessmentStatus(val?: string | null): AssessmentStatus {
  if (!val) return 'Pending';
  const lower = val.toLowerCase().trim();
  if (lower === 'en attente' || lower === 'pending') return 'Pending';
  if (lower === 'payée' || lower === 'payee' || lower === 'paid') return 'Paid';
  if (lower === 'en retard' || lower === 'overdue') return 'Overdue';
  if (lower === 'annulée' || lower === 'annulee' || lower === 'cancelled' || lower === 'canceled') return 'Cancelled';
  if (lower === 'draft') return 'Draft';
  if (lower === 'pending_approval') return 'Pending_Approval';
  if (lower === 'approved') return 'Approved';
  return 'Pending';
}

export function normalizeAnomalyStatus(val?: string | null): AnomalyResolutionStatus {
  if (!val) return 'Unresolved';
  const lower = val.toLowerCase().trim();
  if (lower === 'explique' || lower === 'expliqué' || lower === 'explained') return 'Explained';
  if (lower === 'non_resolu' || lower === 'non résolu' || lower === 'non resolu' || lower === 'unresolved') return 'Unresolved';
  return 'Unresolved';
}

export function normalizeApprovalStatus(val?: string | null): ApprovalRequestStatus {
  if (!val) return 'Pending';
  const lower = val.toLowerCase().trim();
  if (lower === 'en attente' || lower === 'pending') return 'Pending';
  if (lower === 'approuvée' || lower === 'approuvee' || lower === 'approved') return 'Approved';
  if (lower === 'rejetée' || lower === 'rejetee' || lower === 'rejected') return 'Rejected';
  return 'Pending';
}


