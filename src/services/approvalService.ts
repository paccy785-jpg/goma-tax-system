import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteField,
  runTransaction,
  query,
  where,
  limit,
  onSnapshot,
  type Unsubscribe
} from 'firebase/firestore';
import { db, handleFirestoreError, isPermissionDeniedError, OperationType } from '../firebase/config';
import { emitGlobalToast } from '../contexts/ToastContext';
import {
  ApprovalRequest,
  ApprovalRequestStatus,
  ApprovalRequestType,
  UserProfile,
  UserRole,
  BusinessSector,
  BusinessSizeClass,
  normalizeSector,
  normalizeSizeClass,
  normalizeApprovalStatus,
  normalizeUserStatus
} from '../types';
import { fingerprint, intentTimeToken } from './idempotency';
import { 
  cancelAssessment, 
  flagBusinessEnRadiation, 
  createNewTaxRateVersion, 
  logAuditEvent 
} from './dbService';
import { revokeCertificateInternal } from './certificateService';
import { todayDateString } from '../utils/date';
import { BRAND } from '../branding';

const APPROVALS_COLLECTION = 'approvalRequests';

/**
 * Number of administrators whose account is Active (not suspended). Used by the
 * Admin-suspension approval path to refuse a decision that would leave the
 * system with no administrator able to sign in and manage it.
 */
async function countActiveAdmins(): Promise<number> {
  const snap = await getDocs(query(collection(db, 'users'), where('role', '==', 'Admin')));
  return snap.docs.filter((d) => normalizeUserStatus(d.data() as UserProfile) === 'Active').length;
}

/**
 * True when a store failure is transient (offline / permission-denied) rather
 * than a refusal. Used to decide whether the atomic decision claim can be
 * skipped in favour of the deferred server write.
 */
function isTransientStoreError(err: unknown): boolean {
  if (isPermissionDeniedError(err)) return true;
  const code = (err as { code?: unknown })?.code;
  if (
    code === 'unavailable' ||
    code === 'deadline-exceeded' ||
    code === 'internal' ||
    code === 'cancelled' ||
    code === 'resource-exhausted'
  ) {
    return true;
  }
  const message = err instanceof Error ? err.message : String(err);
  return /offline|network|unavailable|failed to get document/i.test(message);
}

/**
 * Fetch all approval requests from Firestore.
 * Firestore is the only store: an empty collection is an empty list and a
 * failed read is surfaced instead of being answered with cached state.
 */
export async function getApprovalRequests(
  statusFilter?: ApprovalRequestStatus | 'ALL'
): Promise<ApprovalRequest[]> {
  try {
    const snap = await getDocs(collection(db, APPROVALS_COLLECTION));
    return filterAndSortRequests(snap.docs.map((d) => d.data() as ApprovalRequest), statusFilter);
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, APPROVALS_COLLECTION);
    return [];
  }
}

/**
 * Active-aware real-time listener for Approval Requests.
 * Bounded by Spark tier limit() and explicitly cleans up when unsubscribed.
 */
export function subscribeToApprovalRequests(
  onData: (requests: ApprovalRequest[]) => void,
  onError?: (err: any) => void,
  limitCount: number = 100
): Unsubscribe {
  console.log(`[Firestore Listener] Subscribed to approvalRequests (limit: ${limitCount})`);
  const q = query(collection(db, APPROVALS_COLLECTION), limit(limitCount));

  const unsubscribe = onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((d) => d.data() as ApprovalRequest);
      list.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
      onData(list);
    },
    (err) => {
      console.error('[Firestore Listener] Error on approvalRequests:', err);
      emitGlobalToast(`Error syncing approval requests: ${err?.message || 'Permission or network issue'}`, 'error', 'Sync Error');
      if (onError) onError(err);
      onData([]);
    }
  );

  return () => {
    console.log('[Firestore Listener] Unsubscribed from approvalRequests');
    unsubscribe();
  };
}

function filterAndSortRequests(
  list: ApprovalRequest[], 
  statusFilter?: ApprovalRequestStatus | 'ALL'
): ApprovalRequest[] {
  let res = [...list];
  if (statusFilter && statusFilter !== 'ALL') {
    res = res.filter((r) => r.status === statusFilter);
  }
  return res.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Submit a new Maker-Checker approval request
 */
export interface CreateApprovalRequestInput {
  requestType: ApprovalRequestType;
  entityType: 'Assessment' | 'Business' | 'TaxRate' | 'TaxRateConfig' | 'Certificate' | 'User';
  entityId: string;
  entityTitle: string;
  beforeValue: Record<string, any>;
  afterValue: Record<string, any>;
  justification: string;
  requester: {
    uid: string;
    displayName: string;
    role: UserRole;
  };
  targetDetails?: Record<string, any>;
}

export async function submitApprovalRequest(
  input: CreateApprovalRequestInput
): Promise<ApprovalRequest> {
  if (!input.justification || !input.justification.trim()) {
    throw new Error('A detailed justification note is mandatory to submit this request.');
  }

  // Derive the sequence from the requests that already exist on the server, and
  // always append a uniqueness suffix — a bare length-based sequence collides
  // across devices. The regex has to match the id that is actually written
  // below, suffix included: it was anchored with `$` against the bare
  // `AR-YYYY-NNNN` form, so it never matched anything and every request was
  // numbered 0001.
  const existing = await getApprovalRequests();
  const maxSeq = existing.reduce((max, r) => {
    const m = r.id.match(/^AR-\d{4}-(\d{4})/);
    return m && m[1] ? Math.max(max, parseInt(m[1], 10)) : max;
  }, 0);
  const nextSeq = (maxSeq + 1).toString().padStart(4, '0');
  // The uniqueness suffix is a hash of the request itself rather than random
  // noise: two officers filing different requests in the same instant still get
  // different ids, while a duplicated submit of the same request resolves to the
  // document that already exists.
  const id = `AR-${new Date().getFullYear()}-${nextSeq}-${fingerprint('approval.submit', [
    input.requestType,
    input.entityType,
    input.entityId,
    input.entityTitle,
    input.justification,
    input.requester.uid,
    intentTimeToken(),
  ]).toUpperCase()}`;
  const now = new Date().toISOString();

  const newRequest: ApprovalRequest = {
    id,
    requestType: input.requestType,
    entityType: input.entityType,
    entityId: input.entityId,
    entityTitle: input.entityTitle,
    requesterId: input.requester.uid,
    requesterName: input.requester.displayName,
    requesterRole: input.requester.role,
    justification: input.justification.trim(),
    status: 'Pending',
    beforeValue: input.beforeValue,
    afterValue: input.afterValue,
    targetDetails: input.targetDetails,
    createdAt: now,
  };

  // Persist in Firestore. A failure is a failure: the request only exists once
  // it is on the server, so it is never quietly recorded on this device instead.
  try {
    await setDoc(doc(db, APPROVALS_COLLECTION, id), newRequest);
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `${APPROVALS_COLLECTION}/${id}`);
  }

  // 3. Log to Audit Trail
  await logAuditEvent(
    input.requester.uid,
    input.requester.displayName,
    input.requester.role,
    'CREATE_APPROVAL_REQUEST',
    'ApprovalRequest',
    id,
    `Approval request submitted [${input.requestType}] for "${input.entityTitle}". Justification: "${input.justification.trim()}". Status: Pending review by Supervisor/Admin.`,
    input.beforeValue,
    input.afterValue
  );

  return newRequest;
}

/**
 * Review an approval request (Maker-Checker enforced)
 */
export async function reviewApprovalRequest(
  requestId: string,
  decision: 'Approved' | 'Rejected',
  reviewer: {
    uid: string;
    displayName: string;
    role: UserRole;
  },
  reviewComment: string
): Promise<ApprovalRequest> {
  if (!reviewComment || !reviewComment.trim()) {
    throw new Error('An approval justification comment or a rejection reason is mandatory.');
  }

  // Verify Role: Supervisor or Admin only
  if (reviewer.role !== 'Admin' && reviewer.role !== 'Supervisor') {
    throw new Error('Insufficient permissions: Only Supervisors or Administrators are authorized to review.');
  }

  // Retrieve the authoritative copy from Firestore. The supervisor may be
  // reviewing on a different station than the one that raised the request, so
  // only the server list is consulted; a failed read is surfaced as an error.
  const allRequests = await getApprovalRequests();
  const targetReq = allRequests.find((r) => r.id === requestId);
  if (!targetReq) {
    throw new Error(`Approval request not found (ID: ${requestId}).`);
  }

  // Compare through the shared normalizer, not raw string equality: the status
  // union also covers French spellings ('en attente', with accents/casing), and
  // the old raw check made such a request permanently unreviewable
  // ("already been processed" on every attempt).
  if (normalizeApprovalStatus(targetReq.status) !== 'Pending') {
    throw new Error(`This request has already been processed (current status: "${targetReq.status}").`);
  }

  // CRITICAL MAKER-CHECKER RULE: Approver can NEVER be the same user who submitted the request!
  if (targetReq.requesterId === reviewer.uid) {
    throw new Error(
      'Violation of internal control rule (Maker-Checker): Approver cannot be the author of the request.'
    );
  }

  const now = new Date().toISOString();
  // Persist the canonical status spelling only. The decision is documented as
  // 'Approved' | 'Rejected', but French callers pass 'approuvée'/'rejetée' —
  // writing that verbatim stores a status outside the ApprovalRequestStatus
  // union, which every downstream filter then fails to match.
  const normalizedDecision: ApprovalRequestStatus =
    normalizeApprovalStatus(decision) === 'Approved' ? 'Approved' : 'Rejected';

  // ---- PHASE 1: atomically CLAIM the decision --------------------------------
  // The pre-checks above can both pass under concurrency (two supervisors
  // reviewing from stale snapshots). Claim the decision in a transaction that
  // re-reads the request and writes its status server-side: Firestore
  // serializes the competing transactions, the losing one re-reads a non-Pending
  // request and aborts. This closes the double-review race.
  let claimedAtomically = false;
  try {
    await runTransaction(db, async (transaction) => {
      const claimRef = doc(db, APPROVALS_COLLECTION, requestId);
      const claimSnap = await transaction.get(claimRef);
      if (!claimSnap.exists()) {
        throw new Error(`Approval request not found (ID: ${requestId}).`);
      }
      const live = claimSnap.data() as ApprovalRequest;
      if (normalizeApprovalStatus(live.status) !== 'Pending') {
        throw new Error(`This request has already been processed (current status: "${live.status}").`);
      }
      if (live.requesterId === reviewer.uid) {
        throw new Error(
          'Violation of internal control rule (Maker-Checker): Approver cannot be the author of the request.'
        );
      }
      transaction.update(claimRef, {
        status: normalizedDecision,
        reviewedBy: reviewer.uid,
        reviewerName: reviewer.displayName,
        reviewerRole: reviewer.role,
        reviewedAt: now,
        reviewComment: reviewComment.trim(),
      });
    });
    claimedAtomically = true;
  } catch (err) {
    // A refusal (already processed / not found / maker-checker violation) must
    // abort the review. Connectivity or permission failures fall through to the
    // non-atomic server write at the end of this function, so a review made
    // while the SDK cache cannot run a transaction is still recorded on the
    // server once connectivity allows.
    if (!isTransientStoreError(err)) throw err;
    console.warn('[ApprovalService] Atomic claim unavailable, using the deferred server write:', err);
  }

  // ---- PHASE 2: apply the decision to the underlying record ------------------
  if (normalizedDecision === 'Approved') {
    try {
      if (targetReq.requestType === 'assessment_cancellation') {
        const reason = targetReq.afterValue?.cancellationReason || targetReq.justification;
        await cancelAssessment(targetReq.entityId, reason, reviewer);
      } else if (targetReq.requestType === 'business_deregistration') {
        const reason = targetReq.afterValue?.deregistrationReason || targetReq.justification;
        const overdueAmount = targetReq.afterValue?.overdueDebtUSD || 0;
        await flagBusinessEnRadiation(
          targetReq.entityId,
          reviewer.uid,
          reviewer.displayName,
          reason,
          overdueAmount
        );
      } else if (targetReq.requestType === 'tax_rate_override') {
        const sector = normalizeSector(targetReq.targetDetails?.activitySector || 'Commerce');
        const sizeClass = normalizeSizeClass(targetReq.targetDetails?.sizeClass || 'Small');
        const newFeeUSD = targetReq.afterValue?.annualFeeUSD || 0;
        const legalBasis = targetReq.afterValue?.legalBasis || 'Approved tariff exemption';

        await createNewTaxRateVersion({
          activitySector: sector as BusinessSector,
          sizeClass: sizeClass as BusinessSizeClass,
          newAnnualFeeUSD: newFeeUSD,
          effectiveStartDate: todayDateString(),
          legalBasis: legalBasis,
          notes: `Rate derogation approved by ${reviewer.displayName}: ${reviewComment.trim()}`,
          userProfile: {
            uid: reviewer.uid,
            email: `${reviewer.uid}@goma.gov.cd`,
            displayName: reviewer.displayName,
            role: reviewer.role,
            assignedOffice: BRAND.defaultOffice,
            active: true,
            createdAt: now,
            updatedAt: now,
          },
        });
      } else if (targetReq.requestType === 'certificate_revocation') {
        const reason = targetReq.afterValue?.revocationReason || targetReq.justification;
        await revokeCertificateInternal(targetReq.entityId, reviewer, reason, requestId);
      } else if (targetReq.requestType === 'user_admin_promotion') {
        const userRef = doc(db, 'users', targetReq.entityId);
        // Propagate failures: marking the request Approved while the role change
        // silently failed would leave it permanently unexecutable.
        await updateDoc(userRef, {
          role: 'Admin',
          updatedAt: now,
        });
        await logAuditEvent(
          reviewer.uid,
          reviewer.displayName,
          reviewer.role,
          'APPROVE_ADMIN_PROMOTION',
          'User',
          targetReq.entityId,
          `Admin promotion request approved for ${targetReq.entityTitle}. Maker: ${targetReq.requesterName}. Reviewer: ${reviewer.displayName}. Comment: "${reviewComment.trim()}".`,
          targetReq.beforeValue,
          targetReq.afterValue
        );
      } else if (targetReq.requestType === 'user_admin_suspension') {
        const userRef = doc(db, 'users', targetReq.entityId);
        // Last-Administrator guard: approving this would strip the only active
        // Admin's access and lock everyone out of administration. The throw
        // below is caught by the compensation block, which returns the request
        // to Pending so it can be reviewed once another Admin exists.
        if ((await countActiveAdmins()) <= 1) {
          throw new Error(
            'Cannot suspend the last active Administrator — promote another administrator first.'
          );
        }
        await updateDoc(userRef, {
          status: 'Suspended',
          active: false,
          updatedAt: now,
        });
        await logAuditEvent(
          reviewer.uid,
          reviewer.displayName,
          reviewer.role,
          'APPROVE_ADMIN_SUSPENSION',
          'User',
          targetReq.entityId,
          `Admin account suspension approved for ${targetReq.entityTitle}. Maker: ${targetReq.requesterName}. Reviewer: ${reviewer.displayName}. Comment: "${reviewComment.trim()}".`,
          targetReq.beforeValue,
          targetReq.afterValue
        );
      } else if (targetReq.requestType === 'user_admin_reactivation') {
        const userRef = doc(db, 'users', targetReq.entityId);
        // Reactivation is the inverse of suspension and goes through the same
        // dual-authorization gate — restoring an Administrator's revoked access
        // unilaterally would undo the control the suspension enforced.
        await updateDoc(userRef, {
          status: 'Active',
          active: true,
          updatedAt: now,
        });
        await logAuditEvent(
          reviewer.uid,
          reviewer.displayName,
          reviewer.role,
          'APPROVE_ADMIN_REACTIVATION',
          'User',
          targetReq.entityId,
          `Admin account reactivation approved for ${targetReq.entityTitle}. Maker: ${targetReq.requesterName}. Reviewer: ${reviewer.displayName}. Comment: "${reviewComment.trim()}".`,
          targetReq.beforeValue,
          targetReq.afterValue
        );
      }

      // Log approval to Audit Ledger
      await logAuditEvent(
        reviewer.uid,
        reviewer.displayName,
        reviewer.role,
        'APPROVE_REQUEST',
        'ApprovalRequest',
        requestId,
        `Approval request ${requestId} (${targetReq.requestType}) APPROVED by ${reviewer.displayName} (${reviewer.role}). Comment: "${reviewComment.trim()}". Changes successfully applied to entity ${targetReq.entityId}.`,
        targetReq.beforeValue,
        targetReq.afterValue
      );
    } catch (err) {
      // Compensation: if the atomic claim already closed this request, re-open
      // it so another reviewer can retry. The old code could leave a request
      // marked "Approved" with its effect never applied (or applied twice after
      // a manual retry).
      if (claimedAtomically) {
        try {
          await updateDoc(doc(db, APPROVALS_COLLECTION, requestId), {
            status: 'Pending',
            reviewedBy: deleteField(),
            reviewerName: deleteField(),
            reviewerRole: deleteField(),
            reviewedAt: deleteField(),
            reviewComment: deleteField(),
          });
        } catch (restoreErr) {
          console.warn('[ApprovalService] Failed to restore request to Pending after application error:', restoreErr);
        }
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  } else {
    // Rejection: Nothing changes in underlying record, but rejection is permanently audited
    await logAuditEvent(
      reviewer.uid,
      reviewer.displayName,
      reviewer.role,
      'REJECT_APPROVAL_REQUEST',
      'ApprovalRequest',
      requestId,
      `Approval request ${requestId} (${targetReq.requestType}) REJECTED by ${reviewer.displayName} (${reviewer.role}). Rejection reason: "${reviewComment.trim()}". No changes applied.`,
      targetReq.beforeValue,
      targetReq.afterValue
    );
  }

  const updatedReq: ApprovalRequest = {
    ...targetReq,
    status: normalizedDecision,
    reviewedBy: reviewer.uid,
    reviewerName: reviewer.displayName,
    reviewerRole: reviewer.role,
    reviewedAt: now,
    reviewComment: reviewComment.trim(),
  };

  // Update Firestore ONLY when the atomic claim could not be made (offline
  // path). When the claim succeeded, the status is already persisted. A failure
  // here is propagated to the caller — the decision is never recorded on this
  // device only.
  if (!claimedAtomically) {
    try {
      await updateDoc(doc(db, APPROVALS_COLLECTION, requestId), {
        status: normalizedDecision,
        reviewedBy: reviewer.uid,
        reviewerName: reviewer.displayName,
        reviewerRole: reviewer.role,
        reviewedAt: now,
        reviewComment: reviewComment.trim(),
      });
    } catch (err) {
      throw new Error(
        `The decision could not be written to the server, so it was not recorded: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  return updatedReq;
}
