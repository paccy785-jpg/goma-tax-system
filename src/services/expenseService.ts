import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  limit,
  orderBy,
  writeBatch,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import { emitGlobalToast } from '../contexts/ToastContext';
import {
  ExpenseCategory,
  ExpenseFrequency,
  ExpenseRecord,
  ExpenseRecordStatus,
  RecurringExpense,
  RecurringExpenseStatus,
  UserRole,
  normalizeExpenseCategory,
  normalizeExpenseFrequency,
} from '../types';
import { logAuditEvent } from './dbService';
import { intentId } from './idempotency';
import { daysBetweenDates, shiftDateString, todayDateString } from '../utils/date';
import { formatMoney } from '../utils/money';

export const EXPENSE_PAYMENT_METHODS = [
  'Cash Guichet',
  'Mobile Money Airtel',
  'Mobile Money Orange',
  'Bank Transfer Rawbank',
  'Bank Transfer EquityBCDC',
  'Petty Cash',
] as const;

const SCHEDULES_COLLECTION = 'recurringExpenses';
const RECORDS_COLLECTION = 'expenseRecords';

// ---------------------------------------------------------------------------
// Recurrence engine (pure, timezone-safe, YYYY-MM-DD string arithmetic)
// ---------------------------------------------------------------------------

function isValidDateStr(value: string): boolean {
  return /^(\d{4})-(\d{2})-(\d{2})$/.test(String(value || '').trim());
}

function daysInMonth(year: number, monthIndex0: number): number {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

/** Add whole months with end-of-month clamping (Jan 31 + 1mo => Feb 28/29). */
export function addMonthsToDateStr(dateStr: string, months: number): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr).trim());
  if (!parts) return dateStr;
  const year = Number(parts[1]);
  const month0 = Number(parts[2]) - 1;
  const day = Number(parts[3]);
  const totalMonths = month0 + months;
  const targetYear = year + Math.floor(totalMonths / 12);
  const targetMonth0 = ((totalMonths % 12) + 12) % 12;
  const clampedDay = Math.min(day, daysInMonth(targetYear, targetMonth0));
  const parsed = new Date(targetYear, targetMonth0, clampedDay);
  if (isNaN(parsed.getTime())) return dateStr;
  const mm = String(targetMonth0 + 1).padStart(2, '0');
  const dd = String(clampedDay).padStart(2, '0');
  return `${targetYear}-${mm}-${dd}`;
}

/** Advance one period. Single source of truth for "recurring" behavior. */
export function computeNextDueDate(fromDate: string, frequency: ExpenseFrequency): string {
  const freq = normalizeExpenseFrequency(frequency);
  if (!isValidDateStr(fromDate)) return todayDateString();
  switch (freq) {
    case 'Daily':
      return shiftDateString(fromDate, 1);
    case 'Weekly':
      return shiftDateString(fromDate, 7);
    case 'Monthly':
      return addMonthsToDateStr(fromDate, 1);
    case 'Quarterly':
      return addMonthsToDateStr(fromDate, 3);
    case 'SemiAnnual':
      return addMonthsToDateStr(fromDate, 6);
    case 'Yearly':
      return addMonthsToDateStr(fromDate, 12);
    default:
      return addMonthsToDateStr(fromDate, 1);
  }
}

/** Next N due dates starting from `fromDate` (inclusive). */
export function generateUpcomingOccurrences(
  schedule: Pick<RecurringExpense, 'frequency' | 'nextDueDate'>,
  count = 12
): string[] {
  const safeCount = Math.min(Math.max(0, Math.floor(Number(count) || 0)), 60);
  const dates: string[] = [];
  let cursor = schedule.nextDueDate;
  for (let i = 0; i < safeCount; i += 1) {
    if (!isValidDateStr(cursor)) break;
    dates.push(cursor);
    cursor = computeNextDueDate(cursor, schedule.frequency);
  }
  return dates;
}

/** Monthly-burn equivalent so daily/weekly/yearly amounts compare fairly. */
export function monthlyEquivalentUSD(amountUSD: number, frequency: ExpenseFrequency): number {
  const amount = Number(amountUSD) || 0;
  switch (normalizeExpenseFrequency(frequency)) {
    case 'Daily':
      return (amount * 365) / 12;
    case 'Weekly':
      return (amount * 52) / 12;
    case 'Monthly':
      return amount;
    case 'Quarterly':
      return amount / 3;
    case 'SemiAnnual':
      return amount / 6;
    case 'Yearly':
      return amount / 12;
    default:
      return amount;
  }
}

export type ScheduleDerivedState = 'Overdue' | 'DueSoon' | 'Upcoming' | 'Terminal';

export function deriveScheduleState(
  schedule: RecurringExpense,
  today: string = todayDateString()
): { state: ScheduleDerivedState; daysUntilDue: number } {
  if (schedule.status !== 'Active') {
    return { state: 'Terminal', daysUntilDue: 0 };
  }
  if (schedule.endDate && schedule.endDate < today) {
    return { state: 'Terminal', daysUntilDue: 0 };
  }
  if (
    typeof schedule.occurrencesPlanned === 'number' &&
    schedule.occurrencesPlanned > 0 &&
    schedule.occurrencesLogged >= schedule.occurrencesPlanned
  ) {
    return { state: 'Terminal', daysUntilDue: 0 };
  }
  const daysUntilDue = daysBetweenDates(today, schedule.nextDueDate);
  if (daysUntilDue < 0) return { state: 'Overdue', daysUntilDue };
  if (daysUntilDue <= 7) return { state: 'DueSoon', daysUntilDue };
  return { state: 'Upcoming', daysUntilDue };
}

export function deriveRecordStatus(
  record: ExpenseRecord,
  today: string = todayDateString()
): ExpenseRecordStatus {
  if (record.status === 'Paid' || record.status === 'Cancelled') return record.status;
  if (record.dueDate < today) return 'Overdue';
  if (record.dueDate === today) return 'Due';
  return 'Scheduled';
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function normalizeSchedule(raw: any): RecurringExpense {
  const amountUSD = Math.max(0, Number(raw?.amountUSD ?? 0) || 0);
  return {
    id: String(raw?.id || `exp_${Date.now().toString(36)}`),
    title: String(raw?.title || 'Untitled expense').trim() || 'Untitled expense',
    category: normalizeExpenseCategory(raw?.category),
    payee: String(raw?.payee || '').trim(),
    amountUSD,
    currency: 'USD',
    frequency: normalizeExpenseFrequency(raw?.frequency),
    startDate: isValidDateStr(raw?.startDate) ? raw.startDate : todayDateString(),
    nextDueDate: isValidDateStr(raw?.nextDueDate)
      ? raw.nextDueDate
      : isValidDateStr(raw?.startDate)
        ? raw.startDate
        : todayDateString(),
    endDate: isValidDateStr(raw?.endDate) ? raw.endDate : null,
    occurrencesPlanned:
      typeof raw?.occurrencesPlanned === 'number' && raw.occurrencesPlanned > 0
        ? Math.floor(raw.occurrencesPlanned)
        : null,
    occurrencesLogged: Math.max(0, Number(raw?.occurrencesLogged ?? 0) || 0),
    totalPaidUSD: Math.max(0, Number(raw?.totalPaidUSD ?? 0) || 0),
    paymentMethod: String(raw?.paymentMethod || 'Cash Guichet'),
    status: (['Active', 'Paused', 'Completed', 'Cancelled'] as RecurringExpenseStatus[]).includes(raw?.status)
      ? raw.status
      : 'Active',
    notes: raw?.notes ? String(raw.notes) : '',
    createdBy: String(raw?.createdBy || ''),
    createdByName: String(raw?.createdByName || ''),
    createdAt: String(raw?.createdAt || new Date().toISOString()),
    updatedAt: raw?.updatedAt ? String(raw.updatedAt) : undefined,
    pausedAt: raw?.pausedAt ? String(raw.pausedAt) : undefined,
    cancelledAt: raw?.cancelledAt ? String(raw.cancelledAt) : undefined,
    cancelReason: raw?.cancelReason ? String(raw.cancelReason) : undefined,
  };
}

function normalizeRecord(raw: any): ExpenseRecord {
  const amountUSD = Math.max(0, Number(raw?.amountUSD ?? 0) || 0);
  const status: ExpenseRecordStatus = (['Scheduled', 'Due', 'Overdue', 'Paid', 'Cancelled'] as ExpenseRecordStatus[]).includes(
    raw?.status
  )
    ? raw.status
    : 'Scheduled';
  return {
    id: String(raw?.id || `expr_${Date.now().toString(36)}`),
    scheduleId: raw?.scheduleId ? String(raw.scheduleId) : null,
    title: String(raw?.title || 'Expense').trim() || 'Expense',
    category: normalizeExpenseCategory(raw?.category),
    payee: raw?.payee ? String(raw.payee) : '',
    amountUSD,
    currency: 'USD',
    dueDate: isValidDateStr(raw?.dueDate) ? raw.dueDate : todayDateString(),
    paidDate: raw?.paidDate ? String(raw.paidDate) : null,
    status,
    paymentMethod: raw?.paymentMethod ? String(raw.paymentMethod) : '',
    reference: raw?.reference ? String(raw.reference) : '',
    notes: raw?.notes ? String(raw.notes) : '',
    recordedBy: String(raw?.recordedBy || ''),
    recordedByName: String(raw?.recordedByName || ''),
    createdAt: String(raw?.createdAt || new Date().toISOString()),
    updatedAt: raw?.updatedAt ? String(raw.updatedAt) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Reads — Firestore is the only store
// ---------------------------------------------------------------------------

export async function getRecurringExpenses(): Promise<RecurringExpense[]> {
  try {
    const snapshot = await getDocs(collection(db, SCHEDULES_COLLECTION));
    const list = snapshot.docs.map((d) => normalizeSchedule({ id: d.id, ...d.data() }));
    list.sort((a, b) => a.nextDueDate.localeCompare(b.nextDueDate));
    return list;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, SCHEDULES_COLLECTION);
    return [];
  }
}

export async function getExpenseRecords(): Promise<ExpenseRecord[]> {
  try {
    const snapshot = await getDocs(collection(db, RECORDS_COLLECTION));
    const list = snapshot.docs.map((d) => normalizeRecord({ id: d.id, ...d.data() }));
    list.sort((a, b) => b.dueDate.localeCompare(a.dueDate));
    return list;
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, RECORDS_COLLECTION);
    return [];
  }
}

export function subscribeToRecurringExpenses(
  onData: (schedules: RecurringExpense[]) => void,
  onError?: (err: any) => void,
  limitCount = 200
): Unsubscribe {
  const q = query(
    collection(db, SCHEDULES_COLLECTION),
    orderBy('nextDueDate', 'asc'),
    limit(limitCount)
  );
  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((d) => normalizeSchedule({ id: d.id, ...d.data() }));
      onData(list);
    },
    (err) => {
      console.error('[Firestore Listener] Error on recurringExpenses:', err);
      emitGlobalToast(
        `Error syncing recurring expenses: ${err?.message || 'Permission or network issue'}`,
        'error',
        'Sync Error'
      );
      if (onError) onError(err);
      onData([]);
    }
  );
  return () => unsubscribe();
}

export function subscribeToExpenseRecords(
  onData: (records: ExpenseRecord[]) => void,
  onError?: (err: any) => void,
  limitCount = 500
): Unsubscribe {
  const q = query(
    collection(db, RECORDS_COLLECTION),
    orderBy('dueDate', 'desc'),
    limit(limitCount)
  );
  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((d) => normalizeRecord({ id: d.id, ...d.data() }));
      onData(list);
    },
    (err) => {
      console.error('[Firestore Listener] Error on expenseRecords:', err);
      emitGlobalToast(
        `Error syncing expense ledger: ${err?.message || 'Permission or network issue'}`,
        'error',
        'Sync Error'
      );
      if (onError) onError(err);
      onData([]);
    }
  );
  return () => unsubscribe();
}

// ---------------------------------------------------------------------------
// Writes (each one advances the recurrence + writes the audit trail)
// ---------------------------------------------------------------------------

export interface CreateScheduleInput {
  title: string;
  category: ExpenseCategory;
  payee: string;
  amountUSD: number;
  frequency: ExpenseFrequency;
  startDate: string;
  endDate?: string | null;
  occurrencesPlanned?: number | null;
  paymentMethod: string;
  notes?: string;
  actor: { uid: string; displayName: string; role: UserRole };
}

export async function createRecurringExpense(input: CreateScheduleInput): Promise<RecurringExpense> {
  const amountUSD = Math.max(0, Number(input.amountUSD) || 0);
  const now = new Date().toISOString();
  const id = intentId('exp', 'expense.createSchedule', [
    input.title,
    input.category,
    input.payee,
    amountUSD,
    input.frequency,
    input.startDate,
    input.actor.uid,
  ]);
  const schedule: RecurringExpense = {
    id,
    title: input.title.trim(),
    category: normalizeExpenseCategory(input.category),
    payee: input.payee.trim(),
    amountUSD,
    currency: 'USD',
    frequency: normalizeExpenseFrequency(input.frequency),
    startDate: input.startDate,
    nextDueDate: input.startDate,
    endDate: input.endDate || null,
    occurrencesPlanned:
      typeof input.occurrencesPlanned === 'number' && input.occurrencesPlanned > 0
        ? Math.floor(input.occurrencesPlanned)
        : null,
    occurrencesLogged: 0,
    totalPaidUSD: 0,
    paymentMethod: input.paymentMethod,
    status: 'Active',
    notes: input.notes?.trim() || '',
    createdBy: input.actor.uid,
    createdByName: input.actor.displayName,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await setDoc(doc(db, SCHEDULES_COLLECTION, id), schedule);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `${SCHEDULES_COLLECTION}/${id}`);
  }
  await logAuditEvent(
    input.actor.uid,
    input.actor.displayName,
    input.actor.role,
    'CREATE_RECURRING_EXPENSE',
    'RecurringExpense',
    id,
    `Recurring expense "${schedule.title}" registered: ${formatMoney(schedule.amountUSD)} ${schedule.frequency} to "${schedule.payee}" starting ${schedule.startDate}.`
  );
  return schedule;
}

export async function updateRecurringExpense(
  scheduleId: string,
  updates: Partial<RecurringExpense>,
  actor: { uid: string; displayName: string; role: UserRole }
): Promise<void> {
  // The audit ledger needs the pre-change image; with Firestore as the only
  // store that means reading the doc itself right before the write. The read is
  // best-effort — if it fails the update still goes ahead and the audit entry
  // falls back to the schedule id, exactly as it did when the local mirror had
  // no copy of the schedule.
  let before: RecurringExpense | null = null;
  try {
    const beforeSnap = await getDoc(doc(db, SCHEDULES_COLLECTION, scheduleId));
    if (beforeSnap.exists()) before = normalizeSchedule({ id: beforeSnap.id, ...beforeSnap.data() });
  } catch (err) {
    console.warn('[expenseService] Could not read pre-update image:', err);
  }

  const payload: Record<string, unknown> = {
    ...updates,
    title: updates.title !== undefined ? updates.title.trim() : undefined,
    payee: updates.payee !== undefined ? String(updates.payee).trim() : undefined,
    updatedAt: new Date().toISOString(),
  };
  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

  try {
    await updateDoc(doc(db, SCHEDULES_COLLECTION, scheduleId), payload);
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `${SCHEDULES_COLLECTION}/${scheduleId}`);
  }
  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    'UPDATE_RECURRING_EXPENSE',
    'RecurringExpense',
    scheduleId,
    `Recurring expense "${before?.title || scheduleId}" updated: ${Object.keys(payload).filter((k) => k !== 'updatedAt').join(', ') || 'details'}.`,
    before,
    payload
  );
}

export async function setScheduleStatus(
  schedule: RecurringExpense,
  status: RecurringExpenseStatus,
  actor: { uid: string; displayName: string; role: UserRole },
  reason?: string
): Promise<void> {
  const now = new Date().toISOString();
  const payload: Partial<RecurringExpense> = {
    status,
    updatedAt: now,
    pausedAt: status === 'Paused' ? now : schedule.pausedAt,
    cancelledAt: status === 'Cancelled' ? now : schedule.cancelledAt,
    cancelReason: status === 'Cancelled' ? reason?.trim() || 'Cancelled by treasury control.' : schedule.cancelReason,
  };
  await updateRecurringExpense(schedule.id, payload, actor);
}

export async function deleteRecurringExpense(
  schedule: RecurringExpense,
  actor: { uid: string; displayName: string; role: UserRole }
): Promise<void> {
  try {
    await deleteDoc(doc(db, SCHEDULES_COLLECTION, schedule.id));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `${SCHEDULES_COLLECTION}/${schedule.id}`);
  }
  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    'DELETE_RECURRING_EXPENSE',
    'RecurringExpense',
    schedule.id,
    `Recurring expense "${schedule.title}" (${schedule.frequency}, ${formatMoney(schedule.amountUSD)}) removed by ${actor.displayName}. ${schedule.occurrencesLogged} payment(s) had been logged.`
  );
}

export interface RecordPaymentInput {
  paidDate: string; // YYYY-MM-DD
  amountUSD: number;
  paymentMethod: string;
  reference?: string;
  notes?: string;
  actor: { uid: string; displayName: string; role: UserRole };
}

/**
 * Records payment for the currently-due occurrence and advances the schedule
 * by exactly one period — the heart of the recurring behavior.
 */
export async function recordSchedulePayment(
  schedule: RecurringExpense,
  input: RecordPaymentInput
): Promise<{ schedule: RecurringExpense; record: ExpenseRecord }> {
  const amountUSD = Math.max(0, Number(input.amountUSD) || 0);
  const now = new Date().toISOString();
  const dueDate = schedule.nextDueDate;
  // Advance whole periods from the DUE DATE, fast-forwarding while the result
  // is still in the past. The old code anchored on today whenever the schedule
  // was overdue: one late payment permanently shifted the cycle day (rent due
  // on the 5th became due on the 13th forever after a single late payment).
  const today = todayDateString();
  let nextDueDate = computeNextDueDate(dueDate, schedule.frequency);
  let guard = 0;
  while (nextDueDate < today && guard < 1200) {
    nextDueDate = computeNextDueDate(nextDueDate, schedule.frequency);
    guard += 1;
  }
  const occurrencesLogged = schedule.occurrencesLogged + 1;
  const totalPaidUSD = Math.round((schedule.totalPaidUSD + amountUSD) * 100) / 100;

  const reachedPlanned =
    typeof schedule.occurrencesPlanned === 'number' &&
    schedule.occurrencesPlanned > 0 &&
    occurrencesLogged >= schedule.occurrencesPlanned;
  const passedEnd = Boolean(schedule.endDate && nextDueDate > schedule.endDate);
  const nextStatus: RecurringExpenseStatus =
    reachedPlanned || passedEnd ? 'Completed' : schedule.status;

  const record: ExpenseRecord = {
    // One payment per occurrence: the schedule and its due date identify the
    // line, so a repeated submit overwrites it instead of paying twice.
    id: intentId('expr', 'expense.schedulePayment', [schedule.id, dueDate]),
    scheduleId: schedule.id,
    title: schedule.title,
    category: schedule.category,
    payee: schedule.payee,
    amountUSD,
    currency: 'USD',
    dueDate,
    paidDate: input.paidDate,
    status: 'Paid',
    paymentMethod: input.paymentMethod,
    reference: input.reference?.trim() || '',
    notes: input.notes?.trim() || '',
    recordedBy: input.actor.uid,
    recordedByName: input.actor.displayName,
    createdAt: now,
  };

  const updated: RecurringExpense = {
    ...schedule,
    nextDueDate: nextStatus === 'Completed' ? schedule.nextDueDate : nextDueDate,
    occurrencesLogged,
    totalPaidUSD,
    status: nextStatus,
    updatedAt: now,
  };

  // The ledger entry and the schedule advance are one operation: written as two
  // separate calls, a failure between them either left the payment logged with
  // the schedule un-advanced (the same occurrence payable twice) or advanced the
  // schedule with no ledger record. A batch commits both or neither.
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, RECORDS_COLLECTION, record.id), record);
    batch.update(doc(db, SCHEDULES_COLLECTION, schedule.id), {
      nextDueDate: updated.nextDueDate,
      occurrencesLogged,
      totalPaidUSD,
      status: nextStatus,
      updatedAt: now,
    });
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `${RECORDS_COLLECTION}/${record.id}`);
  }
  await logAuditEvent(
    input.actor.uid,
    input.actor.displayName,
    input.actor.role,
    'RECORD_EXPENSE_PAYMENT',
    'Expense',
    record.id,
    `Expense payment recorded for "${schedule.title}": ${formatMoney(amountUSD)} paid ${input.paidDate} via ${input.paymentMethod} (due ${dueDate}). Next due ${updated.nextDueDate}${nextStatus === 'Completed' ? ' — schedule completed.' : '.'}`
  );
  return { schedule: updated, record };
}

export interface LogOneOffInput extends RecordPaymentInput {
  title: string;
  category: ExpenseCategory;
  payee: string;
  dueDate: string;
}

export async function logOneOffExpense(input: LogOneOffInput): Promise<ExpenseRecord> {
  const amountUSD = Math.max(0, Number(input.amountUSD) || 0);
  const now = new Date().toISOString();
  const record: ExpenseRecord = {
    id: intentId('expr', 'expense.logOneOff', [
      input.title,
      input.category,
      input.payee,
      amountUSD,
      input.dueDate,
      input.paidDate,
      input.reference,
      input.actor.uid,
    ]),
    scheduleId: null,
    title: input.title.trim(),
    category: normalizeExpenseCategory(input.category),
    payee: input.payee.trim(),
    amountUSD,
    currency: 'USD',
    dueDate: input.dueDate,
    paidDate: input.paidDate,
    status: 'Paid',
    paymentMethod: input.paymentMethod,
    reference: input.reference?.trim() || '',
    notes: input.notes?.trim() || '',
    recordedBy: input.actor.uid,
    recordedByName: input.actor.displayName,
    createdAt: now,
  };
  try {
    await setDoc(doc(db, RECORDS_COLLECTION, record.id), record);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `${RECORDS_COLLECTION}/${record.id}`);
  }
  await logAuditEvent(
    input.actor.uid,
    input.actor.displayName,
    input.actor.role,
    'LOG_ONE_OFF_EXPENSE',
    'Expense',
    record.id,
    `One-off expense "${record.title}" logged: ${formatMoney(record.amountUSD)} paid ${record.paidDate} to "${record.payee || '—'}".`
  );
  return record;
}

export async function markRecordPaid(
  record: ExpenseRecord,
  paidDate: string,
  actor: { uid: string; displayName: string; role: UserRole }
): Promise<void> {
  const now = new Date().toISOString();
  try {
    await updateDoc(doc(db, RECORDS_COLLECTION, record.id), { status: 'Paid', paidDate, updatedAt: now });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `${RECORDS_COLLECTION}/${record.id}`);
  }
  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    'MARK_EXPENSE_PAID',
    'Expense',
    record.id,
    `Expense "${record.title}" (${formatMoney(record.amountUSD)}, due ${record.dueDate}) marked as paid on ${paidDate}.`
  );
}

export async function cancelExpenseRecord(
  record: ExpenseRecord,
  actor: { uid: string; displayName: string; role: UserRole }
): Promise<void> {
  try {
    await updateDoc(doc(db, RECORDS_COLLECTION, record.id), {
      status: 'Cancelled',
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `${RECORDS_COLLECTION}/${record.id}`);
  }
  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    'CANCEL_EXPENSE_RECORD',
    'Expense',
    record.id,
    `Expense record "${record.title}" (${formatMoney(record.amountUSD)}, due ${record.dueDate}) cancelled by ${actor.displayName}.`
  );
}
