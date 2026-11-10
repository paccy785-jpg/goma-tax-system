import { PropertyParcel, RentalLease } from '../types';

/**
 * The lease record itself — pure, no persistence.
 *
 * Split from `leaseService` so the exact shape written to Firestore can be
 * asserted without a server: the register prints these fields, so the mapping
 * from the Add Locataire card to the table columns is a testable fact rather
 * than something to eyeball.
 */

export interface AddLeaseInput {
  /** Locataires — one contract may name co-tenants, and must name at least one. */
  tenantNames: string[];
  /** The locataires' taxpayer ids, when picked from the taxpayer roll. */
  tenantIds?: string[];
  /** The declared property being let, which supplies the whole address. */
  parcel: PropertyParcel;
  /** Which part of the parcel is let, when only part of it is. */
  unitLabel?: string;
  /** YYYY-MM-DD; omitted while the period has not been entered. */
  startDate?: string;
  /** YYYY-MM-DD; omitted while the tenancy is open-ended or unrecorded. */
  endDate?: string | null;
  /** Monthly rent in USD; 0 while it has not been entered. */
  monthlyRentUSD?: number;
  notes?: string;
  exercice: number;
}

/** Names that survive validation: trimmed, de-duplicated, non-empty. */
export function normalizeTenantNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = (raw || '').trim().replace(/\s+/g, ' ');
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * Build the lease record from a filing.
 *
 * Every column the register prints is copied from the parcel here, so a row is
 * complete the moment it is saved and never depends on a later lookup:
 *
 *   card field            → lease field          → table column
 *   Locataire             → tenantNames          → Noms des Locataires
 *   Bailleur              → bailleurName         → Bailleur
 *   Nature                → nature               → Nature
 *   Ville                 → villeTerritoire      → ville
 *   Commune               → communeChefferie     → commune
 *   Quartier              → quartierGroupement   → Quartier
 *   Avenue                → address              → Avenue
 *   Numéro de parcelle    → numeroParcelle       → Numero de parcelle
 *   (not captured)        → startDate            → Periode de location
 *   (not captured)        → monthlyRentUSD       → Loyer mensuel
 */
/**
 * Whether a lease's période de location and loyer mensuel are locked.
 *
 * Locked once they have been saved: explicitly stamped by `termsLockedAt`, or —
 * for a lease saved before locking existed — implied by a recorded start date
 * and rent.
 */
export function isLeaseTermsLocked(lease: Pick<RentalLease, 'termsLockedAt' | 'startDate' | 'monthlyRentUSD'>): boolean {
  return !!lease.termsLockedAt || (!!lease.startDate && (lease.monthlyRentUSD || 0) > 0);
}

/**
 * Whether the locataire has been removed from the property — the tenancy ended.
 *
 * A removed lease stays on the register as IRL evidence; this flag is what the
 * UI and the revenue views read to tell a live tenancy from an ended one.
 */
export function isLeaseVacated(lease: Pick<RentalLease, 'vacatedAt'>): boolean {
  return !!lease.vacatedAt;
}

export function buildLease(input: AddLeaseInput, id: string, lockedByName?: string): RentalLease {
  const tenantNames = normalizeTenantNames(input.tenantNames);
  if (tenantNames.length === 0) throw new Error('Enter at least one locataire.');
  if (!input.parcel?.id) throw new Error('Select the property being let.');

  const { parcel } = input;
  const startDate = input.startDate?.trim();
  const endDate = input.endDate?.trim();
  const monthlyRentUSD = Number(input.monthlyRentUSD) > 0 ? Number(input.monthlyRentUSD) : 0;

  return {
    id,
    parcelId: parcel.id,
    // --- parcel identity, denormalised at filing time ---
    rang: parcel.rang || '',
    ...(parcel.numeroParcelle?.trim() ? { numeroParcelle: parcel.numeroParcelle.trim() } : {}),
    villeTerritoire: parcel.villeTerritoire,
    communeChefferie: parcel.communeChefferie,
    quartierGroupement: parcel.quartierGroupement,
    address: parcel.avenueLocalite,
    nature: parcel.nature,
    // --- who owns what is let ---
    ...(parcel.ownerTaxpayerId ? { bailleurId: parcel.ownerTaxpayerId } : {}),
    ...(parcel.ownerName?.trim() ? { bailleurName: parcel.ownerName.trim() } : {}),
    // --- the tenancy itself ---
    tenantNames,
    ...(input.tenantIds && input.tenantIds.filter(Boolean).length > 0
      ? { tenantIds: input.tenantIds.filter(Boolean) }
      : {}),
    ...(input.unitLabel?.trim() ? { unitLabel: input.unitLabel.trim() } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
    monthlyRentUSD,
    // Filed with both a period and a rent: the terms are saved, so they lock.
    ...(startDate && monthlyRentUSD > 0
      ? {
          termsLockedAt: new Date().toISOString(),
          ...(lockedByName ? { termsLockedByName: lockedByName } : {}),
        }
      : {}),
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
    exercice: input.exercice,
    registeredAt: new Date().toISOString(),
  };
}

/** The période de location (and loyer) of the next declaration. */
export interface NextPeriodInput {
  /** YYYY-MM-DD — required: a new period must say when it starts. */
  startDate: string;
  /** YYYY-MM-DD, or empty while the new period is open-ended. */
  endDate?: string | null;
  /** Loyer mensuel in USD; carried from the previous lease unless revised. */
  monthlyRentUSD: number;
}

/**
 * Build the next period's record from the lease already on file.
 *
 * A tenant declaring a second time is a **new lease, not an edit**. The période
 * de location drives the revenu brut (loyer × mois loués), so rewriting it on a
 * saved record would silently change what was already assessed. This copies the
 * tenancy's identity — locataires, parcelle, bailleur, nature — and applies only
 * the new period and rent, stamping `previousLeaseId` so the chain stays
 * readable.
 *
 * The previous lease is read, never written.
 */
export function buildLeaseForNextPeriod(
  previous: RentalLease,
  terms: NextPeriodInput,
  id: string,
  lockedByName?: string
): RentalLease {
  const startDate = terms.startDate?.trim();
  if (!startDate) throw new Error('Saisissez la date de début de la nouvelle période.');
  const endDate = terms.endDate?.trim() || '';
  if (endDate && endDate < startDate) {
    throw new Error('La date de fin précède la date de début.');
  }
  const monthlyRentUSD =
    Number.isFinite(terms.monthlyRentUSD) && terms.monthlyRentUSD > 0
      ? Math.round(terms.monthlyRentUSD * 100) / 100
      : 0;
  if (monthlyRentUSD <= 0) throw new Error('Saisissez le loyer mensuel.');

  // The exercise follows the new period, not the year it happens to be filed in:
  // a period starting in 2027 belongs to the 2027 roll.
  const startYear = Number(startDate.slice(0, 4));
  const exercice = Number.isFinite(startYear) && startYear > 0 ? startYear : previous.exercice;

  return {
    id,
    parcelId: previous.parcelId,
    rang: previous.rang,
    ...(previous.numeroParcelle ? { numeroParcelle: previous.numeroParcelle } : {}),
    villeTerritoire: previous.villeTerritoire,
    communeChefferie: previous.communeChefferie,
    quartierGroupement: previous.quartierGroupement,
    address: previous.address,
    nature: previous.nature,
    tenantNames: [...previous.tenantNames],
    ...(previous.tenantIds?.length ? { tenantIds: [...previous.tenantIds] } : {}),
    ...(previous.bailleurId ? { bailleurId: previous.bailleurId } : {}),
    ...(previous.bailleurName ? { bailleurName: previous.bailleurName } : {}),
    ...(previous.unitLabel ? { unitLabel: previous.unitLabel } : {}),
    // --- the only things that change ---
    startDate,
    ...(endDate ? { endDate } : {}),
    monthlyRentUSD,
    // Filed with a period and a rent, so these terms lock like any other.
    termsLockedAt: new Date().toISOString(),
    ...(lockedByName ? { termsLockedByName: lockedByName } : {}),
    previousLeaseId: previous.id,
    exercice,
    registeredAt: new Date().toISOString(),
  };
}

/**
 * Whether a proposed period overlaps one already on file.
 *
 * Two periods for the same tenancy that share a month would count that month's
 * rent twice in the revenu brut. Used to warn the officer, not to block the
 * filing — an overlapping record can still be a legitimate correction.
 */
/** Month ordinal (year * 12 + month) of a YYYY-MM-DD string. */
function monthOrdinal(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  const m = /^(\d{4})-(\d{2})/.exec(dateStr);
  if (!m) return null;
  return Number(m[1]) * 12 + (Number(m[2]) - 1);
}

export function periodsOverlap(
  a: { startDate?: string; endDate?: string | null },
  b: { startDate?: string; endDate?: string | null }
): boolean {
  if (!a.startDate || !b.startDate) return false;
  const aStart = monthOrdinal(a.startDate);
  const bStart = monthOrdinal(b.startDate);
  if (aStart === null || bStart === null) return false;
  // Compare MONTHS, not days. Revenue is counted per month (loyer x mois loués),
  // so a period 01/01-15/01 and another 16/01-31/01 share January and that
  // month's rent is counted twice — the day-level comparison called those
  // disjoint and stayed silent.
  const OPEN_ENDED = 9999 * 12;
  const aEnd = a.endDate ? monthOrdinal(a.endDate) ?? OPEN_ENDED : OPEN_ENDED;
  const bEnd = b.endDate ? monthOrdinal(b.endDate) ?? OPEN_ENDED : OPEN_ENDED;
  return aStart <= bEnd && bStart <= aEnd;
}
