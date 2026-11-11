import React, { useState, useEffect, useRef } from 'react';
import {
  AlertTriangle,
  AlertOctagon,
  Search,
  Filter,
  ArrowUpDown,
  Building2,
  Phone,
  MapPin,
  Calendar,
  FileText,
  UserX,
  RotateCcw,
  CheckCircle2,
  Clock,
  RefreshCw,
  Eye,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  Info,
  DollarSign
} from 'lucide-react';
import { UserRole, BusinessSector, BusinessSizeClass, normalizeBusinessStatus, Business, Assessment } from '../types';
import {
  getDelinquentTaxpayers,
  computeDelinquentTaxpayers,
  subscribeToBusinesses,
  subscribeToAssessments,
  DelinquentTaxpayerItem,
  flagBusinessEnRadiation,
  restoreBusinessStatus
} from '../services/dbService';
import { submitApprovalRequest } from '../services/approvalService';
import { PageHeader, Button, Badge, Panel, MetricStrip } from './ui';
import { formatMoney } from '../utils/money';

interface DelinquentTaxpayersViewProps {
  userRole: UserRole;
  userName?: string;
  adminId?: string;
  onNavigateToBusiness?: (businessId: string) => void;
}

type SortField = 'days-desc' | 'days-asc' | 'debt-desc' | 'debt-asc' | 'name-asc';
type SeverityFilter = 'all' | 'critique' | 'eleve' | 'moyen' | 'faible' | 'en_radiation' | 'actif';

export const DelinquentTaxpayersView: React.FC<DelinquentTaxpayersViewProps> = ({
  userRole,
  userName = 'Tax Administrator',
  adminId = 'admin_goma',
}) => {
  const [taxpayers, setTaxpayers] = useState<DelinquentTaxpayerItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [communeFilter, setCommuneFilter] = useState<string>('all');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [sortOption, setSortOption] = useState<SortField>('days-desc');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Modal state for flagging a business as closure/deregistration pending
  const [selectedForRadiation, setSelectedForRadiation] = useState<DelinquentTaxpayerItem | null>(null);
  const [radiationReason, setRadiationReason] = useState<string>('');
  const [isConfirmedCheckbox, setIsConfirmedCheckbox] = useState<boolean>(false);
  const [submittingAction, setSubmittingAction] = useState<boolean>(false);

  // Modal State for Restoring Status
  const [selectedForRestore, setSelectedForRestore] = useState<DelinquentTaxpayerItem | null>(null);
  const [restoreReason, setRestoreReason] = useState<string>('');

  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    setLoading(true);

    let latestBiz: Business[] = [];
    let latestAss: Assessment[] = [];
    // Only clear the loading state once BOTH listeners have delivered: the old
    // code cleared it on the first snapshot, so the table briefly rendered
    // partial results (only one collection's contribution).
    let bizLoaded = false;
    let assLoaded = false;

    const updateCombined = () => {
      const computed = computeDelinquentTaxpayers(latestBiz, latestAss);
      setTaxpayers(computed);
      setLoading(false);
    };

    const unsubBiz = subscribeToBusinesses(
      (biz) => {
        latestBiz = biz || [];
        bizLoaded = true;
        if (bizLoaded && assLoaded) updateCombined();
      },
      (err) => {
        console.error('[DelinquentTaxpayers] Business listener error:', err);
        bizLoaded = true;
        if (bizLoaded && assLoaded) updateCombined();
      }
    );

    const unsubAss = subscribeToAssessments(
      (ass) => {
        latestAss = ass || [];
        assLoaded = true;
        if (bizLoaded && assLoaded) updateCombined();
      },
      (err) => {
        console.error('[DelinquentTaxpayers] Assessment listener error:', err);
        assLoaded = true;
        if (bizLoaded && assLoaded) updateCombined();
      }
    );

    return () => {
      unsubBiz();
      unsubAss();
    };
  }, []);

  const reloadDelinquentData = async () => {
    setLoading(true);
    try {
      const data = await getDelinquentTaxpayers();
      setTaxpayers(data);
    } catch (err) {
      console.error('[DelinquentTaxpayers] Reload error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Notification banner with a single tracked timer: overlapping 4.5s timeouts
  // used to wipe a NEWER notification early, and the pending timer fired
  // setState after unmount.
  const notificationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNotification = (type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    if (notificationTimerRef.current) clearTimeout(notificationTimerRef.current);
    notificationTimerRef.current = setTimeout(() => {
      setNotification(null);
      notificationTimerRef.current = null;
    }, 4500);
  };
  useEffect(() => () => {
    if (notificationTimerRef.current) clearTimeout(notificationTimerRef.current);
  }, []);

  // Filter & Sort
  const filteredTaxpayers = taxpayers
    .filter((item) => {
      const q = (searchQuery || '').toLowerCase();
      const matchesSearch =
        (item.businessName || '').toLowerCase().includes(q) ||
        (item.ownerFullName || '').toLowerCase().includes(q) ||
        (item.nationalIdOrRccm || '').toLowerCase().includes(q) ||
        (item.quartier || '').toLowerCase().includes(q) ||
        (item.commune || '').toLowerCase().includes(q);

      const matchesCommune = communeFilter === 'all' || item.commune === communeFilter;

      let matchesSeverity = true;
      if (severityFilter === 'critique') matchesSeverity = item.severity === 'critique';
      else if (severityFilter === 'eleve') matchesSeverity = item.severity === 'eleve';
      else if (severityFilter === 'moyen') matchesSeverity = item.severity === 'moyen';
      else if (severityFilter === 'faible') matchesSeverity = item.severity === 'faible';
      else if (severityFilter === 'en_radiation') matchesSeverity = normalizeBusinessStatus(item.status) === 'Closure Pending';
      else if (severityFilter === 'actif') matchesSeverity = normalizeBusinessStatus(item.status) !== 'Closure Pending';

      return matchesSearch && matchesCommune && matchesSeverity;
    })
    .sort((a, b) => {
      if (sortOption === 'days-desc') return b.maxDaysOverdue - a.maxDaysOverdue;
      if (sortOption === 'days-asc') return a.maxDaysOverdue - b.maxDaysOverdue;
      if (sortOption === 'debt-desc') return b.totalOverdueUSD - a.totalOverdueUSD;
      if (sortOption === 'debt-asc') return a.totalOverdueUSD - b.totalOverdueUSD;
      if (sortOption === 'name-asc') return a.businessName.localeCompare(b.businessName);
      return 0;
    });

  // KPI Calculations
  const totalCount = taxpayers.length;
  const totalOverdueUSD = taxpayers.reduce((sum, item) => sum + item.totalOverdueUSD, 0);
  const criticalCount = taxpayers.filter((item) => item.severity === 'critique' && normalizeBusinessStatus(item.status) !== 'Closure Pending').length;
  const deregisteredCount = taxpayers.filter((item) => normalizeBusinessStatus(item.status) === 'Closure Pending').length;

  const handleOpenRadiationModal = (item: DelinquentTaxpayerItem) => {
    setSelectedForRadiation(item);
    setRadiationReason(
      `Persistent tax default (> ${item.maxDaysOverdue} days) following statutory formal notices. Outstanding total debt: ${formatMoney(item.totalOverdueUSD)}.`
    );
    setIsConfirmedCheckbox(false);
  };

  const handleConfirmRadiation = async () => {
    if (!selectedForRadiation) return;
    // Authority is enforced here, not only by hiding the control.
    if (userRole !== 'Admin') {
      showNotification('error', 'Only an Administrator may initiate an administrative closure.');
      return;
    }
    // Re-entry guard: the disabled confirm button does not stop a second click
    // landing within the same React batch → duplicate maker-checker requests.
    if (submittingAction) return;
    if (!radiationReason.trim()) {
      showNotification('error', 'Please enter the administrative reason for closure.');
      return;
    }
    if (!isConfirmedCheckbox) {
      showNotification('error', 'Please confirm the administrative compliance statement.');
      return;
    }

    setSubmittingAction(true);
    try {
      const approvalReq = await submitApprovalRequest({
        requestType: 'business_deregistration',
        entityType: 'Business',
        entityId: selectedForRadiation.businessId,
        entityTitle: `${selectedForRadiation.businessName} (Nat ID: ${selectedForRadiation.nationalIdOrRccm || 'N/A'})`,
        beforeValue: {
          status: selectedForRadiation.status,
          totalOverdueUSD: selectedForRadiation.totalOverdueUSD,
          commune: selectedForRadiation.commune,
          quartier: selectedForRadiation.quartier,
        },
        afterValue: {
          status: 'Closure Pending',
          deregistrationReason: radiationReason.trim(),
          overdueDebtUSD: selectedForRadiation.totalOverdueUSD,
        },
        justification: radiationReason.trim(),
        requester: {
          uid: adminId,
          displayName: userName,
          role: userRole,
        },
        targetDetails: {
          businessName: selectedForRadiation.businessName,
          nationalIdOrRccm: selectedForRadiation.nationalIdOrRccm,
          commune: selectedForRadiation.commune,
          quartier: selectedForRadiation.quartier,
          amountUSD: selectedForRadiation.totalOverdueUSD,
        },
      });

      showNotification(
        'success',
        `Closure request #${approvalReq.id} submitted to the Pending Approvals queue (Maker-Checker). Second-agent sign-off required.`
      );
      setSelectedForRadiation(null);
      await reloadDelinquentData();
    } catch (err: any) {
      console.error('[Radiation Error]', err);
      showNotification('error', 'Error submitting closure request: ' + (err.message || 'Unknown error'));
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleConfirmRestore = async () => {
    if (!selectedForRestore) return;
    // Authority is enforced here, not only by hiding the control.
    if (userRole !== 'Admin') {
      showNotification('error', 'Only an Administrator may lift a closure sanction.');
      return;
    }
    // Re-entry guard (see handleConfirmRadiation).
    if (submittingAction) return;
    setSubmittingAction(true);
    try {
      await restoreBusinessStatus(
        selectedForRestore.businessId,
        adminId,
        userName,
        restoreReason || 'Tax compliance regularization verified'
      );
      showNotification(
        'success',
        `Closure sanction lifted for "${selectedForRestore.businessName}". Status restored to Active.`
      );
      setSelectedForRestore(null);
      await reloadDelinquentData();
    } catch (err: any) {
      console.error('[Restore Error]', err);
      showNotification('error', 'Error restoring business status: ' + (err.message || 'Unknown error'));
    } finally {
      setSubmittingAction(false);
    }
  };

  const getSeverityBadge = (item: DelinquentTaxpayerItem) => {
    if (normalizeBusinessStatus(item.status) === 'Closure Pending') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-slate-900 text-amber-300 border border-slate-800">
          <UserX className="w-3.5 h-3.5" />
          In Administrative Closure
        </span>
      );
    }

    switch (item.severity) {
      case 'critique':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-800 border border-red-200">
            <AlertOctagon className="w-3.5 h-3.5 text-red-600" />
            {item.maxDaysOverdue} days (Critical &gt;90d)
          </span>
        );
      case 'eleve':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-orange-100 text-orange-800 border border-orange-200">
            <AlertTriangle className="w-3.5 h-3.5 text-orange-600" />
            {item.maxDaysOverdue} days (High 61-90d)
          </span>
        );
      case 'moyen':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            {item.maxDaysOverdue} days (Medium 31-60d)
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-yellow-100 text-yellow-800 border border-yellow-200">
            <Clock className="w-3.5 h-3.5 text-yellow-600" />
            {item.maxDaysOverdue} days (Recent &lt;30d)
          </span>
        );
    }
  };

  return (
    <div className="space-y-8 font-sans">
      {/* Toast Notification */}
      {notification && (
        <div
          className={`p-4 rounded-[14px] text-xs font-medium flex items-center justify-between transition-premium ${
            notification.type === 'success'
              ? 'bg-sage/15 text-ink border border-sage/30'
              : 'bg-danger/15 text-ink border border-danger/30'
          }`}
        >
          <div className="flex items-center gap-2">
            {notification.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-sage shrink-0" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-danger shrink-0" />
            )}
            <span>{notification.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setNotification(null)}
            className="text-xs text-muted hover:text-ink cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Page Header */}
      <PageHeader
        eyebrow="Compliance"
        title="Delinquent Taxpayers & Debt Recovery"
        description="Delinquency and recovery tracking for DPRNK Business License Tax (Patente) • Fiscal Year 2026."
        actions={
          <Button
            variant="ghost"
            size="md"
            onClick={reloadDelinquentData}
            disabled={loading}
            icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
          >
            Refresh
          </Button>
        }
      />

      {/* Metric Summary Strip */}
      <MetricStrip
        columns={4}
        items={[
          {
            label: 'Delinquent Businesses',
            value: totalCount.toString(),
            trend: `${totalCount} with arrears`,
            trendType: totalCount > 0 ? 'warn' : 'sage',
            subline: 'Overdue unpaid balances',
            icon: <Building2 className="w-4 h-4 text-warn" />,
          },
          {
            label: 'Total Overdue Debt',
            value: `${formatMoney(totalOverdueUSD)}`,
            trend: 'USD total arrears',
            trendType: 'danger',
            subline: 'Cumulative outstanding tax',
            icon: <DollarSign className="w-4 h-4 text-danger" />,
          },
          {
            label: 'Critical Overdue (>90d)',
            value: criticalCount.toString(),
            trend: criticalCount > 0 ? 'Eligible for closure' : 'None',
            trendType: criticalCount > 0 ? 'danger' : 'muted',
            subline: 'High priority enforcement',
            icon: <AlertOctagon className="w-4 h-4 text-danger" />,
          },
          {
            label: 'In Closure',
            value: deregisteredCount.toString(),
            trend: deregisteredCount > 0 ? 'Sanctions active' : 'None',
            trendType: deregisteredCount > 0 ? 'warn' : 'muted',
            subline: 'Pending or confirmed exit',
            icon: <UserX className="w-4 h-4 text-muted" />,
          },
        ]}
      />

      {/* Admin Notice Banner */}
      {userRole === 'Admin' ? (
        <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-950 flex items-start gap-3">
          <ShieldAlert className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold text-amber-900">Urban Administrator Clearance:</span> You are authorized to place a business into 'Closure Pending' status after reviewing its tax file, in accordance with Urban Order No. 01/2026. Every closure decision is permanently recorded in the audit ledger with before/after values.
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-xl bg-slate-100 border border-slate-200 text-xs text-slate-700 flex items-start gap-3">
          <Info className="w-5 h-5 text-slate-500 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold text-slate-800">Consultation Mode:</span> As a <span className="font-semibold">{userRole}</span>, you have read-only access to guide collection missions. Administrative closure is restricted to Administrator oversight.
          </div>
        </div>
      )}

      {/* Search and Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col md:flex-row items-stretch md:items-center gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            id="delinquent-search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs rounded-lg border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-slate-900/20 focus:border-slate-800"
          />
        </div>

        {/* Severity filter */}
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <select
            id="delinquent-severity-filter"
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as SeverityFilter)}
            className="px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white text-slate-700 font-medium"
          >
            <option value="all">All delinquencies ({taxpayers.length})</option>
            <option value="critique">Critical &gt;90 days</option>
            <option value="eleve">High (61 to 90 days)</option>
            <option value="moyen">Medium (31 to 60 days)</option>
            <option value="faible">Recent (&le; 30 days)</option>
            <option value="en_radiation">In closure only</option>
            <option value="actif">Active overdue only</option>
          </select>
        </div>

        {/* Commune filter */}
        <select
          id="delinquent-commune-filter"
          value={communeFilter}
          onChange={(e) => setCommuneFilter(e.target.value)}
          className="px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white text-slate-700 font-medium"
        >
          <option value="all">All Communes</option>
          <option value="Goma">Commune of Goma</option>
          <option value="Karisimbi">Commune of Karisimbi</option>
        </select>

        {/* Sort Option */}
        <div className="flex items-center gap-2">
          <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <select
            id="delinquent-sort-filter"
            value={sortOption}
            onChange={(e) => setSortOption(e.target.value as SortField)}
            className="px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white text-slate-700 font-medium"
          >
            <option value="days-desc">Days overdue (highest first)</option>
            <option value="days-asc">Days overdue (lowest first)</option>
            <option value="debt-desc">Amount due (highest first)</option>
            <option value="debt-asc">Amount due (lowest first)</option>
            <option value="name-asc">Business Name (A - Z)</option>
          </select>
        </div>
      </div>

      {/* Taxpayers Table / Cards */}
      <div className="space-y-4">
        {loading ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-500">
            <RefreshCw className="w-8 h-8 text-slate-400 animate-spin mx-auto mb-2" />
            <div className="text-sm font-semibold text-slate-800">
              Analyzing delinquent tax ledger...
            </div>
            <div className="text-xs text-slate-400 mt-1">Calculating overdue aging and severity brackets</div>
          </div>
        ) : filteredTaxpayers.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-500">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
            <div className="text-sm font-semibold text-slate-800">
              No delinquent taxpayers match the selected criteria.
            </div>
            <p className="text-xs text-slate-400 mt-1">
              All taxpayers are up to date or current search filters are too restrictive.
            </p>
          </div>
        ) : (
          filteredTaxpayers.map((item) => {
            const isExpanded = expandedId === item.id;
            const isDeregistered = normalizeBusinessStatus(item.status) === 'Closure Pending';

            return (
              <div
                key={item.id}
                id={`delinquent-card-${item.id}`}
                className={`bg-white rounded-xl border transition-all ${
                  isDeregistered
                    ? 'border-slate-800 bg-slate-50/40 shadow-xs'
                    : item.severity === 'critique'
                    ? 'border-red-300 shadow-sm'
                    : 'border-slate-200 shadow-xs hover:border-slate-300'
                }`}
              >
                {/* Main Card Header */}
                <div className="p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="flex items-start gap-3.5">
                    <div
                      className={`w-11 h-11 rounded-lg flex items-center justify-center shrink-0 font-bold ${
                        isDeregistered
                          ? 'bg-slate-900 text-amber-400'
                          : item.severity === 'critique'
                          ? 'bg-red-100 text-red-700 border border-red-200'
                          : 'bg-amber-100 text-amber-800 border border-amber-200'
                      }`}
                    >
                      <Building2 className="w-5 h-5" />
                    </div>

                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-bold text-slate-900">{item.businessName}</h3>
                        {getSeverityBadge(item)}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-slate-500">
                        <span className="font-semibold text-slate-700">
                          Owner / Manager: {item.ownerFullName}
                        </span>
                        <span className="font-mono text-slate-400">
                          Nat ID: {item.nationalIdOrRccm || 'Not specified'}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-slate-400" />
                          Commune of {item.commune} ({item.quartier})
                        </span>
                        {item.phoneNumber && (
                          <span className="inline-flex items-center gap-1 font-mono">
                            <Phone className="w-3 h-3 text-slate-400" />
                            {item.phoneNumber}
                          </span>
                        )}
                      </div>

                      {/* Radiation details banner if deregistered */}
                      {isDeregistered && (
                        <div className="mt-2.5 p-2.5 rounded-lg bg-slate-900 text-slate-100 text-xs border border-slate-800 space-y-0.5">
                          <div className="flex items-center gap-1.5 text-amber-400 font-bold">
                            <UserX className="w-3.5 h-3.5" />
                            Administrative Closure Pending / Active
                          </div>
                          <div className="text-slate-300">
                            <span className="text-slate-400">Notified Reason:</span> "{item.deregistrationReason || 'Not specified'}"
                          </div>
                          <div className="text-[12px] text-slate-400">
                            Initiated by: <span className="text-slate-200">{item.deregisteredByName || "Urban Administrator"}</span>
                            {item.deregisteredAt && ` on ${new Date(item.deregisteredAt).toLocaleDateString("en-US")}`}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right side amounts & actions */}
                  <div className="flex flex-col sm:flex-row lg:flex-col items-start sm:items-center lg:items-end justify-between sm:justify-end gap-3 pt-3 lg:pt-0 border-t lg:border-t-0 border-slate-100">
                    <div className="text-left lg:text-right">
                      <div className="text-[12px] uppercase tracking-wider font-semibold text-slate-400">
                        Total Overdue Balance
                      </div>
                      <div className="text-xl font-black text-red-700">
                        {formatMoney(item.totalOverdueUSD)}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* Flag as closure-pending (deregistration) button */}
                      {userRole === 'Admin' ? (
                        !isDeregistered ? (
                          <button
                            type="button"
                            onClick={() => handleOpenRadiationModal(item)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-bold shadow-xs transition-colors"
                          >
                            <UserX className="w-3.5 h-3.5" />
                            Initiate Closure
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedForRestore(item);
                              setRestoreReason('');
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 text-xs font-bold border border-slate-700 shadow-xs transition-colors"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            Lift Closure
                          </button>
                        )
                      ) : (
                        !isDeregistered && (
                          <span className="text-[12px] text-slate-400 italic bg-slate-100 px-2 py-1 rounded">
                            Closure: Admin only
                          </span>
                        )
                      )}

                      {/* Expand / Collapse Button */}
                      <button
                        type="button"
                        onClick={() => setExpandedId(isExpanded ? null : item.id)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 text-xs font-semibold"
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? (
                          <>
                            Hide <ChevronUp className="w-3.5 h-3.5" />
                          </>
                        ) : (
                          <>
                            Tax Assessments ({item.assessmentsCount}) <ChevronDown className="w-3.5 h-3.5" />
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Expanded Assessments breakdown */}
                {isExpanded && (
                  <div className="px-5 pb-5 pt-2 border-t border-slate-100 bg-slate-50/60 rounded-b-xl">
                    <div className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2.5 flex items-center justify-between">
                      <span>Breakdown of Overdue Tax Assessments</span>
                      <span className="text-[12px] font-normal text-slate-500">
                        Oldest Due Date: {item.oldestDueDate}
                      </span>
                    </div>

                    {item.overdueAssessments.length === 0 ? (
                      <p className="text-xs text-slate-400 italic">
                        No specific active notices attached (direct administrative closure).
                      </p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="premium-table w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="border-b border-slate-200 text-slate-500 font-semibold text-[12px]">
                              <th className="py-2 px-3">Assessment Notice No.</th>
                              <th className="py-2 px-3">Fiscal Year</th>
                              <th className="py-2 px-3">Due Date</th>
                              <th className="py-2 px-3">Assessed Amount</th>
                              <th className="py-2 px-3">Already Paid</th>
                              <th className="py-2 px-3 font-bold text-red-700">Remaining Balance</th>
                              <th className="py-2 px-3">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200/60 text-slate-700">
                            {item.overdueAssessments.map((ass) => {
                              const remaining =
                                typeof ass.remainingBalanceUSD === 'number'
                                  ? ass.remainingBalanceUSD
                                  : ass.amountDueUSD - (ass.amountPaidUSD || 0);
                              return (
                                <tr key={ass.id} className="hover:bg-white">
                                  <td className="py-2.5 px-3 font-mono font-bold text-slate-800">
                                    {ass.assessmentNumber || ass.noticeNumber || ass.id}
                                  </td>
                                  <td className="py-2.5 px-3">{ass.fiscalYear || 2026}</td>
                                  <td className="py-2.5 px-3 font-mono text-slate-600">
                                    {ass.dueDate || 'Not set'}
                                  </td>
                                  <td className="py-2.5 px-3">
                                    {formatMoney(ass.amountDueUSD)}
                                  </td>
                                  <td className="py-2.5 px-3 text-emerald-700 font-medium">
                                    {formatMoney((ass.amountPaidUSD || 0))}
                                  </td>
                                  <td className="py-2.5 px-3 font-bold text-red-700">
                                    {formatMoney(remaining)}
                                  </td>
                                  <td className="py-2.5 px-3">
                                    <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-red-100 text-red-800 uppercase">
                                      {ass.status}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* ADMIN REVIEW & DEREGISTRATION MODAL */}
      {selectedForRadiation && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-red-200 max-w-xl w-full shadow-2xl overflow-hidden my-8">
            {/* Modal Header */}
            <div className="bg-red-700 text-white p-5 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <AlertOctagon className="w-6 h-6 text-white shrink-0" />
                <div>
                  <h3 className="text-base font-bold">
                    Administrative Closure Proposal
                  </h3>
                  <p className="text-xs text-red-100 mt-0.5">
                    Urban Decree No. 01/2026 • DPRNK
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedForRadiation(null)}
                className="text-white hover:text-red-200 text-lg font-bold"
              >
                &times;
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4 text-xs text-slate-700">
              {/* Target Summary */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-500">Target Business:</span>
                  <span className="font-bold text-slate-900 text-sm">{selectedForRadiation.businessName}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-500">Owner / Manager:</span>
                  <span className="font-medium text-slate-800">{selectedForRadiation.ownerFullName}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-500">Nat ID:</span>
                  <span className="font-mono text-slate-800">{selectedForRadiation.nationalIdOrRccm || 'N/A'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-500">Overdue Aging:</span>
                  <span className="font-bold text-red-700">
                    {selectedForRadiation.maxDaysOverdue} days overdue
                  </span>
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                  <span className="font-bold text-slate-700">Total Due Debt:</span>
                  <span className="text-base font-black text-red-700">
                    {formatMoney(selectedForRadiation.totalOverdueUSD)}
                  </span>
                </div>
              </div>

              {/* Warning Text */}
              <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 text-red-950 space-y-1">
                <div className="font-bold flex items-center gap-1 text-red-900">
                  <ShieldAlert className="w-4 h-4 text-red-700" />
                  Legal consequences of closure:
                </div>
                <ul className="list-disc list-inside space-y-0.5 text-[12px] text-red-900/90">
                  <li>Immediate suspension of commercial business license in the City of Goma.</li>
                  <li>Transmission of enforcement order to fiscal collection officers.</li>
                  <li>Permanent immutable logging in the audit ledger.</li>
                </ul>
              </div>

              {/* Reason Presets */}
              <div>
                <label className="block font-bold text-slate-800 mb-1.5">
                  Official administrative justification:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mb-2">
                  <button
                    type="button"
                    onClick={() =>
                      setRadiationReason(
                        'Extended payment default (>180 days) after 3 unsuccessful formal notices.'
                      )
                    }
                    className="p-1.5 text-left text-[12px] rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700"
                  >
                    • &gt;180 days after 3 formal notices
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setRadiationReason(
                        'Definitive closure of commercial premises recorded by tax bailiff service.'
                      )
                    }
                    className="p-1.5 text-left text-[12px] rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700"
                  >
                    • Closure confirmed by bailiff
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setRadiationReason(
                        'Unreported cessation of business operations with unsettled license tax liabilities.'
                      )
                    }
                    className="p-1.5 text-left text-[12px] rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700"
                  >
                    • Unreported cessation
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setRadiationReason(
                        'Deliberate payment refusal and obstruction of municipal tax recovery.'
                      )
                    }
                    className="p-1.5 text-left text-[12px] rounded border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-700"
                  >
                    • Deliberate refusal & obstruction
                  </button>
                </div>

                <textarea
                  rows={3}
                  value={radiationReason}
                  onChange={(e) => setRadiationReason(e.target.value)}
                  placeholder="Enter or adjust the detailed administrative reason..."
                  className="w-full p-2.5 rounded-lg border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-red-500/20 focus:border-red-600 text-xs"
                />
              </div>

              {/* Maker-Checker Notice & Confirmation Checkbox */}
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[12px] leading-relaxed">
                <strong>Maker-Checker Principle:</strong> Business closure is a sensitive measure. This request will be routed to the <strong>Pending Approvals</strong> queue for dual-signoff authorization.
              </div>

              <label className="flex items-start gap-2.5 p-3 rounded-lg border border-slate-200 bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isConfirmedCheckbox}
                  onChange={(e) => setIsConfirmedCheckbox(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-red-600 focus:ring-red-500"
                />
                <span className="text-[12px] text-slate-800 font-medium">
                  I, acting as <span className="font-bold">{userRole} ({userName})</span>,{' '}
                  certify that I have verified the persistent default and request the opening of the formal closure approval procedure.
                </span>
              </label>
            </div>

            {/* Modal Actions */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setSelectedForRadiation(null)}
                disabled={submittingAction}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-white text-xs font-semibold"
              >Cancel</button>
              <button
                type="button"
                onClick={handleConfirmRadiation}
                disabled={submittingAction || !isConfirmedCheckbox || !radiationReason.trim()}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-red-700 hover:bg-red-800 text-white text-xs font-bold shadow-sm disabled:opacity-50 transition-colors"
              >
                {submittingAction ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    Submitting request...
                  </>
                ) : (
                  <>
                    <UserX className="w-3.5 h-3.5" />
                    Submit for Approval (Maker-Checker)
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RESTORE BUSINESS STATUS MODAL */}
      {selectedForRestore && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full shadow-2xl overflow-hidden">
            <div className="bg-slate-900 text-white p-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold">Reactivate Business (Lift Closure)</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedForRestore(null)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                &times;
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs text-slate-700">
              <p>
                You are about to restore business status for{' '}
                <span className="font-bold text-slate-900">{selectedForRestore.businessName}</span>. Its status will return
                to "Active" in the fiscal registry.
              </p>

              <div>
                <label className="block font-bold text-slate-800 mb-1">
                  Reason for reactivation / settlement:
                </label>
                <input
                  type="text"
                  value={restoreReason}
                  onChange={(e) => setRestoreReason(e.target.value)}
                  placeholder="e.g. Overdue balance settled at cashier or payment plan agreed."
                  className="w-full p-2.5 rounded-lg border border-slate-200 text-xs focus:ring-2 focus:ring-slate-900/20"
                />
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setSelectedForRestore(null)}
                disabled={submittingAction}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-white text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmRestore}
                disabled={submittingAction}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-amber-300 text-xs font-bold"
              >
                {submittingAction ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-3.5 h-3.5" />
                )}
                Confirm Reactivation
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
