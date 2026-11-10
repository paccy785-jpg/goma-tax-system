import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  limit,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import { emitGlobalToast } from '../contexts/ToastContext';
import {
  BoardDepartment,
  ScheduleEvent,
  ScheduleEventKind,
  ScheduleEventStatus,
  UserRole,
  normalizeBoardDepartment,
  normalizeScheduleEventKind,
  normalizeScheduleEventStatus,
} from '../types';
import { logAuditEvent } from './dbService';
import { toLocalDateString, todayDateString } from '../utils/date';
import { intentId } from './idempotency';

const COLLECTION = 'scheduleEvents';

// ---------------------------------------------------------------------------
// Calendar helpers (pure, Monday-first, YYYY-MM-DD string based)
// ---------------------------------------------------------------------------

export const WEEKDAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** 42 Monday-first cells for a month view; null pads days outside the month. */
export function monthCells(year: number, monthIndex0: number): (string | null)[] {
  const first = new Date(year, monthIndex0, 1);
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, monthIndex0 + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < lead; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(toLocalDateString(new Date(year, monthIndex0, day)));
  }
  while (cells.length % 7 !== 0) cells.push(null);
  while (cells.length < 42) cells.push(null);
  return cells.slice(0, 42);
}

export function monthLabel(year: number, monthIndex0: number): string {
  return new Date(year, monthIndex0, 1).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

export function shiftMonth(year: number, monthIndex0: number, delta: number): { year: number; month: number } {
  const total = monthIndex0 + delta;
  return {
    year: year + Math.floor(total / 12),
    month: ((total % 12) + 12) % 12,
  };
}

/** True when a deadline needs urgent attention (due or overdue, still open). */
export function isDeadlineHot(event: ScheduleEvent, today: string = todayDateString()): boolean {
  return event.kind === 'Deadline' && event.status === 'Scheduled' && event.date <= today;
}

export function isOverdue(event: ScheduleEvent, today: string = todayDateString()): boolean {
  return event.status === 'Scheduled' && event.date < today;
}

export function sortEventsChronologically(events: ScheduleEvent[]): ScheduleEvent[] {
  return [...events].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return (a.time || '99:99').localeCompare(b.time || '99:99');
  });
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

function normalizeEvent(raw: any): ScheduleEvent {
  return {
    id: String(raw?.id || `sch_${Date.now().toString(36)}`),
    title: String(raw?.title || 'Untitled').trim() || 'Untitled',
    kind: normalizeScheduleEventKind(raw?.kind),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(raw?.date || '')) ? raw.date : todayDateString(),
    time: raw?.time ? String(raw.time) : '',
    department: normalizeBoardDepartment(raw?.department),
    location: raw?.location ? String(raw.location) : '',
    notes: raw?.notes ? String(raw.notes) : '',
    status: normalizeScheduleEventStatus(raw?.status),
    createdBy: String(raw?.createdBy || ''),
    createdByName: String(raw?.createdByName || ''),
    createdAt: String(raw?.createdAt || new Date().toISOString()),
    updatedAt: raw?.updatedAt ? String(raw.updatedAt) : undefined,
  };
}

// ---------------------------------------------------------------------------
// Reads — Firestore is the only store
// ---------------------------------------------------------------------------

export async function getScheduleEvents(): Promise<ScheduleEvent[]> {
  try {
    const snapshot = await getDocs(collection(db, COLLECTION));
    return snapshot.docs.map((d) => normalizeEvent({ id: d.id, ...d.data() }));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, COLLECTION);
    return [];
  }
}

export function subscribeToScheduleEvents(
  onData: (events: ScheduleEvent[]) => void,
  onError?: (err: any) => void,
  limitCount = 500
): Unsubscribe {
  const q = query(collection(db, COLLECTION), limit(limitCount));
  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      onData(snapshot.docs.map((d) => normalizeEvent({ id: d.id, ...d.data() })));
    },
    (err) => {
      console.error('[Firestore Listener] Error on scheduleEvents:', err);
      emitGlobalToast(
        `Error syncing meeting schedule: ${err?.message || 'Permission or network issue'}`,
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
// Writes
// ---------------------------------------------------------------------------

export interface CreateScheduleInput {
  title: string;
  kind: ScheduleEventKind;
  date: string;
  time?: string;
  department: BoardDepartment;
  location?: string;
  notes?: string;
  actor: { uid: string; displayName: string; role: UserRole };
}

export async function createScheduleEvent(input: CreateScheduleInput): Promise<ScheduleEvent> {
  const now = new Date().toISOString();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || '')) {
    throw new Error(`Invalid schedule date "${input.date}" — expected YYYY-MM-DD.`);
  }
  const [y, m, d] = (input.date || '').split('-').map(Number);
  const check = new Date(y, m - 1, d);
  if (check.getFullYear() !== y || check.getMonth() !== m - 1 || check.getDate() !== d) {
    throw new Error(`Invalid schedule date "${input.date}" — not a real calendar day.`);
  }
  if (input.time && !/^\d{2}:\d{2}$/.test(input.time.trim())) {
    throw new Error(`Invalid schedule time "${input.time}" — expected HH:MM.`);
  }
  const id = intentId('sch', 'board.scheduleEvent', [
    input.title,
    input.kind,
    input.date,
    input.time,
    input.department,
    input.actor.uid,
  ]);
  const event: ScheduleEvent = {
    id,
    title: input.title.trim(),
    kind: normalizeScheduleEventKind(input.kind),
    date: input.date,
    time: input.time?.trim() || '',
    department: normalizeBoardDepartment(input.department),
    location: input.location?.trim() || '',
    notes: input.notes?.trim() || '',
    status: 'Scheduled',
    createdBy: input.actor.uid,
    createdByName: input.actor.displayName,
    createdAt: now,
  };
  try {
    await setDoc(doc(db, COLLECTION, id), event);
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `${COLLECTION}/${id}`);
  }
  await logAuditEvent(
    input.actor.uid,
    input.actor.displayName,
    input.actor.role,
    input.kind === 'Deadline' ? 'SCHEDULE_DEADLINE_SET' : 'SCHEDULE_MEETING_SET',
    'ScheduleEvent',
    id,
    `${input.kind} "${event.title}" scheduled for ${event.date}${event.time ? ` at ${event.time}` : ''} (${event.department}).`
  );
  return event;
}

export async function setScheduleEventStatus(
  event: ScheduleEvent,
  status: ScheduleEventStatus,
  actor: { uid: string; displayName: string; role: UserRole }
): Promise<void> {
  try {
    await updateDoc(doc(db, COLLECTION, event.id), { status, updatedAt: new Date().toISOString() });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, `${COLLECTION}/${event.id}`);
  }
  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    'SCHEDULE_STATUS_CHANGED',
    'ScheduleEvent',
    event.id,
    `${event.kind} "${event.title}" (${event.date}) marked as ${status} by ${actor.displayName}.`
  );
}

export async function deleteScheduleEvent(
  event: ScheduleEvent,
  actor: { uid: string; displayName: string; role: UserRole }
): Promise<void> {
  try {
    await deleteDoc(doc(db, COLLECTION, event.id));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, `${COLLECTION}/${event.id}`);
  }
  await logAuditEvent(
    actor.uid,
    actor.displayName,
    actor.role,
    'SCHEDULE_DELETED',
    'ScheduleEvent',
    event.id,
    `${event.kind} "${event.title}" (${event.date}) removed by ${actor.displayName}.`
  );
}
