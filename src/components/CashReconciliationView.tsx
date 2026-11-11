import React, { useState, useEffect, useMemo } from 'react';
import { 
  Vault, 
  Clock, 
  CheckCircle2, 
  AlertTriangle, 
  Landmark, 
  ArrowUpRight, 
  FileText, 
  UserCheck, 
  Building, 
  DollarSign, 
  Calendar, 
  Search, 
  Filter, 
  Plus, 
  ChevronRight, 
  X, 
  ShieldCheck, 
  ExternalLink,
  ReceiptText,
  AlertCircle,
  TrendingUp,
  RefreshCw,
  Send,
  Lock,
  Unlock,
  CheckSquare,
  Square
} from 'lucide-react';
import { 
  CashSession, 
  TreasuryDeposit, 
  UserRole, 
  Payment 
} from '../types';
import { 
  getCashSessions, 
  subscribeToCashSessions,
  approveCashSession, 
  getTreasuryDeposits, 
  recordTreasuryDeposit,
  openCashSession,
  closeCashSession,
  getCashCustodySummary
} from '../services/cashService';
import { getPayments, subscribeToPayments } from '../services/dbService';
import { useAuth } from '../contexts/AuthContext';
import { BRAND } from '../branding';
import { localDateFromIsoTimestamp, todayDateString } from '../utils/date';
import { PageHeader, Button, Badge, Panel, MetricStrip } from './ui';
import { formatMoney } from '../utils/money';
import { roundMoney } from '../utils/frenchNumber';
import { parseAmount } from '../utils/taxCalc';
import { cashVarianceLabel, classifyCashVariance } from '../utils/cashVariance';

interface CashReconciliationViewProps {
  userRole: UserRole;
  onNavigateToPayments?: () => void;
}

export const CashReconciliationView: React.FC<CashReconciliationViewProps> = ({
  userRole,
  onNavigateToPayments
}) => {
  const { currentUser, userProfile } = useAuth();
  const [sessions, setSessions] = useState<CashSession[]>([]);
  const [deposits, setDeposits] = useState<TreasuryDeposit[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'pending' | 'open' | 'custody' | 'deposits'>('pending');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Modals
  const [selectedSessionForApproval, setSelectedSessionForApproval] = useState<CashSession | null>(null);
  const [supervisorNotes, setSupervisorNotes] = useState<string>('');
  const [approving, setApproving] = useState<boolean>(false);

  // Treasury Deposit Modal
  const [isDepositModalOpen, setIsDepositModalOpen] = useState<boolean>(false);
  const [selectedSessionIdsForDeposit, setSelectedSessionIdsForDeposit] = useState<string[]>([]);
  const [bankName, setBankName] = useState<string>('Central Bank of Congo (BCC) - Provincial Directorate');
  const [slipRef, setSlipRef] = useState<string>('');
  const [depositorName, setDepositorName] = useState<string>('');
  const [depositDate, setDepositDate] = useState<string>(todayDateString());
  const [depositNotes, setDepositNotes] = useState<string>('');
  const [depositing, setDepositing] = useState<boolean>(false);
  const [depositError, setDepositError] = useState<string | null>(null);
  // Error surface for the approve / close-shift modals (previously failures
  // were console-only, so a rejected action looked like a silent no-op).
  const [sessionActionError, setSessionActionError] = useState<string | null>(null);

  // New Shift / End Shift Quick Modals (for direct accessibility)
  const [isOpenShiftModalOpen, setIsOpenShiftModalOpen] = useState<boolean>(false);
  // Empty, not '50': a shift's opening float is whatever the cashier actually
  // received, and a pre-filled default was being accepted without a count.
  const [openFloatUSD, setOpenFloatUSD] = useState<string>('');
  const [openStation, setOpenStation] = useState<string>('Central Counter - City Hall');
  const [openNotes, setOpenNotes] = useState<string>('');
  const [openingShift, setOpeningShift] = useState<boolean>(false);

  const [sessionToClose, setSessionToClose] = useState<CashSession | null>(null);
  const [countedUSDInput, setCountedUSDInput] = useState<string>('');
  const [closingNotesInput, setClosingNotesInput] = useState<string>('');
  const [varianceExplanationInput, setVarianceExplanationInput] = useState<string>('');
  const [closingShift, setClosingShift] = useState<boolean>(false);

  const canApprove = userRole === 'Supervisor' || userRole === 'Admin';
  const canDeposit = userRole === 'Supervisor' || userRole === 'Admin';
  const canOpenShift = userRole === 'Cashier' || userRole === 'Admin' || userRole === 'Supervisor';

  useEffect(() => {
    setLoading(true);

    // One-time static fetch of treasury deposits
    getTreasuryDeposits()
      .then((depList) => setDeposits(depList || []))
      .catch((err) => console.warn('[Reconciliation] Deposits load error:', err));

    // Active-aware session listener
    const unsubSessions = subscribeToCashSessions(
      (sessList) => {
        setSessions(sessList || []);
        setLoading(false);
      },
      (err) => {
        console.error('[Reconciliation] Sessions listener error:', err);
        setLoading(false);
      }
    );

    // Active-aware payment listener for matching session transactions
    const unsubPayments = subscribeToPayments((payList) => {
      setPayments(payList || []);
    });

    return () => {
      unsubSessions();
      unsubPayments();
    };
  }, []);

  const reloadAll = async () => {
    setLoading(true);
    try {
      const [sessList, depList, payList] = await Promise.all([
        getCashSessions(),
        getTreasuryDeposits(),
        getPayments()
      ]);
      setSessions(sessList);
      setDeposits(depList);
      setPayments(payList);
    } catch (err) {
      console.warn('[Reconciliation] Reload error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Filtered session lists by lifecycle
  const openSessions = useMemo(() => {
    return sessions.filter((s) => s.status === 'open');
  }, [sessions]);

  const pendingApprovalSessions = useMemo(() => {
    return sessions.filter((s) => s.status === 'closed');
  }, [sessions]);

  const inCustodySessions = useMemo(() => {
    return sessions.filter((s) => s.status === 'approved' && s.cashStatus === 'in_custody');
  }, [sessions]);

  // Aggregate totals
  const totalInCustodyUSD = useMemo(() => {
    return inCustodySessions.reduce((sum, s) => {
      const val = s.countedCashUSD !== undefined ? s.countedCashUSD : (s.expectedCashUSD || 0);
      return sum + val;
    }, 0);
  }, [inCustodySessions]);

  const totalDepositedThisMonthUSD = useMemo(() => {
    const currentMonth = todayDateString().slice(0, 7);
    return deposits
      .filter((d) => (d.date || localDateFromIsoTimestamp(d.depositedAt || '') || '').startsWith(currentMonth))
      .reduce((sum, d) => sum + (d.depositAmountUSD || 0), 0);
  }, [deposits]);

  // Handle supervisor approval
  const handleApproveSession = async () => {
    if (!selectedSessionForApproval) return;
    // Authority is enforced here, not only by hiding the button.
    if (!canApprove) {
      setSessionActionError('Only Supervisors or Administrators may approve a cash shift.');
      return;
    }
    // Re-check against the freshest list before acting: the modal holds a
    // snapshot and a concurrent supervisor/second tab may have already
    // approved this shift (or deposited it).
    const fresh = sessions.find((s) => s.id === selectedSessionForApproval.id);
    if (!fresh) {
      setSessionActionError('This shift no longer exists in the registry. Refresh and try again.');
      return;
    }
    if (fresh.status === 'approved') {
      setSessionActionError(`Shift ${fresh.sessionNumber} has already been approved by another supervisor.`);
      setSelectedSessionForApproval(null);
      await reloadAll();
      return;
    }
    if (fresh.status !== 'closed') {
      setSessionActionError(`Shift ${fresh.sessionNumber} is "${fresh.status}" — only closed shifts can be approved.`);
      return;
    }
    setApproving(true);
    setSessionActionError(null);
    try {
      const supervisor = {
        uid: userProfile?.uid || currentUser?.uid || 'sup_aime',
        displayName: userProfile?.displayName || 'Superviseur Urbain',
        role: userRole,
      };

      await approveCashSession(
        selectedSessionForApproval.id,
        supervisor,
        supervisorNotes.trim() || undefined
      );

      setSelectedSessionForApproval(null);
      setSupervisorNotes('');
      await reloadAll();
    } catch (err: any) {
      console.error('[Approve Error]', err);
      setSessionActionError(err?.message || 'Failed to approve the cash shift.');
    } finally {
      setApproving(false);
    }
  };

  // Open shift handler
  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    // The declared float is read the same way the closing count is read: it
    // is a money amount, and an unreadable one has to be reported rather than
    // filed as an empty drawer. An empty field still means an empty drawer.
    const openingFloat = openFloatUSD.trim() === '' ? 0 : parseAmount(openFloatUSD);
    if (!Number.isFinite(openingFloat) || openingFloat < 0) {
      setSessionActionError(
        'Saisissez le montant d’ouverture de caisse (0 pour une caisse vide) avant d’ouvrir le tiroir.'
      );
      return;
    }
    setOpeningShift(true);
    setSessionActionError(null);
    try {
      await openCashSession({
        cashierId: userProfile?.uid || currentUser?.uid || 'cashier_001',
        cashierName: userProfile?.displayName || BRAND.fallbackCashierName,
        cashierEmail: userProfile?.email || currentUser?.email || '',
        stationOffice: openStation,
        openingBalanceUSD: openingFloat,
        openingNotes: openNotes.trim() || 'Opening of shift',
      });
      setIsOpenShiftModalOpen(false);
      setOpenNotes('');
      await reloadAll();
    } catch (err) {
      console.error('[Open Shift Error]', err);
      // The failure used to go to the console only: the officer saw the
      // button stop spinning and nothing else, with no idea whether the
      // drawer was open — "An open cash shift already exists" is the common
      // case, and it needs to be read.
      setSessionActionError(
        err instanceof Error ? err.message : 'Failed to open the cash shift.'
      );
    } finally {
      setOpeningShift(false);
    }
  };

  // Close shift handler
  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionToClose) return;
    // Freshness re-check: closing an already closed/approved/deposited shift
    // reverted the supervisor sign-off and resurrected deposited cash into
    // the custody table.
    const fresh = sessions.find((s) => s.id === sessionToClose.id);
    if (fresh && fresh.status !== 'open') {
      setSessionActionError(`Shift ${fresh.sessionNumber} is "${fresh.status}" — only open shifts can be closed.`);
      return;
    }
    // The count is now typed by the officer rather than pre-filled, so an empty
    // or unreadable field must stop the close: `parseFloat('') || 0` would have
    // closed the shift declaring an empty drawer and a full-value variance.
    // parseAmount, not a bare comma swap: it recognises French thousands
    // grouping, so a drawer counted as "1,250" closes at 1 250 and not at 1.25.
    const counted = parseAmount(countedUSDInput);
    if (!countedUSDInput.trim() || !Number.isFinite(counted) || counted < 0) {
      setSessionActionError('Saisissez le montant réellement compté dans la caisse avant de clôturer.');
      return;
    }
    setClosingShift(true);
    setSessionActionError(null);
    try {
      await closeCashSession(sessionToClose.id, {
        countedCashUSD: counted,
        closingNotes: closingNotesInput.trim(),
        varianceExplanation: varianceExplanationInput.trim(),
        cashierId: userProfile?.uid || currentUser?.uid || sessionToClose.cashierId,
        cashierName: userProfile?.displayName || sessionToClose.cashierName,
      });
      setSessionToClose(null);
      setCountedUSDInput('');
      setClosingNotesInput('');
      setVarianceExplanationInput('');
      await reloadAll();
    } catch (err) {
      console.error('[Close Shift Error]', err);
      setSessionActionError(err instanceof Error ? err.message : 'Failed to close the cash shift.');
    } finally {
      setClosingShift(false);
    }
  };

  // Prepare Deposit modal
  const openTreasuryDepositModal = (preselectedSessionIds?: string[]) => {
    setDepositError(null);
    const ids = preselectedSessionIds && preselectedSessionIds.length > 0 
      ? preselectedSessionIds 
      : inCustodySessions.map((s) => s.id);
    setSelectedSessionIdsForDeposit(ids);
    setSlipRef(`BVR-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`);
    setDepositorName(userProfile?.displayName || `Funds Convoy - ${BRAND.shortName} Goma`);
    setIsDepositModalOpen(true);
  };

  // Toggle selection for deposit
  const toggleSessionDepositSelection = (id: string) => {
    setSelectedSessionIdsForDeposit((prev) => 
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  // Execute Treasury Deposit
  const handleExecuteTreasuryDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Authority is enforced here, not only by hiding the entry point.
    if (!canDeposit) {
      setDepositError('Only Supervisors or Administrators may record a treasury deposit.');
      return;
    }
    if (selectedSessionIdsForDeposit.length === 0) {
      setDepositError('Please select at least one approved cash shift to deposit.');
      return;
    }
    if (!slipRef.trim()) {
      setDepositError('Bank deposit slip reference (BVR) is required.');
      return;
    }
    if (!bankName.trim()) {
      setDepositError('The name of the banking institution or Treasury is required.');
      return;
    }

    setDepositing(true);
    setDepositError(null);
    try {
      const selectedSessions = inCustodySessions.filter((s) => 
        selectedSessionIdsForDeposit.includes(s.id)
      );

      const amountUSD = selectedSessions.reduce((sum, s) => {
        return sum + (s.countedCashUSD !== undefined ? s.countedCashUSD : (s.expectedCashUSD || 0));
      }, 0);

      const cashierNames: string[] = Array.from(new Set<string>(selectedSessions.map((s) => s.cashierName)));

      if (selectedSessions.length === 0) {
        // The whole selection went stale (deposited from another tab) while the
        // modal was open — do not record a $0 deposit claiming those shifts.
        setDepositError('The selected shifts are no longer held in custody. Refresh and re-select.');
        return;
      }

      await recordTreasuryDeposit({
        depositAmountUSD: amountUSD,
        date: depositDate,
        depositorId: userProfile?.uid || currentUser?.uid || 'user_dep',
        depositorName: depositorName.trim(),
        bankName: bankName.trim(),
        bankDepositSlipRef: slipRef.trim(),
        approvingSupervisorId: userProfile?.uid || currentUser?.uid || 'sup_aime',
        approvingSupervisorName: userProfile?.displayName || 'Superviseur Urbain',
        // Submit the IDs of the sessions the amounts were actually computed
        // from. Submitting the raw selection marked already-deposited shifts as
        // deposited again (double-counted treasury totals, orphaned links).
        sessionIds: selectedSessions.map((s) => s.id),
        cashierNames,
        notes: depositNotes.trim() || 'Official deposit of business license cash funds to the Treasury account.',
      });

      setIsDepositModalOpen(false);
      setSelectedSessionIdsForDeposit([]);
      setDepositNotes('');
      await reloadAll();
    } catch (err: any) {
      console.error('[Deposit Error]', err);
      setDepositError(err?.message || 'Error recording treasury deposit.');
    } finally {
      setDepositing(false);
    }
  };

  // Selected sessions total in deposit modal
  const depositModalSelectedTotals = useMemo(() => {
    const chosen = inCustodySessions.filter((s) => selectedSessionIdsForDeposit.includes(s.id));
    const usd = chosen.reduce((sum, s) => sum + (s.countedCashUSD !== undefined ? s.countedCashUSD : (s.expectedCashUSD || 0)), 0);
    return { usd, count: chosen.length };
  }, [inCustodySessions, selectedSessionIdsForDeposit]);

  return (
    <div className="space-y-8 font-sans">
      
      {/* Page Header */}
      <PageHeader
        eyebrow="Cash desk"
        title="Cash Reconciliation & Treasury Deposits"
        description="Shift close-outs, physical count verification, custody security, and official bank deposit slips."
        actions={
          <>
            <Button
              variant="ghost"
              size="md"
              icon={<RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />}
              onClick={reloadAll}
            >
              Refresh
            </Button>
            {canOpenShift && (
              <Button
                variant="ghost"
                size="md"
                icon={<Plus className="w-4 h-4" />}
                onClick={() => { setSessionActionError(null); setIsOpenShiftModalOpen(true); }}
              >
                Open Shift
              </Button>
            )}
            {canDeposit && inCustodySessions.length > 0 && (
              <Button
                variant="primary"
                size="md"
                icon={<Landmark className="w-4 h-4" />}
                onClick={() => openTreasuryDepositModal()}
              >
                Bank Deposit ({inCustodySessions.length})
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
            label: 'In Vault Custody',
            value: `${formatMoney(totalInCustodyUSD)}`,
            trend: `${inCustodySessions.length} approved shifts`,
            trendType: 'sage',
            subline: 'Verified physical counts',
            icon: <Vault className="w-4 h-4 text-sage" />,
          },
          {
            label: 'Pending Approval',
            value: pendingApprovalSessions.length.toString(),
            trend: pendingApprovalSessions.length > 0 ? 'Supervisor check' : 'Reconciled',
            trendType: pendingApprovalSessions.length > 0 ? 'warn' : 'sage',
            subline: 'Physical counts to sign',
            icon: <AlertTriangle className="w-4 h-4 text-warn" />,
          },
          {
            label: 'Active Drawers',
            value: openSessions.length.toString(),
            trend: 'In collection',
            trendType: 'muted',
            subline: 'Real-time counters',
            icon: <Clock className="w-4 h-4 text-accent" />,
          },
          {
            label: 'Deposited This Month',
            value: `${formatMoney(totalDepositedThisMonthUSD)}`,
            trend: `${deposits.length} bank slips`,
            trendType: 'sage',
            subline: 'Transferred to Treasury',
            icon: <Landmark className="w-4 h-4 text-muted" />,
          },
        ]}
      />

      {/* Tabs Navigation */}
      <div className="flex items-center gap-2 border-b border-slate-200 overflow-x-auto pb-1 text-sm font-medium">
        <button
          onClick={() => setActiveTab('pending')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl transition-colors whitespace-nowrap border-b-2 font-semibold ${
            activeTab === 'pending'
              ? 'border-amber-600 text-amber-900 bg-amber-50/50'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          To Review & Sign (Supervisor)
          {pendingApprovalSessions.length > 0 && (
            <span className="px-2 py-0.5 text-xs font-bold bg-amber-200 text-amber-900 rounded-full">
              {pendingApprovalSessions.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('custody')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl transition-colors whitespace-nowrap border-b-2 font-semibold ${
            activeTab === 'custody'
              ? 'border-emerald-600 text-emerald-900 bg-emerald-50/50'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Vault className="w-4 h-4 text-emerald-600" />
          Funds in Custody & Treasury Deposit
          <span className="px-2 py-0.5 text-xs font-bold bg-emerald-100 text-emerald-800 rounded-full">
            {inCustodySessions.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('open')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl transition-colors whitespace-nowrap border-b-2 font-semibold ${
            activeTab === 'open'
              ? 'border-blue-600 text-blue-900 bg-blue-50/50'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Clock className="w-4 h-4 text-blue-600" />
          Active Open Shifts
          <span className="px-2 py-0.5 text-xs font-bold bg-blue-100 text-blue-800 rounded-full">
            {openSessions.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('deposits')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl transition-colors whitespace-nowrap border-b-2 font-semibold ${
            activeTab === 'deposits'
              ? 'border-indigo-600 text-indigo-900 bg-indigo-50/50'
              : 'border-transparent text-slate-600 hover:text-slate-900 hover:bg-slate-50'
          }`}
        >
          <Landmark className="w-4 h-4 text-indigo-600" />
          Treasury Deposit History
          <span className="px-2 py-0.5 text-xs font-bold bg-slate-100 text-slate-700 rounded-full">
            {deposits.length}
          </span>
        </button>
      </div>

      {/* TAB 1: PENDING APPROVAL (CLOSED SESSIONS WITH VARIANCES) */}
      {activeTab === 'pending' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-amber-50/60 border border-amber-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 mt-0.5">
                <AlertCircle className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-amber-950">
                  Cashier Shift Approval & Discrepancy Control
                </h3>
                <p className="text-xs text-amber-900 mt-0.5">
                  In compliance with {BRAND.shortName} financial procedures, every cashier closing a shift submits physical counts. The supervisor must inspect any variances and sign off before cash is admitted to the vault.
                </p>
              </div>
            </div>
          </div>

          {pendingApprovalSessions.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
              <h4 className="text-base font-bold text-slate-900">No shifts pending approval</h4>
              <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
                All closed cashier sessions have been verified, certified, and admitted to vault custody.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {pendingApprovalSessions.map((session) => {
                const varianceUSD = session.varianceUSD ?? 0;
                const varianceKind = classifyCashVariance(varianceUSD);
                const isShortage = varianceKind === 'shortage';
                const isSurplus = varianceKind === 'surplus';
                const isExact = varianceKind === 'exact';

                return (
                  <div 
                    key={session.id}
                    className={`bg-white rounded-xl border p-5 shadow-xs transition-all ${
                      isShortage ? 'border-red-300 ring-2 ring-red-500/10' : 
                      isSurplus ? 'border-blue-300 ring-2 ring-blue-500/10' : 
                      'border-slate-200'
                    }`}
                  >
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                      
                      {/* Session Identity & Office */}
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold text-slate-900">
                            {session.sessionNumber}
                          </span>
                          <span className="text-[12px] font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                            {session.stationOffice === 'Guichet Commune Karisimbi' ? 'Karisimbi Municipality Counter' : ((session.stationOffice || '').toLowerCase().includes('ville') || (session.stationOffice || '').includes('City Hall') ? 'Central Counter - City Hall' : (session.stationOffice || 'Counter'))}
                          </span>

                          {/* Variance Status Badge */}
                          {isShortage && (
                            <span className="inline-flex items-center gap-1 text-[12px] font-bold px-2.5 py-0.5 rounded-full bg-red-100 text-red-800 border border-red-200">
                              <AlertTriangle className="w-3 h-3 text-red-700" />
                              Shortfall found ({formatMoney(Math.abs(varianceUSD))})
                            </span>
                          )}
                          {isSurplus && (
                            <span className="inline-flex items-center gap-1 text-[12px] font-bold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                              <TrendingUp className="w-3 h-3 text-blue-700" />
                              Surplus found (+{formatMoney(varianceUSD)})
                            </span>
                          )}
                          {varianceKind === 'tolerance' && (
                            <span className="inline-flex items-center gap-1 text-[12px] font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                              <CheckCircle2 className="w-3 h-3 text-amber-700" />
                              {cashVarianceLabel(varianceUSD)}
                            </span>
                          )}
                          {isExact && (
                            <span className="inline-flex items-center gap-1 text-[12px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3 text-emerald-700" />
                              Exact Count (Variance 0.00)
                            </span>
                          )}
                        </div>

                        <div className="text-xs text-slate-600 flex items-center gap-3">
                          <span>Cashier: <strong className="text-slate-900">{session.cashierName}</strong></span>
                          <span>•</span>
                          <span>Closed on: {new Date(session.closedAt || session.updatedAt || '').toLocaleString('en-US')}</span>
                          <span>•</span>
                          <span>Receipts issued: <strong>{session.paymentCount}</strong></span>
                        </div>
                      </div>

                      {/* Cash Breakdown Grid */}
                      <div className="grid grid-cols-3 gap-3 bg-slate-50 border border-slate-200/80 rounded-xl p-3 text-center min-w-[320px]">
                        <div>
                          <div className="text-[11px] uppercase font-semibold text-slate-400">OPENING FLOAT</div>
                          <div className="text-xs font-bold text-slate-800">{formatMoney(session.openingBalanceUSD)}</div>
                        </div>

                        <div>
                          <div className="text-[11px] uppercase font-semibold text-slate-400">Expected Amount</div>
                          <div className="text-xs font-bold text-slate-900">{formatMoney(session.expectedCashUSD)}</div>
                        </div>

                        <div>
                          <div className="text-[11px] uppercase font-semibold text-slate-400">ACTUAL COUNTED</div>
                          <div className={`text-xs font-bold ${
                            isShortage ? 'text-red-700' : isSurplus ? 'text-blue-700' : 'text-emerald-700'
                          }`}>
                            {formatMoney(session.countedCashUSD)}
                          </div>
                        </div>
                      </div>

                      {/* Action Button */}
                      <div className="flex items-center gap-2">
                        {canApprove && (
                          <button
                            onClick={() => {
                              setSessionActionError(null);
                              setSelectedSessionForApproval(session);
                              setSupervisorNotes('');
                            }}
                            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl shadow-xs transition-colors whitespace-nowrap"
                          >
                            <UserCheck className="w-3.5 h-3.5" />
                            Review & Supervisor Sign-off
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Explanations if variance exists */}
                    {session.varianceExplanation && (
                      <div className="mt-3 text-xs bg-amber-50/80 border border-amber-200 rounded-lg p-2.5 text-amber-900 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
                        <div>
                          <span className="font-bold">Cashier discrepancy note: </span>
                          {session.varianceExplanation}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: CASH IN CUSTODY & TREASURY DEPOSIT */}
      {activeTab === 'custody' && (
        <div className="space-y-6">
          
          {/* Custody summary callout */}
          <div className="bg-emerald-50/70 border border-emerald-200 rounded-2xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
                <Vault className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-emerald-950">
                  Physical Cash in Vault Custody
                </h3>
                <p className="text-xs text-emerald-900 mt-0.5">
                  These funds originate from closed cashier sessions verified and signed off by a supervisor. They remain in custody until the official bank deposit (BCC or Rawbank) is executed and confirmed with a bank deposit slip.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-right">
                <div className="text-xl font-extrabold text-emerald-950">{formatMoney(totalInCustodyUSD)}</div>
              </div>

              {canDeposit && inCustodySessions.length > 0 && (
                <button
                  onClick={() => openTreasuryDepositModal()}
                  className="px-4 py-2.5 text-xs font-bold text-white bg-emerald-800 hover:bg-emerald-900 rounded-xl shadow-xs transition-colors whitespace-nowrap"
                >
                  Execute Deposit ({inCustodySessions.length})
                </button>
              )}
            </div>
          </div>

          {/* Running Totals Per Cashier Table */}
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
              <div className="font-bold text-sm text-slate-800 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                Breakdown of Vault Cash in Custody by Cashier
              </div>
              <span className="text-xs text-slate-500">
                {inCustodySessions.length} shift(s) secured in vault
              </span>
            </div>

            {inCustodySessions.length === 0 ? (
              <div className="p-12 text-center">
                <CheckCircle2 className="w-10 h-10 text-slate-400 mx-auto mb-2" />
                <h4 className="text-sm font-bold text-slate-700">No funds currently in vault custody</h4>
                <p className="text-xs text-slate-500 mt-1">
                  All approved shift collections have already been deposited to the Public Treasury or bank.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="premium-table w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4">Session N°</th>
                      <th className="py-3 px-4">Cashier & Station</th>
                      <th className="py-3 px-4">Approval Date</th>
                      <th className="py-3 px-4">Supervisor</th>
                      <th className="py-3 px-4 text-right">Amount USD</th>
                      <th className="py-3 px-4 text-center">Custody Status</th>
                      <th className="py-3 px-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {inCustodySessions.map((s) => {
                      const amountUSD = s.countedCashUSD !== undefined ? s.countedCashUSD : (s.expectedCashUSD || 0);

                      return (
                        <tr key={s.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="py-3 px-4 font-mono font-bold text-slate-900">
                            {s.sessionNumber}
                          </td>
                          <td className="py-3 px-4">
                            <div className="font-semibold text-slate-900">{s.cashierName}</div>
                            <div className="text-[12px] text-slate-500">{s.stationOffice}</div>
                          </td>
                          <td className="py-3 px-4 text-slate-500">
                            {s.approvedAt ? new Date(s.approvedAt).toLocaleDateString('en-US') : '-'}
                          </td>
                          <td className="py-3 px-4 font-medium text-slate-800">
                            {s.approvedByName || 'Supervisor'}
                          </td>
                          <td className="py-3 px-4 text-right font-bold text-slate-900">
                            {formatMoney(amountUSD)}
                          </td>
                          <td className="py-3 px-4 text-center">
                            <span className="inline-flex items-center gap-1 text-[12px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                              <Lock className="w-3 h-3 text-emerald-700" />
                              In Custody (Vault)
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            {canDeposit && (
                              <button
                                onClick={() => openTreasuryDepositModal([s.id])}
                                className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 hover:text-emerald-900 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-2.5 py-1 rounded-lg transition-colors"
                              >
                                Deposit to Treasury
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: OPEN SESSIONS (ACTIVE DRAWERS) */}
      {activeTab === 'open' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-blue-50/60 border border-blue-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-800 flex items-center justify-center shrink-0 mt-0.5">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-blue-950">
                  Active Cashier Drawer Tracking
                </h3>
                <p className="text-xs text-blue-900 mt-0.5">
                  Real-time view of active on-duty cashiers. Every payment collected updates the active cashier shift in real time. At the end of the day, the cashier performs cash-up for shift closure.
                </p>
              </div>
            </div>

            {canOpenShift && (
              <button
                onClick={() => { setSessionActionError(null); setIsOpenShiftModalOpen(true); }}
                className="px-3.5 py-2 text-xs font-bold text-white bg-blue-800 hover:bg-blue-900 rounded-lg shadow-xs transition-colors shrink-0"
              >
                + Open Shift
              </button>
            )}
          </div>

          {openSessions.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
              <Clock className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <h4 className="text-base font-bold text-slate-900">No active counters currently open</h4>
              <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
                No cashier shift is currently active. Cashiers must open their shift with their initial drawer float upon starting duty.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {openSessions.map((s) => (
                <div key={s.id} className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between space-y-4">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold text-slate-800">{s.sessionNumber}</span>
                      <span className="inline-flex items-center gap-1 text-[12px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse"></span>
                        Active
                      </span>
                    </div>

                    <div className="mt-2.5">
                      <div className="text-sm font-bold text-slate-900">{s.cashierName}</div>
                      <div className="text-xs text-slate-500">{s.stationOffice}</div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <div className="text-[11px] text-slate-400 font-semibold uppercase">OPENING FLOAT</div>
                        <div className="font-bold text-slate-800">{formatMoney(s.openingBalanceUSD)}</div>
                      </div>

                      <div>
                        <div className="text-[11px] text-slate-400 font-semibold uppercase">Shift Collections</div>
                        <div className="font-bold text-emerald-700">{formatMoney(s.totalPaymentsCashUSD)}</div>
                        <div className="text-[11px] text-emerald-600 font-medium">{s.paymentCount} receipt(s)</div>
                      </div>
                    </div>

                    <div className="mt-2 text-[12px] text-slate-400">
                      Started: {new Date(s.openedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                    <button
                      onClick={() => onNavigateToPayments?.()}
                      className="text-xs text-slate-600 hover:text-slate-900 font-semibold transition-colors"
                    >
                      View payments &rarr;
                    </button>

                    <button
                      onClick={() => {
                        setSessionActionError(null);
                        setSessionToClose(s);
                        // Deliberately NOT pre-filled with opening + collected:
                        // that is the figure the count is meant to test, and
                        // seeding it made every shift reconcile to zero variance
                        // as soon as the officer pressed Confirm. An empty field
                        // forces an actual count.
                        setCountedUSDInput('');
                        setClosingNotesInput('');
                        setVarianceExplanationInput('');
                      }}
                      className="px-3 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-xs transition-colors"
                    >
                      Close Shift
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB 4: TREASURY DEPOSITS ARCHIVE */}
      {activeTab === 'deposits' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-indigo-50/60 border border-indigo-200 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-100 text-indigo-800 flex items-center justify-center shrink-0 mt-0.5">
                <Landmark className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-indigo-950">
                  Treasury & Bank Deposits Log
                </h3>
                <p className="text-xs text-indigo-900 mt-0.5">
                  Official log of physical deposits to the Central Bank of Congo (BCC) or partner banking institutions, secured with verified bank deposit slips.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
            {deposits.length === 0 ? (
              <div className="p-12 text-center">
                <Landmark className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <h4 className="text-sm font-bold text-slate-700">No bank deposits recorded</h4>
                <p className="text-xs text-slate-500 mt-1">
                  Completed treasury deposits will appear here with bank deposit slip references.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="premium-table w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="py-3 px-4">Deposit Ref</th>
                      <th className="py-3 px-4">Deposit Date</th>
                      <th className="py-3 px-4">Banking Institution</th>
                      <th className="py-3 px-4">Deposit Slip (BVR)</th>
                      <th className="py-3 px-4">Depositor / Escort</th>
                      <th className="py-3 px-4">Supervisor Visa</th>
                      <th className="py-3 px-4 text-right">Amount USD</th>
                      <th className="py-3 px-4 text-center">Linked Shifts</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700">
                    {deposits.map((dep) => (
                      <tr key={dep.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-slate-900">
                          {dep.depositReference}
                        </td>
                        <td className="py-3 px-4 text-slate-600">
                          {new Date(dep.date || dep.depositedAt).toLocaleDateString('en-US')}
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-900">
                          {dep.bankName}
                        </td>
                        <td className="py-3 px-4 font-mono font-bold text-indigo-700">
                          {dep.bankDepositSlipRef}
                        </td>
                        <td className="py-3 px-4 text-slate-700">
                          {dep.depositorName}
                        </td>
                        <td className="py-3 px-4 text-slate-700">
                          {dep.approvingSupervisorName}
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-slate-900">
                          {formatMoney(dep.depositAmountUSD)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className="inline-flex items-center text-[12px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                            {dep.sessionIds?.length || 1} shift(s)
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL 1: SUPERVISOR SIGN-OFF & APPROVAL MODAL */}
      {/* ============================================================ */}
      {selectedSessionForApproval && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-xl w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
            
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center">
                  <UserCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Supervisor Visa & Shift Certification</h3>
                  <p className="text-xs text-slate-500 font-mono">{selectedSessionForApproval.sessionNumber}</p>
                </div>
              </div>
              <button 
                onClick={() => setSelectedSessionForApproval(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {sessionActionError && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium">
                {sessionActionError}
              </div>
            )}

            {/* Reconciliation summary card */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Cashier:</span>
                <span className="font-bold text-slate-900">{selectedSessionForApproval.cashierName}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Assigned Counter:</span>
                <span className="font-medium text-slate-800">{selectedSessionForApproval.stationOffice}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Shift Timestamps:</span>
                <span className="font-medium text-slate-800">
                  {new Date(selectedSessionForApproval.openedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} &rarr; {new Date(selectedSessionForApproval.closedAt || '').toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>

              <div className="pt-2 border-t border-slate-200 grid grid-cols-2 gap-2 text-xs">
                <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase">Total Expected</div>
                  <div className="text-sm font-bold text-slate-900">{formatMoney(selectedSessionForApproval.expectedCashUSD)}</div>
                </div>

                <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                  <div className="text-[11px] font-semibold text-slate-400 uppercase">Actual Physical Count</div>
                  <div className="text-sm font-bold text-slate-900">{formatMoney(selectedSessionForApproval.countedCashUSD)}</div>
                </div>
              </div>

              {/* Variance display */}
              <div className="pt-2 border-t border-slate-200 flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-600">Calculated Variance (Counted - Expected):</span>
                <span className={`font-mono font-bold text-sm px-2.5 py-0.5 rounded-full ${
                  (selectedSessionForApproval.varianceUSD || 0) < 0 ? 'bg-red-100 text-red-800' :
                  (selectedSessionForApproval.varianceUSD || 0) > 0 ? 'bg-blue-100 text-blue-800' :
                  'bg-emerald-100 text-emerald-800'
                }`}>
                  {(selectedSessionForApproval.varianceUSD || 0) >= 0 ? '+' : ''}{formatMoney(selectedSessionForApproval.varianceUSD || 0)}
                </span>
              </div>

              {selectedSessionForApproval.varianceExplanation && (
                <div className="text-xs bg-amber-50 p-2.5 rounded-lg text-amber-900 border border-amber-200">
                  <strong>Cashier declared explanation:</strong> {selectedSessionForApproval.varianceExplanation}
                </div>
              )}
            </div>

            {/* Supervisor Notes input */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700">
                Supervisor Remarks & Visa
              </label>
              <textarea
                value={supervisorNotes}
                onChange={(e) => setSupervisorNotes(e.target.value)}
                placeholder="Ex: Physical count verified and certified correct. Funds sealed in City Hall vault."
                rows={3}
                className="w-full text-xs rounded-xl border border-slate-300 p-2.5 focus:ring-2 focus:ring-slate-900 focus:outline-none"
              />
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setSelectedSessionForApproval(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleApproveSession}
                disabled={approving}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl shadow-xs transition-colors"
              >
                <CheckCircle2 className="w-4 h-4" />
                {approving ? 'Signing off...' : 'Certify & Place in Custody'}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL 2: TREASURY / BANK DEPOSIT CREATION */}
      {/* ============================================================ */}
      {isDepositModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-xl w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
            
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
                  <Landmark className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">New Treasury / Bank Deposit</h3>
                  <p className="text-xs text-slate-500">Official transfer of physical funds in vault custody to the municipal account</p>
                </div>
              </div>
              <button 
                onClick={() => setIsDepositModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {depositError && (
              <div className="text-xs bg-red-50 text-red-800 border border-red-200 p-3 rounded-xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{depositError}</span>
              </div>
            )}

            <form onSubmit={handleExecuteTreasuryDeposit} className="space-y-4">
              
              {/* Sessions Selector */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-700">
                  Select Vault Custody Cash Sessions to Deposit:
                </label>
                <div className="max-h-36 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-xl p-1 bg-slate-50/50">
                  {inCustodySessions.map((s) => {
                    const isSelected = selectedSessionIdsForDeposit.includes(s.id);
                    const amountUSD = s.countedCashUSD !== undefined ? s.countedCashUSD : (s.expectedCashUSD || 0);

                    return (
                      <div 
                        key={s.id}
                        onClick={() => toggleSessionDepositSelection(s.id)}
                        className={`p-2 rounded-lg flex items-center justify-between cursor-pointer transition-colors text-xs ${
                          isSelected ? 'bg-emerald-50 text-emerald-950 font-medium' : 'hover:bg-slate-100 text-slate-700'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-emerald-700 shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400 shrink-0" />
                          )}
                          <span className="font-mono font-bold">{s.sessionNumber}</span>
                          <span className="text-slate-500">({s.cashierName})</span>
                        </div>

                        <div className="text-right">
                          <span className="font-bold">{formatMoney(amountUSD)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Total To Deposit Box */}
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-950">
                  Selected Total ({depositModalSelectedTotals.count} sessions):
                </span>
                <div className="text-right">
                  <div className="text-base font-extrabold text-emerald-950">
                    {formatMoney(depositModalSelectedTotals.usd)}
                  </div>
                </div>
              </div>

              {/* Bank Name */}
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">
                  Receiving Bank / Treasury Institution *
                </label>
                <select
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  className="w-full text-xs rounded-xl border border-slate-300 p-2.5 bg-white font-medium focus:ring-2 focus:ring-slate-900 focus:outline-none"
                >
                  <option value="Banque Centrale du Congo (BCC) - Provincial Directorate Goma">
                    Central Bank of Congo (BCC) - Urban Treasury Account
                  </option>
                  <option value="Rawbank Goma - Main Branch Lake Kivu">
                    Rawbank Goma - Lake Kivu Main Branch
                  </option>
                  <option value="Equity BCDC - City Center Branch Goma">
                    Equity BCDC - Downtown Goma Branch
                  </option>
                  <option value="General Urban Treasury Cash Desk - City Hall">
                    General Urban Treasury Cash Desk - City Hall
                  </option>
                </select>
              </div>

              {/* Slip Ref & Depositor */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-700">
                    Bank Deposit Slip Number (BVR) *
                  </label>
                  <input
                    type="text"
                    required
                    value={slipRef}
                    onChange={(e) => setSlipRef(e.target.value)}
                    placeholder="e.g.: BVR-BCC-948102"
                    className="w-full text-xs font-mono font-bold rounded-xl border border-slate-300 p-2.5 focus:ring-2 focus:ring-slate-900 focus:outline-none"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-700">
                    Depositor / Escort Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={depositorName}
                    onChange={(e) => setDepositorName(e.target.value)}
                    placeholder="Name of officer making the deposit"
                    className="w-full text-xs rounded-xl border border-slate-300 p-2.5 focus:ring-2 focus:ring-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              {/* Date & Notes */}
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">
                  Effective Deposit Date
                </label>
                <input
                  type="date"
                  required
                  value={depositDate}
                  onChange={(e) => setDepositDate(e.target.value)}
                  className="w-full text-xs rounded-xl border border-slate-300 p-2.5 focus:ring-2 focus:ring-slate-900 focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">
                  Remarks / Additional References
                </label>
                <textarea
                  value={depositNotes}
                  onChange={(e) => setDepositNotes(e.target.value)}
                  placeholder="Notes regarding funds transport or bank slip..."
                  rows={2}
                  className="w-full text-xs rounded-xl border border-slate-300 p-2.5 focus:ring-2 focus:ring-slate-900 focus:outline-none"
                />
              </div>

              {/* Submit Controls */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsDepositModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  disabled={depositing || depositModalSelectedTotals.count === 0}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-emerald-800 hover:bg-emerald-900 rounded-xl shadow-xs transition-colors disabled:opacity-50"
                >
                  <Landmark className="w-4 h-4" />
                  {depositing ? 'Recording deposit...' : 'Confirm Bank Deposit'}
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL 3: OPEN CASH SHIFT MODAL */}
      {/* ============================================================ */}
      {isOpenShiftModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-800 flex items-center justify-center">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Open Cashier Shift</h3>
                  <p className="text-xs text-slate-500">Take duty and register opening drawer float</p>
                </div>
              </div>
              <button 
                onClick={() => setIsOpenShiftModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleOpenShift} className="space-y-3.5">
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">
                  Assigned Counter / Station *
                </label>
                <select
                  value={openStation}
                  onChange={(e) => setOpenStation(e.target.value)}
                  className="w-full text-xs rounded-xl border border-slate-300 p-2.5 bg-white font-medium focus:ring-2 focus:ring-slate-900 focus:outline-none"
                >
                  <option value="Central Counter - City Hall">Central Counter - City Hall</option>
                  <option value="Karisimbi Commune Counter">Karisimbi Commune Counter</option>
                  <option value="Les Volcans Express Station">Les Volcans Express Station</option>
                  <option value="Antenne Fiscale Quartier Katindo">Katindo Tax Office</option>
                  <option value="Grande Barriere Border Post">Grande Barriere Border Post</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">
                  Opening Float (USD)
                </label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={openFloatUSD}
                  onChange={(e) => setOpenFloatUSD(e.target.value)}
                  placeholder="0.00"
                  className="w-full text-xs font-bold rounded-xl border border-slate-300 p-2.5 focus:ring-2 focus:ring-slate-900 focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">
                  Opening Notes
                </label>
                <input
                  type="text"
                  value={openNotes}
                  onChange={(e) => setOpenNotes(e.target.value)}
                  placeholder="Drawer change verified..."
                  className="w-full text-xs rounded-xl border border-slate-300 p-2.5 focus:ring-2 focus:ring-slate-900 focus:outline-none"
                />
              </div>

              {sessionActionError && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium">
                  {sessionActionError}
                </div>
              )}

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsOpenShiftModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={openingShift}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl shadow-xs transition-colors"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {openingShift ? 'Opening...' : 'Open Cash Drawer'}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL 4: CLOSE CASH SHIFT (END OF DAY CASH-UP) */}
      {/* ============================================================ */}
      {sessionToClose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-lg w-full p-6 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Close Cash Shift (End-of-Day)</h3>
                  <p className="text-xs text-slate-500 font-mono">{sessionToClose.sessionNumber}</p>
                </div>
              </div>
              <button 
                onClick={() => setSessionToClose(null)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCloseShift} className="space-y-4">
              
              {/* Expected cash banner */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs">
                <div>
                  <div className="text-[11px] text-slate-400 font-semibold uppercase">Total Expected USD</div>
                  <div className="text-base font-bold text-slate-900">
                    {formatMoney((sessionToClose.openingBalanceUSD || 0) + (sessionToClose.totalPaymentsCashUSD || 0))}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Float: {formatMoney(sessionToClose.openingBalanceUSD)} + Collections: {formatMoney(sessionToClose.totalPaymentsCashUSD)} · Receipts: {sessionToClose.paymentCount}
                  </div>
                </div>
              </div>

              {/* Physical count input */}
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">
                  Actual Cash Counted (USD) *
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  value={countedUSDInput}
                  onChange={(e) => setCountedUSDInput(e.target.value)}
                  className="w-full text-sm font-bold rounded-xl border border-slate-300 p-2.5 focus:ring-2 focus:ring-slate-900 focus:outline-none"
                />
              </div>

              {/* Variance Indicator */}
              {(() => {
                const expectedUSD = (sessionToClose.openingBalanceUSD || 0) + (sessionToClose.totalPaymentsCashUSD || 0);
                // Same parser as the close itself, so the preview never disagrees
                // with what is filed ("1,250" previewed as 1.00 here while the
                // close recorded 1 250).
                const countedParsed = parseAmount(countedUSDInput);
                const countedUSD = Number.isFinite(countedParsed) ? countedParsed : 0;
                // The same rounding the close files, so the preview never
                // disagrees with the record: `Math.round(x * 100) / 100` rounds
                // a true half-cent down whenever the binary product lands a
                // hair under .5.
                const varianceUSD = roundMoney(countedUSD - expectedUSD);
                const varianceKind = classifyCashVariance(varianceUSD);

                return (
                  <div className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
                    varianceKind === 'shortage' ? 'bg-red-50 border-red-200 text-red-900' :
                    varianceKind === 'surplus' ? 'bg-blue-50 border-blue-200 text-blue-900' :
                    'bg-emerald-50 border-emerald-200 text-emerald-900'
                  }`}>
                    <span className="font-semibold">Calculated Cash Discrepancy:</span>
                    <span className="font-mono font-bold text-sm">
                      {varianceUSD >= 0 ? '+' : ''}{formatMoney(varianceUSD)}
                    </span>
                  </div>
                );
              })()}

              {/* Variance reason if not zero */}
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">
                  Discrepancy Justification (if applicable)
                </label>
                <input
                  type="text"
                  value={varianceExplanationInput}
                  onChange={(e) => setVarianceExplanationInput(e.target.value)}
                  placeholder="e.g.: Damaged bill rejected, change rounding error..."
                  className="w-full text-xs rounded-xl border border-slate-300 p-2.5 focus:ring-2 focus:ring-slate-900 focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-700">
                  Closing Notes
                </label>
                <input
                  type="text"
                  value={closingNotesInput}
                  onChange={(e) => setClosingNotesInput(e.target.value)}
                  placeholder="Sealed envelope ref..."
                  className="w-full text-xs rounded-xl border border-slate-300 p-2.5 focus:ring-2 focus:ring-slate-900 focus:outline-none"
                />
              </div>

              {sessionActionError && (
                <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium">
                  {sessionActionError}
                </div>
              )}

              <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setSessionToClose(null)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={closingShift}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-slate-800 rounded-xl shadow-xs transition-colors"
                >
                  <Lock className="w-4 h-4" />
                  {closingShift ? 'Closing shift...' : 'Submit for Supervisor Sign-off'}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

    </div>
  );
};
