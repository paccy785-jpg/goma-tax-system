import { Payment, Assessment, Business, BusinessSector, SECTOR_LABELS, BusinessSizeClass, normalizeBusinessStatus, normalizeAssessmentStatus, normalizeSector, normalizeSizeClass } from '../types';
import { localDateFromIsoTimestamp, todayDateString, daysBetweenDates, isValidDateString } from '../utils/date';
import { csvCell } from '../utils/csv';

export interface DailyRevenueItem {
  date: string;
  transactionCount: number;
  totalUSD: number;
  cashUSD: number;
  otherUSD: number;
  percentageOfTotal: number;
}

export interface MonthlyRevenueItem {
  monthKey: string; // YYYY-MM
  monthLabel: string; // e.g. "Mars 2026"
  year: number;
  transactionCount: number;
  totalUSD: number;
  averageTransactionUSD: number;
  percentageOfTotal: number;
}

export interface YearlyRevenueItem {
  year: number;
  transactionCount: number;
  totalUSD: number;
  percentageOfTotal: number;
}

export interface CommuneRevenueItem {
  commune: 'Goma' | 'Karisimbi' | string;
  totalUSD: number;
  transactionCount: number;
  businessCount: number;
  percentageOfTotal: number;
  quartiers: {
    quartier: string;
    totalUSD: number;
    businessCount: number;
  }[];
}

export interface SectorRevenueItem {
  sector: BusinessSector;
  sectorLabel: string;
  totalAssessedUSD: number;
  totalCollectedUSD: number;
  businessCount: number;
  paymentCount: number;
  recoveryRatePercent: number | null;
  percentageOfTotalRevenue: number;
}

export interface ComplianceSummary {
  totalBusinesses: number;
  activeBusinesses: number;
  upToDateBusinesses: number;
  delinquentBusinesses: number;
  deregisteredBusinesses: number;
  inactiveBusinesses: number;
  complianceRatePercent: number | null;
  totalOverdueUSD: number;
  byCommune: {
    commune: string;
    total: number;
    active: number;
    delinquent: number;
    deregistered: number;
    complianceRate: number | null;
  }[];
  bySizeClass: {
    sizeClass: BusinessSizeClass;
    sizeLabel: string;
    total: number;
    active: number;
    delinquent: number;
    complianceRate: number | null;
  }[];
  delinquentDetails: {
    businessId: string;
    businessName: string;
    ownerFullName: string;
    commune: string;
    quartier: string;
    maxDaysOverdue: number;
    totalDebtUSD: number;
    status: string;
  }[];
}

export interface CashierDailyShiftItem {
  key: string; // cashierId_date
  date: string;
  cashierId: string;
  cashierName: string;
  transactionCount: number;
  firstReceiptNumber: string;
  lastReceiptNumber: string;
  totalCashUSD: number;
  totalOtherUSD: number;
  grandTotalUSD: number;
  isReconciled: boolean;
  reconciledAt?: string;
  payments: Payment[];
}

/**
 * Heads of tax collected through the Comptable tab (see reportLedger.ts), by
 * the code their payments and notices carry.
 */
export const REPORT_TAX_LABELS: Record<string, string> = {
  IF: 'Impôt foncier (IF)',
  IRL: 'Impôt sur les revenus locatifs (IRL)',
  NP: 'Note de perception',
};

/**
 * The urban commune a record belongs to. Read without regard to case or
 * spacing, so "karisimbi" or "KARISIMBI " is not booked to Goma.
 */
export function communeOf(commune?: string): string {
  const name = (commune || '').trim();
  if (!name) return 'Unattributed';
  if (name.toLowerCase() === 'karisimbi') return 'Karisimbi';
  if (name.toLowerCase() === 'goma') return 'Goma';
  return name;
}

/** Drafts and cancelled notices are not collectible tax debt. */
export function isIssuedAssessment(a: Assessment): boolean {
  return !['Cancelled', 'Draft', 'Pending_Approval'].includes(normalizeAssessmentStatus(a.status));
}

/**
 * Voided receipts are officially cancelled and must never be counted as
 * revenue. Every aggregation below funnels its payments input through this.
 */
function excludeVoidedPayments(payments: Payment[]): Payment[] {
  return payments.filter((p) => !p.isVoided);
}

/**
 * The day a payment belongs to, or null when the record carries no date at all.
 *
 * A payment with neither `paymentDate` nor `paidAt` used to be bucketed into a
 * fabricated `2026-01-01`, which drew a phantom "1 January 2026" spike in the
 * daily chart and a phantom January bucket in the monthly one — revenue
 * appearing on a day no receipt was ever issued. Such payments are real money
 * with no date, so they are kept out of the dated buckets and reported
 * separately as undated rather than being invented a date.
 */
export function paymentDayOf(p: Payment): string | null {
  if (p.paymentDate && isValidDateString(p.paymentDate)) return p.paymentDate;
  if (p.paidAt) {
    const day = localDateFromIsoTimestamp(p.paidAt);
    if (isValidDateString(day)) return day;
  }
  return null;
}

export function computePeriodRevenue(payments: Payment[]) {
  const live = excludeVoidedPayments(payments);
  const totalUSD = live.reduce((sum, p) => sum + (p.amountPaidUSD || 0), 0);

  // Payments with no date at all — reported, never silently re-dated.
  const undated = live.filter((p) => paymentDayOf(p) === null);
  const undatedCount = undated.length;
  const undatedUSD = undated.reduce((sum, p) => sum + (p.amountPaidUSD || 0), 0);

  // 1. Daily
  const dailyMap = new Map<string, {
    count: number;
    totalUSD: number;
    cashUSD: number;
    otherUSD: number;
  }>();

  for (const p of live) {
    const d = paymentDayOf(p);
    if (!d) continue; // no date to bucket by — see `undated` above
    const existing = dailyMap.get(d) || {
      count: 0,
      totalUSD: 0,
      cashUSD: 0,
      otherUSD: 0,
    };
    const pUSD = p.amountPaidUSD || 0;

    existing.count += 1;
    existing.totalUSD += pUSD;

    if (p.paymentMethod === 'Cash_Guichet') {
      existing.cashUSD += pUSD;
    } else {
      existing.otherUSD += pUSD;
    }

    dailyMap.set(d, existing);
  }

  const dailyList: DailyRevenueItem[] = Array.from(dailyMap.entries()).map(([date, val]) => ({
    date,
    transactionCount: val.count,
    totalUSD: val.totalUSD,
    cashUSD: val.cashUSD,
    otherUSD: val.otherUSD,
    percentageOfTotal: totalUSD > 0 ? (val.totalUSD / totalUSD) * 100 : 0,
  }));
  dailyList.sort((a, b) => b.date.localeCompare(a.date));

  // 2. Monthly
  const monthlyMap = new Map<string, { count: number; totalUSD: number }>();
  const monthNamesEn: Record<string, string> = {
    '01': 'January',
    '02': 'February',
    '03': 'March',
    '04': 'April',
    '05': 'May',
    '06': 'June',
    '07': 'July',
    '08': 'August',
    '09': 'September',
    '10': 'October',
    '11': 'November',
    '12': 'December',
  };

  for (const p of live) {
    const d = paymentDayOf(p);
    if (!d) continue; // no date to bucket by — see `undated` above
    const parts = d.split('-');
    const mKey = parts.length >= 2 ? `${parts[0]}-${parts[1]}` : '2026-01';

    const existing = monthlyMap.get(mKey) || { count: 0, totalUSD: 0 };
    const pUSD = p.amountPaidUSD || 0;

    existing.count += 1;
    existing.totalUSD += pUSD;
    monthlyMap.set(mKey, existing);
  }

  const monthlyList: MonthlyRevenueItem[] = Array.from(monthlyMap.entries()).map(([mKey, val]) => {
    const [yearStr, monthStr] = mKey.split('-');
    const monthLabel = `${monthNamesEn[monthStr] || monthStr} ${yearStr}`;
    return {
      monthKey: mKey,
      monthLabel,
      year: parseInt(yearStr, 10) || 2026,
      transactionCount: val.count,
      totalUSD: val.totalUSD,
      averageTransactionUSD: val.count > 0 ? val.totalUSD / val.count : 0,
      percentageOfTotal: totalUSD > 0 ? (val.totalUSD / totalUSD) * 100 : 0,
    };
  });
  monthlyList.sort((a, b) => b.monthKey.localeCompare(a.monthKey));

  // 3. Yearly — bucket on the PAYMENT date like daily/monthly (which use
  // `paymentDayOf`). Keying on fiscalYear put a 2026 payment against a FY-2025
  // assessment into the 2025 yearly bucket while the monthly chart showed 2026
  // — the two charts contradicted each other. Undated receipts remain
  // in the undated bucket rather than inheriting the tax year.
  const yearlyMap = new Map<number, { count: number; totalUSD: number }>();
  for (const p of live) {
    const paymentDay = paymentDayOf(p);
    if (!paymentDay) continue;
    const yr = Number(paymentDay.slice(0, 4));
    if (!Number.isFinite(yr)) continue;
    const existing = yearlyMap.get(yr) || { count: 0, totalUSD: 0 };
    const pUSD = p.amountPaidUSD || 0;
    existing.count += 1;
    existing.totalUSD += pUSD;
    yearlyMap.set(yr, existing);
  }

  const yearlyList: YearlyRevenueItem[] = Array.from(yearlyMap.entries()).map(([year, val]) => ({
    year,
    transactionCount: val.count,
    totalUSD: val.totalUSD,
    percentageOfTotal: totalUSD > 0 ? (val.totalUSD / totalUSD) * 100 : 0,
  }));
  yearlyList.sort((a, b) => b.year - a.year);

  return {
    totalRevenueUSD: totalUSD,
    totalTransactions: live.length,
    daily: dailyList,
    monthly: monthlyList,
    yearly: yearlyList,
    // Money that is counted in every total above but belongs to no day, so the
    // daily and monthly buckets do not sum to `totalRevenueUSD`. Surfaced so a
    // reconciliation gap is visible instead of looking like a missing receipt.
    undated: { count: undatedCount, totalUSD: undatedUSD },
  };
}

export function computeCommuneRevenue(
  payments: Payment[],
  businesses: Business[],
  assessments: Assessment[]
): CommuneRevenueItem[] {
  const live = excludeVoidedPayments(payments);
  // Map business to commune & quartier
  const bizInfoMap = new Map<string, { commune: string; quartier: string }>();
  for (const b of businesses) {
    bizInfoMap.set(b.id, {
      commune: communeOf(b.commune),
      quartier: b.quartier || 'Unattributed',
    });
  }

  // Also build from assessments if businessId matches
  for (const a of assessments) {
    const id = a.businessId || a.taxpayerId;
    if (id && !bizInfoMap.has(id)) {
      bizInfoMap.set(id, {
        commune: communeOf(a.commune),
        quartier: a.quartier || 'Unattributed',
      });
    }
  }

  const totalUSD = live.reduce((sum, p) => sum + (p.amountPaidUSD || 0), 0);

  const communeMap = new Map<string, {
    totalUSD: number;
    txCount: number;
    quartiers: Map<string, { totalUSD: number; bizIds: Set<string> }>;
    bizIds: Set<string>;
  }>();

  // Initialize both official communes of Goma City
  for (const c of new Set(['Goma', 'Karisimbi', ...businesses.map((b) => communeOf(b.commune))])) {
    communeMap.set(c, {
      totalUSD: 0,
      txCount: 0,
      quartiers: new Map(),
      bizIds: new Set(),
    });
  }

  // Count businesses in each commune
  for (const b of businesses) {
    const cName = communeOf(b.commune);
    const cData = communeMap.get(cName)!;
    cData.bizIds.add(b.id);

    const qName = b.quartier || 'Unattributed';
    if (!cData.quartiers.has(qName)) {
      cData.quartiers.set(qName, { totalUSD: 0, bizIds: new Set() });
    }
    cData.quartiers.get(qName)!.bizIds.add(b.id);
  }

  // Process payments
  for (const p of live) {
    const bId = p.businessId || p.taxpayerId || '';
    const info = bizInfoMap.get(bId);
    // Payments whose business/taxpayer cannot be resolved used to be booked to
    // Goma by default, inflating Goma's share and deflating Karisimbi's. Bucket
    // them honestly under "Unattributed" instead.
    const cName = info ? communeOf(info.commune) : 'Unattributed';
    const qName = info?.quartier || 'Unattributed';

    let cData = communeMap.get(cName);
    if (!cData) {
      cData = {
        totalUSD: 0,
        txCount: 0,
        quartiers: new Map(),
        bizIds: new Set(),
      };
      communeMap.set(cName, cData);
    }

    const pUSD = p.amountPaidUSD || 0;

    cData.totalUSD += pUSD;
    cData.txCount += 1;
    if (bId) cData.bizIds.add(bId);

    if (!cData.quartiers.has(qName)) {
      cData.quartiers.set(qName, { totalUSD: 0, bizIds: new Set() });
    }
    const qData = cData.quartiers.get(qName)!;
    qData.totalUSD += pUSD;
    if (bId) qData.bizIds.add(bId);
  }

  const result: CommuneRevenueItem[] = Array.from(communeMap.entries()).map(([commune, data]) => {
    const quartierList = Array.from(data.quartiers.entries()).map(([quartier, q]) => ({
      quartier,
      totalUSD: q.totalUSD,
      businessCount: q.bizIds.size,
    }));
    quartierList.sort((a, b) => b.totalUSD - a.totalUSD);

    return {
      commune,
      totalUSD: data.totalUSD,
      transactionCount: data.txCount,
      businessCount: data.bizIds.size,
      percentageOfTotal: totalUSD > 0 ? (data.totalUSD / totalUSD) * 100 : 0,
      quartiers: quartierList,
    };
  });

  result.sort((a, b) => b.totalUSD - a.totalUSD);
  return result;
}

export function computeSectorRevenue(
  payments: Payment[],
  businesses: Business[],
  assessments: Assessment[]
): SectorRevenueItem[] {
  const live = excludeVoidedPayments(payments);
  const bizSectorMap = new Map<string, BusinessSector>();
  for (const b of businesses) {
    bizSectorMap.set(b.id, b.activitySector ? normalizeSector(b.activitySector) : 'Other');
  }

  for (const a of assessments) {
    if (a.businessId && a.activitySector && !bizSectorMap.has(a.businessId)) {
      bizSectorMap.set(a.businessId, a.activitySector);
    }
  }

  // Denominator must match the numerators (both exclude voided receipts) —
  // using the raw array made every share percentage understated and the rows
  // no longer sum to 100%.
  const totalRevenueUSD = live.reduce((sum, p) => sum + (p.amountPaidUSD || 0), 0);

  const sectorMap = new Map<BusinessSector, {
    totalAssessedUSD: number;
    totalCollectedUSD: number;
    businessIds: Set<string>;
    paymentCount: number;
  }>();

  const allSectors: BusinessSector[] = ['Commerce', 'Food Service', 'Services', 'Crafts', 'Industry', 'Other'];
  for (const s of allSectors) {
    sectorMap.set(s, {
      totalAssessedUSD: 0,
      totalCollectedUSD: 0,
      businessIds: new Set(),
      paymentCount: 0,
    });
  }

  // Count businesses per sector
  for (const b of businesses) {
    const normalized = b.activitySector ? normalizeSector(b.activitySector) : 'Other';
    const s = sectorMap.has(normalized) ? normalized : 'Other';
    if (sectorMap.has(s)) {
      sectorMap.get(s)!.businessIds.add(b.id);
    }
  }

  // Assessments billed per sector
  for (const a of assessments) {
    if (!isIssuedAssessment(a)) continue;
    const rawSector = a.activitySector || bizSectorMap.get(a.businessId || a.taxpayerId || '');
    const normalized = rawSector ? normalizeSector(rawSector) : 'Other';
    const s = sectorMap.has(normalized) ? normalized : 'Other';
    if (sectorMap.has(s)) {
      sectorMap.get(s)!.totalAssessedUSD += (a.amountDueUSD || 0);
      if (a.businessId) sectorMap.get(s)!.businessIds.add(a.businessId);
    }
  }

  // Payments collected per sector
  for (const p of live) {
    const bId = p.businessId || p.taxpayerId || '';
    const s = bizSectorMap.get(bId) || 'Other';
    const pUSD = p.amountPaidUSD || 0;

    const data = sectorMap.get(s) || sectorMap.get('Other')!;
    data.totalCollectedUSD += pUSD;
    data.paymentCount += 1;
    if (bId) data.businessIds.add(bId);
  }

  const result: SectorRevenueItem[] = Array.from(sectorMap.entries()).map(([sector, data]) => {
    const recoveryRate = data.totalAssessedUSD > 0
      ? (data.totalCollectedUSD / data.totalAssessedUSD) * 100
      : null;

    return {
      sector,
      sectorLabel: SECTOR_LABELS[sector] || sector,
      totalAssessedUSD: data.totalAssessedUSD,
      totalCollectedUSD: data.totalCollectedUSD,
      businessCount: data.businessIds.size,
      paymentCount: data.paymentCount,
      recoveryRatePercent: recoveryRate,
      percentageOfTotalRevenue: totalRevenueUSD > 0 ? (data.totalCollectedUSD / totalRevenueUSD) * 100 : 0,
    };
  });

  result.sort((a, b) => b.totalCollectedUSD - a.totalCollectedUSD);
  return result;
}

export interface TaxTypeRevenueItem {
  taxTypeCode: string;
  label: string;
  ratePercent?: number;
  totalAssessedUSD: number;
  totalCollectedUSD: number;
  noticeCount: number;
  paymentCount: number;
  recoveryRatePercent: number | null;
  percentageOfTotalRevenue: number;
}

/**
 * Revenue grouped by head of tax.
 *
 * Records are bucketed by the `taxTypeCode` they carry. A record with none
 * predates tax types and is the Business License Tax — which is what the whole
 * roll was before — so it is counted as PATENTE rather than dropped, and the
 * rows always sum to the full collected total.
 *
 * A payment inherits its notice's head of tax, because receipts issued before
 * the field existed still belong to the tax their notice was raised under.
 */
export function computeTaxTypeRevenue(
  payments: Payment[],
  assessments: Assessment[]
): TaxTypeRevenueItem[] {
  const live = excludeVoidedPayments(payments);
  const taxCodeOf = (code?: string) => (code && code.trim()) || 'PATENTE';

  const labelFor = (code: string, ratePercent?: number) =>
    REPORT_TAX_LABELS[code]
      ? REPORT_TAX_LABELS[code]
      : code === 'PATENTE'
      ? 'Patente (Business License Tax)'
      : ratePercent
        ? `${code} — ${ratePercent}% declaration`
        : `${code} declaration`;

  const taxByAssessment = new Map<string, { code: string; ratePercent?: number }>();
  for (const a of assessments) {
    taxByAssessment.set(a.id, {
      code: taxCodeOf(a.taxTypeCode),
      ratePercent: a.taxRatePercent,
    });
  }

  const buckets = new Map<
    string,
    {
      label: string;
      ratePercent?: number;
      totalAssessedUSD: number;
      totalCollectedUSD: number;
      noticeCount: number;
      paymentCount: number;
    }
  >();

  const ensure = (code: string, ratePercent?: number) => {
    let bucket = buckets.get(code);
    if (!bucket) {
      bucket = {
        label: labelFor(code, ratePercent),
        ratePercent,
        totalAssessedUSD: 0,
        totalCollectedUSD: 0,
        noticeCount: 0,
        paymentCount: 0,
      };
      buckets.set(code, bucket);
    }
    return bucket;
  };

  for (const a of assessments) {
    if (!isIssuedAssessment(a)) continue;
    const bucket = ensure(taxCodeOf(a.taxTypeCode), a.taxRatePercent);
    bucket.totalAssessedUSD += a.amountDueUSD || 0;
    bucket.noticeCount += 1;
  }

  // Denominator matches the numerators: both exclude voided receipts.
  const totalRevenueUSD = live.reduce((sum, p) => sum + (p.amountPaidUSD || 0), 0);

  for (const p of live) {
    const fromNotice = p.assessmentId ? taxByAssessment.get(p.assessmentId) : undefined;
    const bucket = ensure(
      taxCodeOf(p.taxTypeCode || fromNotice?.code),
      p.taxRatePercent ?? fromNotice?.ratePercent
    );
    const usd = p.amountPaidUSD || 0;
    bucket.totalCollectedUSD += usd;
    bucket.paymentCount += 1;
  }

  return Array.from(buckets.entries())
    .map(([taxTypeCode, b]) => ({
      taxTypeCode,
      label: b.label,
      ratePercent: b.ratePercent,
      totalAssessedUSD: b.totalAssessedUSD,
      totalCollectedUSD: b.totalCollectedUSD,
      noticeCount: b.noticeCount,
      paymentCount: b.paymentCount,
      recoveryRatePercent:
        b.totalAssessedUSD > 0
          ? Math.round((b.totalCollectedUSD / b.totalAssessedUSD) * 1000) / 10
          : null,
      percentageOfTotalRevenue:
        totalRevenueUSD > 0
          ? Math.round((b.totalCollectedUSD / totalRevenueUSD) * 1000) / 10
          : 0,
    }))
    .sort(
      (a, b) =>
        b.totalCollectedUSD - a.totalCollectedUSD ||
        a.taxTypeCode.localeCompare(b.taxTypeCode)
    );
}

export function exportTaxTypeRevenueCSV(rows: TaxTypeRevenueItem[]) {
  const header = [
    'Head of Tax',
    'Code',
    'Rate %',
    'Notices',
    'Payments',
    'Assessed (USD)',
    'Collected (USD)',
    'Recovery Rate %',
    'Share of Revenue %',
  ];
  const escape = csvCell;
  const lines = [header.map(escape).join(',')];
  rows.forEach((r) => {
    lines.push(
      [
        r.label,
        r.taxTypeCode,
        r.ratePercent ?? '',
        r.noticeCount,
        r.paymentCount,
        r.totalAssessedUSD.toFixed(2),
        r.totalCollectedUSD.toFixed(2),
        r.recoveryRatePercent,
        r.percentageOfTotalRevenue,
      ]
        .map(escape)
        .join(',')
    );
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `revenue-by-head-of-tax-${todayDateString()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function computeComplianceSummary(
  businesses: Business[],
  assessments: Assessment[]
): ComplianceSummary {
  const totalBusinesses = businesses.length;
  const deregistered = businesses.filter((b) => normalizeBusinessStatus(b.status) === 'Closure Pending').length;
  const inactive = businesses.filter((b) => normalizeBusinessStatus(b.status) === 'Inactive').length;
  const active = businesses.filter((b) => normalizeBusinessStatus(b.status) === 'Active');

  const today = todayDateString();

  // Identify businesses with overdue assessments
  const overdueMap = new Map<string, { count: number; overdueUSD: number; oldestDue: string; maxDays: number }>();

  for (const a of assessments) {
    if (!isIssuedAssessment(a) || normalizeAssessmentStatus(a.status) === 'Paid') continue;
    const bId = a.businessId || a.taxpayerId;
    if (!bId) continue;

    const remaining = typeof a.remainingBalanceUSD === 'number'
      ? a.remainingBalanceUSD
      : Math.max(0, (a.amountDueUSD || 0) - (a.amountPaidUSD || 0));

    if (remaining <= 0.001) continue;

    const isExplicitlyOverdue = a.status === 'Overdue' || (a.status as any) === 'en retard';
    const isOverdueByDate = Boolean(a.dueDate && a.dueDate < today);

    if (isExplicitlyOverdue || isOverdueByDate) {
      const existing = overdueMap.get(bId) || { count: 0, overdueUSD: 0, oldestDue: a.dueDate || today, maxDays: 0 };
      existing.count += 1;
      existing.overdueUSD += remaining;

      if (a.dueDate) {
        if (!existing.oldestDue || a.dueDate < existing.oldestDue) {
          existing.oldestDue = a.dueDate;
        }
        // Calendar-day difference via the shared helper. new Date('YYYY-MM-DD')
        // parses as UTC midnight, so between 00:00 and 02:00 local (UTC+2) this
        // read a day short.
        const diffDays = Math.max(0, daysBetweenDates(a.dueDate, today));
        if (diffDays > existing.maxDays) {
          existing.maxDays = diffDays;
        }
      }
      overdueMap.set(bId, existing);
    }
  }

  // Also flag businesses that are already marked 'Closure Pending'. They are
  // non-compliant, but with no overdue assessments in the ledger they carry no
  // quantified debt — report zeros rather than invented figures.
  for (const b of businesses) {
    if (normalizeBusinessStatus(b.status) === 'Closure Pending' && !overdueMap.has(b.id)) {
      overdueMap.set(b.id, {
        count: 1,
        overdueUSD: 0,
        oldestDue: today,
        maxDays: 0,
      });
    }
  }

  const delinquentBizIds = new Set(overdueMap.keys());
  const delinquentCount = delinquentBizIds.size;
  const upToDateCount = Math.max(0, active.length - businesses.filter((b) => (normalizeBusinessStatus(b.status) === 'Active') && delinquentBizIds.has(b.id)).length);

  let totalDebtUSD = 0;
  for (const v of overdueMap.values()) {
    totalDebtUSD += v.overdueUSD;
  }

  const complianceRate = active.length > 0 ? (upToDateCount / active.length) * 100 : null;

  // By commune
  const communes = [...new Set(['Goma', 'Karisimbi', ...businesses.map((b) => communeOf(b.commune))])];
  const byCommune = communes.map((commune) => {
    const commBiz = businesses.filter((b) => communeOf(b.commune) === commune);
    const commActive = commBiz.filter((b) => normalizeBusinessStatus(b.status) === 'Active').length;
    const commDelinquent = commBiz.filter((b) => delinquentBizIds.has(b.id)).length;
    const commDereg = commBiz.filter((b) => normalizeBusinessStatus(b.status) === 'Closure Pending').length;
    const activeDelinquent = commBiz.filter((b) => normalizeBusinessStatus(b.status) === 'Active' && delinquentBizIds.has(b.id)).length;
    const commRate = commActive > 0 ? ((commActive - activeDelinquent) / commActive) * 100 : null;

    return {
      commune,
      total: commBiz.length,
      active: commActive,
      delinquent: commDelinquent,
      deregistered: commDereg,
      complianceRate: commRate,
    };
  });

  // By size class
  const sizes: BusinessSizeClass[] = ['Small', 'Medium', 'Large'];
  const sizeLabels: Record<BusinessSizeClass, string> = {
    Small: 'Small Businesses (Class 3)',
    Medium: 'Medium Businesses (Class 2)',
    Large: 'Large Businesses (Class 1)',
  };

  const bySizeClass = sizes.map((sizeClass) => {
    const sizeBiz = businesses.filter((b) => b.sizeClass && normalizeSizeClass(b.sizeClass) === sizeClass);
    const sizeActive = sizeBiz.filter((b) => normalizeBusinessStatus(b.status) === 'Active').length;
    const sizeDelinquent = sizeBiz.filter((b) => delinquentBizIds.has(b.id)).length;
    const activeDelinquent = sizeBiz.filter((b) => normalizeBusinessStatus(b.status) === 'Active' && delinquentBizIds.has(b.id)).length;
    const sizeRate = sizeActive > 0 ? ((sizeActive - activeDelinquent) / sizeActive) * 100 : null;

    return {
      sizeClass,
      sizeLabel: sizeLabels[sizeClass],
      total: sizeBiz.length,
      active: sizeActive,
      delinquent: sizeDelinquent,
      complianceRate: sizeRate,
    };
  });

  // Delinquent detailed items
  const delinquentDetails = Array.from(delinquentBizIds).map((bId) => {
    const b = businesses.find((biz) => biz.id === bId);
    const o = overdueMap.get(bId)!;
    return {
      businessId: bId,
      businessName: b?.businessName || bId,
      ownerFullName: b?.ownerFullName || 'Not specified',
      commune: communeOf(b?.commune),
      quartier: b?.quartier || 'Unattributed',
      maxDaysOverdue: o.maxDays ?? 0,
      totalDebtUSD: o.overdueUSD,
      status: b?.status ? (normalizeBusinessStatus(b.status) === 'Closure Pending' ? 'Closure Pending' : b.status) : 'Active',
    };
  });
  delinquentDetails.sort((a, b) => b.totalDebtUSD - a.totalDebtUSD);

  return {
    totalBusinesses,
    activeBusinesses: active.length,
    upToDateBusinesses: upToDateCount,
    delinquentBusinesses: delinquentCount,
    deregisteredBusinesses: deregistered,
    inactiveBusinesses: inactive,
    complianceRatePercent: complianceRate,
    totalOverdueUSD: totalDebtUSD,
    byCommune,
    bySizeClass,
    delinquentDetails,
  };
}

export function computeCashierReconciliation(payments: Payment[]): CashierDailyShiftItem[] {
  const live = excludeVoidedPayments(payments);
  const shiftMap = new Map<string, {
    date: string;
    cashierId: string;
    cashierName: string;
    payments: Payment[];
    cashUSD: number;
    otherUSD: number;
    totalUSD: number;
  }>();

  for (const p of live) {
    // No date at all: the shift is keyed by cashier and day, so such a payment
    // used to be filed under a fabricated 2026-01-01 — a shift that never
    // happened, on a day the cashier did not work. Undated receipts cannot be
    // attributed to a shift, so they are skipped here and surfaced by
    // `computePeriodRevenue().undated`.
    const dateStr = paymentDayOf(p);
    if (!dateStr) continue;
    const cId = p.cashierId || p.receivedBy || 'unattributed';
    const cName = p.cashierName || p.receivedByName || 'Unattributed';
    const key = `${cId}_${dateStr}`;

    const existing = shiftMap.get(key) || {
      date: dateStr,
      cashierId: cId,
      cashierName: cName,
      payments: [],
      cashUSD: 0,
      otherUSD: 0,
      totalUSD: 0,
    };

    const pUSD = p.amountPaidUSD || 0;

    existing.payments.push(p);
    existing.totalUSD += pUSD;

    if (p.paymentMethod === 'Cash_Guichet') {
      existing.cashUSD += pUSD;
    } else {
      existing.otherUSD += pUSD;
    }

    shiftMap.set(key, existing);
  }

  const list: CashierDailyShiftItem[] = Array.from(shiftMap.entries()).map(([key, val]) => {
    // Sort shift payments by sequence number or date
    val.payments.sort((a, b) => (a.sequenceNumber || 0) - (b.sequenceNumber || 0));
    const firstReceipt = val.payments[0]?.receiptNumber || 'N/A';
    const lastReceipt = val.payments[val.payments.length - 1]?.receiptNumber || firstReceipt;

    return {
      key,
      date: val.date,
      cashierId: val.cashierId,
      cashierName: val.cashierName,
      transactionCount: val.payments.length,
      firstReceiptNumber: firstReceipt,
      lastReceiptNumber: lastReceipt,
      totalCashUSD: val.cashUSD,
      totalOtherUSD: val.otherUSD,
      grandTotalUSD: val.totalUSD,
      isReconciled: false,
      reconciledAt: undefined,
      payments: val.payments,
    };
  });

  list.sort((a, b) => b.date.localeCompare(a.date));
  return list;
}

// ==========================================
// CSV EXPORT UTILITIES (SUPPORT ALL REPORTS)
// ==========================================

/** One `;`-delimited CSV row (Excel-fr friendly), formula-injection safe. */
const csvRow = (cells: unknown[]) => cells.map(csvCell).join(';');

function downloadCsvFile(csvContent: string, filename: string) {
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportPeriodRevenueCSV(
  periodType: 'daily' | 'monthly' | 'yearly',
  data: { daily: DailyRevenueItem[]; monthly: MonthlyRevenueItem[]; yearly: YearlyRevenueItem[] }
) {
  const dateStr = todayDateString();

  if (periodType === 'daily') {
    const headers = [
      'Collection_Date',
      'Receipt_Count',
      'Total_Revenue_USD($)',
      'Cash_USD($)',
      'Other_Methods_USD($)',
      'Share_Percentage'
    ];
    const rows = data.daily.map((d) => csvRow([
      d.date,
      d.transactionCount,
      d.totalUSD.toFixed(2),
      d.cashUSD.toFixed(2),
      d.otherUSD.toFixed(2),
      `${d.percentageOfTotal.toFixed(2)}%`
    ]));
    downloadCsvFile([headers.join(';'), ...rows].join('\r\n'), `daily_revenue_report_goma_${dateStr}.csv`);
  } else if (periodType === 'monthly') {
    const headers = [
      'Month_Key',
      'Month_Label',
      'Year',
      'Receipt_Count',
      'Total_Revenue_USD($)',
      'Average_Per_Receipt_USD($)',
      'Share_Percentage'
    ];
    const rows = data.monthly.map((m) => csvRow([
      m.monthKey,
      m.monthLabel,
      m.year,
      m.transactionCount,
      m.totalUSD.toFixed(2),
      m.averageTransactionUSD.toFixed(2),
      `${m.percentageOfTotal.toFixed(2)}%`
    ]));
    downloadCsvFile([headers.join(';'), ...rows].join('\r\n'), `monthly_revenue_report_goma_${dateStr}.csv`);
  } else {
    const headers = [
      'Collection_Year',
      'Receipt_Count',
      'Total_Revenue_USD($)',
      'Share_Percentage'
    ];
    const rows = data.yearly.map((y) => csvRow([
      y.year,
      y.transactionCount,
      y.totalUSD.toFixed(2),
      `${y.percentageOfTotal.toFixed(2)}%`
    ]));
    downloadCsvFile([headers.join(';'), ...rows].join('\r\n'), `annual_revenue_report_goma_${dateStr}.csv`);
  }
}

export function exportCommuneRevenueCSV(communes: CommuneRevenueItem[]) {
  const dateStr = todayDateString();
  const headers = [
    'Commune',
    'Quartier',
    'Total_Revenue_USD($)',
    'Receipt_Count',
    'Business_Count',
    'City_Share_Percentage'
  ];

  const rows: string[] = [];
  for (const c of communes) {
    // Top-level commune row
    rows.push(csvRow([
      c.commune,
      'TOTAL COMMUNE',
      c.totalUSD.toFixed(2),
      c.transactionCount,
      c.businessCount,
      `${c.percentageOfTotal.toFixed(2)}%`
    ]));

    // Quartier breakdowns
    for (const q of c.quartiers) {
      rows.push(csvRow([
        c.commune,
        q.quartier,
        q.totalUSD.toFixed(2),
        '-',
        q.businessCount,
        '-'
      ]));
    }
  }

  downloadCsvFile([headers.join(';'), ...rows].join('\r\n'), `commune_revenue_report_goma_${dateStr}.csv`);
}

export function exportSectorRevenueCSV(sectors: SectorRevenueItem[]) {
  const dateStr = todayDateString();
  const headers = [
    'Sector_Code',
    'Sector_Label',
    'Business_Count',
    'Receipt_Count',
    'Total_Assessed_USD($)',
    'Total_Collected_USD($)',
    'Recovery_Rate_Percentage',
    'Total_Revenue_Share'
  ];

  const rows = sectors.map((s) => csvRow([
    s.sector,
    s.sectorLabel,
    s.businessCount,
    s.paymentCount,
    s.totalAssessedUSD.toFixed(2),
    s.totalCollectedUSD.toFixed(2),
    s.recoveryRatePercent === null ? '' : `${s.recoveryRatePercent.toFixed(2)}%`,
    `${s.percentageOfTotalRevenue.toFixed(2)}%`
  ]));

  downloadCsvFile([headers.join(';'), ...rows].join('\r\n'), `sector_revenue_report_goma_${dateStr}.csv`);
}

export function exportComplianceCSV(compliance: ComplianceSummary) {
  const dateStr = todayDateString();
  const headers = [
    'Business_ID',
    'Business_Name',
    'Owner_Manager_Name',
    'Commune',
    'Quartier',
    'Max_Days_Overdue',
    'Total_Debt_USD($)',
    'Administrative_Status'
  ];

  const rows = compliance.delinquentDetails.map((d) => csvRow([
    d.businessId,
    d.businessName,
    d.ownerFullName,
    d.commune,
    d.quartier,
    d.maxDaysOverdue,
    d.totalDebtUSD.toFixed(2),
    d.status
  ]));

  downloadCsvFile([headers.join(';'), ...rows].join('\r\n'), `delinquent_taxpayers_report_goma_${dateStr}.csv`);
}

export function exportCashierReconciliationCSV(shifts: CashierDailyShiftItem[], filterDate?: string) {
  const dateStr = todayDateString();
  const headers = [
    'Closing_Date',
    'Cashier_ID',
    'Cashier_Name',
    'Issued_Receipts',
    'First_Receipt',
    'Last_Receipt',
    'Total_Cash_USD($)',
    'Other_Methods_USD($)',
    'Grand_Total_USD($)',
    'Reconciliation_Status'
  ];

  const list = filterDate && filterDate !== 'ALL' ? shifts.filter((s) => s.date === filterDate) : shifts;

  const rows = list.map((s) => csvRow([
    s.date,
    s.cashierId,
    s.cashierName,
    s.transactionCount,
    s.firstReceiptNumber,
    s.lastReceiptNumber,
    s.totalCashUSD.toFixed(2),
    s.totalOtherUSD.toFixed(2),
    s.grandTotalUSD.toFixed(2),
    // Never stamp a verification that did not happen: this report is built from
    // payment records only — the physical count/supervisor sign-off lives in the
    // cash-session record. isReconciled is false unless a supervisor verified it.
    s.isReconciled ? 'Reconciled' : 'Recorded (pending physical verification)'
  ]));

  downloadCsvFile([headers.join(';'), ...rows].join('\r\n'), `cashier_reconciliation_report_${dateStr}.csv`);
}
