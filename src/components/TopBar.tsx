import React, { useState, useEffect } from 'react';
import { 
  Menu, 
  Search, 
  Bell, 
  CheckCircle2, 
  AlertTriangle, 
  UserCheck, 
  ChevronDown, 
  Sparkles,
  Wifi,
  WifiOff
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { NavigationItem, UserRole } from '../types';
import { BRAND } from '../branding';
import { DateTime3DClock } from './DateTime3DClock';
import { useLanguage } from '../i18n/LanguageContext';

interface TopBarProps {
  currentView: NavigationItem;
  onOpenMobileSidebar: () => void;
  /** Portal name at the start of the breadcrumb. Defaults to the DPRNK brand. */
  brandName?: string;
}

const VIEW_LABELS: Record<NavigationItem, string> = {
  dashboard: 'Dashboard',
  announcements: 'Announcement Board',
  reception: 'Reception',
  businesses: 'Registration',
  taxpayers: 'Registration',
  declarations: 'Tax Declarations',
  'taxpayer-profile': 'Tax Payer Profile',
  transfer: 'Property Transfer',
  'bank-agent': 'Bank Agent',
  'note-perception': 'Note de Perception',
  notifications: 'Notifications',
  assessments: 'Tax Assessments',
  payments: 'Payment History',
  payroll: 'Payroll & Advances',
  expenses: 'Recurring Expenses',
  'cash-reconciliation': 'Cash Reconciliation',
  'verify-receipt': 'Verify a Receipt',
  'receipt-anomalies': 'Receipt Anomalies',
  approvals: 'Pending Approvals',
  certificates: 'Business Licenses',
  reports: 'Reports & Settlement',
  compliance: 'Delinquent Taxpayers',
  'audit-log': 'Audit Log',
  settings: 'Settings',
  users: 'Users',
};

export const TopBar: React.FC<TopBarProps> = ({ currentView, onOpenMobileSidebar, brandName = BRAND.shortName }) => {
  const { userRole, baseRole, switchRoleQuick, isOfflineMode, setOfflineSimulated } = useAuth();
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const { lang, setLang } = useLanguage();
  // Only a real Administrator may review the other roles' screens. A cashier
  // "switching to Admin" would surface every privileged action in the UI, so the
  // switcher is not rendered for anyone else — they see a static role badge.
  const canSwitchRole = baseRole === 'Admin';

  const roles: { role: UserRole; desc: string }[] = [
    { role: 'Admin', desc: 'Full administration & tariffs' },
    { role: 'Supervisor', desc: 'Shift sign-off & treasury custody' },
    { role: 'Cashier', desc: 'Counter payments & shift float' },
    { role: 'Auditor', desc: 'Read-only compliance & audit ledger' },
  ];

  const viewName = VIEW_LABELS[currentView] || 'Overview';

  return (
    <header className="sticky top-0 z-30 h-[78px] bg-surface border-b border-line shadow-2xs transition-premium">
      {/*
        Three parts in one row: breadcrumb | clock | status & actions. The two
        sides share the free space equally, so the clock sits in the middle
        whenever there is room; when the right-hand group needs more (longer
        French labels), it takes it and the clock moves aside — the two can
        never overlap.
      */}
      <div className="h-full px-4 sm:px-8 max-w-[1600px] mx-auto flex items-center gap-4">

        {/* Left: Mobile Toggle & Breadcrumb */}
        <div className="flex-1 basis-0 flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onOpenMobileSidebar}
            className="lg:hidden p-2 rounded-[10px] bg-surface2 hover:bg-line text-ink cursor-pointer shrink-0"
            aria-label="Open navigation sidebar"
          >
            <Menu className="w-4 h-4" />
          </button>

          <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm font-sans truncate">
            <span className="text-muted tracking-tight">{brandName}</span>
            <span className="text-faint">/</span>
            <span className="font-display font-bold text-ink tracking-tight truncate">
              {viewName}
            </span>
          </nav>
        </div>

        {/* Center: Live 3D Time & Date */}
        <DateTime3DClock />

        {/* Right: Sync Status, Search, Notifications, Role Switcher */}
        <div className="flex-1 basis-0 flex items-center justify-end gap-2.5 sm:gap-3 min-w-max">
          
          {/* Systems Status Indicator */}
          {!isOfflineMode ? (
            <button
              type="button"
              onClick={() => setOfflineSimulated(true)}
              title="Click to simulate offline network condition"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-sage/15 text-sage border border-sage/30 hover:bg-sage/20 transition-premium cursor-pointer"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-sage animate-pulse shrink-0" />
              <span className="hidden xl:inline font-sans whitespace-nowrap">All systems synced</span>
              <span className="xl:hidden font-sans whitespace-nowrap">Synced</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setOfflineSimulated(false)}
              title="Click to reconnect live"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-warn/15 text-warn border border-warn/30 hover:bg-warn/25 transition-premium cursor-pointer"
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span className="font-sans">
                Offline mode
              </span>
            </button>
          )}

          {/* Language toggle — English / Français */}
          <div
            role="group"
            aria-label="Switch language"
            data-no-i18n
            className="inline-flex items-center p-0.5 rounded-[10px] bg-surface2 border border-line text-[12px] font-bold tracking-wide"
          >
            {(['en', 'fr'] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLang(code)}
                aria-pressed={lang === code}
                title={code === 'en' ? 'English' : 'Français'}
                className={`px-2.5 py-1 rounded-[8px] transition-premium cursor-pointer ${
                  lang === code ? 'bg-surface text-ink shadow-2xs' : 'text-muted hover:text-ink'
                }`}
              >
                {code.toUpperCase()}
              </button>
            ))}
          </div>

          {/* Quick Search Icon Button */}
          <button
            type="button"
            title="Search records"
            aria-label="Search"
            className="w-9 h-9 rounded-[10px] bg-surface2 hover:bg-line text-muted hover:text-ink flex items-center justify-center transition-premium cursor-pointer"
          >
            <Search className="w-4 h-4" />
          </button>

          {/* Notification Icon Button */}
          <button
            type="button"
            title="Notifications"
            aria-label="Notifications"
            className="w-9 h-9 rounded-[10px] bg-surface2 hover:bg-line text-muted hover:text-ink flex items-center justify-center transition-premium cursor-pointer relative"
          >
            <Bell className="w-4 h-4" />
            <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-accent" />
          </button>

          {/* Role Switcher Dropdown — Administrators only */}
          {canSwitchRole ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => setRoleDropdownOpen(!roleDropdownOpen)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-[10px] bg-surface2 hover:bg-line text-ink border border-line text-xs font-medium transition-premium cursor-pointer"
              title="Switch role for review"
            >
              <UserCheck className="w-3.5 h-3.5 text-accent shrink-0" />
              <span className="font-bold text-ink hidden md:inline">{userRole}</span>
              <ChevronDown className="w-3 h-3 text-muted" />
            </button>

            {roleDropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setRoleDropdownOpen(false)}
                />
                <div className="absolute right-0 mt-2 w-60 bg-surface rounded-[18px] shadow-[0_10px_30px_oklch(20%_0.03_260/0.12)] border border-line py-2 z-50 animate-in fade-in zoom-in-95 duration-100">
                  <div className="px-4 py-2 border-b border-line text-[11px] font-bold uppercase tracking-[0.14em] text-muted flex items-center justify-between">
                    <span>Active Role</span>
                    <Sparkles className="w-3 h-3 text-accent" />
                  </div>
                  {roles.map((r) => (
                    <button
                      key={r.role}
                      type="button"
                      onClick={() => {
                        switchRoleQuick(r.role).catch((err) =>
                          console.warn('[TopBar] Role switch failed:', err)
                        );
                        setRoleDropdownOpen(false);
                      }}
                      className={`w-full text-left px-4 py-2.5 text-xs transition-premium flex flex-col cursor-pointer ${
                        userRole === r.role
                          ? 'bg-accent-soft/40 font-semibold text-ink border-l-2 border-accent'
                          : 'hover:bg-surface2 text-muted hover:text-ink'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-ink">{r.role}</span>
                        {userRole === r.role && (
                          <span className="text-[11px] font-bold text-sage">Active</span>
                        )}
                      </div>
                      <span className="text-[11px] text-muted mt-0.5 font-normal">
                        {r.desc}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          ) : (
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-[10px] bg-surface2 text-ink border border-line text-xs font-medium"
              title={`Signed in as ${userRole}`}
            >
              <UserCheck className="w-3.5 h-3.5 text-accent shrink-0" />
              <span className="font-bold text-ink hidden md:inline">{userRole}</span>
            </div>
          )}

        </div>
      </div>
    </header>
  );
};
