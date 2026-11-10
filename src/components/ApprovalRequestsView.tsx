import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  ShieldCheck,
  CheckCircle2,
  XCircle,
  Clock,
  Filter,
  Search,
  AlertTriangle,
  ArrowRight,
  User,
  Calendar,
  FileText,
  Building2,
  Layers,
  HelpCircle,
  RefreshCw,
  Plus,
  Scale,
  Eye,
  Lock,
  ChevronRight,
  Sparkles,
  AlertOctagon,
  FileCheck2,
  FileX2,
  UserCheck,
  X
} from 'lucide-react';
import {
  ApprovalRequest,
  ApprovalRequestStatus,
  ApprovalRequestType,
  UserRole,
  normalizeApprovalStatus
} from '../types';
import { 
  getApprovalRequests, 
  subscribeToApprovalRequests,
  reviewApprovalRequest, 
  submitApprovalRequest 
} from '../services/approvalService';
import { useAuth } from '../contexts/AuthContext';
import { PageHeader, Button, Badge, Panel, MetricStrip } from './ui';
import { formatMoney } from '../utils/money';

interface ApprovalRequestsViewProps {
  userRole: UserRole;
  currentUserId?: string;
  currentUserName?: string;
  onNavigateToBusiness?: (businessId: string) => void;
  onNavigateToAssessment?: (assessmentId: string) => void;
}

const TYPE_CONFIG: Record<
  ApprovalRequestType, 
  { label: string; shortLabel: string; icon: React.ElementType; colorClass: string; borderClass: string }
> = {
  assessment_cancellation: {
    label: 'Assessment Notice Cancellation',
    shortLabel: 'Assessment Cancel',
    icon: FileX2,
    colorClass: 'text-rose-700 bg-rose-50 ring-rose-600/20',
    borderClass: 'border-rose-200',
  },
  business_deregistration: {
    label: 'Administrative Business Closure',
    shortLabel: 'Business Closure',
    icon: Building2,
    colorClass: 'text-amber-700 bg-amber-50 ring-amber-600/20',
    borderClass: 'border-amber-200',
  },
  tax_rate_override: {
    label: 'Tax Rate Schedule Override',
    shortLabel: 'Rate Override',
    icon: Scale,
    colorClass: 'text-indigo-700 bg-indigo-50 ring-indigo-600/20',
    borderClass: 'border-indigo-200',
  },
  certificate_revocation: {
    label: 'Business License Certificate Revocation',
    shortLabel: 'Certificate Revocation',
    icon: AlertOctagon,
    colorClass: 'text-purple-700 bg-purple-50 ring-purple-600/20',
    borderClass: 'border-purple-200',
  },
  user_admin_promotion: {
    label: 'Administrator Role Promotion',
    shortLabel: 'Admin Promotion',
    icon: UserCheck,
    colorClass: 'text-emerald-700 bg-emerald-50 ring-emerald-600/20',
    borderClass: 'border-emerald-200',
  },
  user_admin_suspension: {
    label: 'Administrator Account Suspension',
    shortLabel: 'Admin Suspension',
    icon: Lock,
    colorClass: 'text-red-700 bg-red-50 ring-red-600/20',
    borderClass: 'border-red-200',
  },
  user_admin_reactivation: {
    label: 'Administrator Account Reactivation',
    shortLabel: 'Admin Reactivation',
    icon: UserCheck,
    colorClass: 'text-emerald-700 bg-emerald-50 ring-emerald-600/20',
    borderClass: 'border-emerald-200',
  },
};

type TypeConfig = {
  label: string;
  shortLabel: string;
  icon: React.ElementType;
  colorClass: string;
  borderClass: string;
};

const UNKNOWN_TYPE_CONFIG: TypeConfig = {
  label: 'Approval Request',
  shortLabel: 'Request',
  icon: HelpCircle,
  colorClass: 'text-slate-700 bg-slate-50 ring-slate-600/20',
  borderClass: 'border-slate-200',
};

/**
 * Config for a request type, with a neutral fallback for an unknown one.
 *
 * `TYPE_CONFIG[req.requestType]` is a direct index into a Record, so a request
 * whose type is not one of the seven known values — written by a newer client,
 * hand-edited in the console, or seeded — returns `undefined`, and reading
 * `.icon` off it throws during render, blanking the whole Pending Approvals
 * ledger. An unrecognised type is still a real request that a supervisor has
 * to be able to see and review, so it renders with a generic badge rather than
 * taking the page down.
 */
function typeConfigFor(type: string): TypeConfig {
  return (TYPE_CONFIG as Record<string, TypeConfig | undefined>)[type] || UNKNOWN_TYPE_CONFIG;
}

export const ApprovalRequestsView: React.FC<ApprovalRequestsViewProps> = ({
  userRole,
  currentUserId = 'sup_001',
  currentUserName = 'Aime Kambale',
  onNavigateToBusiness,
  onNavigateToAssessment,
}) => {
  const { userProfile } = useAuth();
  const activeUserId = userProfile?.uid || currentUserId;
  const activeUserName = userProfile?.displayName || currentUserName;
  const activeUserRole = userProfile?.role || userRole;

  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusTab, setStatusTab] = useState<ApprovalRequestStatus | 'ALL'>('Pending');
  const [selectedType, setSelectedType] = useState<ApprovalRequestType | 'ALL'>('ALL');
  const [selectedRequester, setSelectedRequester] = useState<string>('ALL');

  // Review Modal State
  const [activeModalRequest, setActiveModalRequest] = useState<ApprovalRequest | null>(null);
  const [reviewComment, setReviewComment] = useState<string>('');
  const [isSubmittingReview, setIsSubmittingReview] = useState<boolean>(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewSuccessMessage, setReviewSuccessMessage] = useState<string | null>(null);

  // New Request Modal State (Maker Initiation)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);
  const [newRequestType, setNewRequestType] = useState<ApprovalRequestType>('assessment_cancellation');
  const [newEntityId, setNewEntityId] = useState<string>('');
  const [newEntityTitle, setNewEntityTitle] = useState<string>('');
  const [newJustification, setNewJustification] = useState<string>('');
  const [newTargetAmount, setNewTargetAmount] = useState<number>(50);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isSubmittingCreate, setIsSubmittingCreate] = useState<boolean>(false);

  useEffect(() => {
    setLoading(true);

    const unsubscribe = subscribeToApprovalRequests(
      (data) => {
        setRequests(data || []);
        setLoading(false);
      },
      (err) => {
        console.error('[ApprovalRequestsView] Real-time listener error:', err);
        setLoading(false);
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  const reloadRequests = async () => {
    setLoading(true);
    try {
      const data = await getApprovalRequests();
      setRequests(data);
    } catch (err) {
      console.warn('[ApprovalRequestsView] Error loading requests:', err);
    } finally {
      setLoading(false);
    }
  };

  // Distinct requesters list for filter dropdown
  const distinctRequesters = useMemo(() => {
    const map = new Map<string, string>();
    requests.forEach((r) => {
      map.set(r.requesterId, r.requesterName);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [requests]);

  // Single tracked timer for the success banner — bare setTimeouts were never
  // cleared on unmount (setState after unmount) and overlapping timers could
  // wipe a newer message early.
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleSuccessMessageClear = (delayMs: number) => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    successTimerRef.current = setTimeout(() => {
      setReviewSuccessMessage(null);
      successTimerRef.current = null;
    }, delayMs);
  };
  useEffect(() => () => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
  }, []);

  // Counts for pills — compare through the shared normalizer: the status union
  // also covers French spellings ('en attente', casing, whitespace), which the
  // raw === checks missed, hiding those requests from the Pending tab.
  const counts = useMemo(() => {
    const statusOf = (r: ApprovalRequest) => normalizeApprovalStatus(r.status);
    return {
      all: requests.length,
      pending: requests.filter((r) => statusOf(r) === 'Pending').length,
      approved: requests.filter((r) => statusOf(r) === 'Approved').length,
      rejected: requests.filter((r) => statusOf(r) === 'Rejected').length,
      cancellations: requests.filter((r) => r.requestType === 'assessment_cancellation' && statusOf(r) === 'Pending').length,
      radiations: requests.filter((r) => r.requestType === 'business_deregistration' && statusOf(r) === 'Pending').length,
      rates: requests.filter((r) => r.requestType === 'tax_rate_override' && statusOf(r) === 'Pending').length,
    };
  }, [requests]);

  // Filtered requests list
  const filteredRequests = useMemo(() => {
    return requests.filter((req) => {
      // Status Tab (normalized — see counts above)
      if (statusTab !== 'ALL' && normalizeApprovalStatus(req.status) !== statusTab) return false;

      // Type Filter
      if (selectedType !== 'ALL' && req.requestType !== selectedType) return false;

      // Requester Filter
      if (selectedRequester !== 'ALL' && req.requesterId !== selectedRequester) return false;

      // Text Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchId = req.id.toLowerCase().includes(q);
        const matchTitle = req.entityTitle.toLowerCase().includes(q);
        const matchEntityId = req.entityId.toLowerCase().includes(q);
        const matchRequester = req.requesterName.toLowerCase().includes(q);
        const matchJustif = req.justification.toLowerCase().includes(q);
        const matchBiz = req.targetDetails?.businessName?.toLowerCase().includes(q);
        return matchId || matchTitle || matchEntityId || matchRequester || matchJustif || matchBiz;
      }

      return true;
    });
  }, [requests, statusTab, selectedType, selectedRequester, searchQuery]);

  // Open review modal
  const handleOpenReview = (req: ApprovalRequest) => {
    setActiveModalRequest(req);
    setReviewComment('');
    setReviewError(null);
  };

  // Process Approval / Rejection
  const handleExecuteDecision = async (decision: 'Approved' | 'Rejected') => {
    if (!activeModalRequest) return;
    if (!reviewComment.trim()) {
      setReviewError('Please provide a justification comment or regulatory reason for your decision.');
      return;
    }

    setIsSubmittingReview(true);
    setReviewError(null);

    try {
      await reviewApprovalRequest(
        activeModalRequest.id,
        decision,
        {
          uid: activeUserId,
          displayName: activeUserName,
          role: activeUserRole,
        },
        reviewComment.trim()
      );

      setReviewSuccessMessage(
        decision === 'Approved' ? `Request ${activeModalRequest.id} was successfully approved. Changes have been applied to the database.` : `Request ${activeModalRequest.id} was rejected. No changes were made to the fiscal record.`
      );

      await reloadRequests();
      setActiveModalRequest(null);
      scheduleSuccessMessageClear(5000);
    } catch (err: any) {
      console.error('[Review Request] Error:', err);
      setReviewError(err.message || 'An error occurred while recording the decision.');
    } finally {
      setIsSubmittingReview(false);
    }
  };

  // Submit new request from modal
  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEntityId.trim() || !newEntityTitle.trim() || !newJustification.trim()) {
      setCreateError('All fields marked with an asterisk are mandatory.');
      return;
    }

    setIsSubmittingCreate(true);
    setCreateError(null);

    try {
      let entityType: 'Assessment' | 'Business' | 'TaxRate' = 'Assessment';
      let beforeVal: Record<string, any> = {};
      let afterVal: Record<string, any> = {};

      if (newRequestType === 'assessment_cancellation') {
        entityType = 'Assessment';
        beforeVal = { status: 'Pending', amountDueUSD: newTargetAmount, fiscalYear: 2026 };
        afterVal = { status: 'Cancelled', cancellationReason: newJustification.trim() };
      } else if (newRequestType === 'business_deregistration') {
        entityType = 'Business';
        beforeVal = { status: 'Active', totalOverdueUSD: newTargetAmount };
        afterVal = { status: 'Closure Pending', deregistrationReason: newJustification.trim(), overdueDebtUSD: newTargetAmount };
      } else {
        entityType = 'TaxRate';
        beforeVal = { annualFeeUSD: 40, version: 1 };
        afterVal = { annualFeeUSD: newTargetAmount, version: 2, legalBasis: 'Exceptional Tax Override' };
      }

      const res = await submitApprovalRequest({
        requestType: newRequestType,
        entityType,
        entityId: newEntityId.trim(),
        entityTitle: newEntityTitle.trim(),
        beforeValue: beforeVal,
        afterValue: afterVal,
        justification: newJustification.trim(),
        requester: {
          uid: activeUserId,
          displayName: activeUserName,
          role: activeUserRole,
        },
        targetDetails: {
          businessName: newEntityTitle.trim(),
          amountUSD: newTargetAmount,
        },
      });

      setIsCreateModalOpen(false);
      setNewEntityId('');
      setNewEntityTitle('');
      setNewJustification('');
      setReviewSuccessMessage(`Request No. ${res.id} successfully submitted to the Maker-Checker approval queue.`);
      await reloadRequests();
      scheduleSuccessMessageClear(5000);
    } catch (err: any) {
      console.error('[Create Request] Error:', err);
      setCreateError(err.message || 'Error creating approval request.');
    } finally {
      setIsSubmittingCreate(false);
    }
  };

  return (
    <div className="space-y-8 font-sans">
      
      {/* Top Banner / Header */}
      <PageHeader
        eyebrow="Maker / checker"
        title="Pending Approvals & Dual Control"
        description="Authorization workflow for sensitive fiscal operations (notice cancellations, administrative closures, rate overrides) enforcing strict Maker-Checker segregation of duties."
        actions={
          <>
            <Button
              variant="ghost"
              size="md"
              onClick={reloadRequests}
              disabled={loading}
              icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
            >
              Refresh
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => setIsCreateModalOpen(true)}
              icon={<Plus className="w-4 h-4" />}
            >
              New Request
            </Button>
          </>
        }
      />

      {/* Success Notification Alert */}
      {reviewSuccessMessage && (
        <div className="p-4 rounded-[14px] bg-sage/15 border border-sage/30 text-ink text-xs flex items-start gap-3 transition-premium">
          <CheckCircle2 className="w-5 h-5 text-sage shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            <strong>Success:</strong> {reviewSuccessMessage}
          </div>
        </div>
      )}

      {/* Overview Stat Strip */}
      <MetricStrip
        columns={4}
        items={[
          {
            label: 'Pending Requests',
            value: counts.pending.toString(),
            trend: counts.pending > 0 ? 'Awaiting sign-off' : 'Queue clear',
            trendType: counts.pending > 0 ? 'warn' : 'sage',
            subline: 'Active control queue',
            icon: <Clock className="w-4 h-4 text-warn" />,
          },
          {
            label: 'Notice Cancellations',
            value: counts.cancellations.toString(),
            trend: 'Cancellation requests',
            trendType: 'muted',
            subline: 'Audit traceability',
            icon: <FileX2 className="w-4 h-4 text-accent" />,
          },
          {
            label: 'Business Closures',
            value: counts.radiations.toString(),
            trend: 'Closure status',
            trendType: 'muted',
            subline: 'Persistent arrears',
            icon: <Building2 className="w-4 h-4 text-muted" />,
          },
          {
            label: 'Schedule Overrides',
            value: counts.rates.toString(),
            trend: 'Rate adjustments',
            trendType: 'muted',
            subline: 'Protected tariff versions',
            icon: <Scale className="w-4 h-4 text-muted" />,
          },
        ]}
      />

      {/* Maker-Checker Rule Notice */}
      <div className="p-4 rounded-[14px] bg-accent-soft/50 border border-line flex items-start gap-3 transition-premium">
        <ShieldCheck className="w-5 h-5 text-accent shrink-0 mt-0.5" />
        <div className="text-xs text-ink leading-relaxed">
          <strong className="text-ink">Core Dual-Control Principle (Maker-Checker):</strong>{' '}
          No sensitive fiscal modification is applied directly. The initiating officer (Maker) submits the request with mandatory justification. A distinct second officer (Checker, holding the <strong>Supervisor</strong> or <strong>Administrator</strong> role) must review and record a reasoned decision. The approver can never be the same user as the requester.
        </div>
      </div>

      {/* Filters and Navigation Bar */}
      <div className="p-4 sm:p-5 rounded-[18px] border border-line bg-surface shadow-card space-y-4">
        {/* Status Tabs */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line pb-3">
          <button
            type="button"
            onClick={() => setStatusTab('Pending')}
            className={`px-3.5 py-2 rounded-[10px] text-xs font-semibold transition-premium flex items-center gap-1.5 ${
              statusTab === 'Pending'
                ? 'bg-accent text-white shadow-sm font-bold'
                : 'text-muted hover:text-ink hover:bg-surface2'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            Pending Review
            <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[11px] font-bold ${
              statusTab === 'Pending' ? 'bg-white/20 text-white' : 'bg-surface2 text-muted'
            }`}>
              {counts.pending}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setStatusTab('Approved')}
            className={`px-3.5 py-2 rounded-[10px] text-xs font-semibold transition-premium flex items-center gap-1.5 ${
              statusTab === 'Approved'
                ? 'bg-accent text-white shadow-sm font-bold'
                : 'text-muted hover:text-ink hover:bg-surface2'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Approved
            <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[11px] font-bold ${
              statusTab === 'Approved' ? 'bg-white/20 text-white' : 'bg-surface2 text-muted'
            }`}>
              {counts.approved}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setStatusTab('Rejected')}
            className={`px-3.5 py-2 rounded-[10px] text-xs font-semibold transition-premium flex items-center gap-1.5 ${
              statusTab === 'Rejected'
                ? 'bg-accent text-white shadow-sm font-bold'
                : 'text-muted hover:text-ink hover:bg-surface2'
            }`}
          >
            <XCircle className="w-3.5 h-3.5" />
            Rejected
            <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[11px] font-bold ${
              statusTab === 'Rejected' ? 'bg-white/20 text-white' : 'bg-surface2 text-muted'
            }`}>
              {counts.rejected}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setStatusTab('ALL')}
            className={`px-3.5 py-2 rounded-[10px] text-xs font-semibold transition-premium flex items-center gap-1.5 ${
              statusTab === 'ALL'
                ? 'bg-accent text-white shadow-sm font-bold'
                : 'text-muted hover:text-ink hover:bg-surface2'
            }`}
          >
            All Requests
            <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[11px] font-bold ${
              statusTab === 'ALL' ? 'bg-white/20 text-white' : 'bg-surface2 text-muted'
            }`}>
              {counts.all}
            </span>
          </button>
        </div>

        {/* Search and Secondary Dropdown Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs rounded-[10px] border border-line bg-surface text-ink placeholder:text-muted focus:border-accent focus:outline-none transition-premium font-sans"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Type Filter */}
          <div className="flex items-center gap-2">
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value as any)}
              className="px-3 py-2 text-xs rounded-[10px] border border-line bg-surface text-ink font-medium focus:border-accent focus:outline-none transition-premium font-sans"
            >
              <option value="ALL">All Types</option>
              <option value="assessment_cancellation">Assessment Notice Cancellation</option>
              <option value="business_deregistration">Business Closure</option>
              <option value="tax_rate_override">Rate Schedule Override</option>
              <option value="certificate_revocation">Certificate Revocation</option>
              <option value="user_admin_promotion">Admin Role Promotion</option>
              <option value="user_admin_suspension">Admin Account Suspension</option>
            </select>
          </div>

          {/* Requester Filter */}
          <div className="flex items-center gap-2">
            <select
              value={selectedRequester}
              onChange={(e) => setSelectedRequester(e.target.value)}
              className="px-3 py-2 text-xs rounded-[10px] border border-line bg-surface text-ink font-medium focus:border-accent focus:outline-none transition-premium font-sans"
            >
              <option value="ALL">All Requesters</option>
              {distinctRequesters.map((req) => (
                <option key={req.id} value={req.id}>
                  {req.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Requests List */}
      {loading ? (
        <div className="py-16 text-center border border-slate-200 rounded-xl bg-white">
          <RefreshCw className="w-6 h-6 animate-spin text-slate-400 mx-auto mb-2" />
          <p className="text-xs text-slate-500 font-medium">Loading approval requests...</p>
        </div>
      ) : filteredRequests.length === 0 ? (
        <div className="py-16 text-center border border-dashed border-slate-300 rounded-xl bg-slate-50">
          <ShieldCheck className="w-10 h-10 text-slate-400 mx-auto mb-2 opacity-60" />
          <h3 className="text-sm font-bold text-slate-800">No approval requests found</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
            {statusTab === 'Pending'
              ? 'All requests have been processed or no sensitive operations are awaiting review.'
              : 'No records match the selected filters and search query.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredRequests.map((req) => {
            const typeConfig = typeConfigFor(req.requestType);
            const TypeIcon = typeConfig.icon;
            const isSelfRequest = req.requesterId === activeUserId;
            const reqStatus = normalizeApprovalStatus(req.status);
            const isPending = reqStatus === 'Pending';

            return (
              <div
                key={req.id}
                className={`rounded-xl border bg-white overflow-hidden shadow-xs transition-all ${
                  isPending ? 'border-amber-300 ring-1 ring-amber-300/40' : 'border-slate-200'
                }`}
              >
                {/* Header Row */}
                <div className="p-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50">
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Status Badge */}
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-bold ${
                        reqStatus === 'Pending'
                          ? 'bg-amber-100 text-amber-900 border border-amber-300'
                          : reqStatus === 'Approved'
                          ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                          : 'bg-rose-100 text-rose-900 border border-rose-300'
                      }`}
                    >
                      {reqStatus === 'Pending' && (
                        <span className="w-2 h-2 rounded-full bg-amber-600 animate-pulse" />
                      )}
                      {reqStatus === 'Approved' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />}
                      {reqStatus === 'Rejected' && <XCircle className="w-3.5 h-3.5 text-rose-700" />}
                      <span className="capitalize">{reqStatus}</span>
                    </span>

                    {/* ID */}
                    <span className="font-mono font-bold text-xs text-slate-900 bg-white px-2 py-0.5 rounded border border-slate-200">
                      {req.id}
                    </span>

                    {/* Request Type Badge */}
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-[12px] font-semibold ${typeConfig.colorClass}`}
                    >
                      <TypeIcon className="w-3.5 h-3.5" />
                      {typeConfig.shortLabel}
                    </span>
                  </div>

                  {/* Submission date */}
                  <div className="text-[12px] text-slate-500 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <span>Submitted on {new Date(req.createdAt).toLocaleString('en-US')}</span>
                  </div>
                </div>

                {/* Body Content */}
                <div className="p-4 space-y-4">
                  {/* Entity Title & Target */}
                  <div>
                    <div className="text-[12px] font-bold uppercase tracking-wider text-slate-500">
                      Entity & Tax Record
                    </div>
                    <div className="text-sm font-bold text-slate-900 mt-0.5 flex flex-wrap items-center gap-2">
                      <span>{req.entityTitle.replace(/^Patente N°/i, 'Business License No.')}</span>
                      <span className="font-mono text-xs font-normal text-slate-500">
                        (Ref: {req.entityId})
                      </span>
                    </div>

                    {req.targetDetails && (
                      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                        {req.targetDetails.commune && (
                          <span>
                            Municipality: <strong>{req.targetDetails.commune}</strong>
                          </span>
                        )}
                        {req.targetDetails.quartier && (
                          <span>
                            Neighborhood: <strong>{req.targetDetails.quartier}</strong>
                          </span>
                        )}
                        {req.targetDetails.amountUSD !== undefined && (
                          <span>
                            Ref Amount: <strong>{formatMoney(req.targetDetails.amountUSD)}</strong>
                          </span>
                        )}
                        {req.targetDetails.fiscalYear && (
                          <span>
                            Fiscal Year: <strong>{req.targetDetails.fiscalYear}</strong>
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* CLEAR DIFF VIEW (Before / After) */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3.5">
                    <div className="text-[12px] font-bold uppercase tracking-wider text-slate-700 mb-2.5 flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-slate-600" />
                      Value Differential (Before / After Comparison)
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* Before Box */}
                      <div className="p-3 rounded-lg bg-white border border-slate-200 text-xs space-y-1">
                        <div className="font-bold text-slate-700 flex items-center justify-between pb-1 border-b border-slate-100 text-[12px]">
                          <span className="text-slate-500 uppercase">Current State (Before)</span>
                          <span className="px-1.5 py-0.2 rounded bg-slate-100 text-slate-700 text-[11px]">
                            Original
                          </span>
                        </div>
                        {Object.entries(req.beforeValue).map(([key, val]) => (
                          <div key={key} className="flex items-start justify-between gap-2 py-0.5">
                            <span className="font-mono text-slate-500 text-[12px]">{key} :</span>
                            <span className="font-mono font-medium text-slate-800 text-right">
                              {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* After Box */}
                      <div className="p-3 rounded-lg bg-emerald-50/40 border border-emerald-200 text-xs space-y-1">
                        <div className="font-bold text-emerald-900 flex items-center justify-between pb-1 border-b border-emerald-100 text-[12px]">
                          <span className="uppercase">Proposed State (After)</span>
                          <span className="px-1.5 py-0.2 rounded bg-emerald-200 text-emerald-900 text-[11px] font-bold">
                            Proposed
                          </span>
                        </div>
                        {Object.entries(req.afterValue).map(([key, val]) => (
                          <div key={key} className="flex items-start justify-between gap-2 py-0.5">
                            <span className="font-mono text-emerald-800 text-[12px]">{key} :</span>
                            <span className="font-mono font-bold text-emerald-950 text-right">
                              {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Requester & Justification */}
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[12px] font-bold uppercase tracking-wider text-slate-500">
                        Requester (Maker)
                      </span>
                      <span className="inline-flex items-center gap-1 font-semibold text-slate-800">
                        <User className="w-3.5 h-3.5 text-slate-500" />
                        {req.requesterName}{' '}
                        <span className="text-slate-500 font-normal">({req.requesterRole})</span>
                      </span>
                    </div>

                    <div>
                      <div className="text-[12px] font-semibold text-slate-700">Reason & Justification:</div>
                      <p className="text-xs text-slate-800 font-medium italic mt-0.5 bg-white p-2.5 rounded border border-slate-200">
                        « {req.justification} »
                      </p>
                    </div>
                  </div>

                  {/* Review / Decision Info (If processed) */}
                  {req.reviewedBy && (
                    <div
                      className={`p-3 rounded-lg border text-xs space-y-1 ${
                        normalizeApprovalStatus(req.status) === 'Approved'
                          ? 'bg-emerald-50/60 border-emerald-200 text-emerald-950'
                          : 'bg-rose-50/60 border-rose-200 text-rose-950'
                      }`}
                    >
                      <div className="flex items-center justify-between font-bold text-[12px]">
                        <span>Decision Rendered by (Checker):</span>
                        <span>{new Date(req.reviewedAt || '').toLocaleString('en-US')}</span>
                      </div>
                      <div className="font-semibold">
                        {req.reviewerName} ({req.reviewerRole})
                      </div>
                      {req.reviewComment && (
                        <div className="mt-1 text-[12px] italic bg-white/70 p-2 rounded border border-slate-200/40">
                          Reviewer Decision Comment: « {req.reviewComment} »
                        </div>
                      )}
                    </div>
                  )}

                  {/* Action Bar */}
                  <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    {/* Maker Checker Alert Hint */}
                    {isPending && isSelfRequest && (
                      <div className="text-[12px] text-amber-800 font-medium flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5 text-amber-600" />
                        <span>You initiated this request. A different officer must decide.</span>
                      </div>
                    )}
                    {isPending && !isSelfRequest && (
                      <div className="text-[12px] text-emerald-800 font-medium flex items-center gap-1.5">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Authorized to review and decide as {activeUserRole}.</span>
                      </div>
                    )}
                    {!isPending && (
                      <div className="text-[12px] text-slate-500">
                        Request closed and recorded in official public finance audit log.
                      </div>
                    )}

                    {/* Action button */}
                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      {isPending ? (
                        <button
                          type="button"
                          onClick={() => handleOpenReview(req)}
                          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-slate-900 hover:bg-slate-800 text-white shadow-xs transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Review & Decide
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleOpenReview(req)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
                        >
                          View Details
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ==================================================================== */}
      {/* REVIEW & DECISION MODAL */}
      {/* ==================================================================== */}
      {activeModalRequest && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="bg-slate-900 text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-amber-400" />
                <div>
                  <h3 className="text-sm font-bold">
                    Maker-Checker Compliance Review — {activeModalRequest.id}
                  </h3>
                  <p className="text-[12px] text-slate-300">
                    {typeConfigFor(activeModalRequest.requestType).label}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveModalRequest(null)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                &times;
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-5 space-y-4 overflow-y-auto text-xs text-slate-700">
              {/* Maker Self-Approval Prohibition Warning */}
              {activeModalRequest.requesterId === activeUserId ? (
                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-300 text-rose-950 text-xs flex items-start gap-2.5">
                  <AlertOctagon className="w-5 h-5 text-rose-700 shrink-0 mt-0.5" />
                  <div>
                    <strong className="block font-bold">Prohibition of Dual Role (Maker-Checker):</strong>
                    You initiated this request as requester (<span className="font-semibold">{activeModalRequest.requesterName}</span>). Public finance audit standards strictly forbid reviewing or deciding on your own submission. Please have another Supervisor or Administrator conduct the review.
                  </div>
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-900 text-[12px] leading-relaxed flex items-start gap-2">
                  <ShieldCheck className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                  <div>
                    You are reviewing this request as <strong>{activeUserRole} ({activeUserName})</strong>. Your decision and justification will be immutably recorded in the municipal audit register.
                  </div>
                </div>
              )}

              {/* Entity Details */}
              <div className="p-3.5 rounded-lg border border-slate-200 bg-slate-50 space-y-1">
                <div className="text-[12px] font-bold uppercase text-slate-500">Subject of Request</div>
                <div className="text-sm font-bold text-slate-900">{activeModalRequest.entityTitle.replace(/^Patente N°/i, 'Business License No.')}</div>
                <div className="text-[12px] text-slate-600">Entity ID: {activeModalRequest.entityId}</div>
              </div>

              {/* Diff view */}
              <div>
                <div className="text-[12px] font-bold uppercase text-slate-500 mb-1.5">
                  Requested Changes (Diff)
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-3 rounded-lg border border-slate-200 bg-slate-50">
                    <div className="font-bold text-[11px] text-slate-500 uppercase pb-1 border-b border-slate-200 mb-1.5">
                      Initial Value (Before)
                    </div>
                    {Object.entries(activeModalRequest.beforeValue).map(([k, v]) => (
                      <div key={k} className="text-[12px] py-0.5 font-mono flex justify-between">
                        <span className="text-slate-500">{k}:</span>
                        <span className="font-bold text-slate-800">{String(v)}</span>
                      </div>
                    ))}
                  </div>

                  <div className="p-3 rounded-lg border border-emerald-300 bg-emerald-50/50">
                    <div className="font-bold text-[11px] text-emerald-800 uppercase pb-1 border-b border-emerald-200 mb-1.5">
                      Requested Value (After)
                    </div>
                    {Object.entries(activeModalRequest.afterValue).map(([k, v]) => (
                      <div key={k} className="text-[12px] py-0.5 font-mono flex justify-between">
                        <span className="text-emerald-700">{k}:</span>
                        <span className="font-bold text-emerald-950">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Justification */}
              <div>
                <div className="text-[12px] font-bold uppercase text-slate-500 mb-1">
                  Officer Justification ({activeModalRequest.requesterName})
                </div>
                <div className="p-3 rounded-lg border border-slate-200 bg-white italic text-slate-800 leading-relaxed">
                  « {activeModalRequest.justification} »
                </div>
              </div>

              {/* Reviewer Comment Input (Required) */}
              {normalizeApprovalStatus(activeModalRequest.status) === 'Pending' && (
                <div>
                  <label className="block text-xs font-bold text-slate-900 mb-1">
                    Review Comment / Decision Regulatory Grounds * (Required)
                  </label>
                  <textarea
                    rows={3}
                    value={reviewComment}
                    onChange={(e) => setReviewComment(e.target.value)}
                    disabled={activeModalRequest.requesterId === activeUserId || isSubmittingReview}
                    placeholder="Specify verification checks conducted, regulatory decree reference, or legal grounds for decision..."
                    className="w-full p-2.5 text-xs rounded-lg border border-slate-300 bg-white text-slate-900 focus:ring-2 focus:ring-slate-400 focus:outline-hidden disabled:bg-slate-100"
                  />
                </div>
              )}

              {reviewError && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{reviewError}</span>
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setActiveModalRequest(null)}
                className="px-4 py-2 text-xs font-semibold rounded-lg border border-slate-300 text-slate-700 hover:bg-white"
              >
                Close
              </button>

              {normalizeApprovalStatus(activeModalRequest.status) === 'Pending' && (
                <div className="flex items-center gap-2">
                  {/* Reject Button */}
                  <button
                    type="button"
                    onClick={() => handleExecuteDecision('Rejected')}
                    disabled={
                      activeModalRequest.requesterId === activeUserId ||
                      !reviewComment.trim() ||
                      isSubmittingReview
                    }
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-rose-700 hover:bg-rose-800 text-white disabled:opacity-40 transition-colors"
                  >
                    <XCircle className="w-4 h-4" />
                    Reject Request
                  </button>

                  {/* Approve Button */}
                  <button
                    type="button"
                    onClick={() => handleExecuteDecision('Approved')}
                    disabled={
                      activeModalRequest.requesterId === activeUserId ||
                      !reviewComment.trim() ||
                      isSubmittingReview
                    }
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white disabled:opacity-40 transition-colors shadow-xs"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    Approve & Apply
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* NEW REQUEST MODAL (Maker Initiation) */}
      {/* ==================================================================== */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 max-w-lg w-full shadow-2xl overflow-hidden">
            <div className="bg-slate-900 text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Plus className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm font-bold">New Approval Request (Maker)</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-white text-lg font-bold"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateRequest} className="p-5 space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-800 mb-1">
                  Sensitive Operation Type *
                </label>
                <select
                  value={newRequestType}
                  onChange={(e) => setNewRequestType(e.target.value as any)}
                  className="w-full p-2.5 rounded-lg border border-slate-300 bg-white font-medium"
                >
                  <option value="assessment_cancellation">Assessment Notice Cancellation</option>
                  <option value="business_deregistration">Administrative Business Closure</option>
                  <option value="tax_rate_override">Tax Rate Schedule Override</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-800 mb-1">
                  Entity Identifier (Notice ID / Business ID / Rate ID) *
                </label>
                <input
                  type="text"
                  value={newEntityId}
                  onChange={(e) => setNewEntityId(e.target.value)}
                  placeholder="e.g., PAT-2026-00089 or biz_goma_014"
                  className="w-full p-2.5 rounded-lg border border-slate-300 font-mono"
                  required
                />
              </div>

              <div>
                <label className="block font-bold text-slate-800 mb-1">
                  Entity / Business Name *
                </label>
                <input
                  type="text"
                  value={newEntityTitle}
                  onChange={(e) => setNewEntityTitle(e.target.value)}
                  placeholder="e.g., Ets Baraka & Sons (Nat ID: CD/GOM/22-A-0988)"
                  className="w-full p-2.5 rounded-lg border border-slate-300"
                  required
                />
              </div>

              <div>
                <label className="block font-bold text-slate-800 mb-1">
                  Reference Amount in USD (Optional)
                </label>
                <input
                  type="number"
                  value={newTargetAmount}
                  onChange={(e) => setNewTargetAmount(Number(e.target.value))}
                  className="w-full p-2.5 rounded-lg border border-slate-300 font-mono font-bold"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-800 mb-1">
                  Detailed Justification * (Mandatory)
                </label>
                <textarea
                  rows={3}
                  value={newJustification}
                  onChange={(e) => setNewJustification(e.target.value)}
                  placeholder="Explain the factual or legal grounds warranting this approval request..."
                  className="w-full p-2.5 rounded-lg border border-slate-300"
                  required
                />
              </div>

              {createError && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{createError}</span>
                </div>
              )}

              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-600 text-[12px]">
                By submitting this request, you act as <strong>Maker ({activeUserName})</strong>. It will immediately enter the queue for review by an independent supervisor.
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingCreate}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white font-bold hover:bg-slate-800 disabled:opacity-50"
                >
                  {isSubmittingCreate ? 'Submitting...' : 'Submit Approval Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
