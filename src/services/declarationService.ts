import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import {
  Assessment,
  Business,
  DeclarationStatus,
  PaymentMethod,
  RevenueDeclaration,
  TaxDeclaration,
  TaxRate,
  UserProfile,
  normalizePatenteCategory,
} from '../types';
import { getNormalizedAssessmentStatus, logAuditEvent } from './dbService';
import { resolveAnnualTariff } from './taxpayerService';
import { amountInFrenchWords, roundMoney } from '../utils/frenchNumber';
import { formatMoney } from '../utils/money';

/**
 * Declarations register.
 *
 * A declaration is the taxpayer's own statement of the activity they are
 * liable for; in this system it is materialised by the Avis d'Imposition
 * raised against them. So the register is *derived*, never stored: folding the
 * assessment ledger onto the taxpayer roll yields, for every contributor, the
 * standing of their declaration for the cycle.
 *
 * Nothing here invents an obligation. A contributor with no notice for the
 * cycle reports `not_declared` and zeroes, never an estimated amount.
 */

/** Human label for each declaration state. */
export const DECLARATION_STATUS_LABELS: Record<DeclarationStatus, string> = {
  not_declared: 'Not Declared',
  declared: 'Declared',
  draft: 'Draft',
  pending_approval: 'Pending Approval',
  assessed: 'Assessed',
  settled: 'Settled',
  overdue: 'Overdue',
  void: 'Void — Re-file',
};

/** Badge variant backing each declaration state. */
export const DECLARATION_STATUS_VARIANT: Record<
  DeclarationStatus,
  'sage' | 'warn' | 'danger' | 'neutral' | 'accent'
> = {
  not_declared: 'neutral',
  declared: 'sage',
  draft: 'warn',
  pending_approval: 'warn',
  assessed: 'accent',
  settled: 'sage',
  overdue: 'danger',
  void: 'danger',
};

/**
 * States in which a declaration is still moving through the office. A
 * contributor in one of these has filed, but the notice is not yet an
 * enforceable obligation.
 */
const IN_REVIEW: DeclarationStatus[] = ['draft', 'pending_approval'];

export interface DeclarationSummary {
  /** Contributors on the roll for the cycle. */
  total: number;
  /** Contributors that have filed a declaration. */
  filed: number;
  notDeclared: number;
  inReview: number;
  assessed: number;
  settled: number;
  overdue: number;
  voided: number;
  /** Share of the roll that has filed, 0-100. */
  filingRate: number;
  assessedUSD: number;
  paidUSD: number;
  outstandingUSD: number;
}

/**
 * Resolve the fiscal cycle the register is about.
 *
 * The cycle follows the most recent year actually present in the assessment
 * ledger, so a register opened in January still shows last year's open
 * notices until the new cycle has one. With no assessments at all it falls
 * back to the current calendar year.
 */
export function resolveFiscalCycle(assessments: Assessment[]): number {
  const years = (assessments || [])
    .map((a) => Number(a.fiscalYear))
    .filter((y) => Number.isFinite(y) && y > 2000);
  if (years.length > 0) return Math.max(...years);
  return new Date().getFullYear();
}

function balanceOf(assessment: Assessment): number {
  if (typeof assessment.remainingBalanceUSD === 'number') {
    return Math.max(0, assessment.remainingBalanceUSD);
  }
  return Math.max(0, (assessment.amountDueUSD || 0) - (assessment.amountPaidUSD || 0));
}

/**
 * Map one assessment to the declaration state it puts the contributor in.
 *
 * The notice workflow is maker-checker: a Draft has not been reviewed, a
 * Pending_Approval is awaiting the second pair of eyes, an Approved notice is
 * an enforceable Avis d'Imposition. A cancelled notice voids the
 * declaration, which has to be filed again.
 */
function statusFor(assessment: Assessment): DeclarationStatus {
  const status = getNormalizedAssessmentStatus(assessment);
  if (status === 'Cancelled') return 'void';
  if (status === 'Draft') return 'draft';
  if (status === 'Pending_Approval') return 'pending_approval';
  if (status === 'Paid') return 'settled';
  if (status === 'Overdue') return 'overdue';
  return 'assessed';
}

/**
 * Build the declarations register for a cycle by folding the assessment
 * ledger onto the taxpayer roll.
 *
 * A contributor can hold several notices in a cycle (prorations, instalments).
 * The register keeps the most advanced one, because that is the declaration
 * the office is currently acting on, and sums the money across all of them.
 *
 * A contributor who filed a revenue return but has no notice yet is reported
 * as `declared`, and the amounts shown are the ones their return yields — the
 * return is the office's only position until a notice is raised.
 */
export function computeDeclarations(
  businesses: Business[],
  assessments: Assessment[],
  rates: TaxRate[] = [],
  filedDeclarations: RevenueDeclaration[] = []
): TaxDeclaration[] {
  const fiscalYear = resolveFiscalCycle(assessments);
  const cycle = (assessments || []).filter(
    (a) => Number(a.fiscalYear) === fiscalYear
  );

  const byBusiness = new Map<string, Assessment[]>();
  cycle.forEach((a) => {
    const key = a.businessId || a.taxpayerId;
    if (!key) return;
    const list = byBusiness.get(key) || [];
    list.push(a);
    byBusiness.set(key, list);
  });

  // The return each contributor filed for the cycle, newest first.
  const returnsByBusiness = new Map<string, RevenueDeclaration[]>();
  (filedDeclarations || []).forEach((d) => {
    if (!d.businessId) return;
    const list = returnsByBusiness.get(d.businessId) || [];
    list.push(d);
    returnsByBusiness.set(d.businessId, list);
  });
  returnsByBusiness.forEach((list) =>
    list.sort(
      (a, b) =>
        new Date(b.declaredAt || 0).getTime() - new Date(a.declaredAt || 0).getTime()
    )
  );

  const rows: TaxDeclaration[] = [];

  (businesses || []).forEach((biz) => {
    const notices = (byBusiness.get(biz.id) || []).slice().sort(
      (a, b) =>
        new Date(b.issueDate || b.createdAt || 0).getTime() -
        new Date(a.issueDate || a.createdAt || 0).getTime()
    );

    const assessedAmountUSD = notices.reduce(
      (sum, a) => sum + (a.amountDueUSD || 0),
      0
    );
    const paidAmountUSD = notices.reduce(
      (sum, a) => sum + (a.amountPaidUSD || 0),
      0
    );
    const balanceUSD = notices.reduce((sum, a) => sum + balanceOf(a), 0);

    // The notice the office is acting on: the live one, else the newest.
    const live = notices.find((a) => getNormalizedAssessmentStatus(a) !== 'Cancelled');
    const primary = live || notices[0];

    // The return the contributor filed, when there is no notice to stand on.
    const filed = (returnsByBusiness.get(biz.id) || [])[0];

    let status: DeclarationStatus = 'not_declared';
    if (primary) {
      // A void notice means the declaration was struck. A live notice in the
      // same cycle overrides it, so the contributor is not asked to re-file.
      const hasLive = notices.some(
        (a) => getNormalizedAssessmentStatus(a) !== 'Cancelled'
      );
      status = hasLive ? statusFor(primary) : 'void';
    } else if (filed) {
      status = 'declared';
    }

    const category = normalizePatenteCategory(biz.patenteCategory);

    // A notice is the office's formal position and outranks the return;
    // without one, the return's own figures are what the contributor owes.
    const useReturn = !primary && !!filed;

    rows.push({
      id: biz.id,
      businessId: biz.id,
      taxpayerName: biz.businessName || biz.ownerFullName || 'Unnamed taxpayer',
      nif: biz.nif || '',
      commune: biz.commune,
      quartier: biz.quartier,
      activitySector: biz.activitySector,
      sizeClass: biz.sizeClass,
      patenteCategory: category,
      status,
      fiscalYear,
      declarationRef: '',
      assessmentId: primary?.id,
      assessmentNumber: primary?.assessmentNumber,
      noticeNumber: primary?.noticeNumber,
      declaredOn: useReturn ? filed?.declaredAt : primary?.issueDate,
      dueDate: primary?.dueDate,
      assessedAmountUSD: roundMoney(
        useReturn ? filed?.taxDueUSD || 0 : assessedAmountUSD
      ),
      paidAmountUSD: roundMoney(
        useReturn ? filed?.withholdingsUSD || 0 : paidAmountUSD
      ),
      balanceUSD: roundMoney(useReturn ? filed?.netPayableUSD || 0 : balanceUSD),
      tariffUSD: resolveAnnualTariff(biz, rates),
      assessedByName: primary?.assessedByName,
      cancellationReason: primary?.cancellationReason,
    });
  });

  // The register is read in a stable order, so the human reference of a
  // declaration follows that order and stays the same between renders.
  rows.sort((a, b) => a.taxpayerName.localeCompare(b.taxpayerName));
  rows.forEach((row, index) => {
    row.declarationRef = `DEC-${fiscalYear}-${String(index + 1).padStart(4, '0')}`;
  });

  return rows;
}

// ============================================================================
// FILING A REVENUE RETURN
// ============================================================================

/** The fields an officer fills in on the declaration slip. */
export interface FileRevenueDeclarationInput {
  business: Business;
  fiscalYear: number;
  /** (1) Gross revenue declared, in USD. */
  grossRevenueUSD: number;
  /** (2) Rate applied to the declared base, in percent. */
  ratePercent: number;
  /** (4) Withholdings already remitted, in USD. */
  withholdingsUSD: number;
  paymentMethod: PaymentMethod;
  notes?: string;
  userProfile: UserProfile;
}

/**
 * Work out the figures of a return.
 *
 * (3) is the tax the declared base yields at the declared rate, and (5) is
 * what is left once the withholdings already remitted are set against it.
 * Both are rounded to the cent, and the amount in words is spelled from the
 * rounded figure, so the printed words always match the printed digits.
 */
export function computeDeclarationFigures(input: {
  grossRevenueUSD: number;
  ratePercent: number;
  withholdingsUSD: number;
}): {
  grossRevenueUSD: number;
  ratePercent: number;
  taxDueUSD: number;
  withholdingsUSD: number;
  netPayableUSD: number;
  netPayableInWords: string;
} {
  const grossRevenueUSD = roundMoney(input.grossRevenueUSD);
  const ratePercent = input.ratePercent;
  const withholdingsUSD = roundMoney(input.withholdingsUSD);

  const taxDueUSD = roundMoney((grossRevenueUSD * ratePercent) / 100);
  const netPayableUSD = roundMoney(taxDueUSD - withholdingsUSD);

  return {
    grossRevenueUSD,
    ratePercent,
    taxDueUSD,
    withholdingsUSD,
    netPayableUSD,
    netPayableInWords: amountInFrenchWords(netPayableUSD),
  };
}

/**
 * Reserve the next declaration number for a cycle.
 *
 * The counter is advanced inside a transaction, so two officers filing at
 * the same moment cannot land on the same reference. A fresh database that
 * has never written the counter is floored against the highest number
 * already present, the same guard the receipt counter uses.
 */
async function reserveDeclarationNumber(fiscalYear: number): Promise<number> {
  let sequenceFloor = 0;
  try {
    const topSnap = await getDocs(
      query(
        collection(db, 'declarations'),
        orderBy('sequenceNumber', 'desc'),
        limit(1)
      )
    );
    const topSeq = topSnap.docs[0]?.data()?.sequenceNumber;
    if (typeof topSeq === 'number' && topSeq > 0) sequenceFloor = topSeq;
  } catch {
    // A missing index or an empty collection just means no floor to apply.
  }

  const counterRef = doc(db, 'counters', 'declarationCounter');
  return runTransaction(db, async (transaction) => {
    const counterDoc = await transaction.get(counterRef);
    let nextSequence = 1;
    if (counterDoc.exists()) {
      const data = counterDoc.data() as { currentSequence?: number };
      nextSequence = (data.currentSequence || 0) + 1;
    }
    if (sequenceFloor > 0) nextSequence = Math.max(nextSequence, sequenceFloor + 1);

    await transaction.set(counterRef, { currentSequence: nextSequence });
    return nextSequence;
  });
}

/**
 * File a revenue return and write it to the declarations ledger.
 *
 * The figures are recomputed here rather than trusted from the caller, so
 * what is stored is always consistent with the declared base and rate.
 */
export async function fileRevenueDeclaration(
  input: FileRevenueDeclarationInput
): Promise<RevenueDeclaration> {
  const path = 'declarations';
  const { userProfile } = input;

  const figures = computeDeclarationFigures({
    grossRevenueUSD: input.grossRevenueUSD,
    ratePercent: input.ratePercent,
    withholdingsUSD: input.withholdingsUSD,
  });

  try {
    const sequence = await reserveDeclarationNumber(input.fiscalYear);
    const declarationNumber = `DEC-${input.fiscalYear}-${String(sequence).padStart(4, '0')}`;
    const id = `dec_${input.fiscalYear}_${String(sequence).padStart(4, '0')}`;

    const declaration: RevenueDeclaration = {
      id,
      declarationNumber,
      fiscalYear: input.fiscalYear,
      businessId: input.business.id,
      taxpayerName:
        input.business.businessName || input.business.ownerFullName || 'Unnamed taxpayer',
      nif: input.business.nif,
      commune: input.business.commune,
      quartier: input.business.quartier,
      grossRevenueUSD: figures.grossRevenueUSD,
      ratePercent: figures.ratePercent,
      taxDueUSD: figures.taxDueUSD,
      withholdingsUSD: figures.withholdingsUSD,
      netPayableUSD: figures.netPayableUSD,
      netPayableInWords: figures.netPayableInWords,
      paymentMethod: input.paymentMethod,
      declaredBy: userProfile.uid,
      declaredByName: userProfile.displayName,
      declaredAt: new Date().toISOString(),
      notes: input.notes?.trim() || undefined,
    };

    await setDoc(doc(db, 'declarations', id), { ...declaration, sequenceNumber: sequence });

    await logAuditEvent(
      userProfile.uid,
      userProfile.displayName,
      userProfile.role,
      'FILE_DECLARATION',
      'RevenueDeclaration',
      id,
      `Filed revenue declaration ${declarationNumber} for ${declaration.taxpayerName}: gross ${formatMoney(figures.grossRevenueUSD)} at ${figures.ratePercent}% → tax ${formatMoney(figures.taxDueUSD)}, withholdings ${formatMoney(figures.withholdingsUSD)}, net ${formatMoney(figures.netPayableUSD)}`
    );

    return declaration;
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
    throw err;
  }
}

/** Real-time listener over the declarations ledger. */
export function subscribeToRevenueDeclarations(
  onData: (declarations: RevenueDeclaration[]) => void,
  onError?: (err: any) => void
): Unsubscribe {
  return onSnapshot(
    collection(db, 'declarations'),
    (snapshot) => {
      const list = snapshot.docs.map((d) => d.data() as RevenueDeclaration);
      list.sort(
        (a, b) =>
          new Date(b.declaredAt || 0).getTime() - new Date(a.declaredAt || 0).getTime()
      );
      onData(list);
    },
    (err) => {
      console.warn('[DeclarationService] Declaration listener error:', err);
      onError?.(err);
    }
  );
}

/** One-shot read of the declarations ledger. */
export async function getRevenueDeclarations(): Promise<RevenueDeclaration[]> {
  const path = 'declarations';
  try {
    const snapshot = await getDocs(collection(db, 'declarations'));
    return snapshot.docs.map((d) => d.data() as RevenueDeclaration);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
    return [];
  }
}

/** Aggregate the register into the headline figures shown above the table. */
export function summarizeDeclarations(rows: TaxDeclaration[]): DeclarationSummary {
  const summary: DeclarationSummary = {
    total: rows.length,
    filed: 0,
    notDeclared: 0,
    inReview: 0,
    assessed: 0,
    settled: 0,
    overdue: 0,
    voided: 0,
    filingRate: 0,
    assessedUSD: 0,
    paidUSD: 0,
    outstandingUSD: 0,
  };

  rows.forEach((row) => {
    if (row.status === 'not_declared') summary.notDeclared += 1;
    else summary.filed += 1;

    if (IN_REVIEW.includes(row.status)) summary.inReview += 1;
    if (row.status === 'assessed') summary.assessed += 1;
    if (row.status === 'settled') summary.settled += 1;
    if (row.status === 'overdue') summary.overdue += 1;
    if (row.status === 'void') summary.voided += 1;

    summary.assessedUSD += row.assessedAmountUSD;
    summary.paidUSD += row.paidAmountUSD;
    summary.outstandingUSD += row.balanceUSD;
  });

  const round = (n: number) => Math.round(n * 100) / 100;
  summary.assessedUSD = round(summary.assessedUSD);
  summary.paidUSD = round(summary.paidUSD);
  summary.outstandingUSD = round(summary.outstandingUSD);
  summary.filingRate =
    summary.total > 0 ? Math.round((summary.filed / summary.total) * 100) : 0;

  return summary;
}
