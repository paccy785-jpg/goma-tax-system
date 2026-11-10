import React, { useEffect, useState } from 'react';
import { 
  Building2, 
  DollarSign, 
  Clock, 
  ArrowUpRight, 
  ShieldCheck, 
  CheckCircle2, 
  AlertTriangle, 
  TrendingUp, 
  RefreshCw,
  Receipt,
  Eye,
  Calendar
} from 'lucide-react';
import { NavigationItem, UserRole, normalizeAssessmentStatus, normalizeBusinessStatus, normalizeApprovalStatus, Payment, Assessment } from '../types';
import { getBusinesses, getAssessments, getPayments, getDashboardAggregateCounts } from '../services/dbService';
import { getApprovalRequests } from '../services/approvalService';
import { emitGlobalToast } from '../contexts/ToastContext';
import { localDateFromIsoTimestamp, toLocalDateString } from '../utils/date';
import { PageHeader, Button, Badge, Panel, MetricStrip, Skeleton, TableSkeleton } from './ui';
import { formatMoney } from '../utils/money';
import { BRAND } from '../branding';

interface DashboardViewProps {
  userRole: UserRole;
  userName: string;
  onNavigate: (view: NavigationItem) => void;
}

interface DashboardMetrics {
  totalBusinesses: number;
  gomaBusinesses: number;
  karisimbiBusinesses: number;
  activeBusinesses: number;
  revenueThisMonthUSD: number;
  monthLabel: string;
  monthTransactionCount: number;
  totalRevenueUSD: number;
  outstandingCount: number;
  outstandingTotalUSD: number;
  overdueCount: number;
  overdueTotalUSD: number;
  pendingApprovalsCount: number;
  paidAssessmentsCount: number;
  pendingAssessmentsCount: number;
  cancelledAssessmentsCount: number;
}

const MONTH_NAMES_EN = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export const DashboardView: React.FC<DashboardViewProps> = ({
  userRole,
  userName,
  onNavigate,
}) => {
  const [loading, setLoading] = useState<boolean>(true);
  const [recentPayments, setRecentPayments] = useState<Payment[]>([]);
  const [monthlyChartData, setMonthlyChartData] = useState<{ label: string; amount: number; isCurrent: boolean }[]>([]);
  const [metrics, setMetrics] = useState<DashboardMetrics>({
    totalBusinesses: 0,
    gomaBusinesses: 0,
    karisimbiBusinesses: 0,
    activeBusinesses: 0,
    revenueThisMonthUSD: 0,
    monthLabel: '',
    monthTransactionCount: 0,
    totalRevenueUSD: 0,
    outstandingCount: 0,
    outstandingTotalUSD: 0,
    overdueCount: 0,
    overdueTotalUSD: 0,
    pendingApprovalsCount: 0,
    paidAssessmentsCount: 0,
    pendingAssessmentsCount: 0,
    cancelledAssessmentsCount: 0,
  });

  const loadRealDashboardData = async () => {
    setLoading(true);
    try {
      const [aggregates, businesses, assessments, allPayments, approvalRequests] = await Promise.all([
        getDashboardAggregateCounts(),
        getBusinesses(),
        getAssessments(),
        getPayments(),
        getApprovalRequests(),
      ]);

      // Fallback path (server count unavailable — e.g. offline): normalize the
      // status instead of raw string equality, which missed 'En attente' and
      // padded spellings, under-reporting the maker-checker queue.
      const pendingReqs = aggregates.pendingApprovalsCount || approvalRequests.filter((r) => normalizeApprovalStatus(r.status) === 'Pending').length;

      // Voided receipts are cancelled payments — never count them as revenue.
      const payments = allPayments.filter((p) => !p.isVoided);

      const totalBiz = Math.max(aggregates.totalBusinesses, businesses.length);
      const gomaBiz = businesses.filter(
        (b) => b.commune === 'Goma' || !b.commune || b.commune.toLowerCase().includes('goma')
      ).length;
      const karisimbiBiz = businesses.filter((b) => b.commune === 'Karisimbi').length;
      const activeBiz = businesses.filter((b) => normalizeBusinessStatus(b.status) === 'Active').length;

      const now = new Date();
      const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const paymentLocalDay = (p: Payment): string => {
        if (p.paymentDate) return p.paymentDate.slice(0, 7);
        if (p.paidAt) return localDateFromIsoTimestamp(p.paidAt).slice(0, 7);
        return '';
      };
      let activeMonthPayments = payments.filter((p) => {
        return paymentLocalDay(p) === currentYearMonth;
      });

      let calculatedMonthLabel = `${MONTH_NAMES_EN[now.getMonth()]} ${now.getFullYear()}`;

      if (activeMonthPayments.length === 0 && payments.length > 0) {
        const sortedDates = payments
          .map((p) => p.paymentDate || (p.paidAt ? localDateFromIsoTimestamp(p.paidAt) : ''))
          .filter(Boolean)
          .sort()
          .reverse();

        if (sortedDates.length > 0) {
          const latest = sortedDates[0];
          const [y, m] = latest.split('-');
          const mIdx = parseInt(m, 10) - 1;
          const targetPrefix = `${y}-${m}`;
          activeMonthPayments = payments.filter((p) => paymentLocalDay(p) === targetPrefix);
          calculatedMonthLabel = `${MONTH_NAMES_EN[mIdx] || m} ${y}`;
        }
      }

      const revMonthUSD = activeMonthPayments.reduce((sum, p) => sum + (p.amountPaidUSD || 0), 0);
      const totalRevUSD = payments.reduce((sum, p) => sum + (p.amountPaidUSD || 0), 0);

      const todayStr = toLocalDateString(now);
      const outstandingAssessments = assessments.filter((a) => {
        const s = normalizeAssessmentStatus(a.status);
        if (s === 'Paid' || s === 'Cancelled') {
          return false;
        }
        const remaining = typeof a.remainingBalanceUSD === 'number'
          ? a.remainingBalanceUSD
          : Math.max(0, (a.amountDueUSD || 0) - (a.amountPaidUSD || 0));
        return remaining > 0.001;
      });

      const outCount = outstandingAssessments.length;
      const outTotalUSD = outstandingAssessments.reduce((sum, a) => {
        const rem = typeof a.remainingBalanceUSD === 'number'
          ? a.remainingBalanceUSD
          : Math.max(0, (a.amountDueUSD || 0) - (a.amountPaidUSD || 0));
        return sum + rem;
      }, 0);

      const overdueAssessments = outstandingAssessments.filter(
        (a) => normalizeAssessmentStatus(a.status) === 'Overdue' || (a.dueDate && a.dueDate < todayStr)
      );

      const ovCount = overdueAssessments.length;
      const ovTotalUSD = overdueAssessments.reduce((sum, a) => {
        const rem = typeof a.remainingBalanceUSD === 'number'
          ? a.remainingBalanceUSD
          : Math.max(0, (a.amountDueUSD || 0) - (a.amountPaidUSD || 0));
        return sum + rem;
      }, 0);

      const paidCount = assessments.filter((a) => normalizeAssessmentStatus(a.status) === 'Paid').length;
      const pendingCount = outCount - ovCount;
      const cancelledCount = assessments.filter((a) => normalizeAssessmentStatus(a.status) === 'Cancelled').length;

      setMetrics({
        totalBusinesses: totalBiz,
        gomaBusinesses: gomaBiz,
        karisimbiBusinesses: karisimbiBiz,
        activeBusinesses: activeBiz,
        revenueThisMonthUSD: revMonthUSD,
        monthLabel: calculatedMonthLabel,
        monthTransactionCount: activeMonthPayments.length,
        totalRevenueUSD: totalRevUSD,
        outstandingCount: outCount,
        outstandingTotalUSD: outTotalUSD,
        overdueCount: ovCount,
        overdueTotalUSD: ovTotalUSD,
        pendingApprovalsCount: pendingReqs,
        paidAssessmentsCount: paidCount,
        pendingAssessmentsCount: Math.max(0, pendingCount),
        cancelledAssessmentsCount: cancelledCount,
      });

      // Recent 5 payments (newest first by local service day)
      const sortedRecent = [...payments].sort((a, b) =>
        (b.paymentDate || localDateFromIsoTimestamp(b.paidAt || '')).localeCompare(
          a.paymentDate || localDateFromIsoTimestamp(a.paidAt || ''))
      );
      setRecentPayments(sortedRecent.slice(0, 5));

      // Build 6-month historical chart bars
      const monthsBack: { label: string; key: string; amount: number; isCurrent: boolean }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const label = MONTH_NAMES_EN[d.getMonth()].slice(0, 3);
        const monthRev = payments
          .filter((p) => paymentLocalDay(p) === key)
          .reduce((sum, p) => sum + (p.amountPaidUSD || 0), 0);
        monthsBack.push({
          label,
          key,
          amount: monthRev,
          isCurrent: i === 0,
        });
      }
      setMonthlyChartData(monthsBack);

    } catch (err: any) {
      console.error('[Dashboard real data load error]', err);
      emitGlobalToast(`Failed to load dashboard metrics: ${err?.message || 'Database error'}`, 'error', 'Database Error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRealDashboardData();
  }, []);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  const getTodayEyebrow = () => {
    const now = new Date();
    return now.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).toUpperCase();
  };

  const firstName = userName ? userName.split(' ')[0] : 'Officer';

  // Portfolio total for health breakdown
  const portfolioTotal = 
    metrics.paidAssessmentsCount + 
    metrics.pendingAssessmentsCount + 
    metrics.overdueCount + 
    metrics.cancelledAssessmentsCount || 1;

  const pctPaid = Math.round((metrics.paidAssessmentsCount / portfolioTotal) * 100);
  const pctPending = Math.round((metrics.pendingAssessmentsCount / portfolioTotal) * 100);
  const pctOverdue = Math.round((metrics.overdueCount / portfolioTotal) * 100);
  const pctCancelled = Math.round((metrics.cancelledAssessmentsCount / portfolioTotal) * 100);

  const maxChartAmount = Math.max(...monthlyChartData.map((d) => d.amount), 500);

  return (
    <div className="space-y-8 font-sans">
      
      {/* Page Header */}
      <PageHeader
        eyebrow={getTodayEyebrow()}
        title={`${getGreeting()}, ${firstName}.`}
        description={`${BRAND.shortName} revenue command center for commercial patente licenses across Goma and Karisimbi.`}
      />

      {/* Metric Strip (4 columns divided by thin line borders) */}
      <MetricStrip
        columns={4}
        items={[
          {
            // Show the period the figure actually covers: when the current
            // month has no receipts yet the metric falls back to the latest
            // month with data — the old hardcoded "This Month" label displayed
            // last month's revenue as if it were this month's.
            label: `Collected — ${metrics.monthLabel || 'This Month'}`,
            value: loading ? '...' : `${formatMoney(metrics.revenueThisMonthUSD)}`,
            trend: `${metrics.monthTransactionCount} receipts`,
            trendType: 'sage',
            subline: 'Tendered in USD',
            icon: <DollarSign className="w-4 h-4 text-sage" />,
          },
          {
            label: 'Active Businesses',
            value: loading ? '...' : metrics.activeBusinesses.toLocaleString('en-US'),
            trend: `${metrics.totalBusinesses} registered`,
            trendType: 'muted',
            subline: `${metrics.gomaBusinesses} Goma • ${metrics.karisimbiBusinesses} Karisimbi`,
            icon: <Building2 className="w-4 h-4 text-accent" />,
          },
          {
            label: 'Outstanding Balance',
            value: loading ? '...' : `${formatMoney(metrics.outstandingTotalUSD)}`,
            trend: metrics.overdueCount > 0 ? `${metrics.overdueCount} overdue` : 'No arrears',
            trendType: metrics.overdueCount > 0 ? 'danger' : 'sage',
            subline: `${metrics.outstandingCount} notices pending`,
            icon: <Clock className="w-4 h-4 text-warn" />,
          },
          {
            label: 'Open Approvals',
            value: loading ? '...' : metrics.pendingApprovalsCount.toString(),
            trend: metrics.pendingApprovalsCount > 0 ? 'Awaiting audit' : 'Queue clear',
            trendType: metrics.pendingApprovalsCount > 0 ? 'warn' : 'sage',
            subline: 'Maker-Checker gate',
            icon: <ShieldCheck className="w-4 h-4 text-muted" />,
          },
        ]}
      />

      {/* 2-Column Grid: Monthly Collection Bar Chart + Portfolio Health Donut */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        {/* Panel 1: Monthly Collection Bar Chart */}
        <Panel
          title="Revenue Collection Trend"
          subtitle="Monthly revenue in USD across last 6 months (accent-soft bars, current month in solid accent)"
          actions={
            <Button variant="ghost" size="sm" onClick={() => onNavigate('reports')}>
              Full Reports
            </Button>
          }
        >
          {loading ? (
            <Skeleton className="h-44 w-full" />
          ) : (
            <div className="pt-4">
              <div className="h-44 flex items-end justify-between gap-3 px-2 border-b border-line pb-2">
                {monthlyChartData.map((d, idx) => {
                  const heightPercent = Math.max(12, Math.round((d.amount / maxChartAmount) * 100));
                  return (
                    <div key={idx} className="flex-1 flex flex-col items-center gap-2 h-full justify-end group">
                      <div className="text-[11px] font-bold text-muted tabular-nums opacity-0 group-hover:opacity-100 transition-premium">
                        {formatMoney(d.amount)}
                      </div>
                      <div
                        style={{ height: `${heightPercent}%` }}
                        className={`w-full max-w-[42px] rounded-t-[8px] transition-premium ${
                          d.isCurrent
                            ? 'bg-accent shadow-[0_4px_12px_oklch(57%_0.16_36/0.3)]'
                            : 'bg-accent-soft hover:bg-accent/40'
                        }`}
                      />
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between gap-3 px-2 pt-2 text-[12px] font-bold text-muted uppercase tracking-wider">
                {monthlyChartData.map((d, idx) => (
                  <span
                    key={idx}
                    className={`flex-1 text-center truncate ${d.isCurrent ? 'text-accent font-extrabold' : ''}`}
                  >
                    {d.label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Panel>

        {/* Panel 2: Portfolio Health */}
        <Panel
          title="Tax Portfolio Health"
          subtitle="Distribution of issued patente assessments by current fiscal status"
        >
          {loading ? (
            <Skeleton className="h-44 w-full" />
          ) : (
            <div className="pt-2 space-y-4">
              {/* Stacked Progress Bar */}
              <div className="h-3 w-full rounded-full bg-surface2 overflow-hidden flex shadow-inner">
                <div style={{ width: `${pctPaid}%` }} className="bg-sage transition-premium" title={`Paid: ${pctPaid}%`} />
                <div style={{ width: `${pctPending}%` }} className="bg-warn transition-premium" title={`Pending: ${pctPending}%`} />
                <div style={{ width: `${pctOverdue}%` }} className="bg-danger transition-premium" title={`Overdue: ${pctOverdue}%`} />
                <div style={{ width: `${pctCancelled}%` }} className="bg-line transition-premium" title={`Cancelled: ${pctCancelled}%`} />
              </div>

              {/* Status Breakdown Legend Rows */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="p-3 rounded-[12px] bg-surface2/60 border border-line flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-sage shrink-0" />
                    <span className="text-xs font-medium text-ink">Paid & Acquitted</span>
                  </div>
                  <span className="font-display font-bold text-sm text-ink tabular-nums">
                    {metrics.paidAssessmentsCount} <span className="text-[11px] text-muted font-normal">({pctPaid}%)</span>
                  </span>
                </div>

                <div className="p-3 rounded-[12px] bg-surface2/60 border border-line flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-warn shrink-0" />
                    <span className="text-xs font-medium text-ink">Pending Payment</span>
                  </div>
                  <span className="font-display font-bold text-sm text-ink tabular-nums">
                    {metrics.pendingAssessmentsCount} <span className="text-[11px] text-muted font-normal">({pctPending}%)</span>
                  </span>
                </div>

                <div className="p-3 rounded-[12px] bg-surface2/60 border border-line flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-danger shrink-0" />
                    <span className="text-xs font-medium text-ink">In Arrears (Overdue)</span>
                  </div>
                  <span className="font-display font-bold text-sm text-danger tabular-nums">
                    {metrics.overdueCount} <span className="text-[11px] text-muted font-normal">({pctOverdue}%)</span>
                  </span>
                </div>

                <div className="p-3 rounded-[12px] bg-surface2/60 border border-line flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-line shrink-0" />
                    <span className="text-xs font-medium text-muted">Annulled</span>
                  </div>
                  <span className="font-display font-bold text-sm text-muted tabular-nums">
                    {metrics.cancelledAssessmentsCount} <span className="text-[11px] text-muted font-normal">({pctCancelled}%)</span>
                  </span>
                </div>
              </div>
            </div>
          )}
        </Panel>

      </div>

      {/* Recent Receipts Table Panel */}
      <Panel
        title="Recent Tax Receipts"
        subtitle="Latest revenue payments collected and issued through municipal cash desks"
        actions={
          <Button variant="ghost" size="sm" onClick={() => onNavigate('payments')}>
            View Full Ledger
          </Button>
        }
        padding="none"
      >
        {loading ? (
          <TableSkeleton rows={5} cols={5} />
        ) : recentPayments.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted">
            No tax payments recorded yet this fiscal term.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse font-sans">
              <thead>
                <tr className="border-b border-line bg-surface2/40">
                  <th className="text-[11px] font-bold uppercase tracking-[0.1em] text-faint px-6 py-3.5">
                    Receipt #
                  </th>
                  <th className="text-[11px] font-bold uppercase tracking-[0.1em] text-faint px-6 py-3.5">
                    Business / Taxpayer
                  </th>
                  <th className="text-[11px] font-bold uppercase tracking-[0.1em] text-faint px-6 py-3.5">
                    Date & Cashier
                  </th>
                  <th className="text-[11px] font-bold uppercase tracking-[0.1em] text-faint px-6 py-3.5 text-right">
                    Amount Tendered
                  </th>
                  <th className="text-[11px] font-bold uppercase tracking-[0.1em] text-faint px-6 py-3.5 text-center">
                    Status
                  </th>
                  <th className="text-[11px] font-bold uppercase tracking-[0.1em] text-faint px-6 py-3.5 text-right">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {recentPayments.map((p) => {
                  const initial = (p.businessName || p.taxpayerName || 'P').charAt(0).toUpperCase();
                  const isPartial = p.paymentType === 'partial' || p.isPartial;

                  return (
                    <tr key={p.id} className="hover:bg-surface2/30 transition-premium">
                      <td className="px-6 py-4 font-mono text-xs font-bold text-ink tabular-nums">
                        {p.receiptNumber}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-[30px] h-[30px] rounded-[8px] bg-accent-soft text-accent font-display font-bold text-xs flex items-center justify-center shrink-0">
                            {initial}
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-ink truncate">
                              {p.businessName || p.taxpayerName}
                            </div>
                            <div className="text-[12px] text-muted truncate">
                              Notice #{p.assessmentNumber || 'PAT-2026'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-xs text-ink tabular-nums">
                          {p.paymentDate || localDateFromIsoTimestamp(p.paidAt)}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="font-display text-sm font-bold text-ink tabular-nums">
                          {formatMoney(p.amountPaidUSD)}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        {p.isVoided ? (
                          <Badge variant="danger">Voided</Badge>
                        ) : isPartial ? (
                          <Badge variant="warn">Partial</Badge>
                        ) : (
                          <Badge variant="sage">Paid Full</Badge>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onNavigate('payments')}
                          icon={<Eye className="w-3.5 h-3.5" />}
                        >
                          View
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

    </div>
  );
};
