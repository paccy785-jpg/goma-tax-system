import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  DollarSign, 
  Plus, 
  History, 
  ShieldCheck, 
  Calendar, 
  Search, 
  Filter, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  Scale, 
  X,
  Lock,
  Percent
} from 'lucide-react';
import { 
  TaxRate, 
  BusinessSector, 
  BusinessSizeClass, 
  SECTOR_LABELS, 
  SIZE_CLASS_LABELS,
  TAX_BASE_KIND_LABELS,
  TaxType,
  TaxTypeRateVersion,
  UserRole
} from '../types';
import { 
  getTaxRates, 
  getTaxRateHistory, 
  createNewTaxRateVersion,
  logAuditEvent
} from '../services/dbService';
import {
  getTaxTypes,
  getTaxTypeRateHistory,
  createTaxTypeRateVersion,
} from '../services/taxTypeService';
import { submitApprovalRequest } from '../services/approvalService';
import { useAuth } from '../contexts/AuthContext';
import { shiftDateString, todayDateString } from '../utils/date';
import { PageHeader, Button, Badge, Panel, MetricStrip } from './ui';
import { TaxTypesModal } from './settings/TaxTypesModal';
import {
  VersionHistoryModal,
  type VersionTimelineEntry,
} from './settings/VersionHistoryModal';
import { formatMoney } from '../utils/money';

interface PatenteRateScheduleViewProps {
  userRole: UserRole;
}

export const PatenteRateScheduleView: React.FC<PatenteRateScheduleViewProps> = ({ userRole }) => {
  const { userProfile } = useAuth();
  const [rates, setRates] = useState<TaxRate[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedSector, setSelectedSector] = useState<string>('ALL');
  const [selectedSize, setSelectedSize] = useState<string>('ALL');
  const [showArchived, setShowArchived] = useState<boolean>(false);

  // Success Notification
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
  }, []);

  // Heads of tax levied as a percentage of a declared base (IF, IRL, …).
  // Separate registry, separate screen — see TaxTypesModal for why.
  const [taxTypes, setTaxTypes] = useState<TaxType[]>([]);
  const [isTaxTypesModalOpen, setIsTaxTypesModalOpen] = useState<boolean>(false);

  /**
   * Versioning Modal State.
   *
   * `modalTaxTypeCode` is what makes one modal serve both schedules: 'PATENTE'
   * drives the sector × size tariff (which routes through the maker-checker
   * queue), any other code drives that head of tax's percentage rate (which
   * takes effect on submission).
   */
  const [isVersionModalOpen, setIsVersionModalOpen] = useState<boolean>(false);
  const [modalTaxTypeCode, setModalTaxTypeCode] = useState<string>('PATENTE');
  const [modalSector, setModalSector] = useState<BusinessSector>('Commerce');
  const [modalSize, setModalSize] = useState<BusinessSizeClass>('Small');
  const [modalNewFeeUSD, setModalNewFeeUSD] = useState<number>(60);
  const [modalNewRatePercent, setModalNewRatePercent] = useState<number>(15);
  const [modalEffectiveStartDate, setModalEffectiveStartDate] = useState<string>(
    todayDateString()
  );
  const [modalLegalBasis, setModalLegalBasis] = useState<string>(
    'DPRNK Decree - 2026 Patente Tariff Revision'
  );
  const [modalNotes, setModalNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [formError, setFormError] = useState<string | null>(null);

  /** The head of tax selected in the version modal, or null for patente. */
  const modalTaxType = useMemo(
    () => taxTypes.find((t) => t.code === modalTaxTypeCode) || null,
    [taxTypes, modalTaxTypeCode]
  );

  /**
   * History modal state. The target is a union so one shared timeline can
   * describe either a patente sector × size or a head of tax.
   */
  type HistoryTarget =
    | { kind: 'patente'; sector: BusinessSector; sizeClass: BusinessSizeClass }
    | { kind: 'taxType'; taxType: TaxType };

  const [historyTarget, setHistoryTarget] = useState<HistoryTarget | null>(null);
  const [historyRates, setHistoryRates] = useState<TaxRate[]>([]);
  const [historyTaxVersions, setHistoryTaxVersions] = useState<TaxTypeRateVersion[]>([]);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);

  useEffect(() => {
    loadRates();
    loadTaxTypes();
  }, []);

  const loadRates = async () => {
    setLoading(true);
    try {
      const data = await getTaxRates(false);
      setRates(data || []);
    } catch (err) {
      console.warn('[PatenteSchedule] Error loading rates:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadTaxTypes = async () => {
    try {
      setTaxTypes(await getTaxTypes());
    } catch (err) {
      console.warn('[PatenteSchedule] Error loading tax types:', err);
    }
  };

  /** Reflect a saved tax type in the local registry. */
  const applySavedTaxType = (taxType: TaxType) => {
    setTaxTypes((prev) => {
      const next = prev.filter((t) => t.id !== taxType.id);
      return [...next, taxType].sort((a, b) => a.code.localeCompare(b.code));
    });
  };

  /** Leave a governance trail for a rate change. */
  const auditTaxTypeChange = async (taxType: TaxType, isNew: boolean) => {
    if (!userProfile) return;
    try {
      await logAuditEvent(
        userProfile.uid,
        userProfile.displayName,
        userProfile.role,
        isNew ? 'CREATE_TAX_TYPE' : 'UPDATE_TAX_TYPE',
        'TaxType',
        taxType.id,
        isNew
          ? `Created head of tax ${taxType.code} (${taxType.label}) at ${taxType.ratePercent}% of ${taxType.baseDescription}.`
          : `Set ${taxType.code} (${taxType.label}) to ${taxType.ratePercent}% of ${taxType.baseDescription}.`
      );
    } catch (auditErr) {
      console.warn('[TaxTypes] Audit log failed:', auditErr);
    }
  };

  /**
   * Open the version modal.
   *
   * Called from the page header (no target → defaults to patente Commerce /
   * Small), from a row's "New Version" button (that sector × size), or from a
   * head of tax card (that tax type's percentage rate).
   */
  const handleOpenVersionModal = (
    targetSector?: BusinessSector,
    targetSize?: BusinessSizeClass,
    targetTaxTypeCode?: string
  ) => {
    setFormError(null);
    setModalNotes('');
    setModalEffectiveStartDate(shiftDateString(todayDateString(), 1));

    if (targetTaxTypeCode && targetTaxTypeCode !== 'PATENTE') {
      const taxType = taxTypes.find((t) => t.code === targetTaxTypeCode);
      setModalTaxTypeCode(targetTaxTypeCode);
      setModalNewRatePercent(taxType?.ratePercent ?? 15);
      setModalLegalBasis(taxType?.legalBasis || 'Code des impôts — taux déclaratif');
      setIsVersionModalOpen(true);
      return;
    }

    const s = targetSector || 'Commerce';
    const sz = targetSize || 'Small';
    setModalTaxTypeCode('PATENTE');
    setModalSector(s);
    setModalSize(sz);

    // Look up current active rate
    const currentActive = rates.find(
      (r) => r.activitySector === s && r.sizeClass === sz && r.isActive !== false
    );

    if (currentActive) {
      setModalNewFeeUSD(currentActive.annualFeeUSD);
    } else {
      setModalNewFeeUSD(100);
    }

    setModalLegalBasis('Municipal Decree City of Goma - 2026 Patente Tariff Revision');
    setIsVersionModalOpen(true);
  };

  const handleSectorOrSizeChangeInModal = (s: BusinessSector, sz: BusinessSizeClass) => {
    setModalSector(s);
    setModalSize(sz);
    const currentActive = rates.find(
      (r) => r.activitySector === s && r.sizeClass === sz && r.isActive !== false
    );
    if (currentActive) {
      setModalNewFeeUSD(currentActive.annualFeeUSD);
    }
  };

  const handleSubmitNewVersion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || userRole !== 'Admin') {
      setFormError('Only a user with the Admin role is authorized to create a tax rate version.');
      return;
    }

    if (!modalEffectiveStartDate) {
      setFormError('Please specify a valid effective start date.');
      return;
    }

    // ---- Head of tax: versioned and applied immediately ------------------
    // A percentage rate is a published statutory figure, so it takes effect on
    // submission; only the patente tariff goes through the maker-checker queue.
    if (modalTaxType) {
      if (!(modalNewRatePercent > 0) || modalNewRatePercent > 100) {
        setFormError('The rate must be greater than 0 and no more than 100 percent.');
        return;
      }

      setIsSubmitting(true);
      setFormError(null);
      try {
        const { newVersion } = await createTaxTypeRateVersion({
          taxType: modalTaxType,
          newRatePercent: modalNewRatePercent,
          effectiveStartDate: modalEffectiveStartDate,
          legalBasis: modalLegalBasis,
          notes: modalNotes,
          userProfile: {
            uid: userProfile.uid,
            displayName: userProfile.displayName,
            role: userRole,
          },
        });

        setTaxTypes((prev) =>
          prev.map((t) =>
            t.id === modalTaxType.id
              ? { ...t, ratePercent: newVersion.ratePercent, updatedBy: userProfile.displayName }
              : t
          )
        );

        setIsVersionModalOpen(false);
        setSuccessMessage(
          `${modalTaxType.code} rate version v${newVersion.version} is now in effect at ${newVersion.ratePercent}%, from ${newVersion.effectiveStartDate}. The previous version was closed, not overwritten.`
        );
        if (successTimerRef.current) clearTimeout(successTimerRef.current);
        successTimerRef.current = setTimeout(() => setSuccessMessage(null), 6000);
      } catch (err: any) {
        console.error('[Submit Tax Type Version] Error:', err);
        setFormError(err?.message || 'Erreur lors de la création de la version de taux.');
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // ---- Patente tariff: maker-checker approval ---------------------------
    if (!modalNewFeeUSD || modalNewFeeUSD < 0) {
      setFormError('Please specify a valid annual rate in USD (≥ 0).');
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      const currentActive = rates.find(
        (r) => r.activitySector === modalSector && r.sizeClass === modalSize && r.isActive !== false
      );

      const justification = modalNotes.trim() || `Tariff rate adjustment requested for ${SECTOR_LABELS[modalSector]} (${SIZE_CLASS_LABELS[modalSize].label}). Proposed rate: ${formatMoney(modalNewFeeUSD)} (previous: ${formatMoney(currentActive?.annualFeeUSD || 0)}). Ref: ${modalLegalBasis}.`;

      const approvalReq = await submitApprovalRequest({
        requestType: 'tax_rate_override',
        entityType: 'TaxRate',
        entityId: currentActive?.id || `rate_${modalSector}_${modalSize}`,
        entityTitle: `Tariff Adjustment: ${SECTOR_LABELS[modalSector]} (${SIZE_CLASS_LABELS[modalSize].label})`,
        beforeValue: {
          annualFeeUSD: currentActive?.annualFeeUSD || 0,
          version: currentActive?.version || 1,
          legalBasis: currentActive?.legalBasis || 'Standard statutory tariff',
        },
        afterValue: {
          annualFeeUSD: modalNewFeeUSD,
          legalBasis: modalLegalBasis,
          effectiveStartDate: modalEffectiveStartDate,
          notes: modalNotes,
        },
        justification: justification,
        requester: {
          uid: userProfile.uid,
          displayName: userProfile.displayName,
          role: userRole,
        },
        targetDetails: {
          activitySector: modalSector,
          sizeClass: modalSize,
          amountUSD: modalNewFeeUSD,
          legalBasis: modalLegalBasis,
        },
      });

      setIsVersionModalOpen(false);
      setSuccessMessage(
        `Approval request #${approvalReq.id} submitted successfully to Maker-Checker queue. The rate adjustment will take effect upon signoff by a distinct Supervisor/Admin.`
      );
      // Tracked timer: the bare setTimeout fired setSuccessMessage after unmount.
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => setSuccessMessage(null), 6000);
    } catch (err: any) {
      console.error('[Submit Rate Version] Error:', err);
      setFormError(err.message || "Erreur lors de l'enregistrement de la demande.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenHistory = async (sector: BusinessSector, sizeClass: BusinessSizeClass) => {
    setHistoryTarget({ kind: 'patente', sector, sizeClass });
    setHistoryTaxVersions([]);
    setLoadingHistory(true);
    try {
      setHistoryRates(await getTaxRateHistory(sector, sizeClass));
    } catch (err) {
      console.error('[History] Error:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  /** Open the same timeline for a head of tax's percentage rate. */
  const handleOpenTaxTypeHistory = async (taxType: TaxType) => {
    setHistoryTarget({ kind: 'taxType', taxType });
    setHistoryRates([]);
    setLoadingHistory(true);
    try {
      setHistoryTaxVersions(await getTaxTypeRateHistory(taxType));
    } catch (err) {
      console.error('[TaxType History] Error:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  /**
   * Both schedules are versioned identically, so their trails are mapped into
   * one shape and drawn by one shared timeline.
   */
  const historyEntries: VersionTimelineEntry[] = useMemo(() => {
    if (!historyTarget) return [];
    if (historyTarget.kind === 'patente') {
      return historyRates.map((h) => ({
        id: h.id,
        version: h.version || 1,
        isActive: h.isActive !== false,
        effectiveStartDate: h.effectiveStartDate,
        effectiveEndDate: h.effectiveEndDate,
        legalBasis: h.legalBasis,
        notes: h.notes,
        createdByName: h.createdByName,
        amountPrimary: `${formatMoney(h.annualFeeUSD)}`,
      }));
    }
    return historyTaxVersions.map((h) => ({
      id: h.id,
      version: h.version || 1,
      isActive: h.isActive !== false,
      effectiveStartDate: h.effectiveStartDate,
      effectiveEndDate: h.effectiveEndDate,
      legalBasis: h.legalBasis,
      notes: h.notes,
      createdByName: h.createdByName,
      amountPrimary: `${h.ratePercent}%`,
      amountSecondary: TAX_BASE_KIND_LABELS[h.baseKind],
    }));
  }, [historyTarget, historyRates, historyTaxVersions]);

  // Find active rates vs archived rates
  const activeRates = rates.filter((r) => r.isActive !== false);
  const displayedRates = (showArchived ? rates : activeRates).filter((r) => {
    const matchesSector = selectedSector === 'ALL' || r.activitySector === selectedSector;
    const matchesSize = selectedSize === 'ALL' || r.sizeClass === selectedSize;
    const sectorName = SECTOR_LABELS[r.activitySector] || '';
    const sizeName = SIZE_CLASS_LABELS[r.sizeClass]?.label || '';
    const query = searchQuery.toLowerCase();
    const matchesSearch = 
      sectorName.toLowerCase().includes(query) ||
      sizeName.toLowerCase().includes(query) ||
      (r.legalBasis && r.legalBasis.toLowerCase().includes(query)) ||
      (r.notes && r.notes.toLowerCase().includes(query));
    return matchesSector && matchesSize && matchesSearch;
  });

  const currentActiveRateForModal = rates.find(
    (r) => r.activitySector === modalSector && r.sizeClass === modalSize && r.isActive !== false
  );

  if (userRole !== 'Admin') {
    return (
      <div className="p-8 bg-white rounded-xl border border-slate-200 text-center space-y-3 shadow-xs">
        <Lock className="w-10 h-10 text-red-500 mx-auto" />
        <h3 className="text-base font-bold text-slate-900">Restricted Access — Tax Administration</h3>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          The <strong>Business License Tax Rate Schedule</strong> management module is reserved exclusively for the <strong>Admin</strong> role (DPRNK Revenue Directorate).
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      
      {/* Toast Notification */}
      {successMessage && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-start justify-between gap-3 shadow-xs animate-in fade-in slide-in-from-top-2">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-emerald-950">Rate Schedule Updated Successfully</p>
              <p className="text-xs text-emerald-800 mt-0.5">{successMessage}</p>
            </div>
          </div>
          <button 
            type="button" 
            onClick={() => setSuccessMessage(null)} 
            className="text-emerald-700 hover:text-emerald-900 text-xs"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Page Header */}
      <PageHeader
        eyebrow="Tariffs"
        title="Official Business License Tax Rate Schedule"
        description="Annual rate schedule matrix by activity sector and business size class with immutable version history."
        actions={
          <Button
            id="open-tax-types-btn"
            variant="ghost"
            size="md"
            onClick={() => setIsTaxTypesModalOpen(true)}
            icon={<Percent className="w-4 h-4" />}
          >
            Tax types
          </Button>
        }
      />

      {/* Legal & Versioning Rule Explainer Card */}
      <div className="p-4 rounded-[14px] bg-accent-soft/50 border border-line flex flex-col md:flex-row md:items-center justify-between gap-4 transition-premium">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-accent shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="text-xs font-bold text-ink uppercase tracking-wider">
              IMMUTABILITY PRINCIPLE & ASSESSMENT CONTINUITY
            </h4>
            <p className="text-xs text-muted leading-relaxed max-w-3xl">
              Each rate change produces a new dated version in <code className="font-mono text-accent bg-surface2 px-1 py-0.5 rounded">/taxRates/{'{rateId}'}</code>. The old rate is never overwritten: it is closed out with an end date.{' '}
              <strong className="text-ink">Assessments already issued preserve their historical statutory rate without retroactive adjustment.</strong>
            </p>
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-2 text-xs bg-surface px-3 py-1.5 rounded-[10px] border border-line font-mono text-ink">
          <Calendar className="w-3.5 h-3.5 text-accent" />
          <span>Fiscal Year: 2026</span>
        </div>
      </div>

      {/* Percentage heads of tax — managed separately from this flat-fee schedule */}
      {taxTypes.some((t) => t.isActive !== false) && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
            Percentage heads of tax
          </span>
          {taxTypes
            .filter((t) => t.isActive !== false)
            .map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setIsTaxTypesModalOpen(true)}
                title={t.label}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface border border-line text-[11px] font-semibold text-ink hover:border-accent hover:text-accent transition-premium cursor-pointer"
              >
                <Percent className="w-3 h-3 text-accent" />
                {t.code}
                <span className="text-muted tabular-nums">{t.ratePercent}%</span>
              </button>
            ))}
          <span className="text-[11px] text-muted">
            assessed on declared values, not on this annual schedule
          </span>
        </div>
      )}

      {/* Metric Summary Strip */}
      <MetricStrip
        columns={4}
        items={[
          {
            label: 'Active Combinations',
            value: `${activeRates.length} / 18`,
            trend: '6 Sectors × 3 Classes',
            trendType: 'sage',
            subline: 'Statutory grid combinations',
            icon: <Scale className="w-4 h-4 text-accent" />,
          },
          {
            label: 'Minimum Rate (Small)',
            value: formatMoney(40),
            trend: 'Statutory floor',
            trendType: 'muted',
            subline: 'Crafts & Small Workshops',
            icon: <DollarSign className="w-4 h-4 text-muted" />,
          },
          {
            label: 'Maximum Rate (Large)',
            value: formatMoney(700),
            trend: 'Statutory ceiling',
            trendType: 'muted',
            subline: 'Industry & Heavy Wholesalers',
            icon: <DollarSign className="w-4 h-4 text-muted" />,
          },
          {
            label: 'Recorded Versions',
            value: rates.length.toString(),
            trend: 'Immutable audit log',
            trendType: 'muted',
            subline: 'Historical version trail',
            icon: <History className="w-4 h-4 text-muted" />,
          },
        ]}
      />

      {/* Filter Toolbar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              id="tax-rate-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs rounded-lg border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400"
            />
          </div>

          {/* Sector Filter */}
          <div className="flex items-center gap-2">
            <select
              id="tax-rate-sector-filter"
              value={selectedSector}
              onChange={(e) => setSelectedSector(e.target.value)}
              className="px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white text-slate-700 font-medium"
            >
              <option value="ALL">All Sectors ({activeRates.length})</option>
              <option value="Commerce">General Commerce</option>
              <option value="Food Service">Hospitality & Restaurants</option>
              <option value="Services">Services & Offices</option>
              <option value="Crafts">Crafts & Trades</option>
              <option value="Industry">Light Industry</option>
              <option value="Other">Other Activities</option>
            </select>

            {/* Size Filter */}
            <select
              id="tax-rate-size-filter"
              value={selectedSize}
              onChange={(e) => setSelectedSize(e.target.value)}
              className="px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white text-slate-700 font-medium"
            >
              <option value="ALL">All Size Classes</option>
              <option value="Small">Small (Class 3)</option>
              <option value="Medium">Medium (Class 2)</option>
              <option value="Large">Large (Class 1)</option>
            </select>

            {/* Toggle archived */}
            <button
              id="toggle-archived-rates-btn"
              type="button"
              onClick={() => setShowArchived(!showArchived)}
              className={`px-3 py-2 text-xs font-semibold rounded-lg border transition-colors ${
                showArchived
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {showArchived ? 'Hide Archives' : 'View Archives'}
            </button>
          </div>
        </div>
      </div>

      {/* Rates Schedule Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[12px]">
                <th className="py-3 px-4">Activity Sector</th>
                <th className="py-3 px-3">Size Class</th>
                <th className="py-3 px-4 font-mono text-right">ANNUAL RATE USD</th>
                <th className="py-3 px-3">VERSION & EFFECTIVE DATE</th>
                <th className="py-3 px-3">STATUS</th>
                <th className="py-3 px-4">LEGAL BASIS</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    Loading official patente rate schedule...
                  </td>
                </tr>
              ) : displayedRates.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    <p className="font-semibold text-slate-700">No rates matching criteria.</p>
                    <p className="text-xs text-slate-400 mt-1">Modify your filters or try a different search.</p>
                  </td>
                </tr>
              ) : (
                displayedRates.map((rate) => {
                  const sizeInfo = SIZE_CLASS_LABELS[rate.sizeClass] || {
                    label: rate.sizeClass,
                    tier: '',
                    badgeColor: 'bg-slate-100 text-slate-700 border-slate-200',
                  };
                  const isCurrentActive = rate.isActive !== false;

                  return (
                    <tr 
                      key={rate.id}
                      className={`hover:bg-slate-50/70 transition-colors ${
                        !isCurrentActive ? 'bg-slate-50/40 text-slate-400' : ''
                      }`}
                    >
                      {/* Sector */}
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900 flex items-center gap-2">
                          <span>{SECTOR_LABELS[rate.activitySector] || rate.activitySector}</span>
                        </div>
                        {rate.notes && (
                          <div className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">
                            {rate.notes}
                          </div>
                        )}
                      </td>

                      {/* Size Class */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${sizeInfo.badgeColor}`}>
                          {sizeInfo.label}
                        </span>
                        <span className="block text-[10px] text-slate-400 font-mono mt-0.5">
                          {sizeInfo.tier}
                        </span>
                      </td>

                      {/* USD Rate */}
                      <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900 text-sm whitespace-nowrap">
                        {formatMoney((rate.annualFeeUSD ?? 0))}
                      </td>

                      {/* Version & Start Date */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-800 font-mono font-bold text-[11px] border border-slate-200">
                            v{rate.version || 1}
                          </span>
                          <span className="text-[12px] text-slate-600 font-mono">
                            {rate.effectiveStartDate}
                          </span>
                        </div>
                        {rate.effectiveEndDate && (
                          <span className="text-[11px] text-slate-400 font-mono block mt-0.5">
                            End: {rate.effectiveEndDate}
                          </span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        {isCurrentActive ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            In Effect
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600 border border-slate-200">
                            <Clock className="w-2.5 h-2.5" />
                            Archived (closed)
                          </span>
                        )}
                      </td>

                      {/* Legal decree / notes */}
                      <td className="py-3.5 px-4 text-slate-500 text-[12px] max-w-xs">
                        <div className="truncate" title={rate.legalBasis || 'DPRNK Decree'}>
                          {rate.legalBasis || 'DPRNK Decree'}
                        </div>
                      </td>

                      {/* Action buttons */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            id={`version-rate-${rate.id}-btn`}
                            type="button"
                            onClick={() => handleOpenVersionModal(rate.activitySector, rate.sizeClass)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white font-semibold text-[12px] transition-colors"
                            title="Create a new version for this combination"
                          >
                            <Plus className="w-3 h-3" />
                            New Version
                          </button>

                          <button
                            id={`history-rate-${rate.id}-btn`}
                            type="button"
                            onClick={() => handleOpenHistory(rate.activitySector, rate.sizeClass)}
                            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md border border-slate-300 hover:bg-slate-100 text-slate-700 font-semibold text-[12px] transition-colors"
                            title="View complete version audit history"
                          >
                            <History className="w-3 h-3 text-slate-500" />
                            History
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
      </div>

      {/* ==================================================================== */}
      {/* MODAL: NOUVELLE VERSION DE TARIF */}
      {/* ==================================================================== */}
      {isVersionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          {/*
            Capped to the viewport with a scrolling body and a pinned action
            row: the form grew past the fold, which pushed the submit button off
            screen on a shorter window.
          */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-lg w-full max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">

            {/* Modal Header */}
            <div className="shrink-0 px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Scale className="w-5 h-5 text-amber-400" />
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Create a New Rate Version
                  </h3>
                  <p className="text-[12px] text-slate-400">
                    {modalTaxType
                      ? `${modalTaxType.code} Declaration — DPRNK`
                      : 'Business License Rate Schedule — DPRNK'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsVersionModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitNewVersion} className="flex-1 min-h-0 flex flex-col">
            <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-3">
              {formError && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Head of tax — switches this modal between the patente tariff
                  and a percentage declaration's rate. */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Head of Tax *
                </label>
                <select
                  id="modal-rate-tax-type"
                  value={modalTaxTypeCode}
                  onChange={(e) => {
                    const code = e.target.value;
                    setModalTaxTypeCode(code);
                    setFormError(null);
                    if (code === 'PATENTE') {
                      setModalLegalBasis(
                        'Municipal Decree City of Goma - 2026 Patente Tariff Revision'
                      );
                    } else {
                      const t = taxTypes.find((x) => x.code === code);
                      setModalNewRatePercent(t?.ratePercent ?? 15);
                      setModalLegalBasis(t?.legalBasis || 'Code des impôts — taux déclaratif');
                    }
                  }}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white font-medium text-slate-800"
                >
                  <option value="PATENTE">PATENTE — Business License Tax (tariff schedule)</option>
                  {taxTypes
                    .filter((t) => t.isActive !== false)
                    .map((t) => (
                      <option key={t.id} value={t.code}>
                        {t.code} — {t.label} ({t.ratePercent}%)
                      </option>
                    ))}
                </select>
                <p className="text-[11px] text-slate-500 mt-1">
                  {modalTaxType
                    ? `Assessed on the ${modalTaxType.baseDescription.toLowerCase()}. A percentage rate takes effect on submission.`
                    : 'Sector × size tariff. Changes are submitted to the maker-checker approval queue.'}
                </p>
              </div>

              {/* Sector & Size Class Selectors — patente only */}
              {!modalTaxType && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Activity Sector *
                  </label>
                  <select
                    id="modal-rate-sector"
                    value={modalSector}
                    onChange={(e) => handleSectorOrSizeChangeInModal(e.target.value as BusinessSector, modalSize)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white font-medium text-slate-800"
                  >
                    <option value="Commerce">General & Retail Commerce</option>
                    <option value="Food Service">Hospitality, Bars & Restaurants</option>
                    <option value="Services">Services & Liberal Professions</option>
                    <option value="Crafts">Crafts & Manual Trades</option>
                    <option value="Industry">Light Industry & Processing</option>
                    <option value="Other">Other Economic Activities</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Size Class *
                  </label>
                  <select
                    id="modal-rate-size"
                    value={modalSize}
                    onChange={(e) => handleSectorOrSizeChangeInModal(modalSector, e.target.value as BusinessSizeClass)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white font-medium text-slate-800"
                  >
                    <option value="Small">Small Enterprise (Class 3)</option>
                    <option value="Medium">Medium Enterprise (Class 2)</option>
                    <option value="Large">Large Enterprise (Class 1)</option>
                  </select>
                </div>
              </div>
              )}

              {/* Current Active Rate Reference — kept to a single row so the
                  form stays compact on a short window. */}
              <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 flex items-center gap-2 text-xs min-w-0">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider shrink-0">
                  Current
                </span>
                <span className="font-bold text-slate-900 truncate min-w-0">
                  {modalTaxType ? (
                    <>
                      {modalTaxType.ratePercent}%
                      <span className="text-slate-500 font-normal">
                        {' '}
                        of {modalTaxType.baseDescription.toLowerCase()}
                      </span>
                    </>
                  ) : currentActiveRateForModal ? (
                    <>
                      {formatMoney(currentActiveRateForModal.annualFeeUSD)}
                      <span className="ml-2 px-1.5 py-0.2 rounded bg-slate-200 text-slate-800 font-mono text-[11px]">
                        v{currentActiveRateForModal.version || 1}
                      </span>
                    </>
                  ) : (
                    <span className="text-slate-400 font-normal">No existing rate</span>
                  )}
                </span>
                {!modalTaxType && currentActiveRateForModal && (
                  <span className="ml-auto text-[11px] text-slate-500 font-mono shrink-0">
                    Since {currentActiveRateForModal.effectiveStartDate}
                  </span>
                )}
              </div>

              {/* New Rate — a percentage for a head of tax, USD for patente */}
              {modalTaxType ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    New Rate (%) *
                  </label>
                  <div className="relative">
                    <input
                      id="modal-rate-new-percent"
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      value={modalNewRatePercent}
                      onChange={(e) => setModalNewRatePercent(Number(e.target.value))}
                      className="w-full pl-3 pr-9 py-2 text-sm font-mono font-bold rounded-lg border border-slate-300 bg-white text-slate-900"
                      required
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">
                      %
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Applied to the {modalTaxType.baseDescription.toLowerCase()}.
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    New Annual Rate (USD) *
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-xs">$</span>
                    <input
                      id="modal-rate-new-fee-usd"
                      type="number"
                      min="0"
                      step="5"
                      value={modalNewFeeUSD}
                      onChange={(e) => setModalNewFeeUSD(Number(e.target.value))}
                      className="w-full pl-8 pr-3 py-2 text-sm font-mono font-bold rounded-lg border border-slate-300 bg-white text-slate-900"
                      required
                    />
                  </div>
                </div>
              )}

              {/* Effective Start Date & Legal Reference — paired to keep the
                  form inside the viewport without a long scroll. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Effective Start Date *
                  </label>
                  <input
                    id="modal-rate-start-date"
                    type="date"
                    value={modalEffectiveStartDate}
                    onChange={(e) => setModalEffectiveStartDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono font-semibold rounded-lg border border-slate-300 bg-white text-slate-800"
                    required
                  />
                  <p className="text-[11px] text-slate-500 mt-1 leading-snug">
                    The prior version stays effective until the eve of this date.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Legal Basis / Official Decree
                  </label>
                  <input
                    id="modal-rate-legal-basis"
                    type="text"
                    value={modalLegalBasis}
                    onChange={(e) => setModalLegalBasis(e.target.value)}
                    placeholder="e.g. DPRNK Decree No. 04/2026"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-800"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Administrative Justification / Reason
                </label>
                <textarea
                  id="modal-rate-notes"
                  rows={2}
                  value={modalNotes}
                  onChange={(e) => setModalNotes(e.target.value)}
                  placeholder="e.g. Adjustment following provincial finance commission review..."
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-800"
                />
              </div>

              {/* Governance note — the two schedules differ here, and the
                  difference is deliberate. */}
              {modalTaxType ? (
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-700 text-[12px] leading-relaxed space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-slate-900">
                    <ShieldCheck className="w-4 h-4 text-slate-600" />
                    Takes effect on submission
                  </div>
                  <p>
                    A declaration rate is a published statutory figure, so this version becomes
                    active immediately. The previous version is closed with an end date rather than
                    overwritten; issued notices keep their original rate.
                  </p>
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-950 text-[12px] leading-relaxed space-y-1">
                  <div className="font-bold flex items-center gap-1.5 text-indigo-900">
                    <ShieldCheck className="w-4 h-4 text-indigo-700" />
                    Mandatory Maker-Checker Dual Control
                  </div>
                  <p>
                    This proposal goes to the <strong>Pending Approvals</strong> queue. A distinct
                    Supervisor or Administrator must approve it before the new version is activated.
                  </p>
                </div>
              )}

            </div>

              {/* Actions — pinned below the scroll area, always reachable */}
              <div className="shrink-0 px-5 py-3.5 border-t border-slate-200 bg-slate-50/70 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsVersionModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                  disabled={isSubmitting}
                >
                  Cancel
                </button>
                <button
                  id="submit-new-rate-version-btn"
                  type="submit"
                  disabled={isSubmitting}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg text-white shadow-xs disabled:opacity-50 ${
                    modalTaxType
                      ? 'bg-slate-900 hover:bg-slate-800'
                      : 'bg-indigo-700 hover:bg-indigo-800'
                  }`}
                >
                  {isSubmitting ? (
                    'Submitting...'
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      {modalTaxType ? 'Create New Version' : 'Submit for Approval (Maker-Checker)'}
                    </>
                  )}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL: TAX TYPES (PERCENTAGE HEADS OF TAX)                           */}
      {/* ==================================================================== */}
      {isTaxTypesModalOpen && (
        <TaxTypesModal
          taxTypes={taxTypes}
          updatedBy={userProfile?.displayName || 'Admin Officer'}
          onClose={() => setIsTaxTypesModalOpen(false)}
          onSaved={applySavedTaxType}
          onAudit={(taxType, isNew) => {
            void auditTaxTypeChange(taxType, isNew);
          }}
          onAddRateVersion={(taxType) => {
            setIsTaxTypesModalOpen(false);
            handleOpenVersionModal(undefined, undefined, taxType.code);
          }}
        />
      )}

      {/* ==================================================================== */}
      {/* MODAL: VERSION HISTORY — one shared timeline for both schedules       */}
      {/* ==================================================================== */}
      {historyTarget && (
        <VersionHistoryModal
          title={
            historyTarget.kind === 'patente'
              ? `${SECTOR_LABELS[historyTarget.sector]} • ${SIZE_CLASS_LABELS[historyTarget.sizeClass].label}`
              : `${historyTarget.taxType.code} — ${historyTarget.taxType.label}`
          }
          subtitle={
            historyTarget.kind === 'patente'
              ? 'Complete audit trail of patente rate adjustments. Every previous version is archived with its own effective dates, and assessments already issued keep the rate they were billed at.'
              : `Complete audit trail of the ${historyTarget.taxType.code} rate, assessed on the ${historyTarget.taxType.baseDescription.toLowerCase()}. Each change closes the previous version with an end date, and notices already issued keep the rate they were billed at.`
          }
          entries={historyEntries}
          loading={loadingHistory}
          onClose={() => setHistoryTarget(null)}
        />
      )}

    </div>
  );
};
