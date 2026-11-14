import React, { useEffect, useState } from 'react';
import { ArrowLeft, LogOut, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { DGI_BRAND, PortalId, monogramSize } from '../branding';
import { NavigationItem, RolePermissionsMap } from '../types';
import { DEFAULT_ROLE_PERMISSIONS } from '../services/userService';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { OfflineBanner } from './OfflineBanner';
import { ErrorBoundary } from './ErrorBoundary';
import { RegistrySubTab, TaxpayerRegistryView } from './TaxpayerRegistryView';
import { SettingsTab, SettingsView } from './SettingsView';
import { UsersView } from './UsersView';
import { ReceptionView } from './ReceptionView';
import { AnnouncementBoardView } from './AnnouncementBoardView';
import { PayrollView } from './PayrollView';
import { ExpensesView } from './ExpensesView';
import { DgiDashboardView } from './dgi/DgiDashboardView';
import { DgiAccountantView } from './dgi/DgiAccountantView';
import { DgiDeclarationsView } from './dgi/DgiDeclarationsView';
import { DgiTaxpayerProfileView } from './dgi/DgiTaxpayerProfileView';
import { ensureAddressRegistrySeeded } from '../services/addressService';

interface DgiPortalViewProps {
  onSwitchPortal: (portal: PortalId) => void;
  rolePermissions?: RolePermissionsMap;
}

/**
 * The tabs of the DGI portal, in sidebar order. Each one is the same module as
 * the DPRNK tab of the same id, and follows the same role permissions — but on
 * the DGI portal's own database (see firebase/config): its own taxpayers, its
 * own user accounts, its own address hierarchy.
 * - reception:  Reception — the same module as on DPRNK (visitor queue and
 *               scheduled meetings), pinned above Workspace as on DPRNK, on the
 *               DGI database's own receptionEntries / scheduleEvents
 * - announcements: Announcement Board — the same module as on DPRNK (posts,
 *               issue threads, memos and the board schedule), pinned under
 *               Reception as on DPRNK, on the DGI database's own announcements
 *               / scheduleEvents
 * - payroll:    Payroll & Advances — the same module as on DPRNK, under the
 *               HR department group, with the DGI portal's own workspace
 * - expenses:   Recurring Expenses — the same module as on DPRNK, under the
 *               Finance department group, on the DGI database's own
 *               recurringExpenses / expenseRecords
 * - dashboard:  Dashboard (Tableau de bord) — the DPRNK layout on DGI data;
 *               first in Workspace and the landing tab, as on DPRNK
 * - businesses: Registration (Enregistrement)
 * - declarations: Declarations — between Registration and Accountant; its
 *               subtab Calcul d'impôt (not the DPRNK Declarations module)
 * - taxpayer-profile: Tax Payer Profile — right below Accountant: a taxpayer
 *               search field (not the DPRNK Tax Payer Profile module)
 * - bank-agent: Accountant — right below Registration: "Fill in declaration"
 *               and the saved declarations (not the DPRNK Accountant module)
 * - settings:   Settings — the address hierarchy (Ville › Commune › Quartier ›
 *               Avenue) the enrolment card's address dropdowns read
 * - users:      Users — the DGI portal's own accounts
 */
const DGI_TABS: NavigationItem[] = ['reception', 'announcements', 'dashboard', 'businesses', 'declarations', 'bank-agent', 'taxpayer-profile', 'payroll', 'expenses', 'settings', 'users'];

/**
 * Settings subtabs in the DGI portal: the address hierarchy, and the
 * Nomenclatures des Impôts — the one list shared with the DPRNK portal.
 */
const DGI_SETTINGS_TABS: SettingsTab[] = ['adresses', 'nomenclatures'];

/**
 * Registration subtabs in the DGI portal: Identification du redevable only —
 * Calcul d'impôt is a subtab of the Declarations tab.
 */
const DGI_REGISTRATION_SUBTABS: RegistrySubTab[] = ['roll'];

/**
 * Post-login shell for the DGI portal: the same layout as the DPRNK portal —
 * sidebar, top bar, content, footer — under the DGI brand, with the DGI tabs.
 * A role with none of the DGI tabs sees the "Module under construction" screen.
 */
export const DgiPortalView: React.FC<DgiPortalViewProps> = ({ onSwitchPortal, rolePermissions }) => {
  const { userRole, currentUser, userProfile } = useAuth();
  const [currentView, setCurrentView] = useState<NavigationItem>('dashboard') /* the Dashboard is the landing tab, as on DPRNK */;
  const [isMobileOpen, setIsMobileOpen] = useState<boolean>(false);

  // The DGI database starts with no address hierarchy, which would leave the
  // enrolment card's Ville / Commune / Quartier / Avenue dropdowns empty. The
  // first administrator visit seeds the standard hierarchy (only when none
  // exists — an existing one is never touched); it is then managed in Settings.
  useEffect(() => {
    if (userRole === 'Admin') void ensureAddressRegistrySeeded();
  }, [userRole]);

  const permitted = rolePermissions?.[userRole] || DEFAULT_ROLE_PERMISSIONS[userRole] || [];
  const tabs = DGI_TABS.filter((tab) => permitted.includes(tab));
  if (tabs.length === 0) return <DgiUnderConstruction onSwitchPortal={onSwitchPortal} />;
  const effectiveView = tabs.includes(currentView) ? currentView : tabs[0];

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
        brand={DGI_BRAND}
        items={DGI_TABS}
      />

      {/* Main Content Wrap */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-[264px] transition-all duration-200">
        {/* Top bar (78px, surface background, bottom border, sticky) */}
        <TopBar
          currentView={effectiveView}
          onOpenMobileSidebar={() => setIsMobileOpen(true)}
          brandName={DGI_BRAND.shortName}
        />

        {/* Offline notification banner */}
        <OfflineBanner />

        {/* Main Content Area (38px/40px padding, max width 1600px, centered) */}
        <main className="flex-1 p-6 sm:p-8 lg:p-10 max-w-[1600px] w-full mx-auto">
          <ErrorBoundary key={effectiveView} onReset={() => setCurrentView(tabs[0])}>
            {/* DGI does not deal with property or rental taxes: Registration
                shows only Identification du redevable. */}
            {/* …and its enrolment card has no NIF, Forme juridique or Numéro de
                parcelle, but has Service, Numéro de dépôt, Salaires du mois de
                and Année above the name. */}
            {effectiveView === 'businesses' && (
              <TaxpayerRegistryView
                userRole={userRole}
                subTabs={DGI_REGISTRATION_SUBTABS}
                nifOnCard={false}
                depotFieldsOnCard
                formeParcelleOnCard={false}
                rollColumns="dgi"
                addressFilters={false}
              />
            )}
            {/* Dashboard — the DPRNK layout, on the DGI portal's own records. */}
            {effectiveView === 'dashboard' && (
              <DgiDashboardView userName={userProfile?.displayName || ''} onNavigate={(view) => setCurrentView(view)} />
            )}
            {/* Payroll & Advances and Recurring Expenses — the same modules as on DPRNK. */}
            {effectiveView === 'payroll' && <PayrollView userRole={userRole} />}
            {effectiveView === 'expenses' && <ExpensesView userRole={userRole} />}
            {/* Announcement Board — the same module as on DPRNK. */}
            {effectiveView === 'announcements' && <AnnouncementBoardView userRole={userRole} />}
            {/* Reception — the same module as on DPRNK. */}
            {effectiveView === 'reception' && <ReceptionView userRole={userRole} />}
            {/* Declarations — the Calcul d'impôt subtab. */}
            {effectiveView === 'declarations' && (
              <DgiDeclarationsView
                userRole={userRole}
                actor={{
                  uid: currentUser?.uid || 'anonymous',
                  displayName: userProfile?.displayName || 'Tax Officer',
                  role: userRole,
                }}
              />
            )}
            {/* Tax Payer Profile — the taxpayer search field. */}
            {effectiveView === 'taxpayer-profile' && <DgiTaxpayerProfileView />}
            {/* Accountant — "Fill in declaration" and the saved declarations. */}
            {effectiveView === 'bank-agent' && (
              <DgiAccountantView
                actor={{
                  uid: currentUser?.uid || 'anonymous',
                  displayName: userProfile?.displayName || 'Tax Officer',
                  role: userRole,
                }}
              />
            )}
            {effectiveView === 'settings' && (
              <SettingsView
                tabs={DGI_SETTINGS_TABS}
                title="Settings"
                description="The DGI portal's own address hierarchy — the Ville, Commune, Quartier and Avenue choices of the enrolment card — and the Nomenclatures des Impôts, shared with the DPRNK portal."
              />
            )}
            {effectiveView === 'users' && <UsersView />}
          </ErrorBoundary>
        </main>

        {/* Official Footer */}
        <footer className="border-t border-line bg-surface/70 py-4 px-6 sm:px-10 text-[12px] text-muted font-sans">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 max-w-[1600px] mx-auto">
            <span>{DGI_BRAND.jurisdiction}</span>
            <span className="text-[11px] text-faint tabular-nums font-mono">{DGI_BRAND.systemLine}</span>
          </div>
        </footer>
      </div>
    </div>
  );
};

/**
 * Shown to a role that has none of the DGI tabs: confirms the session and
 * offers the two safe exits (switch portal / sign out).
 */
const DgiUnderConstruction: React.FC<{ onSwitchPortal: (portal: PortalId) => void }> = ({ onSwitchPortal }) => {
  const { userProfile, userRole, logout } = useAuth();

  const markFontSize = monogramSize(40, 6, 0.616, DGI_BRAND.monogram.length);

  return (
    <div className="min-h-screen bg-paper text-ink font-sans flex flex-col">
      <header className="border-b border-line bg-surface">
        <div className="h-[78px] px-4 sm:px-8 max-w-[1600px] w-full mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-10 h-10 rounded-[12px] brand-mark-vivid text-white flex items-center justify-center font-display font-bold tracking-tight shrink-0"
              style={{ fontSize: markFontSize }}
            >
              {DGI_BRAND.monogram}
            </div>
            <div className="min-w-0">
              <div className="font-display font-bold tracking-tight leading-tight text-ink truncate">
                {DGI_BRAND.portalTitle}
              </div>
              <div className="text-[11px] uppercase tracking-[0.16em] text-muted truncate">
                {DGI_BRAND.fullName}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden sm:block text-right">
              <div className="text-xs font-semibold text-ink max-w-[200px] truncate">
                {userProfile?.displayName}
              </div>
              <div className="text-[11px] uppercase tracking-[0.14em] text-muted">
                {userRole}
              </div>
            </div>
            <button
              type="button"
              onClick={() => logout()}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-[10px] bg-navy hover:bg-navy2 text-white text-xs font-medium transition-premium cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-xl text-center">
          <div
            className="w-16 h-16 mx-auto rounded-[18px] brand-mark-vivid text-white flex items-center justify-center font-display font-bold tracking-tight shadow-lg"
            style={{ fontSize: monogramSize(64, 8, 0.616, DGI_BRAND.monogram.length) }}
          >
            {DGI_BRAND.monogram}
          </div>

          <div className="mt-5 text-[11px] font-bold uppercase tracking-[0.24em] text-muted">
            {DGI_BRAND.shortName} workspace
          </div>
          <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-ink">
            Module under construction
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            The {DGI_BRAND.shortName} portal is provisioned and secured. No workspace sections,
            navigation tabs, or registers have been enabled yet.
          </p>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            {DGI_BRAND.shortName} tools will be added once the DPRNK module is complete.
          </p>

          <div className="mt-8 rounded-[16px] border border-line bg-surface p-5 text-left shadow-2xs">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-4 h-4 text-sage mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-ink">Secure session active</div>
                <div className="mt-0.5 text-[12px] text-muted truncate">
                  {userProfile?.displayName} • {userProfile?.email}
                </div>
                <div className="mt-1 text-[11px] uppercase tracking-[0.14em] text-faint">
                  {userRole} clearance
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => onSwitchPortal('dprnk')}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-[10px] border border-line bg-surface hover:bg-surface2 text-ink text-xs font-medium transition-premium cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Return to DPRNK portal
            </button>
            <button
              type="button"
              onClick={() => logout()}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-[10px] bg-navy hover:bg-navy2 text-white text-xs font-medium transition-premium cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </button>
          </div>
        </div>
      </main>

      <footer className="border-t border-line bg-surface/70 py-4 px-6 text-center text-[12px] text-muted">
        {DGI_BRAND.jurisdiction} • {DGI_BRAND.systemLine}
      </footer>
    </div>
  );
};
