import {
  collection,
  doc,
  getDocs,
  setDoc,
  runTransaction,
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
import { isValidDateString, todayDateString, localDateFromIsoTimestamp } from '../utils/date';

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
  if (entry.status === 'Scheduled') return 0;
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
    if (a.status === 'Scheduled' && b.status === 'Scheduled') {
      const byDate = (a.scheduledFor || '').localeCompare(b.scheduledFor || '');
      if (byDate !== 0) return byDate;
    }
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
    scheduledFor: raw?.scheduledFor || undefined,
    scheduledTime: raw?.scheduledTime || undefined,
    scheduledAt: raw?.scheduledAt || undefined,
    scheduledBy: raw?.scheduledBy || undefined,
    originalCheckedInAt: raw?.originalCheckedInAt || undefined,
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
  limitCount: number | null = null
): Unsubscribe {
  const q = query(collection(db, COLLECTION), ...(limitCount === null ? [] : [limit(limitCount)]));
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
  const updated = await runTransaction(db, async (tx) => {
    const ref = doc(db, COLLECTION, entry.id);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('Ce visiteur n’existe plus.');
    const live = normalizeEntry({ ...snap.data(), id: snap.id });
    if (live.status !== 'Waiting') throw new Error('Ce visiteur n’est plus en attente.');
    const changes = { status: 'InService' as const, calledAt: now, servedBy: input.actor.uid,
      servedByName: input.actor.displayName, window: input.window, updatedAt: now };
    tx.update(ref, changes);
    return { ...live, ...changes };
  });
  const waited = waitMinutesFor(updated, now);
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

/** Schedule an existing waiting ticket, or check it back in when the visitor returns. */
export async function scheduleReceptionVisitor(
  entryId: string,
  date: string | null,
  actor: { uid: string; displayName: string; role: UserRole }
): Promise<ReceptionEntry> {
  if (!['Admin', 'Supervisor', 'Cashier'].includes(actor.role)) throw new Error('Accès en lecture seule.');
  if (date !== null && (!isValidDateString(date) || date <= todayDateString())) {
    throw new Error('Choisissez une date future valide.');
  }
  const ref = doc(db, COLLECTION, entryId);
  const updated = await runTransaction(db, async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists()) throw new Error('Ce visiteur n’existe plus.');
    const live = normalizeEntry({ ...snapshot.data(), id: snapshot.id });
    const now = new Date().toISOString();
    if (date !== null) {
      if (live.status !== 'Waiting' && live.status !== 'Scheduled') throw new Error('Ce visiteur ne peut plus être planifié.');
      const changes = { status: 'Scheduled' as const, scheduledFor: date, scheduledAt: now,
        scheduledBy: actor.uid, originalCheckedInAt: live.originalCheckedInAt || live.checkedInAt, updatedAt: now };
      tx.update(ref, changes);
      return { ...live, ...changes };
    }
    if (live.status !== 'Scheduled') throw new Error('Ce visiteur n’est pas planifié.');
    if (!live.scheduledFor || live.scheduledFor > todayDateString()) throw new Error('La date prévue n’est pas encore arrivée.');
    const changes = { status: 'Waiting' as const, checkedInAt: now, calledAt: null, completedAt: null,
      servedBy: '', servedByName: '', window: '', updatedAt: now };
    tx.update(ref, changes);
    return { ...live, ...changes };
  });
  await logAuditEvent(actor.uid, actor.displayName, actor.role, date ? 'VISITOR_SCHEDULED' : 'VISITOR_RETURNED',
    'Reception', entryId, `${updated.visitorName} — ${date ? `scheduled for ${date}` : 'checked in on return'}.`);
  return updated;
}

/** A form submission owns one permanent ID, so retries cannot create two meetings. */
export async function createReceptionMeeting(input: {
  submissionId: string; visitorName: string; date: string; time?: string; service?: string; notes?: string;
}, actor: RegisterVisitorInput['actor']): Promise<ReceptionEntry> {
  if (!['Admin', 'Supervisor', 'Cashier'].includes(actor.role)) throw new Error('Accès en lecture seule.');
  if (!input.visitorName.trim()) throw new Error('Saisissez le nom du visiteur.');
  if (!isValidDateString(input.date) || input.date <= todayDateString()) throw new Error('Choisissez une date future valide.');
  if (input.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)) throw new Error('Heure invalide.');
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(input.submissionId)) throw new Error('Identifiant du rendez-vous invalide.');
  const id = `meeting_${input.submissionId}`;
  const ref = doc(db, COLLECTION, id);
  const result = await runTransaction(db, async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists()) return normalizeEntry({ ...existing.data(), id });
    const now = new Date().toISOString();
    const entry: ReceptionEntry = {
      id, visitorName: input.visitorName.trim(), service: normalizeReceptionService(input.service),
      notes: input.notes?.trim() || '', priority: 'Normal', status: 'Scheduled',
      scheduledFor: input.date, scheduledTime: input.time || '', scheduledAt: now, scheduledBy: actor.uid,
      checkedInAt: now, createdAt: now, registeredBy: actor.uid, registeredByName: actor.displayName,
    };
    tx.set(ref, entry);
    return entry;
  });
  await logAuditEvent(actor.uid, actor.displayName, actor.role, 'MEETING_SCHEDULED', 'Reception', id,
    `${result.visitorName} — ${result.scheduledFor} ${result.scheduledTime || ''}`);
  return result;
}
