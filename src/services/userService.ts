import { initializeApp, deleteApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  deleteUser,
  signOut as secondarySignOut,
  sendPasswordResetEmail
} from 'firebase/auth';
import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  onSnapshot, 
  limit, 
  query, 
  where,
  type Unsubscribe 
} from 'firebase/firestore';
import { db, auth as primaryAuth, ACTIVE_PORTAL } from '../firebase/config';
import firebaseConfig from '../../firebase-applet-config.json';
import { 
  UserProfile, 
  UserRole, 
  UserStatus, 
  NavigationItem, 
  RolePermissionsMap, 
  normalizeUserStatus,
  ApprovalRequest 
} from '../types';
import { logAuditEvent } from './dbService';
import { portalBrand } from '../branding';
import { submitApprovalRequest } from './approvalService';

// Module catalog and descriptive grouping for the Role Permissions Matrix
export interface ModuleItemConfig {
  id: NavigationItem;
  label: string;
  category: 'Overview' | 'Operations' | 'Finance & Controls' | 'Governance & System';
  description: string;
}

export const MODULE_CATALOG: ModuleItemConfig[] = [
  { id: 'dashboard', label: 'Dashboard', category: 'Overview', description: 'Executive revenue KPIs, real-time collection trends & commune breakdowns' },
  { id: 'businesses', label: 'Taxpayer Registry', category: 'Operations', description: 'Municipal fiscal roll: taxpayer identity (NIF / Nat ID), patente classification & ledger standing' },
  { id: 'declarations', label: 'Declarations', category: 'Operations', description: 'Standing of every contributor\'s fiscal declaration for the cycle: filed, under review, assessed & settled' },
  { id: 'assessments', label: 'Tax Assessments', category: 'Operations', description: 'Annual tax assessment bills (Avis d\'Imposition) and calculations' },
  { id: 'payments', label: 'Payment History', category: 'Operations', description: 'Fiscal receipt ledger, collected revenue & verification proofs' },
  { id: 'payroll', label: 'Payroll & Advances', category: 'Finance & Controls', description: 'Salary disbursement runs, employee payouts & salary advance tracking' },
  { id: 'expenses', label: 'Recurring Expenses', category: 'Finance & Controls', description: 'Repeating operating costs, due-date cadence & treasury payment ledger' },
  { id: 'reception', label: 'Reception', category: 'Operations', description: 'Front-desk visitor check-in, service queue & live waiting clocks' },
  { id: 'announcements', label: 'Announcement Board', category: 'Operations', description: 'Inter-department posts, issue threads & staff memos' },
  { id: 'cash-reconciliation', label: 'Cash Reconciliation', category: 'Finance & Controls', description: 'Cashier shift opening/closing, physical cash tally & treasury deposits' },
  { id: 'verify-receipt', label: 'Verify a Receipt', category: 'Finance & Controls', description: 'Public receipt authenticator with QR verification and anti-fraud checks' },
  { id: 'receipt-anomalies', label: 'Receipt Anomalies', category: 'Finance & Controls', description: 'Receipt sequence gaps, duplicates & missing serial alerts' },
  { id: 'approvals', label: 'Pending Approvals', category: 'Finance & Controls', description: 'Maker-Checker dual authorization queue for cancellations, closures & rates' },
  { id: 'certificates', label: 'Business Licenses', category: 'Operations', description: 'Issue, view, and print official Patente license certificates' },
  { id: 'reports', label: 'Reports & Settlement', category: 'Overview', description: 'Treasury reports, municipal bank settlements & analytical export' },
  { id: 'compliance', label: 'Delinquent Taxpayers', category: 'Operations', description: 'Overdue debtor tracking, summons notices & administrative closure' },
  { id: 'audit-log', label: 'Audit Log', category: 'Governance & System', description: 'Append-only immutable event ledger of all system operations' },
  { id: 'settings', label: 'Settings', category: 'Governance & System', description: 'Tariff schedule configuration, system parameters & exchange rates' },
  { id: 'users', label: 'Users', category: 'Governance & System', description: 'User accounts, credential provisioning & role permission matrix' },
];

/**
 * Standard seed defaults specified in Phase 12 requirements:
 * - Admin: everything (18 modules)
 * - Supervisor: everything except Users and Settings
 * - Cashier: Reception, Business Registry, Tax Assessments, Payment History, Recurring Expenses, Cash Reconciliation, Verify a Receipt
 * - Auditor: read-only-relevant modules — Audit Log, Reports & Settlement, Receipt Anomalies, Pending Approvals, Delinquent Taxpayers, Business Registry, Business Licenses, Payroll & Advances, Recurring Expenses, Reception
 */
export const DEFAULT_ROLE_PERMISSIONS: RolePermissionsMap = {
  Admin: [
    'dashboard',
    'reception',
    'announcements',
    'businesses',
    'declarations',
    'taxpayer-profile',
    'transfer',
    'bank-agent',
    'note-perception',
    'notifications',
    'assessments',
    'payments',
    'payroll',
    'expenses',
    'cash-reconciliation',
    'verify-receipt',
    'receipt-anomalies',
    'approvals',
    'certificates',
    'reports',
    'compliance',
    'audit-log',
    'settings',
    'users',
  ],
  Supervisor: [
    'dashboard',
    'reception',
    'announcements',
    'businesses',
    'declarations',
    'taxpayer-profile',
    'transfer',
    'bank-agent',
    'note-perception',
    'notifications',
    'assessments',
    'payments',
    'payroll',
    'expenses',
    'cash-reconciliation',
    'verify-receipt',
    'receipt-anomalies',
    'approvals',
    'certificates',
    'reports',
    'compliance',
    'audit-log',
  ],
  Cashier: [
    'reception',
    'announcements',
    'businesses',
    'taxpayer-profile',
    'bank-agent',
    'note-perception',
    'notifications',
    'assessments',
    'payments',
    'expenses',
    'cash-reconciliation',
    'verify-receipt',
  ],
  Auditor: [
    'audit-log',
    'reports',
    'receipt-anomalies',
    'approvals',
    'compliance',
    'businesses',
    'declarations',
    'taxpayer-profile',
    'transfer',
    'bank-agent',
    'note-perception',
    'notifications',
    'certificates',
    'payroll',
    'expenses',
    'reception',
    'announcements',
  ],
};

// Permission documents created before Payroll/Expenses/Reception/Announcements
// were introduced contain arrays without the new modules. Keep a schema marker
// so intentional revocations are preserved once an administrator saves the
// matrix again.
// 12 introduced the Nomenclatures des Impôts module, since moved into Settings
// as a subtab; the version stays so saved matrices are read the same way.
const ROLE_PERMISSIONS_SCHEMA_VERSION = 12;

/**
 * The schema version each module was introduced at.
 *
 * A document written before a module's version is backfilled with that
 * module, so an existing installation picks the new module up on its own. A
 * document already at (or after) that version honours the saved list exactly
 * as-is — which is what keeps an administrator's deliberate revocation from
 * being silently undone when a later module is added.
 *
 * Thresholds are per module, not a single blanket backfill, precisely so that
 * adding one module never re-applies the backfill of an older one.
 */
const MODULE_INTRO_VERSION: Record<string, number> = {
  payroll: 5,
  expenses: 5,
  reception: 5,
  announcements: 5,
  declarations: 6,
  transfer: 7,
  'bank-agent': 8,
  'taxpayer-profile': 9,
  notifications: 10,
  'note-perception': 11,
};

const BACKFILL_MODULES: NavigationItem[] = [
  'payroll',
  'expenses',
  'reception',
  'announcements',
  'declarations',
  'transfer',
  'bank-agent',
  'taxpayer-profile',
  'notifications',
  'note-perception',
];

const normalizeRolePermissionRecord = (data: Record<string, unknown>): RolePermissionsMap => {
  const schemaVersion = typeof data.permissionsVersion === 'number'
    ? data.permissionsVersion
    : 0;
  const readRole = (role: UserRole): NavigationItem[] => {
    const stored = Array.isArray(data[role])
      ? (data[role] as NavigationItem[]).filter((item) => typeof item === 'string')
      : [...DEFAULT_ROLE_PERMISSIONS[role]];

    // The Payroll and Expenses releases were deployed after existing
    // permission documents were written. Backfill only the modules that were
    // introduced after the document was saved; current documents honor every
    // saved addition/removal exactly as-is.
    const defaults = DEFAULT_ROLE_PERMISSIONS[role];
    const missing = BACKFILL_MODULES.filter(
      (module) =>
        defaults.includes(module) &&
        !stored.includes(module) &&
        schemaVersion < (MODULE_INTRO_VERSION[module] ?? ROLE_PERMISSIONS_SCHEMA_VERSION)
    );
    if (missing.length > 0) return [...stored, ...missing];

    return stored;
  };

  return {
    Admin: readRole('Admin'),
    Supervisor: readRole('Supervisor'),
    Cashier: readRole('Cashier'),
    Auditor: readRole('Auditor'),
  };
};


export interface CreateUserInput {
  fullName: string;
  email: string;
  phone?: string;
  role: UserRole;
  password: string;
  assignedOffice?: string;
  adminUid: string;
  adminName: string;
}

/**
 * Creates a new Firebase Auth account without signing out the currently logged-in Admin session.
 * Utilizes a secondary named Firebase App instance, calls createUserWithEmailAndPassword on it,
 * signs out of the secondary instance, deletes the instance, and writes the user document
 * directly into Firestore using the primary app instance.
 */
export async function createSystemUser(input: CreateUserInput): Promise<UserProfile> {
  const { fullName, email, phone, role, password, assignedOffice, adminUid, adminName } = input;
  const trimmedEmail = email.trim().toLowerCase();
  const trimmedName = fullName.trim();
  const trimmedPhone = phone?.trim() || '';
  const trimmedOffice = assignedOffice?.trim() || portalBrand(ACTIVE_PORTAL).defaultOffice;

  // Instantiate temporary named Firebase App for background credential generation
  const tempAppName = `UserCreation_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  let tempApp: any = null;
  let tempAuth: any = null;

  let newUid = '';
  try {
    tempApp = initializeApp(firebaseConfig, tempAppName);
    tempAuth = getAuth(tempApp);

    // Create the account in Firebase Auth via the secondary instance
    const cred = await createUserWithEmailAndPassword(tempAuth, trimmedEmail, password);
    newUid = cred.user.uid;

    const now = new Date().toISOString();
    const newUserProfile: UserProfile = {
      uid: newUid,
      email: trimmedEmail,
      displayName: trimmedName,
      phone: trimmedPhone,
      role,
      assignedOffice: trimmedOffice,
      status: 'Active',
      active: true,
      createdAt: now,
      updatedAt: now,
    };

    // Write new user profile to /users/{uid} using the PRIMARY app's Firestore instance.
    //
    // The temporary app is kept alive until this write succeeds. It used to be
    // signed out and deleted in a `finally` the moment the Auth account existed,
    // so a profile write that then failed left an ORPHAN: a real Auth account
    // with no profile document. Such an account can never sign in (no role, no
    // permissions) and never appears in the user register, and because the
    // email is now taken, retrying the creation fails with
    // "email already in use" — the only ways back were the Firebase console or
    // waiting for someone to notice.
    //
    // Rolling the Auth account back requires the user to still be signed in on
    // the temporary instance (`deleteUser` needs a recent login, which this is),
    // so the sign-out below happens only after the profile is safely written or
    // the rollback has been attempted.
    try {
      await setDoc(doc(db, 'users', newUid), newUserProfile);
    } catch (profileErr) {
      // Compensating rollback: remove the Auth account we just created so the
      // email is free and no half-provisioned identity is left behind.
      try {
        await deleteUser(cred.user);
      } catch (deleteErr) {
        console.error('[UserService] Rollback failed — orphaned Auth account remains:', deleteErr);
        throw new Error(
          `Account "${trimmedEmail}" was created in authentication but its profile could not be saved, and it could not be removed automatically. ` +
          `Delete the account with UID ${newUid} from the Firebase console before retrying, or the email will be reported as already in use.`
        );
      }
      throw profileErr instanceof Error
        ? profileErr
        : new Error(`The user profile could not be saved: ${String(profileErr)}`);
    }

    // Append immutable audit log event
    await logAuditEvent(
      adminUid,
      adminName,
      'Admin',
      'CREATE_USER',
      'User',
      newUid,
      `New system user account provisioned: "${trimmedName}" (${trimmedEmail}) assigned role ${role} at ${trimmedOffice}.`,
      null,
      newUserProfile
    );

    return newUserProfile;
  } catch (authErr: any) {
    console.error('[UserService] Auth creation error on secondary app:', authErr);
    // In case of domain or network fallback, generate a deterministic fallback UID
    if (authErr.code === 'auth/email-already-in-use') {
      // Sign-in identities are shared by the two portals; their user lists are
      // not. An email already used on the other portal cannot be created again
      // here: that person signs in to this portal and asks for access.
      throw new Error(
        `An account with email "${trimmedEmail}" already exists. If it is an account of the other portal, ask that person to sign in to this portal and click "Request access", then activate the request here.`
      );
    }
    throw authErr;
  } finally {
    // Clear any session residue on the temporary instance, then drop the app.
    if (tempAuth) {
      await secondarySignOut(tempAuth).catch(() => {});
    }
    if (tempApp) {
      await deleteApp(tempApp).catch((delErr: any) => console.warn('[UserService] Secondary app deletion note:', delErr));
    }
  }
}

/**
 * Fetch all users from Firestore.
 *
 * The bound is a ceiling, not a page: a municipal tax office's roster is far
 * below it. It was 100, which is a display cap rather than a correctness one
 * (the last-Administrator tally queries `/users` with a `where` and no bound),
 * but a past-100 staff list silently dropped users from the register and from
 * the Admin count shown on it.
 *
 * Deliberately NOT ordered by `createdAt`: Firestore's `orderBy` omits
 * documents that lack the field entirely, so legacy profiles written before
 * that field existed would disappear from the roster — a far worse failure
 * than an unsorted list.
 */
export async function getAllSystemUsers(): Promise<UserProfile[]> {
  try {
    const snap = await getDocs(query(collection(db, 'users'), limit(1000)));
    return snap.docs.map((d) => {
      const data = d.data() as UserProfile;
      return {
        ...data,
        status: normalizeUserStatus(data),
      };
    });
  } catch (err) {
    console.warn('[UserService] getAllSystemUsers fallback:', err);
    return [];
  }
}

/**
 * Real-time listener for the users collection
 */
export function subscribeToSystemUsers(callback: (users: UserProfile[]) => void): Unsubscribe {
  // See getAllSystemUsers for why the bound is 1000 and why there is no
  // orderBy here.
  const q = query(collection(db, 'users'), limit(1000));
  return onSnapshot(
    q,
    (snapshot) => {
      const list = snapshot.docs.map((d) => {
        const data = d.data() as UserProfile;
        return {
          ...data,
          status: normalizeUserStatus(data),
        };
      });
      callback(list);
    },
    (err) => {
      console.warn('[UserService] subscribeToSystemUsers error:', err);
      callback([]);
    }
  );
}

/**
 * Number of administrators whose account is Active (not suspended). Used to
 * refuse any operation that would leave the system with no administrator able
 * to sign in and manage it.
 */
async function countActiveAdmins(): Promise<number> {
  const snap = await getDocs(query(collection(db, 'users'), where('role', '==', 'Admin')));
  return snap.docs.filter((d) => normalizeUserStatus(d.data() as UserProfile) === 'Active').length;
}

/**
 * Refuse a write that would strip the last active Administrator of Admin
 * access (by demotion or suspension). Without this, an Admin could demote or
 * suspend the only other Admin — or, via the maker-checker suspension route, a
 * Supervisor could do it — locking everyone out of settings, users and roles
 * with no in-app way back.
 */
async function assertNotLastActiveAdmin(willLoseAdmin: boolean): Promise<void> {
  if (!willLoseAdmin) return;
  const total = await countActiveAdmins();
  if (total <= 1) {
    throw new Error(
      'This is the only active Administrator. Promote another administrator before demoting or suspending this account.'
    );
  }
}

/**
 * Edit non-sensitive user details (Supervisor, Cashier, Auditor roles; phone, office, or suspension of non-Admin accounts).
 */
export async function updateSystemUserDirect(
  userUid: string,
  updates: Partial<UserProfile>,
  adminUid: string,
  adminName: string
): Promise<void> {
  const userRef = doc(db, 'users', userUid);
  const userSnap = await getDoc(userRef);
  const beforeData = userSnap.exists() ? userSnap.data() : null;

  const now = new Date().toISOString();
  // Whitelist non-sensitive fields only — promotion to Admin must go through
  // the maker-checker approval queue, never a direct write. Previously `role`
  // was silently dropped here while UsersView sent it and showed a success
  // toast: every Cashier→Supervisor (and Admin→X demotion) edit was a no-op
  // with a false audit entry.
  const { phone, assignedOffice, status, role } = updates;
  const payload: any = {
    updatedAt: now,
  };
  if (phone !== undefined) payload.phone = phone;
  if (assignedOffice !== undefined) payload.assignedOffice = assignedOffice;
  if (status !== undefined) {
    payload.status = status;
    payload.active = status === 'Active';
  }
  if (role !== undefined) {
    const VALID_ROLES: UserRole[] = ['Supervisor', 'Cashier', 'Auditor'];
    if (!VALID_ROLES.includes(role)) {
      throw new Error(
        `Direct role change to "${role}" is not permitted — promotion to Admin must go through the Pending Approvals queue.`
      );
    }
    payload.role = role;
  }

  // Last-Administrator guard: this update must not remove the only active
  // Admin's access. `beforeData` is the pre-image, so the target still counts
  // as an active Admin in the tally below — a count of 1 therefore means "this
  // is that last one".
  const before = beforeData as UserProfile | null;
  const beforeIsActiveAdmin =
    !!before && before.role === 'Admin' && normalizeUserStatus(before) === 'Active';
  const willLoseAdmin =
    beforeIsActiveAdmin &&
    ((role !== undefined && role !== 'Admin') ||
      (status !== undefined && status === 'Suspended'));
  await assertNotLastActiveAdmin(willLoseAdmin);

  await updateDoc(userRef, payload);

  await logAuditEvent(
    adminUid,
    adminName,
    'Admin',
    'UPDATE_USER_PROFILE',
    'User',
    userUid,
    `User profile updated for UID: ${userUid} by Administrator ${adminName}. Changes: ${JSON.stringify(updates)}`,
    beforeData,
    payload
  );
}

/**
 * Routes user promotion to Admin through the Pending Approvals maker-checker queue.
 */
export async function requestAdminPromotionApproval(
  targetUser: UserProfile,
  justification: string,
  adminUid: string,
  adminName: string,
  adminRole: UserRole = 'Admin'
): Promise<ApprovalRequest> {
  const req = await submitApprovalRequest({
    requestType: 'user_admin_promotion',
    entityType: 'User',
    entityId: targetUser.uid,
    entityTitle: `Promote to Admin: ${targetUser.displayName} (${targetUser.email})`,
    requester: {
      uid: adminUid,
      displayName: adminName,
      role: adminRole,
    },
    justification: justification.trim(),
    beforeValue: {
      role: targetUser.role,
      status: targetUser.status || 'Active',
      displayName: targetUser.displayName,
      email: targetUser.email,
    },
    afterValue: {
      role: 'Admin',
      previousRole: targetUser.role,
      promotionReason: justification.trim(),
    },
    targetDetails: {
      userName: targetUser.displayName,
      userEmail: targetUser.email,
      currentRole: targetUser.role,
      targetRole: 'Admin',
      assignedOffice: targetUser.assignedOffice,
    },
  });

  await logAuditEvent(
    adminUid,
    adminName,
    adminRole,
    'REQUEST_ADMIN_PROMOTION',
    'User',
    targetUser.uid,
    `Admin promotion proposal submitted to Pending Approvals queue for user "${targetUser.displayName}" (${targetUser.email}). Justification: ${justification.trim()}`
  );

  return req;
}

/**
 * Routes suspension of an existing Admin account through the Pending Approvals maker-checker queue.
 */
export async function requestAdminSuspensionApproval(
  targetAdmin: UserProfile,
  justification: string,
  adminUid: string,
  adminName: string,
  adminRole: UserRole = 'Admin'
): Promise<ApprovalRequest> {
  const req = await submitApprovalRequest({
    requestType: 'user_admin_suspension',
    entityType: 'User',
    entityId: targetAdmin.uid,
    entityTitle: `Admin Account Suspension: ${targetAdmin.displayName} (${targetAdmin.email})`,
    requester: {
      uid: adminUid,
      displayName: adminName,
      role: adminRole,
    },
    justification: justification.trim(),
    beforeValue: {
      role: 'Admin',
      status: 'Active',
      displayName: targetAdmin.displayName,
      email: targetAdmin.email,
    },
    afterValue: {
      status: 'Suspended',
      active: false,
      suspensionReason: justification.trim(),
    },
    targetDetails: {
      userName: targetAdmin.displayName,
      userEmail: targetAdmin.email,
      currentRole: 'Admin',
      targetStatus: 'Suspended',
      assignedOffice: targetAdmin.assignedOffice,
    },
  });

  await logAuditEvent(
    adminUid,
    adminName,
    adminRole,
    'REQUEST_ADMIN_SUSPENSION',
    'User',
    targetAdmin.uid,
    `Admin suspension proposal submitted to Pending Approvals queue for administrator "${targetAdmin.displayName}" (${targetAdmin.email}). Justification: ${justification.trim()}`
  );

  return req;
}

/**
 * Routes reactivation of a suspended Admin account through the Pending Approvals
 * maker-checker queue. Reactivation is the inverse of suspension: it restores
 * revoked Administrator access and therefore requires the same dual
 * authorization — doing it through the direct-update path would undermine the
 * control the suspension enforced.
 */
export async function requestAdminReactivationApproval(
  targetAdmin: UserProfile,
  justification: string,
  adminUid: string,
  adminName: string,
  adminRole: UserRole = 'Admin'
): Promise<ApprovalRequest> {
  const req = await submitApprovalRequest({
    requestType: 'user_admin_reactivation',
    entityType: 'User',
    entityId: targetAdmin.uid,
    entityTitle: `Admin Account Reactivation: ${targetAdmin.displayName} (${targetAdmin.email})`,
    requester: {
      uid: adminUid,
      displayName: adminName,
      role: adminRole,
    },
    justification: justification.trim(),
    beforeValue: {
      role: 'Admin',
      status: 'Suspended',
      active: false,
      displayName: targetAdmin.displayName,
      email: targetAdmin.email,
    },
    afterValue: {
      status: 'Active',
      active: true,
      reactivationReason: justification.trim(),
    },
    targetDetails: {
      userName: targetAdmin.displayName,
      userEmail: targetAdmin.email,
      currentRole: 'Admin',
      targetStatus: 'Active',
      assignedOffice: targetAdmin.assignedOffice,
    },
  });

  await logAuditEvent(
    adminUid,
    adminName,
    adminRole,
    'REQUEST_ADMIN_REACTIVATION',
    'User',
    targetAdmin.uid,
    `Admin reactivation proposal submitted to Pending Approvals queue for administrator "${targetAdmin.displayName}" (${targetAdmin.email}). Justification: ${justification.trim()}`
  );

  return req;
}

/**
 * Triggers a password reset email via Firebase Auth for the given user email.
 */
export async function sendUserPasswordReset(
  email: string,
  adminUid: string,
  adminName: string
): Promise<{ success: boolean; message: string }> {
  try {
    await sendPasswordResetEmail(primaryAuth, email);
    await logAuditEvent(
      adminUid,
      adminName,
      'Admin',
      'PASSWORD_RESET_DISPATCHED',
      'User',
      email,
      `Password reset instructions dispatched via email to ${email} by ${adminName}.`
    );
    return {
      success: true,
      message: `Password reset email dispatched to ${email}.`,
    };
  } catch (err: any) {
    console.warn('[UserService] sendPasswordResetEmail error:', err);
    // Log the security event, but tell the admin the truth: the email failed.
    await logAuditEvent(
      adminUid,
      adminName,
      'Admin',
      'PASSWORD_RESET_REQUESTED',
      'User',
      email,
      `Password reset requested for ${email} but dispatch FAILED. Reason: ${err?.code || err?.message || 'unknown error'}.`
    );
    const code: string = err?.code || '';
    const reason = code.includes('user-not-found')
      ? `No account exists for ${email}.`
      : code.includes('invalid-email')
        ? 'The email address is invalid.'
        : `Email dispatch failed (${code || err?.message || 'unknown error'}). Check connectivity and try again.`;
    return {
      success: false,
      message: reason,
    };
  }
}

/**
 * Fetch role permissions from Firestore /settings/rolePermissions.
 * Seeds defaults if not existing.
 */
export async function getRolePermissions(): Promise<RolePermissionsMap> {
  const permDocRef = doc(db, 'settings', 'rolePermissions');
  try {
    const snap = await getDoc(permDocRef);
    if (snap.exists()) {
      return normalizeRolePermissionRecord(snap.data() as Record<string, unknown>);
    } else {
      // Seed default permissions document in Firestore
      await setDoc(permDocRef, {
        ...DEFAULT_ROLE_PERMISSIONS,
        updatedAt: new Date().toISOString(),
        updatedBy: 'System Bootstrap',
      });
      return DEFAULT_ROLE_PERMISSIONS;
    }
  } catch (err) {
    console.warn('[UserService] getRolePermissions fallback:', err);
    return DEFAULT_ROLE_PERMISSIONS;
  }
}

/**
 * Real-time listener for /settings/rolePermissions
 */
export function subscribeToRolePermissions(
  callback: (permissions: RolePermissionsMap) => void
): Unsubscribe {
  const permDocRef = doc(db, 'settings', 'rolePermissions');
  return onSnapshot(
    permDocRef,
    async (snap) => {
      if (snap.exists()) {
        callback(normalizeRolePermissionRecord(snap.data() as Record<string, unknown>));
      } else {
        // Seed default
        await setDoc(permDocRef, {
          ...DEFAULT_ROLE_PERMISSIONS,
          updatedAt: new Date().toISOString(),
          updatedBy: 'System Bootstrap',
        }).catch(() => {});
        callback(DEFAULT_ROLE_PERMISSIONS);
      }
    },
    (err) => {
      console.warn('[UserService] subscribeToRolePermissions error:', err);
      callback(DEFAULT_ROLE_PERMISSIONS);
    }
  );
}

/**
 * Save updated role permissions to /settings/rolePermissions in Firestore and log to Audit Log
 */
export async function saveRolePermissions(
  newPermissions: RolePermissionsMap,
  adminUid: string,
  adminName: string
): Promise<void> {
  const permDocRef = doc(db, 'settings', 'rolePermissions');
  const now = new Date().toISOString();

  await setDoc(permDocRef, {
    Admin: newPermissions.Admin,
    Supervisor: newPermissions.Supervisor,
    Cashier: newPermissions.Cashier,
    Auditor: newPermissions.Auditor,
    permissionsVersion: ROLE_PERMISSIONS_SCHEMA_VERSION,
    updatedAt: now,
    updatedBy: adminName,
  });

  await logAuditEvent(
    adminUid,
    adminName,
    'Admin',
    'UPDATE_ROLE_PERMISSIONS',
    'User',
    'rolePermissions',
    `Role permissions matrix reconfigured and saved by Administrator ${adminName}.`,
    null,
    newPermissions
  );
}
