/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { OfflineBanner } from './components/OfflineBanner';
import { DashboardView } from './components/DashboardView';
import { TaxpayerRegistryView } from './components/TaxpayerRegistryView';
import { DeclarationsView } from './components/DeclarationsView';
import { TransferView } from './components/TransferView';
import { TaxpayerProfileView } from './components/TaxpayerProfileView';
import { BankAgentView } from './components/BankAgentView';
import { NotePerceptionView } from './components/NotePerceptionView';
import { NotificationsView } from './components/NotificationsView';
import { PayrollView } from './components/PayrollView';
import { ExpensesView } from './components/ExpensesView';
import { ReceptionView } from './components/ReceptionView';
import { AnnouncementBoardView } from './components/AnnouncementBoardView';
import { CashReconciliationView } from './components/CashReconciliationView';
import { ReportsView } from './components/ReportsView';
import { AuditLogView } from './components/AuditLogView';
import { SettingsView } from './components/SettingsView';
import { UsersView } from './components/UsersView';
import { LoginView } from './components/LoginView';
import { DgiPortalView } from './components/DgiPortalView';
import { PortalAccessView } from './components/PortalAccessView';
import { ACTIVE_PORTAL } from './firebase/config';
import { NavigationItem, RolePermissionsMap, normalizeUserStatus } from './types';
import { BRAND, PortalId, monogramSize, portalBrand } from './branding';
import { Lock, LogOut } from 'lucide-react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { subscribeToRolePermissions, DEFAULT_ROLE_PERMISSIONS } from './services/userService';

/**
 * Modules deliberately removed from the portal. They stay in `NavigationItem`
 * and in the role-permissions matrix, but are not routable: the view guard
 * rejects them so any stale/deep link falls back to the dashboard instead of
 * rendering the module.
 */
const DISABLED_VIEWS: NavigationItem[] = [
  'assessments',
  'certificates',
  'verify-receipt',
  'receipt-anomalies',
  'approvals',
  'compliance',
];

/**
 * Portal selection is URL-addressable (`?portal=dgi`) so each sign-in surface
 * has its own link. Anything else resolves to the DPRNK portal. The portal is
 * read once, when the page loads: it also decides which database the app works
 * on (see firebase/config), so switching portal reloads the page.
 */
function resolvePortalFromUrl(): PortalId {
  return ACTIVE_PORTAL;
}

interface MainPortalProps {
  portal: PortalId;
  onSwitchPortal: (portal: PortalId) => void;
}

function MainPortal({ portal, onSwitchPortal }: MainPortalProps) {
  const { currentUser, userProfile, userRole, initializing, logout, portalAccess } = useAuth();
  const [currentView, setView] = useState<NavigationItem>('dashboard');
  /**
   * Payment History is a subtab of Bank Agent. Anything that still navigates
   * to 'payments' (dashboard links, cash reconciliation) opens Bank Agent on
   * that subtab; the counter remounts Bank Agent so the request takes effect
   * even when Bank Agent is already open.
   */
  const [paymentsRequest, setPaymentsRequest] = useState(0);
  const [openOnPayments, setOpenOnPayments] = useState(false);
  const setCurrentView = (view: NavigationItem) => {
    if (view === 'payments') {
      setView('bank-agent');
      setOpenOnPayments(true);
      setPaymentsRequest((n) => n + 1);
    } else {
      setView(view);
      setOpenOnPayments(false);
    }
  };
  const [isMobileOpen, setIsMobileOpen] = useState<boolean>(false);
  const [rolePermissions, setRolePermissions] = useState<RolePermissionsMap>(DEFAULT_ROLE_PERMISSIONS);

  // Subscribe to real-time role permissions matrix from Firestore.
  // Rules deny reads without a signed-in user, so wait for the session.
  useEffect(() => {
    if (!userProfile) return;
    const unsub = subscribeToRolePermissions((perms) => {
      setRolePermissions(perms);
    });
    return () => unsub();
  }, [userProfile?.uid]);

  const brand = portalBrand(portal);

  // Only the initial session bootstrap shows the full-screen loader. A failed
  // sign-in must NOT unmount LoginView, or its error message is lost (the
  // attempt toggles `loading`, which used to swap the whole portal for this
  // loader and back to a fresh, error-less form).
  if (initializing) {
    return (
      <div className="min-h-screen bg-paper flex flex-col items-center justify-center text-ink p-4 font-sans">
        <div className="w-12 h-12 rounded-[14px] brand-mark-vivid text-white flex items-center justify-center font-display font-bold tracking-tight animate-pulse mb-4" style={{ fontSize: monogramSize(48, 6, 0.616, brand.monogram.length) }}>
          {brand.monogram}
        </div>
        <div className="font-display font-bold tracking-tight text-xl brand-title-vivid">
          {brand.shortName}
        </div>
        <div className="text-xs text-muted mt-1 font-sans">
          {brand.terminalName} — connecting to revenue ledger & local cache...
        </div>
      </div>
    );
  }

  // Signed in, but no profile on this portal's database: still being decided,
  // or this account has no access here (the portals' accounts are separate).
  if (currentUser && !userProfile && portalAccess === 'checking') {
    return (
      <div className="min-h-screen bg-paper flex flex-col items-center justify-center text-ink p-4 font-sans">
        <div className="w-12 h-12 rounded-[14px] brand-mark-vivid text-white flex items-center justify-center font-display font-bold tracking-tight animate-pulse mb-4" style={{ fontSize: monogramSize(48, 6, 0.616, brand.monogram.length) }}>
          {brand.monogram}
        </div>
        <div className="text-xs text-muted font-sans">Checking access to this portal…</div>
        {/* The answer needs the server. Offline, it never arrives — and a
            spinner with no way out leaves the officer stuck on this screen.
            Signing out is always possible. */}
        <button
          type="button"
          onClick={() => void logout()}
          className="mt-5 px-4 py-2 text-xs font-semibold text-ink bg-surface border border-line rounded-xl hover:bg-surface2 transition-premium"
        >
          Sign out
        </button>
      </div>
    );
  }
  if (currentUser && !userProfile && portalAccess === 'none') {
    return <PortalAccessView portal={portal} mode="none" onSwitchPortal={onSwitchPortal} />;
  }

  if (!userProfile) {
    return <LoginView portal={portal} onSwitchPortal={onSwitchPortal} />;
  }

  // An access request filed on this portal, not yet granted.
  if (userProfile.accessRequested && normalizeUserStatus(userProfile) === 'Suspended') {
    return <PortalAccessView portal={portal} mode="requested" onSwitchPortal={onSwitchPortal} />;
  }

  // Suspended Account Lock Screen
  if (normalizeUserStatus(userProfile) === 'Suspended') {
    return (
      <div className="min-h-screen bg-paper flex flex-col items-center justify-center text-ink p-6 text-center font-sans">
        <div className="w-16 h-16 rounded-[18px] bg-danger/10 text-danger flex items-center justify-center border border-danger/30 mb-4 shadow-sm">
          <Lock className="w-8 h-8" />
        </div>
        <h2 className="font-display text-2xl font-bold text-ink tracking-tight">
          Account Suspended • Access Revoked
        </h2>
        <p className="text-sm text-muted max-w-md mt-2 leading-relaxed">
          Your account ({userProfile.email}) has been placed into administrative suspension by municipal revenue control. All read and write privileges have been revoked under Goma urban tax security policies.
        </p>
        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={() => logout()}
            className="flex items-center gap-2 px-5 py-2.5 rounded-[10px] bg-navy hover:bg-navy2 text-white font-medium text-xs transition-premium cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  // The DGI portal: the same shell as DPRNK, with the DGI tabs (Registration).
  if (portal === 'dgi') {
    return <DgiPortalView onSwitchPortal={onSwitchPortal} rolePermissions={rolePermissions} />;
  }

  // Guard view accessibility dynamically by role permissions matrix
  const isViewAllowed = (view: NavigationItem): boolean => {
    if (DISABLED_VIEWS.includes(view)) return false;
    const allowedList = rolePermissions[userRole] || DEFAULT_ROLE_PERMISSIONS[userRole] || [];
    if (view === 'taxpayers') return allowedList.includes('businesses');
    return allowedList.includes(view);
  };

  const permittedViews = rolePermissions[userRole] || DEFAULT_ROLE_PERMISSIONS[userRole] || [];
  const routableViews = permittedViews.filter((view) => !DISABLED_VIEWS.includes(view));
  const defaultFallbackView: NavigationItem = routableViews.includes('dashboard')
    ? 'dashboard'
    : (routableViews[0] || 'dashboard');
  const effectiveView = isViewAllowed(currentView) ? currentView : defaultFallbackView;

  return (
    <div className="min-h-screen bg-paper text-ink flex font-sans">
      {/* Left Sidebar Navigation (264px) */}
      <Sidebar
        currentView={effectiveView}
        onNavigate={(view) => setCurrentView(view)}
        userRole={userRole}
        isMobileOpen={isMobileOpen}
        onCloseMobile={() => setIsMobileOpen(false)}
        rolePermissions={rolePermissions}
      />

      {/* Main Content Wrap */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-[264px] transition-all duration-200">
        {/* Top bar (78px, surface background, bottom border, sticky) */}
        <TopBar
          currentView={effectiveView}
          onOpenMobileSidebar={() => setIsMobileOpen(true)}
        />

        {/* Offline notification banner */}
        <OfflineBanner />

        {/* Main Content Area (38px/40px padding, max width 1600px, centered) */}
        <main className="flex-1 p-6 sm:p-8 lg:p-10 max-w-[1600px] w-full mx-auto">
          <ErrorBoundary
            key={effectiveView}
            onReset={() => setCurrentView('dashboard')}
          >
            {effectiveView === 'dashboard' && (
              <DashboardView
                userRole={userRole}
                userName={userProfile.displayName}
                onNavigate={(view) => setCurrentView(view)}
              />
            )}

            {(effectiveView === 'businesses' || effectiveView === 'taxpayers') && (
              <TaxpayerRegistryView userRole={userRole} />
            )}

            {effectiveView === 'declarations' && (
              <DeclarationsView userRole={userRole} />
            )}

            {effectiveView === 'taxpayer-profile' && (
              <TaxpayerProfileView userRole={userRole} />
            )}

            {effectiveView === 'transfer' && (
              <TransferView userRole={userRole} />
            )}

            {effectiveView === 'bank-agent' && (
              <BankAgentView
                key={`bank-agent-${paymentsRequest}`}
                userRole={userRole}
                canSeePayments={isViewAllowed('payments')}
                initialSubTab={openOnPayments ? 'payments' : undefined}
              />
            )}

            {effectiveView === 'note-perception' && (
              <NotePerceptionView userRole={userRole} />
            )}

            {effectiveView === 'notifications' && (
              <NotificationsView userRole={userRole} />
            )}

            {effectiveView === 'payroll' && (
              <PayrollView userRole={userRole} />
            )}

            {effectiveView === 'expenses' && (
              <ExpensesView userRole={userRole} />
            )}

            {effectiveView === 'reception' && (
              <ReceptionView userRole={userRole} />
            )}

            {effectiveView === 'announcements' && (
              <AnnouncementBoardView userRole={userRole} />
            )}

            {effectiveView === 'cash-reconciliation' && (
              <CashReconciliationView 
                userRole={userRole} 
                onNavigateToPayments={() => setCurrentView('payments')}
              />
            )}

            {effectiveView === 'reports' && (
              <ReportsView userRole={userRole} />
            )}

            {effectiveView === 'audit-log' && (
              <AuditLogView userRole={userRole} />
            )}

            {effectiveView === 'settings' && (
              <SettingsView />
            )}

            {effectiveView === 'users' && (
              <UsersView />
            )}
          </ErrorBoundary>
        </main>

        {/* Official Footer */}
        <footer className="border-t border-line bg-surface/70 py-4 px-6 sm:px-10 text-[12px] text-muted font-sans">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 max-w-[1600px] mx-auto">
            <span>
              {BRAND.jurisdiction}
            </span>
            <span className="text-[11px] text-faint tabular-nums font-mono">
              Business License Tax (Patente) — {BRAND.systemLine}
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default function App() {
  const [portal, setPortal] = useState<PortalId>(resolvePortalFromUrl);

  // Each portal works on its own database, chosen when the page loads, so
  // switching portal loads the page again for the other portal.
  const handleSwitchPortal = (next: PortalId) => {
    if (next === portal) return;
    try {
      const url = new URL(window.location.href);
      if (next === 'dgi') url.searchParams.set('portal', 'dgi');
      else url.searchParams.delete('portal');
      window.location.assign(url.toString());
    } catch {
      // The page could not be reloaded for the other portal. Switching the
      // portal WITHOUT reloading would show the other portal's screens while
      // `db` — chosen when the page loaded — still pointed at this portal's
      // database: every DGI record written would land in the DPRNK register.
      // Staying put is the only safe answer.
      console.error('[App] Could not switch portal — the page was not reloaded, so the database did not change.');
    }
  };

  useEffect(() => {
    document.title = portalBrand(portal).portalTitle;
  }, [portal]);

  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <MainPortal portal={portal} onSwitchPortal={handleSwitchPortal} />
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
