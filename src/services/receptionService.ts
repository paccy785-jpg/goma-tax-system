import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  limit,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import { emitGlobalToast } from '../contexts/ToastContext';
import {
  ReceptionEntry,
  ReceptionPriority,
  ReceptionStatus,
  UserRole,
  normalizeReceptionService,
  normalizeReceptionStatus,
} from '../types';
import { logAuditEvent } from './dbService';
import { intentId } from './idempotency';
import { localDateFromIsoTimestamp } from '../utils/date';

export const RECEPTION_WINDOWS = [
  'Counter 1 — Goma',
  'Counter 2 — Karisimbi',
  'Back Office',
  'Supervisor Desk',
] as const;

const COLLECTION = 'receptionEntries';

export const RECEPTION_PRIORITIES: ReceptionPriority[] = ['Normal', 'Priority'];

// ---------------------------------------------------------------------------
// Wait-time engine (pure functions — the waiting clock starts at check-in)
// ---------------------------------------------------------------------------

/** Whole minutes elapsed between two ISO timestamps (never negative). */
export function minutesBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (isNaN(from) || isNaN(to)) return 0;
  return Math.max(0, Math.floor((to - from) / 60000));
}

/**
 * Live waiting minutes for a queue entry:
 * - Waiting   -> checkedInAt until now (keeps ticking)
 * - InService -> checkedInAt until calledAt (frozen final wait)
 * - Completed -> checkedInAt until calledAt, or until completedAt when the
 *   visitor was served without a recorded call time
 * - Cancelled / NoShow -> frozen at the last known transition
 */
export function waitMinutesFor(entry: ReceptionEntry, nowIso: string = new Date().toISOString()): number {
  const end =
    entry.status === 'Waiting'
      ? nowIso
      : entry.calledAt || entry.completedAt || entry.updatedAt || nowIso;
  return minutesBetween(entry.checkedInAt, end);
}

/** Service minutes once a visitor is (or was) being served. */
export function serviceMinutesFor(entry: ReceptionEntry, nowIso: string = new Date().toISOString()): number {
  if (!entry.calledAt) return 0;
  const end = entry.completedAt || (entry.status === 'InService' ? nowIso : entry.updatedAt || nowIso);
  return minutesBetween(entry.calledAt, end);
}

/** Human label: "4 min", "1 h 05". */
export function formatWait(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${String(rest).padStart(2, '0')}`;
}

/** Queue order: Priority first, then earliest check-in. */
export function sortQueueForDisplay(entries: ReceptionEntry[]): ReceptionEntry[] {
  return [...entries].sort((a, b) => {
    const aActive = a.status === 'Waiting' || a.status === 'InService' ? 0 : 1;
    const bActive = b.status === 'Waiting' || b.status === 'InService' ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    if (a.status === 'Waiting' && b.status === 'Waiting') {
      if (a.priority !== b.priority) return a.priority === 'Priority' ? -1 : 1;
    }
    return a.checkedInAt.localeCompare(b.checkedInAt);
  });
}

/** Pick who "Call next" should serve: longest-waiting Priority, else longest-waiting Normal. */
export function pickNextVisitor(entries: ReceptionEntry[]): ReceptionEntry | null {
  const waiting = entries.filter((e) => e.status === 'Waiting');
  if (waiting.length === 0) return null;
  const priority = waiting.filter((e) => e.priority === 'Priority');
  const pool = priority.length > 0 ? priority : waiting;
  return pool.reduce((oldest, e) => (e.checkedInAt < oldest.checkedInAt ? e : oldest));
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function normalizeEntry(raw: any): ReceptionEntry {
  return {
    id: String(raw?.id || `rec_${Date.now().toString(36)}`),
    visitorName: String(raw?.visitorName || 'Unknown visitor').trim() || 'Unknown visitor',
    phone: raw?.phone ? String(raw.phone) : '',
    service: normalizeReceptionService(raw?.service),
    priority: raw?.priority === 'Priority' ? 'Priority' : 'Normal',
    status: normalizeReceptionStatus(raw?.status),
    checkedInAt: String(raw?.checkedInAt || raw?.createdAt || new Date().toISOString()),
    calledAt: raw?.calledAt ? String(raw.calledAt) : null,
    completedAt: raw?.completedAt ? String(raw.completedAt) : null,
    servedBy: raw?.servedBy ? String(raw.servedBy) : '',
    servedByName: raw?.servedByName ? String(raw.servedByName) : '',
    window: raw?.window ? String(raw.window) : '',
    notes: raw?.notes ? String(raw.notes) : '',
    registeredBy: String(raw?.registeredBy || ''),
    registeredByName: String(raw?.registeredByName || ''),
    createdAt: String(raw?.createdAt || new Date().toISOString()),
    updatedAt: raw?.updatedAt ? String(raw.updatedAt) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Reads — Firestore is the only store
// ---------------------------------------------------------------------------

export async function getReceptionQueue(): Promise<ReceptionEntry[]> {
  try {
    const snapshot = await getDocs(collection(db, COLLECTION));
    return snapshot.docs.map((d) => normalizeEntry({ id: d.id, ...d.data() }));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, COLLECTION);
    return [];
  }
}

export function subscribeToReceptionQueue(
  onData: (entries: ReceptionEntry[]) => void,
  onError?: (err: any) => void,
  limitCount = 300
): Unsubscribe {
  const q = query(collection(db, COLLECTION), limit(limitCount));
  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      onData(snapshot.docs.map((d) => normalizeEntry({ id: d.id, ...d.data() })));
    },
    (err) => {
      console.error('[Firestore Listener] Error on receptionEntries:', err);
      emitGlobalToast(
        `Error syncing reception queue: ${err?.message || 'Permission or network issue'}`,
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
// Writes — every transition stamps the clock and the audit ledger
// ---------------------------------------------------------------------------

export interface RegisterVisitorInput {
  visitorName: string;
  phone?: string;
  service: string;
  priority: ReceptionPriority;
  notes?: string;
  actor: { uid: string; displayName: string; role: UserRole };
}

export async function registerVisitor(input: RegisterVisitorInput): Promise<ReceptionEntry> {
  const now = new Date().toISOString();
  // Derived from the check-in itself, not the clock: one officer checking in one
  // visitor in one minute is one ticket, however many times the request fires.
  const id = intentId('rec', 'reception.checkIn', [
    input.visitorName,
    input.phone,
    input.service,
    input.priority,
    input.notes,
    input.actor.uid,
  ]);
  const entry: ReceptionEntry = {
    id,
    visitorName: input.visitorName.trim(),
    phone: input.phone?.trim() || '',
    service: normalizeReceptionService(input.service),
    priority: input.priority,
    status: 'Waiting',
    checkedInAt: now,
    calledAt: null,
    completedAt: null,
    servedBy: '',
    servedByName: '',
    window: '',
    notes: input.notes?.trim() || '',
    registeredBy: input.actor.uid,
    registeredByName: input.actor.displayName,
    createdAt: now,
  };
  try {
    await setDoc(doc(db, COLLECTION, id), entry);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `${COLLECTION}/${id}`);
  }
  await logAuditEvent(
    input.actor.uid,
    input.actor.displayName,
    input.actor.role,
    'VISITOR_CHECKED_IN',
    'Reception',
    id,
    `Visitor "${entry.visitorName}" checked in at reception for "${entry.service}"${entry.priority === 'Priority' ? ' (priority lane)' : ''}.`
  );
  return entry;
}

export interface CallVisitorInput {
  window: string;
  actor: { uid: string; displayName: string; role: UserRole };
}

/** Waiting -> InService: freezes the waiting clock, opens the service clock. */
export async function callVisitor(entry: ReceptionEntry, input: CallVisitorInput): Promise<ReceptionEntry> {
  // Only a Waiting ticket can be called. Without this guard, calling a
  // Completed/Cancelled entry (stale snapshot, second clerk, double-submit)
  // resurrected it into the live queue, re-stamped calledAt (destroying the
  // frozen wait and inflating the reported wait time) and overwrote the
  // original servedBy/window.
  if (entry.status !== 'Waiting') {
    throw new Error(`Cannot call visitor "${entry.visitorName}" — ticket is already "${entry.status}".`);
  }
  const now = new Date().toISOString();
  const waited = waitMinutesFor(entry, now);
  const updated: ReceptionEntry = {
    ...entry,
    status: 'InService',
    calledAt: now,
    servedBy: input.actor.uid,
    servedByName: input.actor.displayName,
    window: input.window,
    updatedAt: now,
  };
  try {
    await updateDoc(doc(db, COLLECTION, entry.id), {
      status: 'InService',
      calledAt: now,
      servedBy: input.actor.uid,
      servedByName: input.actor.displayName,
      window: input.window,
      updatedAt: now,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `${COLLECTION}/${entry.id}`);
  }
  await logAuditEvent(
    input.actor.uid,
    input.actor.displayName,
    input.actor.role,
    'VISITOR_CALLED',
    'Reception',
    entry.id,
    `Visitor "${entry.visitorName}" called to ${input.window} after waiting ${formatWait(waited)} for "${entry.service}".`
  );
  return updated;
}

/** InService -> Completed. */
export async function completeVisit(
  entry: ReceptionEntry,
  actor: { uid: string; displayName: string; role: UserRole }
): Promise<ReceptionEntry> {
  // Only an InService visit can be completed — completing a Cancelled/NoShow
  // entry pulled it back into the day's average wait and "served today"
  // metrics, and a double-complete overwrote completedAt (inflating the
  // service time).
  if (entry.status !== 'InService') {
    throw new Error(`Cannot complete visit for "${entry.visitorName}" — ticket is "${entry.status}", not in service.`);
  }
  const now = new Date().toISOString();
  const updated: ReceptionEntry = { ...entry, status: 'Completed', completedAt: now, updatedAt: now };
  try {
    await updateDoc(doc(db, COLLECTION, entry.id), {
      status: 'Completed',
      completedAt: now,
      updatedAt: now,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `${COLLECTION}/${entry.id}`);
  }
  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    'VISITOR_SERVED',
    'Reception',
    entry.id,
    `Visit completed for "${entry.visitorName}" (${entry.service}): waited ${formatWait(waitMinutesFor(updated, now))}, served in ${formatWait(serviceMinutesFor(updated, now))} at ${entry.window || 'counter'}.`
  );
  return updated;
}

/** Waiting/InService -> Cancelled or NoShow. */
export async function closeVisitWithoutService(
  entry: ReceptionEntry,
  outcome: 'Cancelled' | 'NoShow',
  actor: { uid: string; displayName: string; role: UserRole }
): Promise<ReceptionEntry> {
  // Only a Waiting or InService ticket may be closed out — closing a Completed
  // entry silently removed a genuinely served visitor from the day's average
  // wait and served-today metrics.
  if (entry.status !== 'Waiting' && entry.status !== 'InService') {
    throw new Error(`Cannot close visit for "${entry.visitorName}" — ticket is already "${entry.status}".`);
  }
  const now = new Date().toISOString();
  const updated: ReceptionEntry = { ...entry, status: outcome, updatedAt: now };
  try {
    await updateDoc(doc(db, COLLECTION, entry.id), {
      status: outcome,
      updatedAt: now,
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `${COLLECTION}/${entry.id}`);
  }
  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    outcome === 'NoShow' ? 'VISITOR_NO_SHOW' : 'VISITOR_CANCELLED',
    'Reception',
    entry.id,
    `Visit ${outcome === 'NoShow' ? 'marked as no-show' : 'cancelled'} for "${entry.visitorName}" (${entry.service}) after waiting ${formatWait(waitMinutesFor(entry, now))}.`
  );
  return updated;
}

/** Average final wait across completed visits of a given local day (YYYY-MM-DD). */
export function averageWaitForDay(entries: ReceptionEntry[], day: string): number {
  const done = entries.filter(
    (e) => e.status === 'Completed' && localDateFromIsoTimestamp(e.checkedInAt) === day
  );
  if (done.length === 0) return 0;
  const total = done.reduce((sum, e) => sum + waitMinutesFor(e), 0);
  return Math.round(total / done.length);
}
