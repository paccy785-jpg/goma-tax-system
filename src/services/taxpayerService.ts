import { Business, Assessment, Payment, TaxpayerComplianceState, TaxRate, normalizeBusinessStatus } from '../types';
import { getNormalizedAssessmentStatus } from './dbService';
import { todayDateString, daysBetweenDates } from '../utils/date';

/**
 * Derived fiscal position of a registered contributor.
 *
 * Every monetary figure here is read off the assessment ledger — nothing is
 * estimated. A taxpayer with no issued assessment reports zeros and an
 * `unassessed` state rather than an invented obligation.
 */
export interface TaxpayerFiscalProfile {
  businessId: string;
  state: TaxpayerComplianceState;

  /** Assessments issued for the current fiscal cycle (non-cancelled). */
  assessmentCount: number;
  assessedUSD: number;

  /** Cash actually received against those assessments. */
  paidUSD: number;

  /** assessedUSD - paidUSD, floored at zero. */
  outstandingUSD: number;

  /** Unpaid assessments whose due date has passed. */
  overdueCount: number;
  overdueUSD: number;
  maxDaysOverdue: number;
  oldestDueDate?: string;

  /** Published annual tariff for this sector + size combination. */
  annualTariffUSD: number;

  /** Share of the assessed amount settled, 0-100. */
  settlementRate: number;

  lastPaymentDate?: string;
  latestAssessment?: Assessment;
  assessments: Assessment[];
  payments: Payment[];
}

export interface FiscalRollSummary {
  total: number;
  compliant: number;
  outstanding: number;
  overdue: number;
  suspended: number;
  closure: number;
  unassessed: number;
  assessedUSD: number;
  paidUSD: number;
  outstandingUSD: number;
  overdueUSD: number;
  /** Compliance rate over taxpayers that carry an issued assessment. */
  complianceRate: number;
}

export const COMPLIANCE_STATE_LABELS: Record<TaxpayerComplianceState, string> = {
  compliant: 'In Good Standing',
  outstanding: 'Balance Outstanding',
  overdue: 'Overdue',
  suspended: 'Suspended',
  closure: 'Closure Pending',
  unassessed: 'Not Assessed',
};

function balanceOf(assessment: Assessment): number {
  if (typeof assessment.remainingBalanceUSD === 'number') {
    return Math.max(0, assessment.remainingBalanceUSD);
  }
  return Math.max(0, (assessment.amountDueUSD || 0) - (assessment.amountPaidUSD || 0));
}

function isCancelled(assessment: Assessment): boolean {
  return getNormalizedAssessmentStatus(assessment) === 'Cancelled';
}

/**
 * Resolve the published annual patente tariff for a business from the active
 * rate schedule, falling back to the sector+size default schedule.
 */
export function resolveAnnualTariff(business: Business, rates: TaxRate[]): number {
  const match = (rates || []).find(
    (r) => r.activitySector === business.activitySector && r.sizeClass === business.sizeClass
  );
  return match ? match.annualFeeUSD : 0;
}

/**
 * Build the fiscal profile of every registered taxpayer by folding the
 * assessment and payment ledgers onto the registry.
 */
export function computeTaxpayerFiscalProfiles(
  businesses: Business[],
  assessments: Assessment[],
  payments: Payment[],
  rates: TaxRate[] = []
): Map<string, TaxpayerFiscalProfile> {
  const today = todayDateString();

  const assessmentsByBiz = new Map<string, Assessment[]>();
  (assessments || []).forEach((a) => {
    const key = a.businessId || a.taxpayerId;
    if (!key) return;
    const list = assessmentsByBiz.get(key) || [];
    list.push(a);
    assessmentsByBiz.set(key, list);
  });

  const paymentsByBiz = new Map<string, Payment[]>();
  (payments || []).forEach((p) => {
    const key = p.businessId || p.taxpayerId;
    if (!key) return;
    const list = paymentsByBiz.get(key) || [];
    list.push(p);
    paymentsByBiz.set(key, list);
  });

  const profiles = new Map<string, TaxpayerFiscalProfile>();

  (businesses || []).forEach((biz) => {
    // Only issued, non-cancelled notices count toward the fiscal position: a
    // Draft is not yet an obligation and a Cancelled notice is void.
    const live = (assessmentsByBiz.get(biz.id) || []).filter((a) => !isCancelled(a));
    const sorted = [...live].sort(
      (a, b) =>
        new Date(b.issueDate || b.createdAt || 0).getTime() - new Date(a.issueDate || a.createdAt || 0).getTime()
    );

    const bizPayments = (paymentsByBiz.get(biz.id) || [])
      .slice()
      .sort((a, b) => new Date(b.paidAt || 0).getTime() - new Date(a.paidAt || 0).getTime());

    let assessedUSD = 0;
    let paidUSD = 0;
    let outstandingUSD = 0;
    let overdueCount = 0;
    let overdueUSD = 0;
    let maxDaysOverdue = 0;
    let oldestDueDate: string | undefined;

    sorted.forEach((a) => {
      assessedUSD += a.amountDueUSD || 0;
      paidUSD += a.amountPaidUSD || 0;

      const balance = balanceOf(a);
      outstandingUSD += balance;

      if (balance > 0 && getNormalizedAssessmentStatus(a) === 'Overdue') {
        overdueCount += 1;
        overdueUSD += balance;
        if (a.dueDate) {
          if (!oldestDueDate || a.dueDate < oldestDueDate) oldestDueDate = a.dueDate;
          const days = Math.max(0, daysBetweenDates(a.dueDate, today));
          if (days > maxDaysOverdue) maxDaysOverdue = days;
        }
      }
    });

    const adminStatus = normalizeBusinessStatus(biz.status);
    let state: TaxpayerComplianceState;
    if (adminStatus === 'Closure Pending') {
      state = 'closure';
    } else if (adminStatus === 'Inactive') {
      state = 'suspended';
    } else if (overdueCount > 0) {
      state = 'overdue';
    } else if (sorted.length === 0) {
      state = 'unassessed';
    } else if (outstandingUSD > 0) {
      state = 'outstanding';
    } else {
      state = 'compliant';
    }

    profiles.set(biz.id, {
      businessId: biz.id,
      state,
      assessmentCount: sorted.length,
      assessedUSD: Math.round(assessedUSD * 100) / 100,
      paidUSD: Math.round(paidUSD * 100) / 100,
      outstandingUSD: Math.round(outstandingUSD * 100) / 100,
      overdueCount,
      overdueUSD: Math.round(overdueUSD * 100) / 100,
      maxDaysOverdue,
      oldestDueDate,
      annualTariffUSD: resolveAnnualTariff(biz, rates),
      settlementRate: assessedUSD > 0 ? Math.min(100, Math.round((paidUSD / assessedUSD) * 100)) : 0,
      lastPaymentDate: bizPayments[0]?.paymentDate || (bizPayments[0]?.paidAt ? bizPayments[0].paidAt.slice(0, 10) : undefined),
      latestAssessment: sorted[0],
      assessments: sorted,
      payments: bizPayments,
    });
  });

  return profiles;
}

/** Aggregate the fiscal roll into headline registry figures. */
export function summarizeFiscalRoll(
  businesses: Business[],
  profiles: Map<string, TaxpayerFiscalProfile>
): FiscalRollSummary {
  const summary: FiscalRollSummary = {
    total: businesses.length,
    compliant: 0,
    outstanding: 0,
    overdue: 0,
    suspended: 0,
    closure: 0,
    unassessed: 0,
    assessedUSD: 0,
    paidUSD: 0,
    outstandingUSD: 0,
    overdueUSD: 0,
    complianceRate: 0,
  };

  businesses.forEach((biz) => {
    const profile = profiles.get(biz.id);
    summary[profile?.state || 'unassessed'] += 1;
    if (!profile) return;
    summary.assessedUSD += profile.assessedUSD;
    summary.paidUSD += profile.paidUSD;
    summary.outstandingUSD += profile.outstandingUSD;
    summary.overdueUSD += profile.overdueUSD;
  });

  const round = (n: number) => Math.round(n * 100) / 100;
  summary.assessedUSD = round(summary.assessedUSD);
  summary.paidUSD = round(summary.paidUSD);
  summary.outstandingUSD = round(summary.outstandingUSD);
  summary.overdueUSD = round(summary.overdueUSD);
  summary.complianceRate =
    summary.total > 0 ? Math.round((summary.compliant / summary.total) * 100) : 0;

  return summary;
}
