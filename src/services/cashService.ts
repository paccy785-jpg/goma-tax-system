import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  query, 
  where,
  orderBy,
  limit,
  runTransaction,
  onSnapshot,
  type Unsubscribe 
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import { emitGlobalToast } from '../contexts/ToastContext';
import { 
  CashSession, 
  CashSessionStatus, 
  CashCustodyStatus, 
  TreasuryDeposit, 
  Payment, 
  UserProfile, 
  UserRole 
} from '../types';
import { todayDateString } from '../utils/date';
import { logAuditEvent } from './dbService';
import { intentId } from './idempotency';
import { formatMoney } from '../utils/money';
import { roundMoney } from '../utils/frenchNumber';
import { requireMoney } from '../utils/paymentAmounts';
import { describeCashVariance, hasCashVariance } from '../utils/cashVariance';

const CASH_SESSIONS_COLLECTION = 'cashSessions';
const TREASURY_DEPOSITS_COLLECTION = 'treasuryDeposits';

/**
 * Fetch all cash sessions from Firestore.
 * Firestore is the only store: an empty collection is an empty list and a
 * failed read is surfaced instead of being answered with a local copy.
 */
export async function getCashSessions(): Promise<CashSession[]> {
  try {
    const q = query(collection(db, CASH_SESSIONS_COLLECTION), orderBy('openedAt', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => d.data() as CashSession);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, CASH_SESSIONS_COLLECTION);
    return [];
  }
}

/**
 * Active-aware real-time listener for Cash Sessions.
 *
 * Ordered by `openedAt` descending before the bound is applied. Without the
 * orderBy, `limit(n)` returned an arbitrary n documents, so the reconciliation
 * and treasury totals computed over this feed silently dropped shifts as soon
 * as the collection grew past the bound — the newest shift could be missing
 * from "total collected". Newest-first means a bound now only ever trims the
 * oldest history, never the current shift.
 */
export function subscribeToCashSessions(
  onData: (sessions: CashSession[]) => void,
  onError?: (err: any) => void,
  limitCount: number | null = null
): Unsubscribe {
  console.log(`[Firestore Listener] Subscribed to cashSessions (limit: ${limitCount})`);
  const q = query(
    collection(db, CASH_SESSIONS_COLLECTION),
    orderBy('openedAt', 'desc'),
    ...(limitCount === null ? [] : [limit(limitCount)])
  );

  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((d) => d.data() as CashSession);
      onData(list);
    },
    (err) => {
      console.error('[Firestore Listener] Error on cashSessions:', err);
      emitGlobalToast(`Error syncing cash sessions: ${err?.message || 'Permission or network issue'}`, 'error', 'Sync Error');
      if (onError) onError(err);
      onData([]);
    }
  );

  return () => {
    console.log('[Firestore Listener] Unsubscribed from cashSessions');
    unsubscribe();
  };
}

/**
 * Find active open session for a cashier (or any active session if cashierId not specified)
 */
export async function getActiveCashSession(cashierId?: string): Promise<CashSession | null> {
  const allSessions = await getCashSessions();
  if (cashierId) {
    return allSessions.find((s) => s.status === 'open' && s.cashierId === cashierId) || null;
  }
  return allSessions.find((s) => s.status === 'open') || null;
}

export interface OpenCashSessionParams {
  cashierId: string;
  cashierName: string;
  cashierEmail?: string;
  stationOffice: string;
  openingBalanceUSD: number;
  openingNotes?: string;
}

/**
 * Open a new cashier shift session
 */
export async function openCashSession(params: OpenCashSessionParams): Promise<CashSession> {
  requireMoney(params.openingBalanceUSD, 'Solde d’ouverture', true);
  // Prevent duplicate open shifts for the same cashier.
  const existing = await getActiveCashSession(params.cashierId);
  if (existing) {
    throw new Error(`An open cash shift already exists (${existing.sessionNumber}). Close it before opening a new one.`);
  }
  const now = new Date();
  const dateStr = todayDateString().replace(/-/g, '');
  // Derived from the shift being opened, so a duplicated submit writes the same
  // document twice instead of leaving the cashier with two open shifts. Closing
  // a shift takes a counted drawer, so a legitimate reopen inside the same
  // minute is not a real officer action.
  const sessionId = intentId('cs', 'cash.openSession', [
    params.cashierId,
    params.stationOffice,
    params.openingBalanceUSD,
  ]);
  const randomSuffix = Math.floor(100 + Math.random() * 900);
  const sessionNumber = `SESS-${dateStr}-${randomSuffix}`;

  const newSession: CashSession = {
    id: sessionId,
    sessionNumber,
    cashierId: params.cashierId,
    cashierName: params.cashierName,
    cashierEmail: params.cashierEmail || '',
    stationOffice: params.stationOffice || 'Central Counter - City Hall',
    openedAt: now.toISOString(),
    openingBalanceUSD: Number(params.openingBalanceUSD) || 0,
    openingNotes: params.openingNotes || 'Opening of cash shift.',
    paymentIds: [],
    totalPaymentsCashUSD: 0,
    totalPaymentsOtherUSD: 0,
    paymentCount: 0,
    status: 'open',
    cashStatus: 'in_drawer',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };

  // The shift must exist on the server before the cashier works it: a failed
  // write is surfaced to the caller instead of being kept on this device.
  try {
    await setDoc(doc(db, CASH_SESSIONS_COLLECTION, newSession.id), newSession);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `${CASH_SESSIONS_COLLECTION}/${newSession.id}`);
  }

  // Log Audit Trail
  await logAuditEvent(
    params.cashierId,
    params.cashierName,
    'Cashier',
    'CASH_SESSION_OPENED',
    'CashSession',
    newSession.id,
    `Opening of cash shift No. ${newSession.sessionNumber} by ${newSession.cashierName} (${newSession.stationOffice}). Initial opening balance: ${formatMoney(newSession.openingBalanceUSD)}.`,
    null,
    {
      sessionNumber: newSession.sessionNumber,
      openingBalanceUSD: newSession.openingBalanceUSD,
      stationOffice: newSession.stationOffice,
    }
  );

  return newSession;
}

export interface CloseCashSessionParams {
  countedCashUSD: number;
  closingNotes?: string;
  varianceExplanation?: string;
  cashierId: string;
  cashierName: string;
}

/**
 * Cashier closes session at end-of-day by entering physically counted cash.
 * Computes expected cash vs counted cash and flags any variance.
 */
export async function closeCashSession(
  sessionId: string, 
  params: CloseCashSessionParams
): Promise<CashSession> {
  const countedUSD = requireMoney(params.countedCashUSD, 'Comptage physique', true);
  const now = new Date().toISOString();
  const { session, updatedSession } = await runTransaction(db, async (transaction) => {
    const ref = doc(db, CASH_SESSIONS_COLLECTION, sessionId);
    const snap = await transaction.get(ref);
    if (!snap.exists()) throw new Error(`Cash session not found (${sessionId}).`);
    const session = { ...snap.data(), id: snap.id } as CashSession;
    if (session.status !== 'open' || session.cashierId !== params.cashierId) {
      throw new Error('Seul le caissier de cette session ouverte peut la clôturer.');
    }
    const expectedUSD = roundMoney((session.openingBalanceUSD || 0) + (session.totalPaymentsCashUSD || 0));
    const varianceUSD = roundMoney(countedUSD - expectedUSD);
    const hasVariance = hasCashVariance(varianceUSD);
    const changes = {
      closedAt: now, countedCashUSD: countedUSD, expectedCashUSD: expectedUSD,
      varianceUSD, hasVariance, closingNotes: params.closingNotes || '',
      varianceExplanation: hasVariance ? (params.varianceExplanation || '') : '',
      status: 'closed' as const, cashStatus: 'pending_audit' as const, updatedAt: now,
    };
    transaction.update(ref, changes);
    return { session, updatedSession: { ...session, ...changes } };
  });
  const { expectedCashUSD: expectedUSD, varianceUSD, hasVariance } = updatedSession;

  // Log to Audit Trail
  const varianceDesc = describeCashVariance(varianceUSD, updatedSession.varianceExplanation);

  await logAuditEvent(
    params.cashierId,
    params.cashierName,
    'Cashier',
    'CASH_SESSION_CLOSED',
    'CashSession',
    sessionId,
    `Close of cash shift No. ${session.sessionNumber}. Expected: ${formatMoney(expectedUSD)}. Physical count: ${formatMoney(countedUSD)}. ${varianceDesc}`,
    // Log the ACTUAL prior state — the old code hardcoded { status: 'open' }
    // regardless of what the session really was before closing.
    { status: session.status, cashStatus: session.cashStatus },
    { status: 'closed', cashStatus: 'pending_audit', varianceUSD, hasVariance }
  );

  return updatedSession;
}

/**
 * Supervisor reviews and signs off on a closed session.
 * Transitions cash from 'pending_audit' to 'in_custody'.
 */
export async function approveCashSession(
  sessionId: string,
  supervisor: { uid: string; displayName: string; role: UserRole },
  supervisorNotes?: string
): Promise<CashSession> {
  if (supervisor.role !== 'Admin' && supervisor.role !== 'Supervisor') {
    throw new Error('Only a Supervisor or Administrator may approve a cash shift.');
  }
  const now = new Date().toISOString();
  const { session, updatedSession } = await runTransaction(db, async (transaction) => {
    const ref = doc(db, CASH_SESSIONS_COLLECTION, sessionId);
    const snap = await transaction.get(ref);
    if (!snap.exists()) throw new Error(`Session not found (${sessionId}).`);
    const session = { ...snap.data(), id: snap.id } as CashSession;
    if (session.status !== 'closed') throw new Error('Only closed shifts can be approved.');
    const changes = {
      status: 'approved' as const, approvedBy: supervisor.uid, approvedByName: supervisor.displayName,
      approvedAt: now, supervisorNotes: supervisorNotes || '',
      cashStatus: 'in_custody' as const, updatedAt: now,
    };
    transaction.update(ref, changes);
    return { session, updatedSession: { ...session, ...changes } };
  });

  // Log to Audit Trail
  await logAuditEvent(
    supervisor.uid,
    supervisor.displayName,
    supervisor.role,
    'CASH_SESSION_APPROVED',
    'CashSession',
    sessionId,
    `Supervisor sign-off and approval of shift No. ${session.sessionNumber} (${session.cashierName}). Funds of ${formatMoney(session.countedCashUSD ?? session.expectedCashUSD)} entered "IN VAULT CUSTODY" at City Hall vault. Notes: ${updatedSession.supervisorNotes}`,
    // Log the ACTUAL prior state — the old code hardcoded { status: 'closed' }.
    { status: session.status, cashStatus: session.cashStatus },
    { status: 'approved', cashStatus: 'in_custody' }
  );

  return updatedSession;
}

/**
 * Links a newly recorded payment to an active cash session and updates running totals
 */
export async function linkPaymentToCashSession(
  sessionId: string, 
  payment: Payment
): Promise<void> {
  const sessionRef = doc(db, CASH_SESSIONS_COLLECTION, sessionId);
  // Read-modify-write inside a transaction: two receipts taken on the same
  // shift at the same time used to read the same session, each add their own
  // receipt, and the second write clobbered the first — the drawer total was
  // understated by every receipt lost to the race.
  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(sessionRef);
      if (!snap.exists()) throw new Error('Cash session not found.');
      const session = snap.data() as CashSession;

      const currentPaymentIds = session.paymentIds || [];
      // Idempotency guard: if this payment is already linked on the server copy
      // (e.g. a retry after a failed attempt), do not increment the running
      // totals a second time.
      if (currentPaymentIds.includes(payment.id)) return;
      if (session.status !== 'open') throw new Error('Cannot add a payment to a closed cash session.');

      const isCash = payment.paymentMethod === 'Cash_Guichet';
      const usdAmount = payment.amountPaidUSD || 0;

      transaction.update(sessionRef, {
        paymentIds: [...currentPaymentIds, payment.id],
        paymentCount: (session.paymentCount || 0) + 1,
        totalPaymentsCashUSD: isCash ? (session.totalPaymentsCashUSD || 0) + usdAmount : session.totalPaymentsCashUSD || 0,
        totalPaymentsOtherUSD: !isCash ? (session.totalPaymentsOtherUSD || 0) + usdAmount : session.totalPaymentsOtherUSD || 0,
        firstReceiptNumber: session.firstReceiptNumber || payment.receiptNumber,
        lastReceiptNumber: payment.receiptNumber,
        updatedAt: new Date().toISOString(),
      });
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `${CASH_SESSIONS_COLLECTION}/${sessionId}`);
  }
}

/**
 * Removes a voided payment from its cash session's running totals so the
 * expected drawer cash at close reflects only live (non-voided) receipts.
 */
export async function unlinkPaymentFromCashSession(
  sessionId: string,
  payment: Payment
): Promise<void> {
  const sessionRef = doc(db, CASH_SESSIONS_COLLECTION, sessionId);
  try {
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(sessionRef);
      if (!snap.exists()) return;
      const session = snap.data() as CashSession;

      const currentPaymentIds = session.paymentIds || [];
      // Never linked (or already unlinked) — nothing to reverse.
      if (!currentPaymentIds.includes(payment.id)) return;

      const isCash = payment.paymentMethod === 'Cash_Guichet';
      const usdAmount = payment.amountPaidUSD || 0;

      const newPaymentIds = currentPaymentIds.filter((id) => id !== payment.id);
      const newPaymentCount = Math.max(0, (session.paymentCount || 1) - 1);
      const newTotalCash = isCash
        ? Math.max(0, (session.totalPaymentsCashUSD || 0) - usdAmount)
        : session.totalPaymentsCashUSD || 0;
      const newTotalOther = !isCash
        ? Math.max(0, (session.totalPaymentsOtherUSD || 0) - usdAmount)
        : session.totalPaymentsOtherUSD || 0;

      const update: Record<string, unknown> = {
        paymentIds: newPaymentIds,
        paymentCount: newPaymentCount,
        totalPaymentsCashUSD: newTotalCash,
        totalPaymentsOtherUSD: newTotalOther,
        updatedAt: new Date().toISOString(),
      };

      // A receipt voided AFTER the shift was closed must not leave the closure
      // snapshot stale: expectedCash = opening + cash payments (types/index.ts).
      // Recompute the stored expected/variance pair from the reduced totals so
      // the reconciliation view does not show pre-void expectations.
      const hadClosureSnapshot = Boolean(session.closedAt) || session.expectedCashUSD !== undefined;
      if (hadClosureSnapshot) {
        const expectedCashUSD = (session.openingBalanceUSD || 0) + newTotalCash;
        update.expectedCashUSD = expectedCashUSD;
        if (session.countedCashUSD !== undefined) {
          const varianceUSD = roundMoney((session.countedCashUSD ?? 0) - expectedCashUSD);
          update.varianceUSD = varianceUSD;
          update.hasVariance = hasCashVariance(varianceUSD);
        }
      }

      transaction.update(sessionRef, update);
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `${CASH_SESSIONS_COLLECTION}/${sessionId}`);
  }
}

/**
 * Fetch all treasury deposits from Firestore.
 */
export async function getTreasuryDeposits(): Promise<TreasuryDeposit[]> {
  try {
    const q = query(collection(db, TREASURY_DEPOSITS_COLLECTION), orderBy('date', 'desc'));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => d.data() as TreasuryDeposit);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, TREASURY_DEPOSITS_COLLECTION);
    return [];
  }
}

export interface RecordTreasuryDepositParams {
  depositAmountUSD: number;
  date: string; // YYYY-MM-DD
  depositorId: string;
  depositorName: string;
  bankName: string;
  bankDepositSlipRef: string;
  bankDepositSlipUrl?: string;
  approvingSupervisorId: string;
  approvingSupervisorName: string;
  sessionIds: string[];
  cashierNames?: string[];
  notes?: string;
}

/**
 * Create a new Treasury/Bank deposit for cash held in custody from approved sessions.
 * Updates all linked sessions to `cashStatus: 'deposited'` and sets their `depositId`.
 */
export async function recordTreasuryDeposit(
  params: RecordTreasuryDepositParams
): Promise<TreasuryDeposit> {
  requireMoney(params.depositAmountUSD, 'Dépôt');
  const now = new Date();
  const dateStr = todayDateString().replace(/-/g, '');
  const depositId = intentId('dep', 'cash.treasuryDeposit', [
    [...params.sessionIds].sort(),
    params.depositAmountUSD,
    params.date,
    params.bankDepositSlipRef,
    params.depositorId,
  ]);
  const randomSuffix = Math.floor(100 + Math.random() * 900);
  const depositReference = `TDP-${dateStr}-${randomSuffix}`;

  // Only sessions that are CURRENTLY in custody may be linked to this deposit.
  // Without this check a stale or retried submission re-linked an already
  // "deposited" shift: treasury totals double-counted the same physical cash
  // while the session's depositId was silently repointed to the newer deposit,
  // orphaning the first deposit's linkage.
  const allSessions = await getCashSessions();
  const eligibleSessionIds: string[] = [];
  const skippedSessionIds: string[] = [];
  for (const sessId of new Set(params.sessionIds || [])) {
    const s = allSessions.find((item) => item.id === sessId);
    if (s && s.cashStatus === 'in_custody') {
      eligibleSessionIds.push(sessId);
    } else {
      skippedSessionIds.push(sessId);
    }
  }
  if (skippedSessionIds.length > 0) {
    console.warn(
      `[recordTreasuryDeposit] Skipped ${skippedSessionIds.length} session(s) that are not in custody (already deposited or missing):`,
      skippedSessionIds
    );
  }
  if (eligibleSessionIds.length === 0) {
    throw new Error('None of the selected cash shifts are currently held in custody. They may already have been deposited.');
  }

  const newDeposit: TreasuryDeposit = {
    id: depositId,
    depositReference,
    depositAmountUSD: Number(params.depositAmountUSD) || 0,
    date: params.date || todayDateString(),
    depositedAt: now.toISOString(),
    depositorId: params.depositorId,
    depositorName: params.depositorName,
    bankName: params.bankName,
    bankDepositSlipRef: params.bankDepositSlipRef,
    bankDepositSlipUrl: params.bankDepositSlipUrl || '',
    approvingSupervisorId: params.approvingSupervisorId,
    approvingSupervisorName: params.approvingSupervisorName,
    sessionIds: eligibleSessionIds,
    cashierNames: params.cashierNames || [],
    notes: params.notes || 'Regular physical deposit of collected cash drawer funds.',
    createdAt: now.toISOString(),
  };

  // 1+2. Write the deposit and archive every linked shift in ONE transaction.
  //    Previously the deposit was written first and each session updated in a
  //    separate loop: a failure partway through left a filed deposit whose
  //    shifts were still "in custody", so the same physical cash could be
  //    deposited a second time. The transaction re-reads each session and
  //    re-checks its custody status, so a concurrent deposit cannot double-link
  //    either. (A Firestore transaction must read before it writes, so all reads
  //    happen in the first pass and the writes in the second.)
  try {
    await runTransaction(db, async (transaction) => {
      const claimed: string[] = [];
      let claimedCashUSD = 0;
      for (const sessId of eligibleSessionIds) {
        const sessionRef = doc(db, CASH_SESSIONS_COLLECTION, sessId);
        const sessionSnap = await transaction.get(sessionRef);
        if (!sessionSnap.exists()) continue;
        const live = sessionSnap.data() as CashSession;
        if (live.cashStatus !== 'in_custody') continue;
        claimed.push(sessId);
        // Same figure the treasury custody summary uses: the physical count
        // when the shift was closed, otherwise the expected drawer cash.
        claimedCashUSD +=
          live.countedCashUSD !== undefined ? live.countedCashUSD : live.expectedCashUSD || 0;
      }

      // The deposit amount must equal the cash of the shifts it archives. The
      // caller's figure used to be trusted verbatim, so a wrong amount — a
      // stale UI, a retried submission, or a console call — could file a
      // deposit that did not match the physical cash it claimed to bank, and
      // the mismatch was invisible because the audit trail repeats the
      // declared figure. The sessions the transaction actually claims are the
      // only authoritative source, so the declared amount is checked against
      // them here, at the trust boundary.
      const declaredUSD = roundMoney(Number(params.depositAmountUSD) || 0);
      const archivedUSD = roundMoney(claimedCashUSD);
      if (declaredUSD !== archivedUSD) {
        throw new Error(
          `Deposit amount ${formatMoney(declaredUSD)} does not match the cash held by the selected shifts (${formatMoney(archivedUSD)}). ` +
          'Re-select the shifts and re-enter the amount from the counted cash.'
        );
      }

      for (const sessId of claimed) {
        transaction.update(doc(db, CASH_SESSIONS_COLLECTION, sessId), {
          cashStatus: 'deposited',
          depositId: newDeposit.id,
          depositedAt: newDeposit.depositedAt,
          updatedAt: now.toISOString(),
        });
      }

      newDeposit.sessionIds = claimed;
      newDeposit.depositAmountUSD = archivedUSD;
      if (claimed.length === 0) {
        throw new Error('None of the selected cash shifts are currently held in custody. They may already have been deposited.');
      }
      transaction.set(doc(db, TREASURY_DEPOSITS_COLLECTION, newDeposit.id), newDeposit);
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `${TREASURY_DEPOSITS_COLLECTION}/${newDeposit.id}`);
  }

  // Reflect the shifts actually claimed by the transaction in the audit entry.
  const archivedSessionIds = newDeposit.sessionIds;

  // 3. Log Audit Trail
  await logAuditEvent(
    params.approvingSupervisorId,
    params.approvingSupervisorName,
    'Supervisor',
    'TREASURY_DEPOSIT_RECORDED',
    'TreasuryDeposit',
    newDeposit.id,
    `Treasury/Bank deposit No. ${newDeposit.depositReference} recorded. Amount deposited: ${formatMoney(newDeposit.depositAmountUSD)} with "${newDeposit.bankName}" (Deposit Slip: ${newDeposit.bankDepositSlipRef}). Depositor: ${newDeposit.depositorName}. ${archivedSessionIds.length} cash shift(s) archived as deposited.`,
    { sessionIds: archivedSessionIds, status: 'in_custody' },
    { depositId: newDeposit.id, depositReference: newDeposit.depositReference, bankDepositSlipRef: newDeposit.bankDepositSlipRef, status: 'deposited' }
  );

  return newDeposit;
}

/**
 * Computes running total of cash currently in custody per cashier awaiting deposit
 */
export async function getCashCustodySummary() {
  const sessions = await getCashSessions();
  // Cash in custody: approved sessions that haven't been deposited yet
  const inCustodySessions = sessions.filter(
    (s) => s.status === 'approved' && s.cashStatus === 'in_custody'
  );

  let totalInCustodyUSD = 0;

  const perCashier: Record<
    string, 
    { cashierName: string; count: number; usd: number; sessionIds: string[] }
  > = {};

  for (const s of inCustodySessions) {
    const amountUSD = s.countedCashUSD !== undefined ? s.countedCashUSD : (s.expectedCashUSD || 0);

    totalInCustodyUSD += amountUSD;

    const cId = s.cashierId || 'unknown';
    if (!perCashier[cId]) {
      perCashier[cId] = {
        cashierName: s.cashierName,
        count: 0,
        usd: 0,
        sessionIds: [],
      };
    }
    perCashier[cId].count += 1;
    perCashier[cId].usd += amountUSD;
    perCashier[cId].sessionIds.push(s.id);
  }

  return {
    totalInCustodyUSD,
    perCashier,
    inCustodySessions,
  };
}
