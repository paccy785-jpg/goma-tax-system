import React, { useState, useEffect, useMemo } from 'react';
import { 
  Users, 
  UserPlus, 
  Shield, 
  ShieldCheck, 
  KeyRound, 
  Search, 
  Filter, 
  CheckCircle2, 
  XCircle, 
  Lock, 
  Unlock, 
  Mail, 
  Phone, 
  Building2, 
  Calendar, 
  Pencil, 
  RefreshCw, 
  Sliders, 
  Sparkles, 
  AlertTriangle, 
  X, 
  Eye, 
  EyeOff, 
  Copy, 
  Check, 
  Save, 
  RotateCcw,
  UserCheck,
  UserX,
  FileCheck,
  ShieldAlert
} from 'lucide-react';
import { 
  UserProfile, 
  UserRole, 
  UserStatus, 
  NavigationItem, 
  RolePermissionsMap, 
  normalizeUserStatus 
} from '../types';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { 
  getAllSystemUsers, 
  subscribeToSystemUsers, 
  createSystemUser, 
  updateSystemUserDirect, 
  requestAdminPromotionApproval, 
  requestAdminSuspensionApproval, 
  requestAdminReactivationApproval, 
  sendUserPasswordReset, 
  getRolePermissions, 
  subscribeToRolePermissions, 
  saveRolePermissions, 
  MODULE_CATALOG, 
  DEFAULT_ROLE_PERMISSIONS 
} from '../services/userService';
import { PageHeader, Button, Badge, Panel, MetricStrip } from './ui';
import { officeLabel, portalBrand } from '../branding';
import { ACTIVE_PORTAL } from '../firebase/config';

/** Default office of a new account on this portal. */
const DEFAULT_OFFICE = portalBrand(ACTIVE_PORTAL).defaultOffice;

const ROLE_COLORS: Record<UserRole, { badge: string; text: string; bg: string; border: string }> = {
  Admin: {
    badge: 'bg-purple-100 text-purple-800 border-purple-300',
    text: 'text-purple-700',
    bg: 'bg-purple-50',
    border: 'border-purple-200',
  },
  Supervisor: {
    badge: 'bg-blue-100 text-blue-800 border-blue-300',
    text: 'text-blue-700',
    bg: 'bg-blue-50',
    border: 'border-blue-200',
  },
  Cashier: {
    badge: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    text: 'text-emerald-700',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
  },
  Auditor: {
    badge: 'bg-amber-100 text-amber-800 border-amber-300',
    text: 'text-amber-700',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
  },
};

const ALL_ROLES: UserRole[] = ['Admin', 'Supervisor', 'Cashier', 'Auditor'];

export const UsersView: React.FC = () => {
  const { userProfile: activeAdmin, userRole } = useAuth();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<'users' | 'matrix'>('users');
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loadingUsers, setLoadingUsers] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Role Permissions Matrix State
  const [permissions, setPermissions] = useState<RolePermissionsMap>(DEFAULT_ROLE_PERMISSIONS);
  const [originalPermissions, setOriginalPermissions] = useState<RolePermissionsMap>(DEFAULT_ROLE_PERMISSIONS);
  const [isSavingPermissions, setIsSavingPermissions] = useState<boolean>(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);

  // Create form state
  const [createName, setCreateName] = useState<string>('');
  const [createEmail, setCreateEmail] = useState<string>('');
  const [createPhone, setCreatePhone] = useState<string>('');
  const [createRole, setCreateRole] = useState<UserRole>('Cashier');
  const [createPassword, setCreatePassword] = useState<string>('');
  const [createOffice, setCreateOffice] = useState<string>(DEFAULT_OFFICE);
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [isSubmittingCreate, setIsSubmittingCreate] = useState<boolean>(false);
  const [copiedPassword, setCopiedPassword] = useState<boolean>(false);

  // Edit form state
  const [editRole, setEditRole] = useState<UserRole>('Cashier');
  const [editStatus, setEditStatus] = useState<UserStatus>('Active');
  const [editPhone, setEditPhone] = useState<string>('');
  const [editOffice, setEditOffice] = useState<string>('');
  const [editJustification, setEditJustification] = useState<string>('');
  const [isSubmittingEdit, setIsSubmittingEdit] = useState<boolean>(false);

  // Subscribe to Users collection
  useEffect(() => {
    setLoadingUsers(true);
    const unsub = subscribeToSystemUsers((userList) => {
      setUsers(userList);
      setLoadingUsers(false);
    });
    return () => unsub();
  }, []);

  // Subscribe to /settings/rolePermissions
  useEffect(() => {
    const unsub = subscribeToRolePermissions((perms) => {
      setPermissions(perms);
      setOriginalPermissions(perms);
      setHasUnsavedChanges(false);
    });
    return () => unsub();
  }, []);

  // Check if permissions matrix has unsaved edits
  const handleTogglePermission = (role: UserRole, moduleId: NavigationItem) => {
    const currentList = permissions[role] || [];
    const exists = currentList.includes(moduleId);
    const updatedList = exists
      ? currentList.filter((m) => m !== moduleId)
      : [...currentList, moduleId];

    const newPerms = {
      ...permissions,
      [role]: updatedList,
    };
    setPermissions(newPerms);
    setHasUnsavedChanges(JSON.stringify(newPerms) !== JSON.stringify(originalPermissions));
  };

  const handleSavePermissions = async () => {
    // The role-permissions matrix is the app-wide RBAC source of truth — only
    // an Administrator may commit it. `activeAdmin` exists for any signed-in
    // user, so gate on the role as well.
    if (!activeAdmin || userRole !== 'Admin') {
      showToast('Only Administrators can modify the role permissions matrix.', 'error', 'Permission Denied');
      return;
    }
    setIsSavingPermissions(true);
    try {
      await saveRolePermissions(permissions, activeAdmin.uid, activeAdmin.displayName);
      setOriginalPermissions(permissions);
      setHasUnsavedChanges(false);
      showToast('Role Permissions Matrix updated successfully! Sidebar access synchronized in real-time.', 'success', 'Permissions Saved');
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Failed to save permissions.', 'error', 'Save Error');
    } finally {
      setIsSavingPermissions(false);
    }
  };

  const handleResetToDefaults = () => {
    setPermissions(DEFAULT_ROLE_PERMISSIONS);
    setHasUnsavedChanges(JSON.stringify(DEFAULT_ROLE_PERMISSIONS) !== JSON.stringify(originalPermissions));
    showToast('Reset to system default role matrix. Click "Save Matrix Changes" to commit.', 'info', 'Defaults Staged');
  };

  // Auto-generate strong secure password
  const generateRandomPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*';
    // `Math.random()` is a predictable PRNG — two generated passwords from the
    // same page load share a recoverable seed, so an officer's first credential
    // was guessable from one they had already seen. Use the platform CSPRNG.
    const buf = new Uint32Array(12);
    crypto.getRandomValues(buf);
    let res = '';
    for (let i = 0; i < 12; i++) {
      res += chars.charAt(buf[i] % chars.length);
    }
    setCreatePassword(res);
    setShowPassword(true);
  };

  /**
   * One entry point for opening the enrollment form. Every "New User" button
   * used to do its own partial setup — the empty-state button skipped the
   * password generation entirely, so enrolling the first officer opened the form
   * with a blank (or a previous officer's) password. Resetting here also clears
   * anything typed into a form the officer then cancelled.
   */
  const openCreateModal = () => {
    setCreateName('');
    setCreateEmail('');
    setCreatePhone('');
    setCreateRole('Cashier');
    setCreateOffice(DEFAULT_OFFICE);
    setCopiedPassword(false);
    generateRandomPassword();
    setIsCreateModalOpen(true);
  };

  const closeCreateModal = () => {
    setIsCreateModalOpen(false);
    setCreateName('');
    setCreateEmail('');
    setCreatePhone('');
    setCreatePassword('');
    setCreateRole('Cashier');
    setCreateOffice(DEFAULT_OFFICE);
    setCopiedPassword(false);
  };

  const copyGeneratedPassword = () => {
    if (!createPassword) return;
    navigator.clipboard.writeText(createPassword).then(() => {
      setCopiedPassword(true);
      setTimeout(() => setCopiedPassword(false), 2000);
    }).catch(() => {
      showToast('Copy failed — select and copy the password manually.', 'warning', 'Clipboard blocked');
    });
  };

  // Create User Handler
  const handleCreateUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Re-entry guard: a disabled submit button does NOT stop implicit form
    // submission via the Enter key — without this check, pressing Enter twice
    // fired two createSystemUser calls (duplicate officers / duplicate
    // maker-checker requests).
    if (isSubmittingCreate) return;
    // `activeAdmin` is only the signed-in profile — the name is misleading. The
    // form is hidden for non-Admins, but a hidden form is not authorisation: the
    // handler must refuse on its own, and the Firestore rules now refuse too.
    if (userRole !== 'Admin') {
      showToast('Only an Administrator can create staff accounts.', 'error', 'Not permitted');
      return;
    }
    if (!createName.trim() || !createEmail.trim() || !createPassword.trim()) {
      showToast('Please fill in Full Name, Email, and Password.', 'error', 'Validation Error');
      return;
    }

    if (createPassword.length < 6) {
      showToast('Password must be at least 6 characters.', 'error', 'Weak Password');
      return;
    }

    setIsSubmittingCreate(true);
    try {
      await createSystemUser({
        fullName: createName.trim(),
        email: createEmail.trim().toLowerCase(),
        phone: createPhone.trim(),
        role: createRole,
        password: createPassword,
        assignedOffice: createOffice.trim(),
        adminUid: activeAdmin?.uid || 'admin_user',
        adminName: activeAdmin?.displayName || 'System Administrator',
      });

      showToast(`Account for ${createName} (${createEmail}) created successfully with role ${createRole}. Current session preserved.`, 'success', 'User Created');
      closeCreateModal();
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Failed to create user account.', 'error', 'Account Creation Failed');
    } finally {
      setIsSubmittingCreate(false);
    }
  };

  // Open Edit Modal
  const handleOpenEditModal = (user: UserProfile) => {
    setSelectedUser(user);
    setEditRole(user.role);
    setEditStatus(normalizeUserStatus(user));
    setEditPhone(user.phone || '');
    setEditOffice(officeLabel(user.assignedOffice));
    setEditJustification('');
    setIsEditModalOpen(true);
  };

  // Password reset dispatch
  const handleTriggerPasswordReset = async (email: string) => {
    try {
      const res = await sendUserPasswordReset(
        email, 
        activeAdmin?.uid || 'admin', 
        activeAdmin?.displayName || 'Administrator'
      );
      showToast(res.message, 'success', 'Password Reset');
    } catch (err: any) {
      showToast(err.message || 'Error sending password reset.', 'error', 'Reset Failed');
    }
  };

  // Handle Edit User Submit (Routes to Maker-Checker for Admin promotion or Admin suspension)
  const handleEditUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Re-entry guard for the Enter-key double-submit path (see create handler).
    if (isSubmittingEdit) return;
    if (!selectedUser || !activeAdmin) return;
    if (userRole !== 'Admin') {
      showToast('Only an Administrator can edit staff accounts.', 'error', 'Not permitted');
      return;
    }

    // Self-target guard: no administrator may modify their own account through
    // this form — the maker-checker contract requires the checker to be a
    // different person than the maker.
    if (selectedUser.uid === activeAdmin.uid) {
      showToast('You cannot modify your own account. Ask another Administrator to perform this action.', 'error', 'Self-Modification Blocked');
      return;
    }

    const isPromotingToAdmin = selectedUser.role !== 'Admin' && editRole === 'Admin';
    // ANY status change on an Administrator row is sensitive — suspension AND
    // reactivation. Reactivation used to fall through to the direct-update
    // path, restoring revoked Admin access without dual authorization and
    // undoing the control the suspension enforced.
    const isSuspendingAdmin =
      selectedUser.role === 'Admin' &&
      editStatus === 'Suspended' &&
      normalizeUserStatus(selectedUser) === 'Active';
    // Reactivation is only its own action when the role is left alone. A
    // suspended Admin whose role is ALSO being changed is a compound edit, and
    // the reactivation approval applies only the status — routing it here would
    // silently drop the role change while telling the operator both had been
    // submitted. That combination is refused below and done in two steps.
    const isReactivatingAdmin =
      selectedUser.role === 'Admin' &&
      editRole === 'Admin' &&
      editStatus === 'Active' &&
      normalizeUserStatus(selectedUser) === 'Suspended';
    const isCompoundAdminEdit =
      selectedUser.role === 'Admin' &&
      editRole !== 'Admin' &&
      editStatus === 'Active' &&
      normalizeUserStatus(selectedUser) === 'Suspended';

    if (isCompoundAdminEdit) {
      showToast(
        `Reactivating ${selectedUser.displayName} and changing their role are two separate authorizations. Reactivate the account first, then change the role once it is active again.`,
        'error',
        'Two-Step Change Required'
      );
      return;
    }

    // Maker-checker check: require justification
    if ((isPromotingToAdmin || isSuspendingAdmin || isReactivatingAdmin) && !editJustification.trim()) {
      showToast('Justification is required for sensitive administrative access modifications.', 'error', 'Maker-Checker Notice');
      return;
    }

    setIsSubmittingEdit(true);
    try {
      if (isPromotingToAdmin) {
        // Route to Pending Approvals
        await requestAdminPromotionApproval(
          selectedUser,
          editJustification.trim(),
          activeAdmin.uid,
          activeAdmin.displayName,
          activeAdmin.role
        );
        showToast(
          `Promotion to Administrator for ${selectedUser.displayName} submitted to Pending Approvals queue for dual-signoff authorization.`,
          'info',
          'Approval Request Staged'
        );
      } else if (isSuspendingAdmin) {
        // Route to Pending Approvals
        await requestAdminSuspensionApproval(
          selectedUser,
          editJustification.trim(),
          activeAdmin.uid,
          activeAdmin.displayName,
          activeAdmin.role
        );
        showToast(
          `Administrator suspension for ${selectedUser.displayName} submitted to Pending Approvals queue for dual authorization.`,
          'info',
          'Approval Request Staged'
        );
      } else if (isReactivatingAdmin) {
        // Restoring revoked Admin access is the exact inverse of the
        // suspension above, so it takes the same dual-authorization gate. This
        // branch was computed but never routed: reactivation fell through to
        // `updateSystemUserDirect`, so one Administrator could undo a
        // suspension that required two signatures to impose.
        await requestAdminReactivationApproval(
          selectedUser,
          editJustification.trim(),
          activeAdmin.uid,
          activeAdmin.displayName,
          activeAdmin.role
        );
        showToast(
          `Administrator reactivation for ${selectedUser.displayName} submitted to Pending Approvals queue for dual authorization.`,
          'info',
          'Approval Request Staged'
        );
      } else {
        // Direct update for non-admin roles and non-sensitive status changes
        await updateSystemUserDirect(
          selectedUser.uid,
          {
            role: editRole,
            status: editStatus,
            phone: editPhone.trim(),
            assignedOffice: editOffice.trim(),
          },
          activeAdmin.uid,
          activeAdmin.displayName
        );
        showToast(`User profile for ${selectedUser.displayName} updated successfully.`, 'success', 'User Updated');
      }

      setIsEditModalOpen(false);
      setSelectedUser(null);
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Failed to update user profile.', 'error', 'Update Error');
    } finally {
      setIsSubmittingEdit(false);
    }
  };

  // Filtered users list
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = 
        !q ||
        u.displayName.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.phone && u.phone.toLowerCase().includes(q)) ||
        (u.assignedOffice && u.assignedOffice.toLowerCase().includes(q));

      const matchesRole = roleFilter === 'ALL' || u.role === roleFilter;
      const normalizedStatus = normalizeUserStatus(u);
      const matchesStatus = statusFilter === 'ALL' || normalizedStatus === statusFilter;

      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [users, searchQuery, roleFilter, statusFilter]);

  // Counts
  const totalCount = users.length;
  const activeCount = users.filter((u) => normalizeUserStatus(u) === 'Active').length;
  const suspendedCount = users.filter((u) => normalizeUserStatus(u) === 'Suspended').length;
  const adminCount = users.filter((u) => u.role === 'Admin').length;
  const isReadOnly = userRole !== 'Admin';

  // The access changes that require dual authorization, computed ONCE so the
  // warning banner, the justification field and the submit button label can
  // never drift apart. They did drift: the Admin-reactivation case was added to
  // the submit handler but to none of these three, so the form neither asked
  // for a justification nor said the action would be queued — and its
  // justification guard then rejected the submission with a bare toast.
  //
  // A compound edit (reactivate a suspended Admin AND change their role) is not
  // listed here: it is refused outright by the submit handler, so the form must
  // not offer it the maker-checker treatment.
  const editIsSensitive =
    !!selectedUser &&
    ((selectedUser.role !== 'Admin' && editRole === 'Admin') ||
      (selectedUser.role === 'Admin' &&
        editRole === 'Admin' &&
        ((editStatus === 'Suspended' && normalizeUserStatus(selectedUser) === 'Active') ||
          (editStatus === 'Active' && normalizeUserStatus(selectedUser) === 'Suspended'))));

  const handleReloadUsers = async () => {
    setLoadingUsers(true);
    try {
      const list = await getAllSystemUsers();
      setUsers(list);
    } finally {
      setLoadingUsers(false);
    }
  };

  return (
    <div className="space-y-8 font-sans">
      {/* Page Header */}
      <PageHeader
        eyebrow="Administration"
        title="Users & Role-Based Access Management"
        description="Officer account provisioning, Maker-Checker authorization protocols, and fine-grained dynamic module matrix."
        actions={
          <>
            <Button
              variant="ghost"
              size="md"
              onClick={handleReloadUsers}
              disabled={loadingUsers}
              icon={<RefreshCw className={`w-3.5 h-3.5 ${loadingUsers ? 'animate-spin' : ''}`} />}
            >
              Refresh
            </Button>
            {!isReadOnly && (
              <Button
                variant="primary"
                size="md"
                onClick={openCreateModal}
                icon={<UserPlus className="w-4 h-4" />}
              >
                Enroll New Officer
              </Button>
            )}
          </>
        }
      />

      {/* Metric Summary Strip */}
      <MetricStrip
        columns={4}
        items={[
          {
            label: 'Total Officers',
            value: totalCount.toString(),
            trend: 'Enrolled staff',
            trendType: 'muted',
            subline: 'Municipal tax personnel',
            icon: <Users className="w-4 h-4 text-accent" />,
          },
          {
            label: 'Active Status',
            value: activeCount.toString(),
            trend: 'Full privileges',
            trendType: 'sage',
            subline: 'Operational accounts',
            icon: <CheckCircle2 className="w-4 h-4 text-sage" />,
          },
          {
            label: 'Suspended Access',
            value: suspendedCount.toString(),
            trend: suspendedCount > 0 ? 'Revoked credentials' : 'None',
            trendType: suspendedCount > 0 ? 'danger' : 'muted',
            subline: 'Barred from ledger entry',
            icon: <UserX className="w-4 h-4 text-danger" />,
          },
          {
            label: 'Administrators',
            value: adminCount.toString(),
            trend: 'Maker-checker root',
            trendType: 'muted',
            subline: 'Urban revenue governance',
            icon: <ShieldCheck className="w-4 h-4 text-accent" />,
          },
        ]}
      />

      {/* Tab Switcher */}
      <div className="flex items-center gap-2 border-b border-line pb-2">
        <button
          onClick={() => setActiveTab('users')}
          className={`flex items-center gap-2 px-4 py-2 rounded-[10px] text-xs font-semibold transition-premium cursor-pointer ${
            activeTab === 'users'
              ? 'bg-accent text-white shadow-xs font-bold'
              : 'text-muted hover:text-ink hover:bg-surface2'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          System Users ({users.length})
        </button>
        <button
          onClick={() => setActiveTab('matrix')}
          className={`flex items-center gap-2 px-4 py-2 rounded-[10px] text-xs font-semibold transition-premium cursor-pointer ${
            activeTab === 'matrix'
              ? 'bg-accent text-white shadow-xs font-bold'
              : 'text-muted hover:text-ink hover:bg-surface2'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          Role Permissions Matrix
          {hasUnsavedChanges && (
            <span className="w-2 h-2 rounded-full bg-warn animate-ping" />
          )}
        </button>
      </div>

      {/* TAB 1: SYSTEM USERS */}
      {activeTab === 'users' && (
        <div className="space-y-6">

          {/* Action & Filter Toolbar */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex flex-1 flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              {/* Search Bar */}
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 bg-slate-50 focus:bg-white focus:border-indigo-500 focus:outline-hidden transition-all text-slate-900"
                />
              </div>

              {/* Role Filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">Role:</span>
                <select
                  value={roleFilter}
                  onChange={(e) => setRoleFilter(e.target.value)}
                  className="px-2.5 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-800 font-medium focus:outline-hidden"
                >
                  <option value="ALL">All Roles</option>
                  <option value="Admin">Admin</option>
                  <option value="Supervisor">Supervisor</option>
                  <option value="Cashier">Cashier</option>
                  <option value="Auditor">Auditor</option>
                </select>
              </div>

              {/* Status Filter */}
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">Status:</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="px-2.5 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-800 font-medium focus:outline-hidden"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="Active">Active</option>
                  <option value="Suspended">Suspended</option>
                </select>
              </div>
            </div>

            {/* New User Button — only for Admins (matches the header buttons;
                a non-Admin who ever reaches this view must not be able to
                enroll officers or edit the RBAC matrix). */}
            {!isReadOnly && (
              <button
                onClick={openCreateModal}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold shadow-xs transition-all cursor-pointer whitespace-nowrap"
              >
                <UserPlus className="w-4 h-4" />
                New User
              </button>
            )}
          </div>

          {/* Users Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="premium-table w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[11px]">
                    <th className="py-3 px-4">Officer Name & Contact</th>
                    <th className="py-3 px-4">Role</th>
                    <th className="py-3 px-4">Assigned Station / Office</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Date Added</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {loadingUsers ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-slate-400">
                        <RefreshCw className="w-5 h-5 mx-auto animate-spin mb-2 text-indigo-500" />
                        Loading system accounts from Firestore...
                      </td>
                    </tr>
                  ) : filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-slate-500">
                        No system users found matching the query.
                      </td>
                    </tr>
                  ) : (
                    filteredUsers.map((u) => {
                      const normalizedStatus = normalizeUserStatus(u);
                      const isSuspended = normalizedStatus === 'Suspended';
                      const roleMeta = ROLE_COLORS[u.role] || ROLE_COLORS.Cashier;
                      const formattedDate = u.createdAt 
                        ? new Date(u.createdAt).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })
                        : 'Pre-existing';

                      return (
                        <tr key={u.uid} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3.5 px-4">
                            <div className="font-bold text-slate-900 text-sm">{u.displayName}</div>
                            <div className="flex items-center gap-3 text-slate-500 text-[12px] mt-0.5">
                              <span className="flex items-center gap-1">
                                <Mail className="w-3 h-3 text-slate-400" />
                                {u.email}
                              </span>
                              {u.phone && (
                                <span className="flex items-center gap-1 font-mono">
                                  <Phone className="w-3 h-3 text-slate-400" />
                                  {u.phone}
                                </span>
                              )}
                            </div>
                          </td>

                          <td className="py-3.5 px-4 whitespace-nowrap">
                            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-bold border ${roleMeta.badge}`}>
                              <Shield className="w-3 h-3" />
                              {u.role}
                            </span>
                          </td>

                          <td className="py-3.5 px-4 text-slate-600">
                            <div className="flex items-center gap-1.5">
                              <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span className="truncate max-w-[200px]">{officeLabel(u.assignedOffice)}</span>
                            </div>
                          </td>

                          <td className="py-3.5 px-4 whitespace-nowrap">
                            {isSuspended ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                                <Lock className="w-3 h-3 text-rose-500" />
                                Suspended
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                Active
                              </span>
                            )}
                          </td>

                          <td className="py-3.5 px-4 text-slate-500 text-[12px] whitespace-nowrap">
                            <div className="flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-slate-400" />
                              {formattedDate}
                            </div>
                          </td>

                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              {/* Edit User Button */}
                              <button
                                onClick={() => handleOpenEditModal(u)}
                                className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50/50 transition-all cursor-pointer"
                                title="Edit Role & Details"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>

                              {/* Password Reset Dispatch */}
                              <button
                                onClick={() => handleTriggerPasswordReset(u.email)}
                                className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-amber-600 hover:border-amber-200 hover:bg-amber-50/50 transition-all cursor-pointer"
                                title="Send Password Reset Email"
                              >
                                <KeyRound className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Table Footer */}
            <div className="p-3 bg-slate-50 border-t border-slate-200 text-slate-500 text-xs flex items-center justify-between">
              <span>Showing {filteredUsers.length} of {users.length} enrolled users</span>
              <span className="text-[12px] text-slate-400 font-mono">
                Spark-tier multi-instance auth isolation active
              </span>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: ROLE PERMISSIONS MATRIX */}
      {activeTab === 'matrix' && (
        <div className="space-y-5">
          {/* Header Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Sliders className="w-5 h-5 text-indigo-600" />
                <h2 className="text-lg font-bold text-slate-900">Module Access Control Matrix</h2>
              </div>
              <p className="text-xs text-slate-500 mt-1 max-w-2xl">
                Configure module visibility for each of the 4 system roles. Stored in <code className="bg-slate-100 text-slate-700 px-1 py-0.5 rounded font-mono text-[12px]">/settings/rolePermissions</code> and synchronized app-wide in real-time across user workstations.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2.5">
              {!isReadOnly && (
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => {
                    generateRandomPassword();
                    setIsCreateModalOpen(true);
                  }}
                  icon={<UserPlus className="w-4 h-4" />}
                >
                  Create User
                </Button>
              )}

              {!isReadOnly && (
                <button
                  onClick={handleResetToDefaults}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg border border-slate-300 transition-all cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                  Reset Defaults
                </button>
              )}

              <button
                onClick={handleSavePermissions}
                disabled={isSavingPermissions || !hasUnsavedChanges || isReadOnly}
                className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-bold rounded-lg shadow-xs transition-all ${
                  hasUnsavedChanges
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer ring-2 ring-emerald-500/20 animate-pulse'
                    : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                }`}
              >
                {isSavingPermissions ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-3.5 h-3.5" />
                    {hasUnsavedChanges ? 'Save Matrix Changes' : 'All Changes Saved'}
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Matrix Grid Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="premium-table w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-900 text-white font-bold text-[12px]">
                    <th className="py-3.5 px-4 w-1/3">System Module / Subsystem</th>
                    {ALL_ROLES.map((role) => {
                      const enabledCount = (permissions[role] || []).length;
                      return (
                        <th key={role} className="py-3.5 px-4 text-center">
                          <div className="font-bold text-sm">{role}</div>
                          <div className="text-[11px] text-slate-400 font-normal mt-0.5">
                            {enabledCount} of {MODULE_CATALOG.length} modules
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {MODULE_CATALOG.map((module) => {
                    return (
                      <tr key={module.id} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 uppercase">
                              {module.category}
                            </span>
                            <span className="font-bold text-slate-900 text-sm">{module.label}</span>
                          </div>
                          <p className="text-[12px] text-slate-500 mt-0.5">{module.description}</p>
                        </td>

                        {ALL_ROLES.map((role) => {
                          const isAllowed = (permissions[role] || []).includes(module.id);
                          return (
                            <td key={role} className="py-3 px-4 text-center">
                              <button
                                type="button"
                                onClick={() => handleTogglePermission(role, module.id)}
                                className={`inline-flex items-center justify-center w-12 h-6 rounded-full transition-colors relative cursor-pointer ${
                                  isAllowed ? 'bg-emerald-600' : 'bg-slate-200'
                                }`}
                                title={`${isAllowed ? 'Revoke' : 'Grant'} access to ${module.label} for ${role}`}
                              >
                                <span
                                  className={`w-4 h-4 rounded-full bg-white transition-transform transform shadow-xs flex items-center justify-center ${
                                    isAllowed ? 'translate-x-3' : '-translate-x-3'
                                  }`}
                                >
                                  {isAllowed ? (
                                    <Check className="w-2.5 h-2.5 text-emerald-600 stroke-[3]" />
                                  ) : (
                                    <X className="w-2.5 h-2.5 text-slate-400 stroke-[3]" />
                                  )}
                                </span>
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Matrix Help Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 text-xs text-slate-600 flex flex-col sm:flex-row items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-indigo-700 font-medium">
                <CheckCircle2 className="w-4 h-4" />
                Changes apply instantly upon saving. Users see updated sidebar navigation upon real-time sync.
              </span>
              <span className="text-[12px] text-slate-400">
                Firestore Key: /settings/rolePermissions
              </span>
            </div>
          </div>
        </div>
      )}

      {/* CREATE USER MODAL */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-lg w-full p-6 shadow-2xl animate-in fade-in duration-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center border border-indigo-200">
                  <UserPlus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-slate-900 text-base">Create System User</h3>
                  <p className="text-xs text-slate-500">Spark-tier secondary instance credential provisioning</p>
                </div>
              </div>
              <button
                onClick={closeCreateModal}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateUserSubmit} className="space-y-4">
              {/* Full Name */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Full Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Rachel Masika"
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:border-indigo-500 focus:outline-hidden"
                />
              </div>

              {/* Email */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Official Email Address <span className="text-rose-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  placeholder="e.g. rachel.masika@tax.gouv.cd"
                  value={createEmail}
                  onChange={(e) => setCreateEmail(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:border-indigo-500 focus:outline-hidden"
                />
              </div>

              {/* Phone (Optional) */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Phone Number <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <input
                  type="tel"
                  placeholder="e.g. +243 998 123 456"
                  value={createPhone}
                  onChange={(e) => setCreatePhone(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:border-indigo-500 focus:outline-hidden font-mono"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Role */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    System Role <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={createRole}
                    onChange={(e) => setCreateRole(e.target.value as UserRole)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:border-indigo-500 focus:outline-hidden bg-white"
                  >
                    <option value="Cashier">Cashier (Collector)</option>
                    <option value="Supervisor">Supervisor (Control)</option>
                    <option value="Auditor">Auditor (Inspection)</option>
                    {/* No Admin option: promotion to Administrator is a
                        maker-checker decision, requested from the edit panel,
                        never granted at creation. */}
                  </select>
                </div>

                {/* Assigned Office */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Station / Assigned Office
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Commune of Karisimbi"
                    value={createOffice}
                    onChange={(e) => setCreateOffice(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>
              </div>

              {/* Initial Password */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700">
                    Initial Temporary Password <span className="text-rose-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={generateRandomPassword}
                    className="text-[12px] font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 cursor-pointer"
                  >
                    <Sparkles className="w-3 h-3" />
                    Auto-Generate
                  </button>
                </div>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    placeholder="Min 6 characters"
                    value={createPassword}
                    onChange={(e) => setCreatePassword(e.target.value)}
                    className="w-full pl-3 pr-20 py-2 text-xs rounded-lg border border-slate-300 focus:border-indigo-500 focus:outline-hidden font-mono"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="text-slate-400 hover:text-slate-600 p-1"
                      title={showPassword ? 'Hide' : 'Show'}
                    >
                      {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={copyGeneratedPassword}
                      className="text-slate-400 hover:text-indigo-600 p-1"
                      title="Copy Password"
                    >
                      {copiedPassword ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Security Isolation Notice */}
              <div className="p-3 bg-indigo-50/70 border border-indigo-100 rounded-xl text-xs text-indigo-900 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">Active Session Guard:</span> This account is provisioned via an isolated background Firebase instance. Your currently logged-in Admin session will remain active without interruption.
                </div>
              </div>

              {/* Form Actions */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={closeCreateModal}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 rounded-lg border border-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingCreate}
                  className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs flex items-center gap-2 cursor-pointer"
                >
                  {isSubmittingCreate ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Provisioning...
                    </>
                  ) : (
                    'Create Account'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT USER MODAL */}
      {isEditModalOpen && selectedUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-lg w-full p-6 shadow-2xl animate-in fade-in duration-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-700 flex items-center justify-center border border-indigo-200">
                  <Pencil className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-slate-900 text-base">Edit User Profile</h3>
                  <p className="text-xs text-slate-500">{selectedUser.displayName} ({selectedUser.email})</p>
                </div>
              </div>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleEditUserSubmit} className="space-y-4">
              {/* Role */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Role Assignment</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as UserRole)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:border-indigo-500 focus:outline-hidden bg-white font-medium"
                >
                  <option value="Cashier">Cashier</option>
                  <option value="Supervisor">Supervisor</option>
                  <option value="Auditor">Auditor</option>
                  <option value="Admin">Administrator (Maker-Checker Approval Required)</option>
                </select>
              </div>

              {/* Status */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Account Status</label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value as UserStatus)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:border-indigo-500 focus:outline-hidden bg-white font-medium"
                >
                  <option value="Active">Active (Permitted read/write per RBAC rules)</option>
                  <option value="Suspended">Suspended (Blocked from reading/writing via Firestore rules)</option>
                </select>
              </div>

              {/* Phone & Office */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Phone Number</label>
                  <input
                    type="tel"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:border-indigo-500 focus:outline-hidden font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Station / Office</label>
                  <input
                    type="text"
                    value={editOffice}
                    onChange={(e) => setEditOffice(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>
              </div>

              {/* Maker-Checker Warning Banners */}
              {selectedUser.role !== 'Admin' && editRole === 'Admin' && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
                  <div className="flex items-center gap-1.5 font-bold mb-1">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    Maker-Checker Rule (Phase 10 & 12)
                  </div>
                  Promoting any officer to Administrator is a sensitive authorization change. This action cannot be applied directly: it will be staged into the <strong>Pending Approvals</strong> queue for dual-officer sign-off.
                </div>
              )}

              {selectedUser.role === 'Admin' &&
                editStatus === 'Suspended' &&
                normalizeUserStatus(selectedUser) === 'Active' && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-900">
                    <div className="flex items-center gap-1.5 font-bold mb-1">
                      <ShieldAlert className="w-4 h-4 text-rose-600" />
                      Sensitive Administrative Suspension
                    </div>
                    Suspending an Administrator account requires dual authorization and will route to the <strong>Pending Approvals</strong> maker-checker ledger.
                  </div>
                )}

              {selectedUser.role === 'Admin' &&
                editRole === 'Admin' &&
                editStatus === 'Active' &&
                normalizeUserStatus(selectedUser) === 'Suspended' && (
                  <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-xs text-indigo-900">
                    <div className="flex items-center gap-1.5 font-bold mb-1">
                      <ShieldCheck className="w-4 h-4 text-indigo-600" />
                      Sensitive Administrative Reactivation
                    </div>
                    Restoring a suspended Administrator&apos;s revoked access is the inverse of a suspension and takes the same dual authorization: it routes to the <strong>Pending Approvals</strong> maker-checker ledger rather than being applied here.
                  </div>
                )}

              {/* Justification input if sensitive */}
              {editIsSensitive ? (
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Regulatory / Administrative Justification <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    rows={3}
                    required
                    placeholder="Provide official rationale (e.g. Urban ministerial delegation, security suspension protocol)..."
                    value={editJustification}
                    onChange={(e) => setEditJustification(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:border-indigo-500 focus:outline-hidden"
                  />
                </div>
              ) : null}

              {/* Quick Actions (Password Reset) */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-800">Password Reset</div>
                  <div className="text-[12px] text-slate-500">Send an official reset token to {selectedUser.email}</div>
                </div>
                <button
                  type="button"
                  onClick={() => handleTriggerPasswordReset(selectedUser.email)}
                  className="px-3 py-1.5 text-xs font-bold bg-white text-slate-700 border border-slate-300 hover:border-indigo-400 hover:text-indigo-600 rounded-lg shadow-2xs transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <Mail className="w-3.5 h-3.5" />
                  Dispatch Reset
                </button>
              </div>

              {/* Form Buttons */}
              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 rounded-lg border border-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingEdit}
                  className="px-5 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs flex items-center gap-2 cursor-pointer"
                >
                  {isSubmittingEdit ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Saving...
                    </>
                  ) : editIsSensitive ? (
                    'Submit to Approvals Queue'
                  ) : (
                    'Apply Changes'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
