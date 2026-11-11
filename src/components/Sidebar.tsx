import React, { useEffect, useState } from 'react';
import { 
  ScrollText,
  LayoutDashboard, 
  BarChart3, 
  ShieldCheck, 
  Settings, 
  Users,
  Wallet,
  Repeat2,
  ClipboardList,
  Briefcase,
  Landmark,
  Megaphone,
  FileText,
  ArrowLeftRight,
  BadgeCheck,
  IdCard,
  Bell,
  ChevronDown,
  X,
  LogOut
} from 'lucide-react';
import { NavigationItem, UserRole, RolePermissionsMap } from '../types';
import { BRAND, monogramSize } from '../branding';
import { DEFAULT_ROLE_PERMISSIONS } from '../services/userService';
import { useAuth } from '../contexts/AuthContext';

interface SidebarProps {
  currentView: NavigationItem;
  onNavigate: (view: NavigationItem) => void;
  userRole: UserRole;
  isMobileOpen: boolean;
  onCloseMobile: () => void;
  rolePermissions?: RolePermissionsMap;
  /**
   * Portal identity shown in the brand header. Defaults to the DPRNK brand;
   * the DGI portal passes its own.
   */
  brand?: { shortName: string; monogram: string; tagline: string };
  /**
   * Restrict the sidebar to these tabs (still subject to role permissions).
   * Omitted: every DPRNK tab. The DGI portal passes only the tabs it has.
   */
  items?: NavigationItem[];
}

interface NavItemConfig {
  id: NavigationItem;
  label: string;
  icon: React.ElementType;
  section: 'Workspace' | 'Administration';
  badge?: string;
  department?: 'hr' | 'finance';
}

interface DepartmentConfig {
  id: 'hr' | 'finance';
  label: string;
  sublabel: string;
  icon: React.ElementType;
}

const DEPARTMENTS: DepartmentConfig[] = [
  { id: 'hr', label: 'HR Department', sublabel: 'People & payroll', icon: Briefcase },
  { id: 'finance', label: 'Finance Department', sublabel: 'Treasury & costs', icon: Landmark },
];

const ALL_NAV_ITEMS: NavItemConfig[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, section: 'Workspace' },
  { id: 'announcements', label: 'Announcement Board', icon: Megaphone, section: 'Workspace', badge: 'Board' },
  { id: 'reception', label: 'Reception', icon: ClipboardList, section: 'Workspace', badge: 'Queue' },
  { id: 'businesses', label: 'Registration', icon: Users, section: 'Workspace' },
  { id: 'declarations', label: 'Declarations', icon: FileText, section: 'Workspace' },
  { id: 'taxpayer-profile', label: 'Tax Payer Profile', icon: IdCard, section: 'Workspace' },
  { id: 'transfer', label: 'Transfer', icon: ArrowLeftRight, section: 'Workspace' },
  { id: 'bank-agent', label: 'Accountant', icon: BadgeCheck, section: 'Workspace' },
  { id: 'note-perception', label: 'Note de Perception', icon: ScrollText, section: 'Workspace' },
  { id: 'notifications', label: 'Notifications', icon: Bell, section: 'Workspace' },
  // Payment History is now a subtab of Bank Agent (Historique des paiements).
  { id: 'payroll', label: 'Payroll & Advances', icon: Wallet, section: 'Workspace', badge: 'HR', department: 'hr' },
  { id: 'expenses', label: 'Recurring Expenses', icon: Repeat2, section: 'Workspace', badge: 'Costs', department: 'finance' },
  { id: 'reports', label: 'Reports & Settlement', icon: BarChart3, section: 'Workspace', department: 'finance' },
  
  { id: 'audit-log', label: 'Audit Log', icon: ShieldCheck, section: 'Administration' },
  { id: 'settings', label: 'Settings', icon: Settings, section: 'Administration' },
  { id: 'users', label: 'Users', icon: Users, section: 'Administration' },
];

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onNavigate,
  userRole,
  isMobileOpen,
  onCloseMobile,
  rolePermissions,
  brand = BRAND,
  items,
}) => {
  const { userProfile, logout } = useAuth();
  const activePermissions = rolePermissions?.[userRole] || DEFAULT_ROLE_PERMISSIONS[userRole] || [];
  const visibleItems = ALL_NAV_ITEMS.filter(
    (item) => activePermissions.includes(item.id) && (!items || items.includes(item.id))
  );

  // Department-owned modules render under their department group, not Workspace.
  // Reception + Announcement Board are pinned right above the Departments section.
  const receptionItem = visibleItems.find((item) => item.id === 'reception');
  const announcementItem = visibleItems.find((item) => item.id === 'announcements');
  const workspaceItems = visibleItems.filter((item) => item.section === 'Workspace' && !item.department && item.id !== 'reception' && item.id !== 'announcements');
  const adminItems = visibleItems.filter((item) => item.section === 'Administration');
  const departmentGroups = DEPARTMENTS.map((dept) => ({
    ...dept,
    items: visibleItems.filter((item) => item.department === dept.id),
  })).filter((dept) => dept.items.length > 0);

  const [expandedDepts, setExpandedDepts] = useState<Record<string, boolean>>({ hr: true, finance: true });

  // Keep the department containing the active view expanded.
  // visibleItems is derived from these deps, so they are the stable triggers.
  const visibleItemIds = visibleItems.map((item) => `${item.id}:${item.department || ''}`).join(',');
  useEffect(() => {
    const activeDept = visibleItems.find(
      (item) => item.department && (currentView === item.id || (item.id === 'businesses' && currentView === 'taxpayers'))
    )?.department;
    if (activeDept) {
      setExpandedDepts((current) => (current[activeDept] ? current : { ...current, [activeDept]: true }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, visibleItemIds]);

  const isItemActive = (item: NavItemConfig) =>
    currentView === item.id || (item.id === 'businesses' && currentView === 'taxpayers');

  const navigate = (item: NavItemConfig) => {
    onNavigate(item.id);
    onCloseMobile();
  };

  const getInitials = (name?: string) => {
    if (!name) return 'GP';
    return name
      .split(' ')
      .map((n) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  };

  const renderNavButton = (item: NavItemConfig, indented = false) => {
    const Icon = item.icon;
    const isActive = isItemActive(item);
    return (
      <button
        key={item.id}
        id={`nav-${item.id}-btn`}
        type="button"
        onClick={() => navigate(item)}
        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-[10px] text-left transition-premium font-sans cursor-pointer group ${
          indented ? 'ml-3 w-[calc(100%-12px)]' : ''
        } ${
          isActive
            ? 'bg-accent text-white font-semibold shadow-[0_4px_16px_oklch(57%_0.16_36/0.35)]'
            : 'text-white/75 hover:bg-navy2 hover:text-white hover:translate-x-[2px]'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <Icon
            className={`w-4 h-4 shrink-0 transition-premium ${
              isActive ? 'text-white' : 'text-white/60 group-hover:text-white'
            }`}
          />
          <span className="truncate text-xs tracking-tight font-medium">
            {item.label}
          </span>
        </div>

        {item.badge && (
          <span
            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider ${
              isActive
                ? 'bg-white/20 text-white'
                : 'bg-white/10 text-white/70 group-hover:bg-white/20 group-hover:text-white'
            }`}
          >
            {item.badge}
          </span>
        )}
      </button>
    );
  };

  const renderNavGroup = (title: string, items: NavItemConfig[]) => {
    if (items.length === 0) return null;
    return (
      <div className="mb-6">
        <div className="px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white/40 font-sans select-none">
          {title}
        </div>
        <div className="space-y-1">
          {items.map((item) => renderNavButton(item))}
        </div>
      </div>
    );
  };

  const renderDepartments = () => {
    if (departmentGroups.length === 0) return null;
    return (
      <div className="mb-6">
        <div className="px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white/40 font-sans select-none">
          Departments
        </div>
        <div className="space-y-2">
          {departmentGroups.map((dept) => {
            const DeptIcon = dept.icon;
            const expanded = expandedDepts[dept.id] !== false;
            const containsActive = dept.items.some((item) => isItemActive(item));
            return (
              <div
                key={dept.id}
                className={`rounded-[12px] border transition-premium ${
                  containsActive ? 'border-accent/40 bg-white/5' : 'border-white/10 bg-white/[0.02]'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setExpandedDepts((current) => ({ ...current, [dept.id]: !expanded }))}
                  aria-expanded={expanded}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-left cursor-pointer group"
                >
                  <span className={`w-7 h-7 rounded-[8px] flex items-center justify-center shrink-0 transition-premium ${containsActive ? 'bg-accent text-white' : 'bg-white/10 text-white/70 group-hover:text-white'}`}>
                    <DeptIcon className="w-3.5 h-3.5" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate text-xs font-semibold text-white tracking-tight">
                      {dept.label}
                    </span>
                    <span className="block truncate text-[11px] text-white/45">
                      {dept.sublabel} · {dept.items.length} {dept.items.length === 1 ? 'module' : 'modules'}
                    </span>
                  </span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-white/50 shrink-0 transition-transform duration-200 ${expanded ? '' : '-rotate-90'}`}
                  />
                </button>
                {expanded && (
                  <div className="pb-2 pr-1 space-y-1">
                    {dept.items.map((item) => renderNavButton(item, true))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Mobile backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-navy/80 backdrop-blur-xs z-40 lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      {/* Sidebar container */}
      <aside
        id="official-sidebar"
        className={`fixed top-0 bottom-0 left-0 z-50 w-[264px] bg-navy text-white flex flex-col border-r border-white/10 transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand Header */}
        <div className="px-5 pt-6 pb-5 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            {/* 38px vivid gradient mark — the monogram size is derived so a
                name change resizes the glyphs to keep fitting the box. */}
            <div className="w-[38px] h-[38px] rounded-[10px] brand-mark-vivid text-white font-display font-bold tracking-tight flex items-center justify-center shrink-0" style={{ fontSize: monogramSize(38, 6, 0.616, brand.monogram.length) }}>
              {brand.monogram}
            </div>
            <div className="min-w-0">
              <div className="font-display font-bold text-base tracking-tight truncate brand-title-vivid-bright">
                {brand.shortName}
              </div>
              <div className="text-[11px] text-white/50 tracking-wider font-sans uppercase truncate">
                {brand.tagline}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onCloseMobile}
            className="lg:hidden p-1.5 rounded-lg text-white/60 hover:text-white hover:bg-white/10 cursor-pointer"
            aria-label="Close sidebar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation list */}
        <div className="flex-1 overflow-y-auto px-4 py-5 scrollbar-thin scrollbar-thumb-white/10">
          {(receptionItem || announcementItem) && (
            <div className="mb-6 space-y-1">
              {receptionItem && renderNavButton(receptionItem)}
              {announcementItem && renderNavButton(announcementItem)}
            </div>
          )}
          {renderDepartments()}
          {renderNavGroup('Workspace', workspaceItems)}
          {renderNavGroup('Administration', adminItems)}
        </div>

        {/* Current User Pinned Footer */}
        <div className="p-3.5 border-t border-white/10 bg-navy2/40">
          <div className="flex items-center justify-between gap-2.5 p-2 rounded-[10px] bg-navy2/60 border border-white/10">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-[8px] bg-accent/20 border border-accent/40 text-accent-soft font-display font-bold text-xs flex items-center justify-center shrink-0">
                {getInitials(userProfile?.displayName)}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-white truncate font-sans">
                  {userProfile?.displayName || 'Tax Officer'}
                </div>
                <div className="text-[11px] font-bold text-white/50 uppercase tracking-wider">
                  {userRole}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={logout}
              title="Sign out"
              className="p-1.5 text-white/50 hover:text-danger hover:bg-white/10 rounded-[8px] transition-premium cursor-pointer shrink-0"
              aria-label="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};
