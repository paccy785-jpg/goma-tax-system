import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteField,
  query,
  limit,
  onSnapshot,
  type Unsubscribe
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase/config';
import { detectReceiptSequenceGaps } from '../utils/receiptSequence';
import { emitGlobalToast } from '../contexts/ToastContext';
import { 
  ReceiptAnomaly, 
  SequenceCheckSummary, 
  Payment, 
  UserProfile, 
  UserRole,
  AnomalyType,
  AnomalyResolutionStatus
} from '../types';
import { logAuditEvent, getPayments } from './dbService';
import { localDateFromIsoTimestamp, todayDateString } from '../utils/date';
import { normalizeAnomalyStatus } from '../types';

const ANOMALIES_COLLECTION = 'receiptAnomalies';

/**
 * Sort: unresolved first, then newest detectedAt.
 * Compare through normalizeAnomalyStatus — the status union also covers
 * French spellings ('non_resolu', 'non résolu', casing/whitespace), which
 * the raw === checks used to sort as RESOLVED.
 */
function sortAnomalies(list: ReceiptAnomaly[]): ReceiptAnomaly[] {
  return list.sort((a, b) => {
    const aResolved = normalizeAnomalyStatus(a.status) !== 'Unresolved';
    const bResolved = normalizeAnomalyStatus(b.status) !== 'Unresolved';
    if (aResolved !== bResolved) {
      return aResolved ? 1 : -1;
    }
    return new Date(b.detectedAt || 0).getTime() - new Date(a.detectedAt || 0).getTime();
  });
}

/**
 * Fetches all receipt anomalies from Firestore /receiptAnomalies.
 * Firestore is the only store: an empty collection is an empty list and a
 * failed read is surfaced as an error.
 */
export async function getReceiptAnomalies(): Promise<ReceiptAnomaly[]> {
  try {
    const snapshot = await getDocs(collection(db, ANOMALIES_COLLECTION));
    return sortAnomalies(snapshot.docs.map((d) => d.data() as ReceiptAnomaly));
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, ANOMALIES_COLLECTION);
    return [];
  }
}

/**
 * Active-aware real-time listener for Receipt Anomalies.
 * Bounded by Spark tier limit() and explicitly cleans up when unsubscribed.
 */
export function subscribeToReceiptAnomalies(
  onData: (anomalies: ReceiptAnomaly[]) => void,
  onError?: (err: any) => void,
  limitCount: number = 100
): Unsubscribe {
  console.log(`[Firestore Listener] Subscribed to receiptAnomalies (limit: ${limitCount})`);
  const q = query(collection(db, ANOMALIES_COLLECTION), limit(limitCount));

  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((d) => d.data() as ReceiptAnomaly);
      onData(sortAnomalies(list));
    },
    (err) => {
      console.error('[Firestore Listener] Error on receiptAnomalies:', err);
      emitGlobalToast(`Error syncing receipt anomalies: ${err?.message || 'Permission or network issue'}`, 'error', 'Sync Error');
      if (onError) onError(err);
      onData([]);
    }
  );

  return () => {
    console.log('[Firestore Listener] Unsubscribed from receiptAnomalies');
    unsubscribe();
  };
}

/**
 * Saves or updates a receipt anomaly record
 */
export async function saveReceiptAnomaly(anomaly: ReceiptAnomaly): Promise<void> {
  const path = `${ANOMALIES_COLLECTION}/${anomaly.id}`;
  // Firestore rejects undefined field values even with { merge: true }.
  // Convert them to deleteField() so e.g. reopening an anomaly properly
  // clears the previous resolution metadata instead of throwing.
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(anomaly)) {
    sanitized[key] = value === undefined ? deleteField() : value;
  }
  try {
    await setDoc(doc(db, ANOMALIES_COLLECTION, anomaly.id), sanitized, { merge: true });
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }
}

/**
 * Marks a receipt anomaly as "Explained" with a MANDATORY explanatory note.
 * Enforces role restriction (Auditor, Supervisor, or Admin).
 * Emits audit log entry.
 */
export async function resolveReceiptAnomaly(params: {
  anomalyId: string;
  resolutionNote: string;
  userProfile: {
    uid: string;
    displayName: string;
    role: UserRole;
  };
}): Promise<ReceiptAnomaly> {
  const { anomalyId, resolutionNote, userProfile } = params;

  if (!resolutionNote || resolutionNote.trim().length < 5) {
    throw new Error("A detailed justification of at least 5 characters is strictly required to mark an anomaly as explained.");
  }

  const all = await getReceiptAnomalies();
  const target = all.find((a) => a.id === anomalyId);
  if (!target) {
    throw new Error(`Receipt anomaly not found (${anomalyId}).`);
  }

  const now = new Date().toISOString();
  const updated: ReceiptAnomaly = {
    ...target,
    status: 'Explained',
    resolutionNote: resolutionNote.trim(),
    resolvedBy: userProfile.uid,
    resolvedByName: userProfile.displayName,
    resolvedAt: now,
  };

  await saveReceiptAnomaly(updated);

  // Log to Audit Trail
  await logAuditEvent(
    userProfile.uid,
    userProfile.displayName,
    userProfile.role,
    'RESOLVE_RECEIPT_ANOMALY',
    'ReceiptAnomaly',
    updated.id,
    `Resolution of receipt anomaly #${updated.id} (${updated.type === 'gap' ? 'Missing sequence receipt number' : 'Duplicate detected on ' + updated.actualReceiptNumber}) by ${userProfile.displayName} (${userProfile.role}). Justification: "${resolutionNote.trim()}".`,
    { status: target.status, resolutionNote: target.resolutionNote || null },
    { status: 'Explained', resolutionNote: updated.resolutionNote, resolvedByName: updated.resolvedByName, resolvedAt: now }
  );

  return updated;
}

/**
 * Reverts an explained anomaly back to "Unresolved"
 */
export async function unresolveReceiptAnomaly(params: {
  anomalyId: string;
  userProfile: {
    uid: string;
    displayName: string;
    role: UserRole;
  };
  reopenReason?: string;
}): Promise<ReceiptAnomaly> {
  const { anomalyId, userProfile, reopenReason } = params;
  const all = await getReceiptAnomalies();
  const target = all.find((a) => a.id === anomalyId);
  if (!target) {
    throw new Error(`Receipt anomaly not found (${anomalyId}).`);
  }

  const now = new Date().toISOString();
  const updated: ReceiptAnomaly = {
    ...target,
    status: 'Unresolved',
    resolutionNote: reopenReason ? `Reopened: ${reopenReason}` : undefined,
    resolvedBy: undefined,
    resolvedByName: undefined,
    resolvedAt: undefined,
  };

  await saveReceiptAnomaly(updated);

  await logAuditEvent(
    userProfile.uid,
    userProfile.displayName,
    userProfile.role,
    'REOPEN_RECEIPT_ANOMALY',
    'ReceiptAnomaly',
    updated.id,
    `Reopening of receipt anomaly ${updated.id} by ${userProfile.displayName} (${userProfile.role}). Anomaly returned to "Unresolved" status.`,
    { status: target.status },
    { status: 'Unresolved' }
  );

  return updated;
}

/**
 * Core Algorithm: Scans all issued receipts per cashier/office and globally.
 * Detects:
 * (a) Gaps: an expected receipt number that was never issued.
 * (b) Duplicates: the same receipt number issued twice.
 * 
 * Run automatically on offline sync, and available as a manual "Verify Sequences" action.
 */
export async function runReceiptSequenceScan(params: {
  triggeredBy: {
    uid: string;
    displayName: string;
    role: UserRole;
  };
  source?: 'sync_offline' | 'manual_scan' | 'automatic_check';
}): Promise<SequenceCheckSummary> {
  const source = params.source || 'manual_scan';
  const now = new Date().toISOString();

  // 1. Fetch current payments and existing anomalies
  const [payments, existingAnomalies] = await Promise.all([
    getPayments(),
    getReceiptAnomalies()
  ]);

  const existingMap = new Map<string, ReceiptAnomaly>();
  for (const anom of existingAnomalies) {
    existingMap.set(anom.id, anom);
  }

  const detectedAnomalies: ReceiptAnomaly[] = [];

  // ==========================================
  // CHECK (B): DUPLICATE DETECTION (GLOBAL & PER CASHIER)
  // ==========================================
  const receiptNumberMap = new Map<string, Payment[]>();
  for (const p of payments) {
    const num = (p.receiptNumber || '').trim();
    if (!num) continue;
    const list = receiptNumberMap.get(num) || [];
    list.push(p);
    receiptNumberMap.set(num, list);
  }

  for (const [receiptNum, matchingPayments] of receiptNumberMap.entries()) {
    if (matchingPayments.length > 1) {
      // Duplicate found!
      const anomalyId = `ANOM-DUP-${receiptNum.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
      const existing = existingMap.get(anomalyId);

      const dates = matchingPayments
        .map((p) => p.paymentDate || (p.paidAt ? localDateFromIsoTimestamp(p.paidAt) : ''))
        .filter(Boolean)
        .sort();

      const startDate = dates[0] || todayDateString();
      const endDate = dates[dates.length - 1] || startDate;
      const cashierNames = Array.from(new Set(matchingPayments.map((p) => p.cashierName || p.cashierId))).join(' & ');
      const cashierId = matchingPayments[0].cashierId || 'multi_cashier';

      const duplicateAnomaly: ReceiptAnomaly = {
        id: anomalyId,
        type: 'duplicate',
        cashierId,
        cashierName: cashierNames,
        stationOffice: (matchingPayments[0].notes?.includes('Guichet') || matchingPayments[0].notes?.toLowerCase().includes('counter')) ? 'Multiple Counters' : 'Goma Revenue Counter',
        expectedReceiptNumber: 'Unique Receipt Number',
        actualReceiptNumber: receiptNum,
        duplicatePaymentIds: matchingPayments.map((p) => p.id),
        duplicateCount: matchingPayments.length,
        startDate,
        endDate,
        detectedAt: existing ? existing.detectedAt : now,
        status: existing ? (existing.status as any) : 'Unresolved',
        resolutionNote: existing?.resolutionNote,
        resolvedBy: existing?.resolvedBy,
        resolvedByName: existing?.resolvedByName,
        resolvedAt: existing?.resolvedAt,
        source: existing?.source || source,
      };

      detectedAnomalies.push(duplicateAnomaly);
    }
  }

  // ==========================================
  // CHECK (A): GAP DETECTION ON THE GLOBAL SEQUENCE
  // ==========================================
  // Group payments by cashier
  const cashierGroups = new Map<string, { cashierName: string; payments: Payment[] }>();
  for (const p of payments) {
    const cId = p.cashierId || 'unknown_cashier';
    const cName = p.cashierName || 'Unassigned Cashier';
    const group = cashierGroups.get(cId) || { cashierName: cName, payments: [] };
    group.payments.push(p);
    cashierGroups.set(cId, group);
  }

  for (const gap of detectReceiptSequenceGaps(payments)) {
    const current = gap.previous;
    const next = gap.next;
    // The missing receipt was never taken, so it is attributed to the
    // cashier whose receipt precedes the hole — the drawer it was issued
    // from.
    const cId = current.cashierId || 'unknown_cashier';
    const cashierName = current.cashierName || 'Unassigned Cashier';
    const startMissing = gap.startSequence;
    const endMissing = gap.endSequence;
    const gapSize = endMissing - startMissing + 1;
    // Keep the label readable for very large gaps; full range stays in start/endSequence.
    const MAX_LABEL_SPAN = 50;
    const fiscalYear = current.fiscalYear || new Date().getFullYear();

    const expectedLabel = startMissing === endMissing
      ? `REC-${fiscalYear}-${String(startMissing).padStart(5, '0')}`
      : gapSize > MAX_LABEL_SPAN
        ? `REC-${fiscalYear}-${String(startMissing).padStart(5, '0')} to REC-${fiscalYear}-${String(startMissing + MAX_LABEL_SPAN - 1).padStart(5, '0')} (+${gapSize - MAX_LABEL_SPAN} more)`
        : `REC-${fiscalYear}-${String(startMissing).padStart(5, '0')} to REC-${fiscalYear}-${String(endMissing).padStart(5, '0')}`;

    const anomalyId = `ANOM-GAP-${cId}-${fiscalYear}-${startMissing}-${endMissing}`;
    const existing = existingMap.get(anomalyId);

    const startDate = current.paymentDate
      || (current.paidAt ? localDateFromIsoTimestamp(current.paidAt) : todayDateString());
    const endDate = next.paymentDate
      || (next.paidAt ? localDateFromIsoTimestamp(next.paidAt) : startDate);

    const gapAnomaly: ReceiptAnomaly = {
      id: anomalyId,
      type: 'gap',
      cashierId: cId,
      cashierName,
      stationOffice: (current.notes?.includes('Guichet') || current.notes?.toLowerCase().includes('counter')) ? 'Tax Collection Office' : 'DPRNK Goma',
      expectedReceiptNumber: expectedLabel,
      expectedSequenceNumber: startMissing,
      startSequence: startMissing,
      endSequence: endMissing,
      actualReceiptNumber: `Previous: ${current.receiptNumber} (#${gap.previousSequence}) • Next: ${next.receiptNumber} (#${gap.nextSequence})`,
      startDate,
      endDate,
      detectedAt: existing ? existing.detectedAt : now,
      status: existing ? (existing.status as any) : 'Unresolved',
      resolutionNote: existing?.resolutionNote,
      resolvedBy: existing?.resolvedBy,
      resolvedByName: existing?.resolvedByName,
      resolvedAt: existing?.resolvedAt,
      source: existing?.source || source,
    };

    detectedAnomalies.push(gapAnomaly);
  }

  // Save all detected anomalies (and preserve any manually entered or previously existing ones)
  for (const anom of detectedAnomalies) {
    existingMap.set(anom.id, anom);
    await saveReceiptAnomaly(anom);
  }

  const finalAnomalies = Array.from(existingMap.values());
  const gapsCount = finalAnomalies.filter((a) => a.type === 'gap').length;
  const duplicatesCount = finalAnomalies.filter((a) => a.type === 'duplicate').length;
  const newAnomaliesCount = detectedAnomalies.filter((a) => normalizeAnomalyStatus(a.status) === 'Unresolved').length;

  // Log to Audit Trail
  await logAuditEvent(
    params.triggeredBy.uid,
    params.triggeredBy.displayName,
    params.triggeredBy.role,
    'SCAN_RECEIPT_SEQUENCES',
    'ReceiptAnomaly',
    `scan_${Date.now()}`,
    `Sequential receipt integrity audit (${source === 'sync_offline' ? 'Automatic post-offline sync' : 'Manual verification'}): ${payments.length} receipt(s) scanned, ${gapsCount} sequence gap(s) and ${duplicatesCount} duplicate(s) recorded. ${newAnomaliesCount} unresolved anomaly(ies) awaiting review.`
  );

  return {
    checkedAt: now,
    totalPaymentsScanned: payments.length,
    totalCashiersScanned: cashierGroups.size,
    gapsCount,
    duplicatesCount,
    newAnomaliesCount,
    anomalies: finalAnomalies,
  };
}

/**
 * Checks for offline merge conflicts before sync
 */
export function detectOfflineMergeConflict(
  offlinePayment: Payment,
  existingPayments: Payment[]
): { hasConflict: boolean; reason?: string; conflictingPayment?: Payment } {
  const match = existingPayments.find((p) => 
    p.receiptNumber === offlinePayment.receiptNumber ||
    (p.sequenceNumber && offlinePayment.sequenceNumber && p.sequenceNumber === offlinePayment.sequenceNumber)
  );

  if (match) {
    return {
      hasConflict: true,
      reason: `Conflict detected: Receipt number ${offlinePayment.receiptNumber} already exists on server for ${match.businessName} (recorded on ${match.paymentDate}).`,
      conflictingPayment: match,
    };
  }

  return { hasConflict: false };
}
