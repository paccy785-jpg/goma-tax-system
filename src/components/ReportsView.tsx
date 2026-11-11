import React, { useState, useEffect, useMemo } from 'react';
import { 
  BarChart3, 
  TrendingUp, 
  Download, 
  Building2, 
  PieChart, 
  Calendar,
  Printer,
  MapPin,
  AlertTriangle,
  Receipt,
  Users,
  RefreshCw,
  FileSpreadsheet,
  ChevronDown,
  CheckCheck,
  Info,
  Layers,
  ArrowUpDown,
  ExternalLink
} from 'lucide-react';
import { UserRole, BusinessSector, SECTOR_LABELS, normalizeBusinessStatus } from '../types';
import { todayDateString } from '../utils/date';
import { useRevenueLedger } from '../hooks/useRevenueLedger';
import { 
  computePeriodRevenue,
  computeCommuneRevenue,
  computeSectorRevenue,
  computeTaxTypeRevenue,
  computeComplianceSummary,
  exportPeriodRevenueCSV,
  exportCommuneRevenueCSV,
  exportSectorRevenueCSV,
  exportTaxTypeRevenueCSV,
  exportComplianceCSV,
  DailyRevenueItem,
  MonthlyRevenueItem,
  YearlyRevenueItem,
  CommuneRevenueItem,
  SectorRevenueItem,
  TaxTypeRevenueItem,
  ComplianceSummary,
  CashierDailyShiftItem
} from '../services/reportsService';
import { PageHeader, Button, Badge, Panel, MetricStrip } from './ui';
import { formatMoney } from '../utils/money';

interface ReportsViewProps {
  userRole: UserRole;
}

type ReportTab = 'period' | 'commune' | 'sector' | 'compliance';

/** YYYY-MM-DD → DD/MM/YYYY, read as a calendar date. */
const dayLabel = (d: string) => d.split('-').reverse().join('/');

const percentageLabel = (n: number | null) => n === null ? '—' : `${n.toFixed(1)}%`;

const MONTH_NAMES: Record<string, string> = {
  '01': 'January', '02': 'February', '03': 'March', '04': 'April', '05': 'May', '06': 'June',
  '07': 'July', '08': 'August', '09': 'September', '10': 'October', '11': 'November', '12': 'December',
};

/** "November 2026", as two pieces so the month name is translated on screen. */
const MonthLabel: React.FC<{ monthKey: string }> = ({ monthKey }) => (
  <>
    {MONTH_NAMES[monthKey.slice(5, 7)] || monthKey.slice(5, 7)} {monthKey.slice(0, 4)}
  </>
);

export const ReportsView: React.FC<ReportsViewProps> = ({ userRole }) => {
  const [activeTab, setActiveTab] = useState<ReportTab>('period');
  const [periodSubTab, setPeriodSubTab] = useState<'daily' | 'monthly' | 'yearly'>('daily');
  const [reloadKey, setReloadKey] = useState(0);
  const { businesses, assessments, payments, loading, error, cached } = useRevenueLedger(reloadKey);
  const reloadData = () => setReloadKey((k) => k + 1);

  // Aggregated analytics
  const periodData = useMemo(() => computePeriodRevenue(payments), [payments]);
  const communeData = useMemo(() => computeCommuneRevenue(payments, businesses, assessments), [payments, businesses, assessments]);
  const sectorData = useMemo(() => computeSectorRevenue(payments, businesses, assessments), [payments, businesses, assessments]);
  const taxTypeData = useMemo(() => computeTaxTypeRevenue(payments, assessments), [payments, assessments]);
  const complianceData = useMemo(() => computeComplianceSummary(businesses, assessments), [businesses, assessments]);

  if (loading || error) return (
    <div className="space-y-4" role="status">
      <PageHeader title="Revenue Reports & Analytics" />
      <p>{error || 'Chargement du registre complet…'}</p>
      {error && <Button onClick={reloadData}>Réessayer</Button>}
    </div>
  );

  return (
    <div className="space-y-8 font-sans">
      {cached && <p role="status" className="p-4 border border-warn rounded-xl">Données locales non confirmées par le serveur : les totaux peuvent être incomplets.</p>}
      
      {/* Page Header */}
      <PageHeader
        eyebrow="Governance"
        title="Revenue Reports & Analytics"
        actions={
          <>
            <Button
              variant="ghost"
              size="md"
              icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
              onClick={reloadData}
              disabled={loading}
            >
              Refresh
            </Button>
            <Button
              variant="ghost"
              size="md"
              icon={<Printer className="w-3.5 h-3.5" />}
              onClick={() => window.print()}
            >
              Print
            </Button>
            <Button
              variant="primary"
              size="md"
              icon={<Download className="w-3.5 h-3.5" />}
              onClick={() => {
                const originalTitle = document.title;
                // Local calendar day for the report stamp — toISOString() is
                // UTC, so between 00:00 and 02:00 (Goma, UTC+2) the exported
                // report carried yesterday's date.
                const dateStamp = todayDateString();
                document.title = `DPRNK-Revenue-Report-${activeTab}-${dateStamp}`;
                window.print();
                setTimeout(() => {
                  document.title = originalTitle;
                }, 500);
              }}
            >
              Export PDF
            </Button>
          </>
        }
      />

      {/* Primary Navigation Tabs */}
      <div className="bg-surface rounded-[14px] border border-line p-1.5 shadow-card overflow-x-auto">
        <nav className="flex space-x-1.5 min-w-max" aria-label="Tabs">
          <button
            id="tab-btn-period"
            type="button"
            onClick={() => setActiveTab('period')}
            className={`flex items-center gap-2 px-3.5 py-2.5 rounded-[10px] text-xs font-semibold transition-premium cursor-pointer ${
              activeTab === 'period'
                ? 'bg-accent text-white shadow-xs font-bold'
                : 'text-muted hover:text-ink hover:bg-surface2'
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>1. Revenue by Period</span>
            <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[11px] font-mono tabular-nums ${
              activeTab === 'period' ? 'bg-white/20 text-white' : 'bg-surface2 text-muted'
            }`}>
              {formatMoney(periodData.totalRevenueUSD)}
            </span>
          </button>

          <button
            id="tab-btn-commune"
            type="button"
            onClick={() => setActiveTab('commune')}
            className={`flex items-center gap-2 px-3.5 py-2.5 rounded-[10px] text-xs font-semibold transition-premium cursor-pointer ${
              activeTab === 'commune'
                ? 'bg-accent text-white shadow-xs font-bold'
                : 'text-muted hover:text-ink hover:bg-surface2'
            }`}
          >
            <MapPin className="w-4 h-4" />
            <span>2. Revenue by Commune</span>
            <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[11px] ${
              activeTab === 'commune' ? 'bg-white/20 text-white' : 'bg-surface2 text-muted'
            }`}>
              Goma & Karisimbi
            </span>
          </button>

          <button
            id="tab-btn-sector"
            type="button"
            onClick={() => setActiveTab('sector')}
            className={`flex items-center gap-2 px-3.5 py-2.5 rounded-[10px] text-xs font-semibold transition-premium cursor-pointer ${
              activeTab === 'sector'
                ? 'bg-accent text-white shadow-xs font-bold'
                : 'text-muted hover:text-ink hover:bg-surface2'
            }`}
          >
            <PieChart className="w-4 h-4" />
            <span>3. Revenue by Sector</span>
            <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[11px] ${
              activeTab === 'sector' ? 'bg-white/20 text-white' : 'bg-surface2 text-muted'
            }`}>
              {sectorData.length} Sectors
            </span>
          </button>

          <button
            id="tab-btn-compliance"
            type="button"
            onClick={() => setActiveTab('compliance')}
            className={`flex items-center gap-2 px-3.5 py-2.5 rounded-[10px] text-xs font-semibold transition-premium cursor-pointer ${
              activeTab === 'compliance'
                ? 'bg-accent text-white shadow-xs font-bold'
                : 'text-muted hover:text-ink hover:bg-surface2'
            }`}
          >
            <AlertTriangle className={`w-4 h-4 ${activeTab === 'compliance' ? 'text-white' : 'text-warn'}`} />
            <span>4. Active vs. Overdue</span>
            <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[11px] font-semibold tabular-nums ${
              activeTab === 'compliance'
                ? 'bg-white/20 text-white'
                : complianceData.delinquentBusinesses > 0
                ? 'bg-warn/15 text-warn border border-warn/30'
                : 'bg-sage/15 text-sage border border-sage/30'
            }`}>
              {complianceData.delinquentBusinesses} Overdue
            </span>
          </button>

        </nav>
      </div>

      {/* TAB 1: REVENUE BY PERIOD */}
      {activeTab === 'period' && (
        <div className="space-y-6">
          {/* Sub-navigation: Daily / Monthly / Yearly */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-700 uppercase">Aggregation Period:</span>
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                <button
                  type="button"
                  onClick={() => setPeriodSubTab('daily')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                    periodSubTab === 'daily'
                      ? 'bg-white text-slate-900 shadow-xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Daily
                </button>
                <button
                  type="button"
                  onClick={() => setPeriodSubTab('monthly')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                    periodSubTab === 'monthly'
                      ? 'bg-white text-slate-900 shadow-xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  onClick={() => setPeriodSubTab('yearly')}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                    periodSubTab === 'yearly'
                      ? 'bg-white text-slate-900 shadow-xs font-bold'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Annual
                </button>
              </div>
            </div>

            <button
              id="export-period-csv-btn"
              type="button"
              onClick={() => exportPeriodRevenueCSV(periodSubTab, periodData)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-xs"
            >
              <Download className="w-3.5 h-3.5 text-blue-600" />
              Download CSV ({periodSubTab === 'daily' ? 'Daily' : periodSubTab === 'monthly' ? 'Monthly' : 'Annual'})
            </button>
          </div>

          {/* Metrics summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="kpi-card kpi-report-card p-5">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Revenue Collected</div>
              <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">
                {formatMoney(periodData.totalRevenueUSD)}
              </div>
            </div>

            <div className="kpi-card kpi-report-card p-5">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Receipt Volume</div>
              <div className="text-2xl font-bold text-blue-700 mt-1 font-mono">
                {periodData.totalTransactions} <span className="text-sm font-normal text-slate-500">Receipts</span>
              </div>
              <div className="text-[12px] text-slate-500 mt-1">
                All recorded receipts
              </div>
            </div>

            <div className="kpi-card kpi-report-card p-5">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Average per Receipt</div>
              <div className="text-2xl font-bold text-emerald-700 mt-1 font-mono">
                {formatMoney((periodData.totalTransactions > 0 ? (periodData.totalRevenueUSD / periodData.totalTransactions) : 0))}
              </div>
            </div>

            <div className="kpi-card kpi-report-card p-5">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Closed Periods</div>
              <div className="text-2xl font-bold text-purple-700 mt-1 font-mono">
                {periodSubTab === 'daily' ? periodData.daily.length : periodSubTab === 'monthly' ? periodData.monthly.length : periodData.yearly.length}{' '}
                <span className="text-sm font-normal text-slate-500">
                  {periodSubTab === 'daily' ? 'Days' : periodSubTab === 'monthly' ? 'Months' : 'Years'}
                </span>
              </div>
              <div className="text-[12px] text-slate-500 mt-1">
                Data synchronized successfully
              </div>
            </div>
          </div>

          {/* Undated receipts — counted in the totals but belonging to no day,
              so the daily/monthly bars below do not add up to the revenue
              figure above. Previously these were silently re-dated to
              2026-01-01, which invented a day of revenue that never existed. */}
          {periodData.undated.count > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-900">
                <div className="font-bold mb-0.5">
                  {periodData.undated.count} receipt{periodData.undated.count === 1 ? '' : 's'} totalling{' '}
                  {formatMoney(periodData.undated.totalUSD)} carry no payment date
                </div>
                <div className="text-amber-800">
                  They are included in every revenue total on this page but cannot be placed in a day or month, so the
                  breakdown below does not sum to the totals above. They are not assigned to a period — correct the
                  payment date on the receipt to place them.
                </div>
              </div>
            </div>
          )}

          {/* Period Visual Bars */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 mb-2">
              Revenue Collection Curve ({periodSubTab === 'daily' ? 'Daily' : periodSubTab === 'monthly' ? 'Monthly' : 'Annual'})
            </h3>
            <p className="text-xs text-slate-500 mb-4">
              Proportional breakdown of revenues collected into the DPRNK Treasury
            </p>

            <div className="space-y-3">
              {/* Nothing collected yet: say so, instead of an empty card. */}
              {(periodSubTab === 'daily' ? periodData.daily : periodSubTab === 'monthly' ? periodData.monthly : periodData.yearly)
                .length === 0 && (
                <p className="py-6 text-center text-xs text-slate-500">No revenue recorded yet.</p>
              )}
              {periodSubTab === 'daily' && periodData.daily.slice(0, 10).map((d) => (
                <div key={d.date} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800">{dayLabel(d.date)}</span>
                    <span className="font-mono text-slate-900 font-bold">
                      {formatMoney(d.totalUSD)} ({d.transactionCount} receipts)
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                    <div 
                      className="bg-blue-600 h-2.5 rounded-full transition-all duration-500" 
                      style={{ width: `${Math.max(0, Math.min(100, d.percentageOfTotal))}%` }}
                    />
                  </div>
                </div>
              ))}

              {periodSubTab === 'monthly' && periodData.monthly.map((m) => (
                <div key={m.monthKey} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800"><MonthLabel monthKey={m.monthKey} /></span>
                    <span className="font-mono text-slate-900 font-bold">
                      {formatMoney(m.totalUSD)} ({m.transactionCount} receipts)
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                    <div 
                      className="bg-emerald-600 h-2.5 rounded-full transition-all duration-500" 
                      style={{ width: `${Math.max(0, Math.min(100, m.percentageOfTotal))}%` }}
                    />
                  </div>
                </div>
              ))}

              {periodSubTab === 'yearly' && periodData.yearly.map((y) => (
                <div key={y.year} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-800">Fiscal Year {y.year}</span>
                    <span className="font-mono text-slate-900 font-bold">
                      {formatMoney(y.totalUSD)} ({y.transactionCount} receipts)
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                    <div 
                      className="bg-purple-600 h-2.5 rounded-full transition-all duration-500" 
                      style={{ width: `${Math.max(0, Math.min(100, y.percentageOfTotal))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Period Detailed Table */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs overflow-hidden">
            <h3 className="text-sm font-bold text-slate-900 mb-4 pb-2 border-b border-slate-100">
              Revenue Ledger by Period
            </h3>

            <div className="overflow-x-auto">
              <table className="premium-table w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 uppercase font-semibold text-[12px]">
                    <th className="py-2.5 px-3">Period</th>
                    <th className="py-2.5 px-3">Receipts</th>
                    <th className="py-2.5 px-3 text-right">Revenue (USD)</th>
                    {periodSubTab === 'daily' && (
                      <>
                        <th className="py-2.5 px-3 text-right">Cash Vault (USD)</th>
                        <th className="py-2.5 px-3 text-right">Other Methods</th>
                      </>
                    )}
                    {periodSubTab === 'monthly' && (
                      <th className="py-2.5 px-3 text-right">Average / Receipt</th>
                    )}
                    <th className="py-2.5 px-3 text-right">Part %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 font-mono">
                  {(periodSubTab === 'daily' ? periodData.daily : periodSubTab === 'monthly' ? periodData.monthly : periodData.yearly)
                    .length === 0 && (
                    <tr>
                      <td
                        colSpan={periodSubTab === 'daily' ? 6 : periodSubTab === 'monthly' ? 5 : 4}
                        className="py-8 px-3 text-center font-sans text-slate-500"
                      >
                        No revenue recorded yet.
                      </td>
                    </tr>
                  )}
                  {periodSubTab === 'daily' && periodData.daily.map((d) => (
                    <tr key={d.date} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-3 font-sans font-semibold text-slate-900">{dayLabel(d.date)}</td>
                      <td className="py-3 px-3">{d.transactionCount}</td>
                      <td className="py-3 px-3 text-right text-emerald-700 font-bold">{formatMoney(d.totalUSD)}</td>
                      <td className="py-3 px-3 text-right text-slate-800">{formatMoney(d.cashUSD)}</td>
                      <td className="py-3 px-3 text-right text-slate-500">{formatMoney(d.otherUSD)}</td>
                      <td className="py-3 px-3 text-right font-bold text-slate-800">{d.percentageOfTotal.toFixed(1)}%</td>
                    </tr>
                  ))}

                  {periodSubTab === 'monthly' && periodData.monthly.map((m) => (
                    <tr key={m.monthKey} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-3 font-sans font-semibold text-slate-900"><MonthLabel monthKey={m.monthKey} /></td>
                      <td className="py-3 px-3">{m.transactionCount}</td>
                      <td className="py-3 px-3 text-right text-emerald-700 font-bold">{formatMoney(m.totalUSD)}</td>
                      <td className="py-3 px-3 text-right text-slate-800">{formatMoney(m.averageTransactionUSD)}</td>
                      <td className="py-3 px-3 text-right font-bold text-slate-800">{m.percentageOfTotal.toFixed(1)}%</td>
                    </tr>
                  ))}

                  {periodSubTab === 'yearly' && periodData.yearly.map((y) => (
                    <tr key={y.year} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-3 font-sans font-semibold text-slate-900">Fiscal Year {y.year}</td>
                      <td className="py-3 px-3">{y.transactionCount}</td>
                      <td className="py-3 px-3 text-right text-emerald-700 font-bold">{formatMoney(y.totalUSD)}</td>
                      <td className="py-3 px-3 text-right font-bold text-slate-800">{y.percentageOfTotal.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: REVENUE BY COMMUNE */}
      {activeTab === 'commune' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Revenue Distribution by Urban Commune</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Territorial consolidation: Commune of Goma (Volcans, Himbi, Katindo) and Commune of Karisimbi (Mabanga, Majengo, Kasika)
              </p>
            </div>
            <button
              id="export-commune-csv-btn"
              type="button"
              onClick={() => exportCommuneRevenueCSV(communeData)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-xs"
            >
              <Download className="w-3.5 h-3.5 text-blue-600" />
              Export Communes (CSV)
            </button>
          </div>

          {/* Commune Comparison Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {communeData.map((c) => {
              const isGoma = c.commune === 'Goma';
              return (
                <div 
                  key={c.commune} 
                  className={`kpi-card kpi-report-card border p-5 relative overflow-hidden ${
                    isGoma ? 'border-blue-200 ring-1 ring-blue-100' : 'border-indigo-200 ring-1 ring-indigo-100'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className={`inline-block text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded ${
                        isGoma ? 'bg-blue-100 text-blue-800' : 'bg-indigo-100 text-indigo-800'
                      }`}>
                        Urban Commune
                      </span>
                      <h4 className="text-xl font-bold text-slate-900 mt-1">
                        Commune of {c.commune}
                      </h4>
                    </div>
                    <div className="text-right">
                      <span className="text-2xl font-bold font-mono text-slate-900">
                        {c.percentageOfTotal.toFixed(1)}%
                      </span>
                      <p className="text-[12px] text-slate-500">Provincial Share</p>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-slate-500 block text-[12px]">Revenue USD</span>
                      <strong className="font-mono text-emerald-700 text-sm">
                        {formatMoney(c.totalUSD)}
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[12px]">Registered Taxpayers</span>
                      <strong className="text-slate-800 text-sm">
                        {c.businessCount} Ent.
                      </strong>
                    </div>
                    <div>
                      <span className="text-slate-500 block text-[12px]">Receipts Issued</span>
                      <strong className="text-slate-800 text-sm font-mono">
                        {c.transactionCount}
                      </strong>
                    </div>
                  </div>

                  <div className="mt-4">
                    <span className="text-[12px] font-semibold text-slate-600 block mb-1.5">
                      Top Neighborhoods in Commune:
                    </span>
                    <div className="space-y-1.5">
                      {c.quartiers.slice(0, 4).map((q) => (
                        <div key={q.quartier} className="flex items-center justify-between text-xs bg-slate-50 px-2.5 py-1.5 rounded">
                          <span className="text-slate-700 font-medium">Q. {q.quartier}</span>
                          <span className="font-mono text-slate-900 font-semibold">{formatMoney(q.totalUSD)} ({q.businessCount} ent.)</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Full Territorial Breakdown Table */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 mb-4 pb-2 border-b border-slate-100">
              Revenue Breakdown by Quarter and Commune
            </h3>

            <div className="overflow-x-auto">
              <table className="premium-table w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 uppercase font-semibold text-[12px]">
                    <th className="py-2.5 px-3">Commune</th>
                    <th className="py-2.5 px-3">Neighborhood</th>
                    <th className="py-2.5 px-3">Registered Taxpayers</th>
                    <th className="py-2.5 px-3 text-right">Collected Revenue (USD)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 font-mono">
                  {communeData.flatMap((c) =>
                    c.quartiers.map((q) => (
                      <tr key={`${c.commune}_${q.quartier}`} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-2.5 px-3 font-sans font-semibold text-slate-900">{c.commune}</td>
                        <td className="py-2.5 px-3 font-sans font-medium text-slate-800">Q. {q.quartier}</td>
                        <td className="py-2.5 px-3">{q.businessCount}</td>
                        <td className="py-2.5 px-3 text-right text-emerald-700 font-bold">{formatMoney(q.totalUSD)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: REVENUE BY ACTIVITY SECTOR */}
      {activeTab === 'sector' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Fiscal Performance by Activity Sector</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Comparison of assessed vs. collected revenue and collection rate by economic sector of Goma
              </p>
            </div>
            <button
              id="export-sector-csv-btn"
              type="button"
              onClick={() => exportSectorRevenueCSV(sectorData)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-xs"
            >
              <Download className="w-3.5 h-3.5 text-blue-600" />
              Export Sectors (CSV)
            </button>
          </div>

          {/* Sector Bars */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sectorData.map((s) => (
              <div key={s.sector} className="kpi-card kpi-report-card p-5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-900">{s.sectorLabel}</span>
                    <span className="text-[12px] font-mono font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                      {s.businessCount} Ent.
                    </span>
                  </div>

                  <div className="mt-2">
                    <span className="text-xs text-slate-500">Collected Revenue</span>
                    <div className="text-xl font-bold font-mono text-emerald-700">
                      {formatMoney(s.totalCollectedUSD)}
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-500">Collection Rate</span>
                    <span className="font-bold text-slate-900 font-mono">{percentageLabel(s.recoveryRatePercent)}</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div 
                      className={`h-2 rounded-full ${
                        s.recoveryRatePercent >= 75 ? 'bg-emerald-600' : s.recoveryRatePercent >= 40 ? 'bg-amber-500' : 'bg-rose-500'
                      }`}
                      style={{ width: `${Math.max(0, Math.min(100, s.recoveryRatePercent))}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Comprehensive Sector Table */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 mb-4 pb-2 border-b border-slate-100">
              Detailed Analysis by Tariff & Activity Sector
            </h3>

            <div className="overflow-x-auto">
              <table className="premium-table w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 uppercase font-semibold text-[12px]">
                    <th className="py-2.5 px-3">Economic Sector</th>
                    <th className="py-2.5 px-3">Businesses</th>
                    <th className="py-2.5 px-3">Receipts</th>
                    <th className="py-2.5 px-3 text-right">Assessed / Notified</th>
                    <th className="py-2.5 px-3 text-right">Collected (USD)</th>
                    <th className="py-2.5 px-3 text-right">Collection Rate</th>
                    <th className="py-2.5 px-3 text-right">Share of Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 font-mono">
                  {sectorData.map((s) => (
                    <tr key={s.sector} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-3 font-sans font-bold text-slate-900">{s.sectorLabel}</td>
                      <td className="py-3 px-3">{s.businessCount}</td>
                      <td className="py-3 px-3">{s.paymentCount}</td>
                      <td className="py-3 px-3 text-right text-slate-700">{formatMoney(s.totalAssessedUSD)}</td>
                      <td className="py-3 px-3 text-right text-emerald-700 font-bold">{formatMoney(s.totalCollectedUSD)}</td>
                      <td className="py-3 px-3 text-right">
                        <span className={`px-2 py-0.5 rounded text-[12px] font-bold ${
                          s.recoveryRatePercent >= 75 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                        }`}>
                          {percentageLabel(s.recoveryRatePercent)}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-slate-800">{s.percentageOfTotalRevenue.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Revenue by head of tax — the percentage declarations (IF, IRL)
              alongside the Business License Tax, so a head of tax that is
              collected separately can never disappear into one blended total. */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-5 py-4 border-b border-slate-200">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Revenue by Head of Tax</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Business License Tax alongside the percentage declarations assessed on declared property values
                </p>
              </div>
              <button
                id="export-tax-type-csv-btn"
                type="button"
                onClick={() => exportTaxTypeRevenueCSV(taxTypeData)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-xs shrink-0"
              >
                <Download className="w-3.5 h-3.5 text-blue-600" />
                Export Heads of Tax (CSV)
              </button>
            </div>

            {taxTypeData.length === 0 ? (
              <p className="px-5 py-8 text-center text-xs text-slate-500">
                No revenue recorded yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="premium-table w-full text-left text-xs">
                  <thead className="bg-slate-50/80 text-slate-600 font-semibold uppercase tracking-wider text-[12px] border-b border-slate-200">
                    <tr>
                      <th className="py-2.5 px-3">Head of Tax</th>
                      <th className="py-2.5 px-3 text-right">Rate</th>
                      <th className="py-2.5 px-3 text-right">Notices</th>
                      <th className="py-2.5 px-3 text-right">Receipts</th>
                      <th className="py-2.5 px-3 text-right">Assessed / Notified</th>
                      <th className="py-2.5 px-3 text-right">Collected (USD)</th>
                      <th className="py-2.5 px-3 text-right">Collection Rate</th>
                      <th className="py-2.5 px-3 text-right">Share of Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700 font-mono">
                    {taxTypeData.map((t) => (
                      <tr key={t.taxTypeCode} className="hover:bg-slate-50/70 transition-colors">
                        <td className="py-3 px-3 font-sans font-bold text-slate-900">
                          <span className="inline-flex items-center gap-2">
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-[11px] font-bold text-slate-800">
                              {t.taxTypeCode}
                            </span>
                            <span className="truncate">{t.label}</span>
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right">
                          {t.ratePercent ? `${t.ratePercent}%` : '—'}
                        </td>
                        <td className="py-3 px-3 text-right">{t.noticeCount}</td>
                        <td className="py-3 px-3 text-right">{t.paymentCount}</td>
                        <td className="py-3 px-3 text-right text-slate-700">{formatMoney(t.totalAssessedUSD)}</td>
                        <td className="py-3 px-3 text-right text-emerald-700 font-bold">{formatMoney(t.totalCollectedUSD)}</td>
                        <td className="py-3 px-3 text-right">
                          <span className={`px-2 py-0.5 rounded text-[12px] font-bold ${
                            t.recoveryRatePercent >= 75 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                          }`}>
                            {percentageLabel(t.recoveryRatePercent)}
                          </span>
                        </td>
                        <td className="py-3 px-3 text-right font-bold text-slate-800">{t.percentageOfTotalRevenue.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: ACTIVE VS DELINQUENT BUSINESSES */}
      {activeTab === 'compliance' && (
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Tax Compliance Report: Active vs. Overdue</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Civic monitoring, compliant taxpayers, and tracking of delinquent tax receivables
              </p>
            </div>
            <button
              id="export-compliance-csv-btn"
              type="button"
              onClick={() => exportComplianceCSV(complianceData)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-xs"
            >
              <Download className="w-3.5 h-3.5 text-blue-600" />
              Export Delinquent Taxpayers (CSV)
            </button>
          </div>

          {/* Indicators */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="kpi-card kpi-report-card p-5">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Tax Compliance Rate</div>
              <div className="text-2xl font-bold text-emerald-700 mt-1 font-mono">
                {percentageLabel(complianceData.complianceRatePercent)}
              </div>
              <div className="text-[12px] text-emerald-600 mt-1">
                {complianceData.upToDateBusinesses} out of {complianceData.activeBusinesses} active businesses
              </div>
            </div>

            <div className="kpi-card kpi-report-card p-5">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Overdue Businesses</div>
              <div className="text-2xl font-bold text-rose-700 mt-1 font-mono">
                {complianceData.delinquentBusinesses} <span className="text-sm font-normal text-slate-500">Bus.</span>
              </div>
              <div className="text-[12px] text-rose-600 mt-1">
                Overdue tax assessment notices pending settlement
              </div>
            </div>

            <div className="kpi-card kpi-report-card p-5">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Delinquent Receivables</div>
              <div className="text-2xl font-bold text-amber-700 mt-1 font-mono">
                {formatMoney(complianceData.totalOverdueUSD)}
              </div>
            </div>

            <div className="kpi-card kpi-report-card p-5">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Administrative Closures</div>
              <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">
                {complianceData.deregisteredBusinesses} <span className="text-sm font-normal text-slate-500">Ent.</span>
              </div>
              <div className="text-[12px] text-slate-500 mt-1">
                Official "Closure Pending" status
              </div>
            </div>
          </div>

          {/* Commune & Size class breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
              <h4 className="text-xs font-bold text-slate-900 uppercase mb-3">Compliance by Commune</h4>
              <div className="space-y-3">
                {complianceData.byCommune.map((c) => (
                  <div key={c.commune} className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <strong className="text-slate-900 font-bold">Commune of {c.commune}</strong>
                      <span className="font-bold text-emerald-700 font-mono">{percentageLabel(c.complianceRate)} in compliance</span>
                    </div>
                    <div className="flex items-center justify-between text-[12px] text-slate-500 mt-1">
                      <span>Total: {c.total} | Actives: {c.active}</span>
                      <span className="text-rose-600 font-semibold">{c.delinquent} in default</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
              <h4 className="text-xs font-bold text-slate-900 uppercase mb-3">Compliance by Size Class</h4>
              <div className="space-y-3">
                {complianceData.bySizeClass.map((s) => (
                  <div key={s.sizeClass} className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <strong className="text-slate-900 font-bold">{s.sizeLabel}</strong>
                      <span className="font-bold text-emerald-700 font-mono">{percentageLabel(s.complianceRate)}</span>
                    </div>
                    <div className="flex items-center justify-between text-[12px] text-slate-500 mt-1">
                      <span>Total: {s.total} | Actives: {s.active}</span>
                      <span className="text-rose-600 font-semibold">{s.delinquent} in default</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Delinquent Business list */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
            <h3 className="text-sm font-bold text-slate-900 mb-4 pb-2 border-b border-slate-100 flex items-center justify-between">
              <span>Delinquent Taxpayers Registry (Fiscal Arrears)</span>
              <span className="text-xs font-normal text-slate-500">
                {complianceData.delinquentDetails.length} cases identified
              </span>
            </h3>

            <div className="overflow-x-auto">
              <table className="premium-table w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 uppercase font-semibold text-[12px]">
                    <th className="py-2.5 px-3">Business</th>
                    <th className="py-2.5 px-3">Manager / Owner</th>
                    <th className="py-2.5 px-3">Location</th>
                    <th className="py-2.5 px-3 text-right">Overdue (Days)</th>
                    <th className="py-2.5 px-3 text-right">Outstanding Debt (USD)</th>
                    <th className="py-2.5 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 font-mono">
                  {complianceData.delinquentDetails.map((d) => (
                    <tr key={d.businessId} className="hover:bg-rose-50/40 transition-colors">
                      <td className="py-3 px-3 font-sans font-bold text-slate-900">{d.businessName}</td>
                      <td className="py-3 px-3 font-sans text-slate-600">{d.ownerFullName}</td>
                      <td className="py-3 px-3 font-sans text-slate-500">{d.commune} ({d.quartier})</td>
                      <td className="py-3 px-3 text-right font-bold text-rose-700">{d.maxDaysOverdue} days</td>
                      <td className="py-3 px-3 text-right font-bold text-rose-700">{formatMoney(d.totalDebtUSD)}</td>
                      <td className="py-3 px-3 font-sans">
                        <span className={`px-2 py-0.5 rounded text-[11px] font-semibold uppercase ${
                          normalizeBusinessStatus(d.status) === 'Closure Pending' || d.status === 'en radiation'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}>
                          {normalizeBusinessStatus(d.status) === 'Closure Pending' ? 'Closure Pending' : d.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}


    </div>
  );
};
