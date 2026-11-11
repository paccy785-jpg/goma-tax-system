import React, { useState, useEffect, useMemo } from 'react';
import { 
  FileCheck2, 
  CheckCircle2, 
  Clock, 
  AlertTriangle, 
  Plus, 
  Search, 
  ShieldCheck, 
  FileText,
  DollarSign,
  Sparkles,
  Filter,
  XCircle,
  Eye,
  AlertOctagon,
  Building2,
  Calendar,
  Layers,
  ArrowUpDown,
  RefreshCw,
  X
} from 'lucide-react';
import { 
  Assessment, 
  UserRole,
  Business,
  NavigationItem,
  normalizeBusinessStatus,
  normalizeAssessmentStatus, 
  TaxRate, 
  TaxType,
  SECTOR_LABELS, 
  SIZE_CLASS_LABELS 
} from '../types';
import { 
  getAssessments, 
  subscribeToAssessments,
  addAssessment, 
  getBusinesses, 
  subscribeToBusinesses,
  getTaxRates, 
  logAuditEvent,
  calculateProratedAssessment,
  generateNextAssessmentNumber,
  getNormalizedAssessmentStatus,
  DEFAULT_PATENTE_RATES
} from '../services/dbService';
import { assessmentTaxLabel, getTaxTypes } from '../services/taxTypeService';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { BulkAssessmentModal } from './assessments/BulkAssessmentModal';
import { CancelAssessmentModal } from './assessments/CancelAssessmentModal';
import { AssessmentNoticeModal } from './assessments/AssessmentNoticeModal';
import { PageHeader, Button, Badge, Panel, MetricStrip } from './ui';
import { localDateFromIsoTimestamp, todayDateString } from '../utils/date';
import { formatMoney } from '../utils/money';

interface AssessmentsViewProps {
  userRole: UserRole;
  onNavigate?: (view: NavigationItem) => void;
}

export const AssessmentsView: React.FC<AssessmentsViewProps> = ({ userRole, onNavigate }) => {
  const { currentUser, userProfile } = useAuth();
  const { showToast } = useToast();
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [activeRates, setActiveRates] = useState<TaxRate[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [yearFilter, setYearFilter] = useState<string>('ALL');
  const [communeFilter, setCommuneFilter] = useState<string>('ALL');
  /** Filter by head of tax: patente, or a percentage tax such as IF / IRL. */
  const [taxTypeFilter, setTaxTypeFilter] = useState<string>('ALL');
  const [taxTypes, setTaxTypes] = useState<TaxType[]>([]);

  // Modals
  const [isNewModalOpen, setIsNewModalOpen] = useState<boolean>(false);
  const [isBulkModalOpen, setIsBulkModalOpen] = useState<boolean>(false);
  const [noticeModalAssessment, setNoticeModalAssessment] = useState<Assessment | null>(null);
  const [assessmentToCancel, setAssessmentToCancel] = useState<Assessment | null>(null);

  // New Assessment Form States
  const currentYear = new Date().getFullYear();
  const [selectedBusinessId, setSelectedBusinessId] = useState<string>('');
  const [assFiscalYear, setAssFiscalYear] = useState<number>(currentYear);
  const [customDueDate, setCustomDueDate] = useState<string>(`${currentYear}-03-31`);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const canCreate = userRole === 'Supervisor' || userRole === 'Admin';
  const canBulkCreate = userRole === 'Admin';
  const canCancel = userRole === 'Supervisor' || userRole === 'Admin';

  useEffect(() => {
    setLoading(true);

    // Static tax rates: single getDocs() read
    getTaxRates(true)
      .then((rates) => setActiveRates(rates || []))
      .catch((err) => console.warn('[Assessments] Tax rates load error:', err));

    // Heads of tax, for the filter and the notice-type badge
    getTaxTypes()
      .then((types) => setTaxTypes(types || []))
      .catch((err) => console.warn('[Assessments] Tax types load error:', err));

    // Active-aware listeners
    const unsubAssessments = subscribeToAssessments(
      (data) => {
        setAssessments(data || []);
        setLoading(false);
      },
      (err) => {
        console.error('[Assessments] Real-time listener error:', err);
        setLoading(false);
      }
    );

    const unsubBusinesses = subscribeToBusinesses(
      (data) => {
        setBusinesses(data || []);
      },
      (err) => {
        console.error('[Assessments] Businesses listener error:', err);
      }
    );

    return () => {
      unsubAssessments();
      unsubBusinesses();
    };
  }, []);

  const reloadData = async () => {
    setLoading(true);
    try {
      const [assData, bizData, ratesData] = await Promise.all([
        getAssessments(),
        getBusinesses(),
        getTaxRates(true)
      ]);
      setAssessments(assData || []);
      setBusinesses(bizData || []);
      setActiveRates(ratesData || []);
    } catch (err) {
      console.warn('[Assessments] Reload error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Find business for new assessment form
  const selectedBusiness = useMemo(() => {
    return businesses.find((b) => b.id === selectedBusinessId) || null;
  }, [businesses, selectedBusinessId]);

  // Set default selected business if not set
  useEffect(() => {
    if (!selectedBusinessId && businesses.length > 0) {
      const active = businesses.find((b) => normalizeBusinessStatus(b.status) === 'Active');
      if (active) setSelectedBusinessId(active.id);
    }
  }, [businesses, selectedBusinessId]);

  // Resolve applicable tax rate
  const resolvedRate = useMemo(() => {
    if (!selectedBusiness) return null;
    const rates = activeRates.length > 0 ? activeRates : DEFAULT_PATENTE_RATES;
    return rates.find(
      (r) =>
        r.activitySector === selectedBusiness.activitySector &&
        r.sizeClass === selectedBusiness.sizeClass &&
        (r.isActive ?? true)
    ) || null;
  }, [selectedBusiness, activeRates]);

  // Calculate Proration preview
  const prorationCalc = useMemo(() => {
    if (!selectedBusiness || !resolvedRate) return null;
    return calculateProratedAssessment(
      resolvedRate.annualFeeUSD,
      selectedBusiness.registrationDate,
      assFiscalYear
    );
  }, [selectedBusiness, resolvedRate, assFiscalYear]);

  // Preview generated assessment number
  const previewAssessmentNumber = useMemo(() => {
    return generateNextAssessmentNumber(assessments, assFiscalYear);
  }, [assFiscalYear, assessments]);

  // Compute KPI Statistics
  const stats = useMemo(() => {
    let totalCount = assessments.length;
    let pendingCount = 0;
    let paidCount = 0;
    let overdueCount = 0;
    let cancelledCount = 0;

    let totalUSD = 0;
    let pendingUSD = 0;
    let paidUSD = 0;
    let overdueUSD = 0;

    assessments.forEach((a) => {
      const st = getNormalizedAssessmentStatus(a);
      const amt = a.amountDueUSD || 0;
      totalUSD += amt;

      if (st === 'Paid') {
        paidCount++;
        paidUSD += a.amountPaidUSD || amt;
      } else if (st === 'Overdue') {
        overdueCount++;
        overdueUSD += (a.remainingBalanceUSD !== undefined ? a.remainingBalanceUSD : amt);
      } else if (st === 'Cancelled') {
        cancelledCount++;
      } else {
        pendingCount++;
        pendingUSD += (a.remainingBalanceUSD !== undefined ? a.remainingBalanceUSD : amt);
      }
    });

    return {
      totalCount,
      pendingCount,
      paidCount,
      overdueCount,
      cancelledCount,
      totalUSD,
      pendingUSD,
      paidUSD,
      overdueUSD,
    };
  }, [assessments]);

  // Unique fiscal years for filter
  const availableYears = useMemo(() => {
    const set = new Set<number>();
    assessments.forEach((a) => {
      if (a.fiscalYear) set.add(a.fiscalYear);
    });
    set.add(currentYear);
    return Array.from(set).sort((a, b) => b - a);
  }, [assessments, currentYear]);

  // Filtered Assessments
  const filtered = useMemo(() => {
    return assessments.filter((a) => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        (a.assessmentNumber && a.assessmentNumber.toLowerCase().includes(q)) ||
        (a.noticeNumber && a.noticeNumber.toLowerCase().includes(q)) ||
        (a.businessName && a.businessName.toLowerCase().includes(q)) ||
        (a.taxpayerName && a.taxpayerName.toLowerCase().includes(q)) ||
        (a.ownerFullName && a.ownerFullName.toLowerCase().includes(q)) ||
        (a.quartier && a.quartier.toLowerCase().includes(q)) ||
        (a.taxTypeCode && a.taxTypeCode.toLowerCase().includes(q)) ||
        (a.parcelRang && a.parcelRang.toLowerCase().includes(q)) ||
        (a.nationalIdOrRccm && a.nationalIdOrRccm.toLowerCase().includes(q));

      const normalizedStatus = getNormalizedAssessmentStatus(a);
      const matchesStatus = statusFilter === 'ALL' || normalizedStatus === statusFilter;
      const matchesYear = yearFilter === 'ALL' || a.fiscalYear === Number(yearFilter);
      const matchesCommune = communeFilter === 'ALL' || a.commune === communeFilter;
      // A missing taxTypeCode means a legacy record — that is the Business
      // License Tax, which is exactly what the whole roll was before.
      const taxCode = a.taxTypeCode || 'PATENTE';
      const matchesTaxType = taxTypeFilter === 'ALL' || taxCode === taxTypeFilter;

      return matchesSearch && matchesStatus && matchesYear && matchesCommune && matchesTaxType;
    });
  }, [assessments, searchQuery, statusFilter, yearFilter, communeFilter, taxTypeFilter]);

  // Handle single assessment creation
  const handleCreateAssessment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreate) return;
    if (!selectedBusiness || !resolvedRate || !prorationCalc) return;
    // Re-entry guard: the disabled submit button does not stop implicit form
    // submission via the Enter key.
    if (isSubmitting) return;

    // Duplicate-assessment guard (mirrors the bulk rollout rule): refuse a
    // second live notice for the same business and fiscal year — two open
    // balances for one tax year is double taxation.
    const duplicate = assessments.find(
      (a) =>
        a.businessId === selectedBusiness.id &&
        a.fiscalYear === assFiscalYear &&
        normalizeAssessmentStatus(a.status) !== 'Cancelled'
    );
    if (duplicate) {
      showToast(
        `${selectedBusiness.businessName} already has an assessment notice for fiscal year ${assFiscalYear} (${duplicate.assessmentNumber || duplicate.noticeNumber}). Cancel it before issuing a new one.`,
        'error',
        'Duplicate Assessment'
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const now = new Date().toISOString();
      const nextNum = generateNextAssessmentNumber(assessments, assFiscalYear);

      const newAssessment: Assessment = {
        id: `ass_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        assessmentNumber: nextNum,
        noticeNumber: nextNum,
        fiscalYear: assFiscalYear,
        businessId: selectedBusiness.id,
        businessName: selectedBusiness.businessName,
        taxpayerName: selectedBusiness.ownerFullName || selectedBusiness.businessName,
        ownerFullName: selectedBusiness.ownerFullName,
        nationalIdOrRccm: selectedBusiness.nationalIdOrRccm,
        commune: selectedBusiness.commune,
        quartier: selectedBusiness.quartier,
        physicalAddress: selectedBusiness.physicalAddress,
        phoneNumber: selectedBusiness.phoneNumber,
        activitySector: selectedBusiness.activitySector,
        sizeClass: selectedBusiness.sizeClass,
        baseAnnualFeeUSD: resolvedRate.annualFeeUSD,
        amountDueUSD: prorationCalc.amountDueUSD,
        amountPaidUSD: 0,
        remainingBalanceUSD: prorationCalc.amountDueUSD,
        isProrated: prorationCalc.isProrated,
        proratedMonths: prorationCalc.proratedMonths,
        proratedNotes: prorationCalc.notes,
        registrationDate: selectedBusiness.registrationDate,
        issueDate: todayDateString(),
        dueDate: customDueDate || `${assFiscalYear}-03-31`,
        status: 'Pending',
        assessedBy: currentUser?.uid || 'officer',
        assessedByName: userProfile?.displayName || 'Tax Supervisor',
        rateId: resolvedRate.id,
        rateVersion: resolvedRate.version || 1,
        createdAt: now,
        updatedAt: now,
      };

      await addAssessment(newAssessment);

      // Audit Log
      if (userProfile) {
        await logAuditEvent(
          userProfile.uid,
          userProfile.displayName,
          userProfile.role,
          'CREATE_ASSESSMENT',
          'Assessment',
          newAssessment.id,
          `Issuance of Business License Tax notice ${nextNum} for "${selectedBusiness.businessName}" (${selectedBusiness.commune}): ${formatMoney(newAssessment.amountDueUSD)} at tariff v${resolvedRate.version || 1}. Proration: ${prorationCalc.isProrated ? `${prorationCalc.proratedMonths}/12 months` : 'Full Year'}.`
        );
      }

      setAssessments((prev) => [newAssessment, ...prev]);
      setIsNewModalOpen(false);
    } catch (err) {
      console.error('[Create Assessment] Error:', err);
      // Surface the failure — a silent catch left the officer believing the
      // notice was issued and inviting a duplicate retry.
      showToast(
        err instanceof Error ? err.message : 'Failed to issue the assessment notice.',
        'error',
        'Issuance Failed'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderStatusBadge = (a: Assessment) => {
    const status = getNormalizedAssessmentStatus(a);
    switch (status) {
      case 'Paid':
        return <Badge variant="sage" dot>Paid & Cleared</Badge>;
      case 'Overdue':
        return <Badge variant="danger" dot>Overdue</Badge>;
      case 'Cancelled':
        return <Badge variant="neutral">Cancelled</Badge>;
      case 'Pending':
      default:
        return <Badge variant="warn" dot>Pending Payment</Badge>;
    }
  };

  return (
    <div className="space-y-8 font-sans">
      
      {/* Top Header */}
      <PageHeader
        eyebrow="Assessment & Billing"
        title="Tax Assessments Ledger"
        actions={
          <>
            <Button
              variant="ghost"
              size="md"
              icon={<RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />}
              onClick={reloadData}
            >
              Refresh
            </Button>
            {canBulkCreate && (
              <Button
                variant="ghost"
                size="md"
                icon={<Sparkles className="w-4 h-4 text-accent" />}
                onClick={() => setIsBulkModalOpen(true)}
              >
                Annual Roll Rollout
              </Button>
            )}
            {canCreate && (
              <Button
                variant="primary"
                size="md"
                icon={<Plus className="w-4 h-4" />}
                onClick={() => {
                  setAssFiscalYear(currentYear);
                  setCustomDueDate(`${currentYear}-03-31`);
                  setIsNewModalOpen(true);
                }}
              >
                Issue Notice
              </Button>
            )}
            {onNavigate && (
              <Button
                variant="primary"
                size="md"
                icon={<DollarSign className="w-4 h-4" />}
                onClick={() => onNavigate('payments')}
              >
                Record Payment
              </Button>
            )}
          </>
        }
      />

      {/* Metric Strip (4 columns) */}
      <MetricStrip
        columns={4}
        items={[
          {
            label: 'Total Assessments',
            value: stats.totalCount.toLocaleString('en-US'),
            trend: `${formatMoney(stats.totalUSD)}`,
            trendType: 'muted',
            subline: 'Assessed fiscal roll',
            icon: <FileCheck2 className="w-4 h-4 text-accent" />,
          },
          {
            label: 'Pending Payment',
            value: stats.pendingCount.toLocaleString('en-US'),
            trend: `${formatMoney(stats.pendingUSD)}`,
            trendType: 'warn',
            subline: 'Awaiting cash collection',
            icon: <Clock className="w-4 h-4 text-warn" />,
          },
          {
            label: 'Paid & Cleared',
            value: stats.paidCount.toLocaleString('en-US'),
            trend: `${formatMoney(stats.paidUSD)}`,
            trendType: 'sage',
            subline: 'Acquitted revenue',
            icon: <CheckCircle2 className="w-4 h-4 text-sage" />,
          },
          {
            label: 'In Arrears (Overdue)',
            value: stats.overdueCount.toLocaleString('en-US'),
            trend: `${formatMoney(stats.overdueUSD)}`,
            trendType: stats.overdueCount > 0 ? 'danger' : 'sage',
            subline: 'Recovery notice eligible',
            icon: <AlertTriangle className="w-4 h-4 text-danger" />,
          },
        ]}
      />

      {/* Role Mandate Callout */}
      {userRole === 'Supervisor' && (
        <div className="p-4 rounded-[14px] bg-accent-soft border border-line text-xs text-ink flex items-start gap-3 transition-premium">
          <ShieldCheck className="w-5 h-5 text-accent shrink-0 mt-0.5" />
          <div>
            <span className="font-bold text-ink">Supervisor Authority:</span> As a Supervisor, you can issue new tax assessments with automatic proration, verify tariff schedule compliance, or cancel erroneous notices with mandatory audit logging.
          </div>
        </div>
      )}

      {/* Panel with Search & Filter Bar and Table */}
      <Panel
        title="Assessment Roll"
        subtitle={`Displaying ${filtered.length} of ${assessments.length} assessment notices`}
        padding="none"
      >
        {/* Search & Filters Bar */}
        <div className="p-4 sm:p-5 border-b border-line bg-surface2/30 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          
          {/* Search Input */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-muted absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="assessment-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-surface border border-line rounded-[10px] text-xs text-ink placeholder:text-muted focus:border-accent focus:outline-none transition-premium font-sans"
            />
          </div>

          {/* Filter Controls */}
          <div className="flex flex-wrap items-center gap-2">
            
            {/* Status Filter */}
            <select
              id="assessment-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 bg-surface border border-line rounded-[10px] text-xs text-ink font-medium focus:border-accent focus:outline-none transition-premium font-sans"
            >
              <option value="ALL">All Statuses ({assessments.length})</option>
              <option value="Pending">Pending ({stats.pendingCount})</option>
              <option value="Paid">Paid ({stats.paidCount})</option>
              <option value="Overdue">Overdue ({stats.overdueCount})</option>
              <option value="Cancelled">Cancelled ({stats.cancelledCount})</option>
            </select>

            {/* Tax Year Filter */}
            <select
              id="assessment-year-filter"
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              className="px-3 py-2 bg-surface border border-line rounded-[10px] text-xs font-mono text-ink font-medium focus:border-accent focus:outline-none transition-premium"
            >
              <option value="ALL">All Years</option>
              {availableYears.map((yr) => (
                <option key={yr} value={yr}>
                  Fiscal Year {yr}
                </option>
              ))}
            </select>

            {/* Commune Filter */}
            <select
              id="assessment-commune-filter"
              value={communeFilter}
              onChange={(e) => setCommuneFilter(e.target.value)}
              className="px-3 py-2 bg-surface border border-line rounded-[10px] text-xs text-ink font-medium focus:border-accent focus:outline-none transition-premium font-sans"
            >
              <option value="ALL">All Communes</option>
              <option value="Goma">Commune of Goma</option>
              <option value="Karisimbi">Commune of Karisimbi</option>
            </select>

            {/* Head of tax filter */}
            <select
              id="assessment-tax-type-filter"
              value={taxTypeFilter}
              onChange={(e) => setTaxTypeFilter(e.target.value)}
              aria-label="Filter by head of tax"
              className="px-3 py-2 bg-surface border border-line rounded-[10px] text-xs text-ink font-medium focus:border-accent focus:outline-none transition-premium font-sans"
            >
              <option value="ALL">All Taxes</option>
              <option value="PATENTE">Patente (Business License)</option>
              {taxTypes.map((t) => (
                <option key={t.id} value={t.code}>
                  {t.code} — {t.ratePercent}%
                </option>
              ))}
            </select>

            {(statusFilter !== 'ALL' ||
              yearFilter !== 'ALL' ||
              communeFilter !== 'ALL' ||
              taxTypeFilter !== 'ALL' ||
              searchQuery) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStatusFilter('ALL');
                  setYearFilter('ALL');
                  setCommuneFilter('ALL');
                  setTaxTypeFilter('ALL');
                  setSearchQuery('');
                }}
              >
                Reset
              </Button>
            )}

          </div>
        </div>

        {/* Assessments Data Table */}
        <div className="overflow-x-auto">
          <table className="premium-table w-full text-left border-collapse text-xs font-sans">
            <thead>
              <tr className="border-b border-line bg-surface2/40">
                <th className="py-3.5 px-6 text-[11px] font-bold uppercase tracking-[0.1em] text-faint">Notice & Year</th>
                <th className="py-3.5 px-6 text-[11px] font-bold uppercase tracking-[0.1em] text-faint">Business & Location</th>
                <th className="py-3.5 px-6 text-[11px] font-bold uppercase tracking-[0.1em] text-faint">Sector / Size</th>
                <th className="py-3.5 px-6 text-[11px] font-bold uppercase tracking-[0.1em] text-faint text-right">Assessed Amount</th>
                <th className="py-3.5 px-6 text-[11px] font-bold uppercase tracking-[0.1em] text-faint">Due Date</th>
                <th className="py-3.5 px-6 text-[11px] font-bold uppercase tracking-[0.1em] text-faint text-center">Status</th>
                <th className="py-3.5 px-6 text-[11px] font-bold uppercase tracking-[0.1em] text-faint text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-muted">
                    <FileText className="w-8 h-8 mx-auto text-faint mb-2" />
                    <div className="font-semibold text-ink">No tax assessments found</div>
                    <div className="text-xs text-muted mt-0.5">
                      Adjust your filters or issue a new assessment for a registered business.
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((item) => {
                  const normalizedStatus = getNormalizedAssessmentStatus(item);
                  return (
                    <tr key={item.id} className="hover:bg-surface2/30 transition-premium">
                      {/* Notice Number & Year */}
                      <td className="py-4 px-6 font-mono">
                        <div className="font-bold text-ink text-xs tabular-nums">
                          {item.assessmentNumber || item.noticeNumber}
                        </div>
                        <div className="text-[12px] text-muted flex items-center gap-1 mt-0.5 font-sans">
                          <span>Fiscal Year:</span>
                          <span className="font-bold text-ink">{item.fiscalYear}</span>
                        </div>
                      </td>

                      {/* Business & Location */}
                      <td className="py-4 px-6">
                        <div className="font-bold text-ink">
                          {item.businessName || item.taxpayerName}
                        </div>
                        <div className="text-[12px] text-muted mt-0.5">
                          {item.commune} {item.quartier ? `• ${item.quartier}` : ''}
                          {item.ownerFullName ? ` • ${item.ownerFullName}` : ''}
                        </div>
                        {item.nationalIdOrRccm && (
                          <div className="text-[11px] text-faint font-mono mt-0.5">
                            {item.nationalIdOrRccm}
                          </div>
                        )}
                      </td>

                      {/* Classification — a percentage head of tax is classified
                          by its rate and declared base, not by sector and size. */}
                      <td className="py-4 px-6">
                        {item.taxTypeCode && item.taxTypeCode !== 'PATENTE' ? (
                          <>
                            <div
                              className="flex flex-wrap items-center gap-1.5"
                              title={assessmentTaxLabel(item)}
                            >
                              <span className="font-bold text-[11px] px-2 py-0.5 rounded-[6px] bg-accent-soft text-accent border border-accent/25 uppercase tracking-wider">
                                {item.taxTypeCode}
                              </span>
                              <span className="text-[11px] font-semibold text-ink tabular-nums">
                                {item.taxRatePercent}%
                              </span>
                            </div>
                            {item.taxableBaseUSD !== undefined && (
                              <div className="text-[11px] text-muted mt-1 tabular-nums">
                                Base: {formatMoney(item.taxableBaseUSD)}
                              </div>
                            )}
                            <div className="text-[11px] text-faint mt-0.5">
                              {item.taxableBaseLabel || 'Declared base'}
                              {item.parcelRang ? ` • Rang ${item.parcelRang}` : ''}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-semibold text-[12px] px-2 py-0.5 rounded-[6px] bg-surface2 border border-line text-ink capitalize">
                                {item.activitySector ? SECTOR_LABELS[item.activitySector] : 'General'}
                              </span>
                              <span className="text-[11px] px-1.5 py-0.5 rounded-[6px] bg-accent-soft text-accent border border-accent/20 capitalize font-medium">
                                {item.sizeClass ? (SIZE_CLASS_LABELS[item.sizeClass]?.label || item.sizeClass) : 'Standard'}
                              </span>
                            </div>
                            {item.isProrated && (
                              <div className="mt-1">
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-warn bg-warn/10 px-1.5 py-0.5 rounded-[6px] border border-warn/25">
                                  <Clock className="w-2.5 h-2.5 text-warn" />
                                  Prorated {item.proratedMonths}/12 mo.
                                </span>
                              </div>
                            )}
                          </>
                        )}
                      </td>

                      {/* Amount Due (USD) */}
                      <td className="py-4 px-6 text-right">
                        <div className="font-display font-bold text-ink text-sm tabular-nums">
                          {formatMoney(item.amountDueUSD)}
                        </div>
                        {item.isProrated && item.baseAnnualFeeUSD && item.baseAnnualFeeUSD !== item.amountDueUSD && (
                          <div className="text-[11px] text-faint line-through tabular-nums">
                            Base: {formatMoney(item.baseAnnualFeeUSD)}
                          </div>
                        )}
                      </td>

                      {/* Due Date */}
                      <td className="py-4 px-6 font-mono text-xs">
                        <div className={`font-semibold tabular-nums ${normalizedStatus === 'Overdue' ? 'text-danger' : 'text-ink'}`}>
                          {item.dueDate}
                        </div>
                        <div className="text-[11px] text-muted font-sans">
                          Issued: {item.issueDate || (item.createdAt ? localDateFromIsoTimestamp(item.createdAt) : 'n/a')}
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-4 px-6 text-center">
                        {renderStatusBadge(item)}
                      </td>

                      {/* Actions */}
                      <td className="py-4 px-6 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {/* View Notice */}
                          <button
                            id={`view-notice-${item.id}-btn`}
                            type="button"
                            onClick={() => setNoticeModalAssessment(item)}
                            title="View and print official tax notice"
                            className="p-1.5 rounded-[8px] border border-line bg-surface hover:bg-surface2 text-ink shadow-2xs transition-premium"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>

                          {/* Cancel Assessment (Supervisor / Admin only) */}
                          {canCancel && normalizedStatus !== 'Paid' && normalizedStatus !== 'Cancelled' && (
                            <button
                              id={`cancel-assessment-${item.id}-btn`}
                              type="button"
                              onClick={() => setAssessmentToCancel(item)}
                              title="Cancel this assessment with justification"
                              className="p-1.5 rounded-[8px] border border-danger/30 bg-danger/10 hover:bg-danger/20 text-danger shadow-2xs transition-premium"
                            >
                              <AlertOctagon className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ======================================================== */}
      {/* ISSUE NEW INDIVIDUAL ASSESSMENT MODAL                    */}
      {/* ======================================================== */}
      {isNewModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/60 backdrop-blur-xs overflow-y-auto">
          <div className="bg-surface rounded-[18px] border border-line shadow-card w-full max-w-xl my-8 overflow-hidden font-sans">
            
            <div className="px-6 py-5 border-b border-line bg-surface2/30 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-[10px] bg-accent-soft text-accent flex items-center justify-center shrink-0">
                  <FileCheck2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-display text-base font-bold text-ink">
                    Issue Business License Tax Assessment
                  </h3>
                  <p className="text-xs text-muted">
                    Calculation of duties based on official tariff schedule and prorata temporis
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsNewModalOpen(false)}
                className="w-8 h-8 rounded-[8px] bg-surface2 text-muted hover:text-ink flex items-center justify-center transition-premium"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateAssessment} className="p-6 space-y-4">
              
              {/* Business Selector */}
              <div>
                <label className="block text-xs font-bold text-ink mb-1.5 flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-accent" />
                  Select Active Business *
                </label>
                <select
                  id="ass-form-business-select"
                  value={selectedBusinessId}
                  onChange={(e) => setSelectedBusinessId(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs rounded-[10px] border border-line bg-surface text-ink font-medium focus:border-accent focus:outline-none transition-premium"
                >
                  {businesses
                    .filter((b) => normalizeBusinessStatus(b.status) === 'Active')
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.businessName} — {b.commune} ({SECTOR_LABELS[b.activitySector] || b.activitySector}, {SIZE_CLASS_LABELS[b.sizeClass]?.label || b.sizeClass})
                      </option>
                    ))}
                </select>
              </div>

              {/* Fiscal Year & Due Date */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-ink mb-1.5 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-accent" />
                    Fiscal Year *
                  </label>
                  <select
                    id="ass-form-year-select"
                    value={assFiscalYear}
                    onChange={(e) => {
                      const yr = Number(e.target.value);
                      setAssFiscalYear(yr);
                      setCustomDueDate(`${yr}-03-31`);
                    }}
                    className="w-full px-3 py-2 text-xs font-mono font-bold rounded-[10px] border border-line bg-surface text-ink focus:border-accent focus:outline-none transition-premium"
                  >
                    <option value={currentYear + 1}>{currentYear + 1} (Next Year)</option>
                    <option value={currentYear}>{currentYear} (Current Fiscal Year)</option>
                    <option value={currentYear - 1}>{currentYear - 1} (Prior Year Regularization)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-ink mb-1.5">
                    Payment Due Date (Deadline) *
                  </label>
                  <input
                    id="ass-form-due-date-input"
                    type="date"
                    required
                    value={customDueDate}
                    onChange={(e) => setCustomDueDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono rounded-[10px] border border-line bg-surface text-ink focus:border-accent focus:outline-none transition-premium"
                  />
                </div>
              </div>

              {/* Resolved Tariff Schedule Display */}
              {selectedBusiness && resolvedRate && (
                <div className="p-3.5 rounded-[12px] bg-surface2/60 border border-line text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-muted">Resolved tariff schedule:</span>
                    <Badge variant="sage" size="sm">
                      Tariff v{resolvedRate.version || 1}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-ink">
                    <span className="text-muted">Sector & Size:</span>
                    <span className="font-semibold">
                      {SECTOR_LABELS[selectedBusiness.activitySector] || selectedBusiness.activitySector} • {SIZE_CLASS_LABELS[selectedBusiness.sizeClass]?.label || selectedBusiness.sizeClass}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-ink">
                    <span className="text-muted">Annual Tariff:</span>
                    <span className="font-display font-bold tabular-nums">{formatMoney(resolvedRate.annualFeeUSD)} / yr</span>
                  </div>
                  <div className="flex items-center justify-between text-ink">
                    <span className="text-muted">Registration Date:</span>
                    <span className="font-mono tabular-nums">{selectedBusiness.registrationDate || 'Prior Year'}</span>
                  </div>
                </div>
              )}

              {/* Proration Engine Details */}
              {prorationCalc && (
                <div className={`p-4 rounded-[12px] border text-xs space-y-1.5 ${
                  prorationCalc.isProrated 
                    ? 'bg-warn/10 border-warn/30 text-ink' 
                    : 'bg-sage/10 border-sage/30 text-ink'
                }`}>
                  <div className="font-bold flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Clock className="w-4 h-4 text-accent" />
                      Prorata Temporis Calculation:
                    </span>
                    <span className="font-display text-sm font-bold tabular-nums">
                      {formatMoney(prorationCalc.amountDueUSD)}
                    </span>
                  </div>
                  <p className="text-[12px] leading-relaxed text-muted">
                    {prorationCalc.notes}
                  </p>
                </div>
              )}

              {/* Unique Sequential Reference preview */}
              <div className="p-3 rounded-[10px] bg-surface2 border border-line text-xs flex items-center justify-between font-mono">
                <span className="text-muted">Generated Notice Reference:</span>
                <span className="font-bold text-ink bg-surface px-2 py-0.5 rounded-[6px] border border-line tabular-nums">
                  {previewAssessmentNumber}
                </span>
              </div>

              {/* Form Buttons */}
              <div className="pt-4 border-t border-line flex items-center justify-end gap-3">
                <Button
                  variant="ghost"
                  size="md"
                  onClick={() => setIsNewModalOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  type="submit"
                  disabled={isSubmitting || !selectedBusiness || !resolvedRate}
                >
                  {isSubmitting ? 'Issuing Notice...' : 'Issue Assessment Notice'}
                </Button>
              </div>

            </form>

          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* BULK ASSESSMENT GENERATION MODAL (ADMIN ONLY)            */}
      {/* ======================================================== */}
      <BulkAssessmentModal
        isOpen={isBulkModalOpen}
        onClose={() => setIsBulkModalOpen(false)}
        onCompleted={() => {
          reloadData();
        }}
        businesses={businesses}
        existingAssessments={assessments}
        activeRates={activeRates}
        currentUser={{
          uid: currentUser?.uid || 'admin_goma',
          displayName: userProfile?.displayName || 'Administrateur',
          role: userRole,
        }}
      />

      {/* ======================================================== */}
      {/* CANCEL ASSESSMENT MODAL (SUPERVISOR / ADMIN ONLY)        */}
      {/* ======================================================== */}
      <CancelAssessmentModal
        isOpen={!!assessmentToCancel}
        onClose={() => setAssessmentToCancel(null)}
        onCancelled={() => {
          reloadData();
        }}
        assessment={assessmentToCancel}
        currentUser={{
          uid: currentUser?.uid || 'sup_001',
          displayName: userProfile?.displayName || 'Superviseur Fiscal',
          role: userRole,
        }}
      />

      {/* ======================================================== */}
      {/* OFFICIAL PRINTABLE TAX NOTICE MODAL                      */}
      {/* ======================================================== */}
      <AssessmentNoticeModal
        isOpen={!!noticeModalAssessment}
        onClose={() => setNoticeModalAssessment(null)}
        assessment={noticeModalAssessment}
      />

    </div>
  );
};
