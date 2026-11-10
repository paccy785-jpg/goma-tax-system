import { natureDisplay, RentalLease } from '../types';
import { csvCell } from '../utils/csv';

/* ==================================================================== */
/*  REVENUE MATH                                                        */
/* ==================================================================== */

/** Absolute month ordinal: year × 12 + 1-based month. */
function monthIndex(value?: string | null): number | null {
  if (!value) return null;
  // Read a YYYY-MM-DD date as written. `new Date("2026-04-30")` is UTC
  // midnight, which lands on the previous day — and month — west of Greenwich.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const probe = new Date(year, month - 1, day);
    // Reject impossible calendar dates such as 31/04.
    if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day) {
      return null;
    }
    return year * 12 + month;
  }
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.getFullYear() * 12 + d.getMonth() + 1;
}

/**
 * Whole calendar months the property was let during the exercise.
 *
 * A month in which the property was let for any part of it counts as let —
 * that is how a lease is billed, so it is how the revenue is declared. A lease
 * running to an open end is treated as running to the end of the exercise.
 *
 * Returns 0 when the lease falls entirely outside the exercise.
 */
export function monthsLetInExercise(lease: RentalLease, exercice: number): number {
  const start = monthIndex(lease.startDate);
  if (start === null) return 0;

  // The tenancy ends at the earliest of: its contracted end date, the day the
  // locataire was recorded as leaving, and the moment the lease was vacated.
  // Only `endDate` used to be consulted, so a tenancy that actually ended in
  // March was still billed for the twelve months of the exercise — the revenu
  // brut declared for the bailleur was up to nine months of rent too high, and
  // the assessment built on it with it.
  const terminations = [monthIndex(lease.endDate), monthIndex(lease.moveOutDate), monthIndex(lease.vacatedAt)]
    .filter((m): m is number => m !== null);
  const end = terminations.length > 0
    ? Math.min(...terminations)
    : exercice * 12 + 12;

  const windowStart = exercice * 12 + 1;
  const windowEnd = exercice * 12 + 12;

  const from = Math.max(windowStart, start);
  const to = Math.min(windowEnd, end);
  if (to < from) return 0;
  return to - from + 1;
}

/** Total revenu brut for one lease: loyer mensuel × months let. */
export function grossRevenueUSD(lease: RentalLease, exercice: number): number {
  return Math.max(0, lease.monthlyRentUSD || 0) * monthsLetInExercise(lease, exercice);
}

/** Tenant count for a lease — co-tenants on one contract each count. */
export function tenantCount(lease: RentalLease): number {
  return (lease.tenantNames || []).filter((n) => n.trim().length > 0).length;
}

/* ==================================================================== */
/*  ROLL-UP & RECONCILIATION                                            */
/* ==================================================================== */

export interface RentalRollRow {
  lease: RentalLease;
  monthsLet: number;
  grossUSD: number;
}

export interface RentalRoll {
  rows: RentalRollRow[];
  totalLeases: number;
  totalTenants: number;
  /** Total revenu brut across every lease in scope, in USD. */
  totalGrossUSD: number;
}

/**
 * Roll the lease register up.
 *
 * `leases` is the filtered set the table is rendering, so the totals can never
 * contradict the rows above them.
 */
export function computeRentalRoll(
  leases: RentalLease[],
  exercice: number
): RentalRoll {
  const rows: RentalRollRow[] = leases.map((lease) => ({
    lease,
    monthsLet: monthsLetInExercise(lease, exercice),
    grossUSD: grossRevenueUSD(lease, exercice),
  }));

  const totalGrossUSD = rows.reduce((sum, r) => sum + r.grossUSD, 0);
  const totalTenants = leases.reduce((sum, l) => sum + tenantCount(l), 0);


  return {
    rows,
    totalLeases: rows.length,
    totalTenants,
    totalGrossUSD,
  };
}

/**
 * One locataire's block in the register: the name(s) shown once, with every
 * document (lease) filed under them listed beneath.
 */
export interface RentalTenantGroup {
  /** Stable grouping key — the sorted, lower-cased set of tenant names. */
  key: string;
  /** Display names, as filed (order preserved from the first document seen). */
  tenantNames: string[];
  rows: RentalRollRow[];
  totalGrossUSD: number;
  totalMonthsLet: number;
}

/** The grouping key for a lease: its tenant set, order- and case-insensitive. */
export function leaseTenantKey(lease: RentalLease): string {
  const names = (lease.tenantNames || [])
    .map((n) => n.trim().toLowerCase())
    .filter(Boolean)
    .sort();
  // A lease with no usable name still needs a bucket of its own.
  return names.length > 0 ? names.join(' | ') : `lease:${lease.id}`;
}

/**
 * Group roll rows by locataire so a tenant with several documents occupies one
 * block instead of repeating their name on every row.
 *
 * Co-tenants are grouped by the exact set of names on the contract: two leases
 * that name the same locataires belong together, while a lease naming an extra
 * co-tenant is its own group — merging them would misstate who contracted what.
 * Groups keep the order the register first lists them in (newest first).
 */
export function groupRentalRowsByTenant(rows: RentalRollRow[]): RentalTenantGroup[] {
  const groups = new Map<string, RentalTenantGroup>();
  for (const row of rows) {
    const key = leaseTenantKey(row.lease);
    let group = groups.get(key);
    if (!group) {
      const tenantNames = (row.lease.tenantNames || []).map((n) => n.trim()).filter(Boolean);
      group = { key, tenantNames, rows: [], totalGrossUSD: 0, totalMonthsLet: 0 };
      groups.set(key, group);
    }
    group.rows.push(row);
    group.totalGrossUSD += row.grossUSD;
    group.totalMonthsLet += row.monthsLet;
  }
  return Array.from(groups.values());
}

/** Compact dd/mm/yyyy for the period column, tolerant of a missing date. */
export function shortDate(dateStr?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((dateStr || '').trim());
  if (!m) return '—';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Export the rental register, including the reconciliation findings. */
export function exportRentalRegisterCSV(roll: RentalRoll, exercice: number) {
  const escape = csvCell;
  const lines: string[] = [];

  lines.push(
    [
      'Noms de Locataires',
      'Nat',
      'Adresse',
      'Période de location',
      'Loyer mensuel (USD)',
      'Total revenu brut (USD)',
    ]
      .map(escape)
      .join(',')
  );
  roll.rows.forEach(({ lease, monthsLet, grossUSD }) => {
    const period = lease.startDate
      ? `${shortDate(lease.startDate)} → ${lease.endDate ? shortDate(lease.endDate) : 'En cours'} (${monthsLet} mois)`
      : '';
    lines.push(
      [
        lease.tenantNames.join(' / '),
        natureDisplay(lease.nature),
        `${lease.address} — ${lease.communeChefferie} (${
          lease.numeroParcelle || lease.rang
        } — ${lease.quartierGroupement})`,
        period,
        // A rent of 0 means "not entered", not "free" — export it blank.
        lease.monthlyRentUSD ? Math.round(lease.monthlyRentUSD) : '',
        lease.monthlyRentUSD ? Math.round(grossUSD) : '',
      ]
        .map(escape)
        .join(',')
    );
  });
  lines.push(
    [
      'TOTAL',
      '',
      '',
      `${roll.totalLeases} bailleur${roll.totalLeases === 1 ? '' : 's'} · ${roll.totalTenants} locataire${roll.totalTenants === 1 ? '' : 's'}`,
      '',
      Math.round(roll.totalGrossUSD),
    ]
      .map(escape)
      .join(',')
  );

  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `registre-des-baux-${exercice}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

