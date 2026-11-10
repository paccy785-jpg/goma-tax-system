import React, { useState, useEffect, useRef } from 'react';
import { 
  AlertTriangle, 
  CheckCircle2, 
  Search, 
  RefreshCw, 
  ShieldAlert, 
  ShieldCheck, 
  FileText, 
  Hash, 
  Copy, 
  Calendar, 
  User, 
  Filter, 
  ArrowUpDown, 
  Download, 
  ExternalLink, 
  X, 
  Clock, 
  HelpCircle,
  Building,
  Check,
  ChevronRight
} from 'lucide-react';
import {
  ReceiptAnomaly,
  AnomalyType,
  AnomalyResolutionStatus,
  UserRole,
  normalizeAnomalyStatus
} from '../types';
import { 
  getReceiptAnomalies, 
  subscribeToReceiptAnomalies,
  resolveReceiptAnomaly, 
  unresolveReceiptAnomaly, 
  runReceiptSequenceScan 
} from '../services/anomalyService';
import { useAuth } from '../contexts/AuthContext';
import { todayDateString } from '../utils/date';
import { buildCsv } from '../utils/csv';
import { PageHeader, Button, Badge, Panel, MetricStrip } from './ui';

interface ReceiptAnomaliesViewProps {
  userRole: UserRole;
  onNavigateToVerify?: (receiptNumber?: string) => void;
}

export const ReceiptAnomaliesView: React.FC<ReceiptAnomaliesViewProps> = ({
  userRole,
  onNavigateToVerify,
}) => {
  const { currentUser, userProfile } = useAuth();
  const [anomalies, setAnomalies] = useState<ReceiptAnomaly[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<'all' | AnomalyType>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | AnomalyResolutionStatus>('all');
  const [cashierFilter, setCashierFilter] = useState<string>('all');

  // Resolution Modal State
  const [selectedAnomalyForResolve, setSelectedAnomalyForResolve] = useState<ReceiptAnomaly | null>(null);
  const [resolutionNoteInput, setResolutionNoteInput] = useState<string>('');
  const [resolving, setResolving] = useState<boolean>(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  // Reopen State
  const [reopeningId, setReopeningId] = useState<string | null>(null);

  const canResolve = userRole === 'Auditor' || userRole === 'Supervisor' || userRole === 'Admin';

  useEffect(() => {
    setLoading(true);

    const unsubscribe = subscribeToReceiptAnomalies(
      (data) => {
        setAnomalies(data || []);
        setLoading(false);
      },
      (err) => {
        console.error('[Anomalies] Real-time listener error:', err);
        setLoading(false);
      }
    );

    return () => {
      unsubscribe();
    };
  }, []);

  // Single tracked timer for the scan-result banner — the bare setTimeout was
  // never cleared on unmount (setState after unmount, older message wiped).
  const scanMessageTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleScanMessageClear = (delayMs: number) => {
    if (scanMessageTimerRef.current) clearTimeout(scanMessageTimerRef.current);
    scanMessageTimerRef.current = setTimeout(() => {
      setScanMessage(null);
      scanMessageTimerRef.current = null;
    }, delayMs);
  };
  useEffect(() => () => {
    if (scanMessageTimerRef.current) clearTimeout(scanMessageTimerRef.current);
  }, []);

  const reloadData = async () => {
    setLoading(true);
    try {
      const data = await getReceiptAnomalies();
      setAnomalies(data || []);
    } catch (err) {
      console.warn('[Anomalies] Reload error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRunManualScan = async () => {
    setIsScanning(true);
    setScanMessage(null);
    try {
      const user = {
        uid: userProfile?.uid || currentUser?.uid || 'auditor_goma',
        displayName: userProfile?.displayName || 'Revenue Auditor',
        role: userRole,
      };

      const result = await runReceiptSequenceScan({
        triggeredBy: user,
        source: 'manual_scan',
      });

      setAnomalies(result.anomalies);
      setScanMessage(
        `Audit completed: ${result.totalPaymentsScanned} receipts scanned. ${result.gapsCount} sequence gap(s) and ${result.duplicatesCount} duplicate(s) identified.`
      );
    } catch (err: any) {
      console.error('[Scan Error]', err);
      setScanMessage(`Error auditing sequence continuity: ${err?.message || 'Failed'}`);
    } finally {
      setIsScanning(false);
      scheduleScanMessageClear(8000);
    }
  };

  const handleOpenResolveModal = (anom: ReceiptAnomaly) => {
    setSelectedAnomalyForResolve(anom);
    setResolutionNoteInput(anom.resolutionNote || '');
    setResolveError(null);
  };

  const handleConfirmResolve = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAnomalyForResolve) return;

    if (!resolutionNoteInput.trim() || resolutionNoteInput.trim().length < 5) {
      setResolveError("An explanatory justification note of at least 5 characters is required.");
      return;
    }

    setResolving(true);
    setResolveError(null);
    try {
      const user = {
        uid: userProfile?.uid || currentUser?.uid || 'user_sup',
        displayName: userProfile?.displayName || 'Supervisor / Auditor',
        role: userRole,
      };

      const updated = await resolveReceiptAnomaly({
        anomalyId: selectedAnomalyForResolve.id,
        resolutionNote: resolutionNoteInput.trim(),
        userProfile: user,
      });

      setAnomalies((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      setSelectedAnomalyForResolve(null);
      setResolutionNoteInput('');
    } catch (err: any) {
      console.error('[Resolve Error]', err);
      setResolveError(err?.message || 'Erreur lors de la validation.');
    } finally {
      setResolving(false);
    }
  };

  const handleReopen = async (anomaly: ReceiptAnomaly) => {
    if (!window.confirm(`Confirm reopening anomaly ${anomaly.id}? It will revert to 'Unresolved' status.`)) {
      return;
    }

    setReopeningId(anomaly.id);
    try {
      const user = {
        uid: userProfile?.uid || currentUser?.uid || 'user_sup',
        displayName: userProfile?.displayName || 'Superviseur / Auditeur',
        role: userRole,
      };

      const updated = await unresolveReceiptAnomaly({
        anomalyId: anomaly.id,
        userProfile: user,
        reopenReason: 'Reopened by supervisor for review of supporting documents.',
      });

      setAnomalies((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
    } catch (err) {
      console.error('[Reopen Error]', err);
    } finally {
      setReopeningId(null);
    }
  };

  // Preset reason buttons for modal
  const applyPresetReason = (reason: string) => {
    setResolutionNoteInput((prev) => (prev ? `${prev} • ${reason}` : reason));
  };

  // Filtered anomalies
  const filtered = anomalies.filter((a) => {
    const q = (searchQuery || '').toLowerCase();
    const matchesSearch = 
      (a.id || '').toLowerCase().includes(q) ||
      (a.cashierName || '').toLowerCase().includes(q) ||
      (a.expectedReceiptNumber || '').toLowerCase().includes(q) ||
      (a.actualReceiptNumber || '').toLowerCase().includes(q) ||
      ((a as any).receiptNumber || '').toLowerCase().includes(q) ||
      (a.resolutionNote || '').toLowerCase().includes(q);

    if (!matchesSearch) return false;

    if (typeFilter !== 'all' && a.type !== typeFilter) return false;
    // Data stores both English ('Explained'/'Unresolved') and French
    // ('explique'/'non_resolu') statuses — compare on the normalized value.
    if (statusFilter !== 'all' && normalizeAnomalyStatus(a.status) !== normalizeAnomalyStatus(statusFilter)) return false;
    if (cashierFilter !== 'all' && a.cashierId !== cashierFilter && a.cashierName !== cashierFilter) return false;

    return true;
  });

  // Unique cashiers for dropdown
  const uniqueCashiers = Array.from(
    new Set(anomalies.map((a) => a.cashierName || a.cashierId))
  ).filter(Boolean);

  // Statistics
  const totalCount = anomalies.length;
  const unresolvedCount = anomalies.filter((a) => normalizeAnomalyStatus(a.status) === 'Unresolved').length;
  const resolvedCount = anomalies.filter((a) => normalizeAnomalyStatus(a.status) === 'Explained').length;
  const gapsCount = anomalies.filter((a) => a.type === 'gap').length;
  const duplicatesCount = anomalies.filter((a) => a.type === 'duplicate').length;
  const resolutionRate = totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 100;

  // Export CSV
  const handleExportCSV = () => {
    const headers = [
      'Anomaly ID',
      'Type',
      'Status',
      'Cashier / Station',
      'Expected Number (Gap)',
      'Actual Observation',
      'Start Date',
      'End Date',
      'Detection Date',
      'Explanatory Note / Visa',
      'Validated By',
      'Validation Date'
    ];

    const rows = filtered.map((a) => [
      a.id || '',
      a.type === 'gap' ? 'Gap' : a.type === 'duplicate' ? 'Duplicate' : 'Voided Receipt',
      normalizeAnomalyStatus(a.status) === 'Explained' ? 'Explained' : 'Unresolved',
      a.cashierName || '',
      a.expectedReceiptNumber || '',
      a.actualReceiptNumber || '',
      a.startDate || '',
      a.endDate || '',
      a.detectedAt || '',
      a.resolutionNote || '',
      a.resolvedByName || '',
      a.resolvedAt || '',
    ]);

    const csvContent = buildCsv([headers, ...rows]);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `anomalies_quittances_goma_${todayDateString()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-8 font-sans">
      {/* Page Header */}
      <PageHeader
        eyebrow="Governance"
        title="Receipt Sequence Anomalies & Continuity Audit"
        description="Exhaustive audit of receipt numbering by cashier and station. Instant detection of missing sequence gaps and duplicates resulting from offline synchronizations."
        actions={
          <>
            <Button
              variant="ghost"
              size="md"
              onClick={handleExportCSV}
              icon={<Download className="w-3.5 h-3.5" />}
            >
              Export CSV
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={handleRunManualScan}
              disabled={isScanning}
              icon={<RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin' : ''}`} />}
            >
              {isScanning ? 'Scanning...' : 'Verify Sequences'}
            </Button>
          </>
        }
      />

      {/* Feedback Message */}
      {scanMessage && (
        <div className="p-4 rounded-[14px] bg-accent-soft/70 border border-line text-xs flex items-center justify-between gap-3 transition-premium">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-accent shrink-0" />
            <span className="font-semibold text-ink">{scanMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setScanMessage(null)}
            className="text-muted hover:text-ink cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Metric Summary Strip */}
      <MetricStrip
        columns={4}
        items={[
          {
            label: 'Total Anomalies',
            value: totalCount.toString(),
            trend: `${resolutionRate}% resolved`,
            trendType: 'muted',
            subline: 'Events logged in register',
            icon: <ShieldAlert className="w-4 h-4 text-accent" />,
          },
          {
            label: 'Unresolved Alerts',
            value: unresolvedCount.toString(),
            trend: unresolvedCount > 0 ? 'Requires sign-off' : 'Queue clear',
            trendType: unresolvedCount > 0 ? 'warn' : 'sage',
            subline: 'Open sequence deviations',
            icon: <AlertTriangle className="w-4 h-4 text-warn" />,
          },
          {
            label: 'Missing Gaps',
            value: gapsCount.toString(),
            trend: gapsCount > 0 ? 'Sequence breaks' : 'Continuous',
            trendType: gapsCount > 0 ? 'warn' : 'sage',
            subline: 'Gaps between receipts',
            icon: <Hash className="w-4 h-4 text-muted" />,
          },
          {
            label: 'Duplicate Collisions',
            value: duplicatesCount.toString(),
            trend: duplicatesCount > 0 ? 'Collisions detected' : 'Zero duplicates',
            trendType: duplicatesCount > 0 ? 'danger' : 'sage',
            subline: 'Multi-device sync conflicts',
            icon: <Copy className="w-4 h-4 text-danger" />,
          },
        ]}
      />

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Search Input */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-hidden focus:border-slate-800 transition-colors"
            />
          </div>

          {/* Status Filter */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 font-medium text-slate-800 focus:outline-hidden focus:border-slate-800"
            >
              <option value="all">All Statuses ({anomalies.length})</option>
              <option value="non_resolu">🔴 Unresolved ({unresolvedCount})</option>
              <option value="explique">🟢 Explained / Regularized ({resolvedCount})</option>
            </select>
          </div>

          {/* Type Filter */}
          <div>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as any)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 font-medium text-slate-800 focus:outline-hidden focus:border-slate-800"
            >
              <option value="all">All Anomaly Types</option>
              <option value="gap">Missing Number (Gap)</option>
              <option value="duplicate">Duplicate Collision</option>
            </select>
          </div>

          {/* Cashier Filter */}
          <div>
            <select
              value={cashierFilter}
              onChange={(e) => setCashierFilter(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 font-medium text-slate-800 focus:outline-hidden focus:border-slate-800"
            >
              <option value="all">All Cashiers / Counters</option>
              {uniqueCashiers.map((cName) => (
                <option key={cName} value={cName}>
                  {cName}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Active Filter Chips */}
        {(typeFilter !== 'all' || statusFilter !== 'all' || cashierFilter !== 'all' || searchQuery) && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 text-xs">
            <span className="text-[12px] text-slate-500 font-semibold">Active filters:</span>
            {statusFilter !== 'all' && (
              <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[11px] font-bold flex items-center gap-1">
                Status: {statusFilter === 'non_resolu' ? 'Unresolved' : 'Explained'}
                <button type="button" onClick={() => setStatusFilter('all')} className="hover:text-amber-950">×</button>
              </span>
            )}
            {typeFilter !== 'all' && (
              <span className="px-2 py-0.5 rounded-md bg-blue-100 text-blue-800 text-[11px] font-bold flex items-center gap-1">
                Type: {typeFilter === 'gap' ? 'Gap' : 'Duplicate'}
                <button type="button" onClick={() => setTypeFilter('all')} className="hover:text-blue-950">×</button>
              </span>
            )}
            {cashierFilter !== 'all' && (
              <span className="px-2 py-0.5 rounded-md bg-slate-200 text-slate-800 text-[11px] font-bold flex items-center gap-1">
                Cashier: {cashierFilter}
                <button type="button" onClick={() => setCashierFilter('all')} className="hover:text-slate-950">×</button>
              </span>
            )}
            {searchQuery && (
              <span className="px-2 py-0.5 rounded-md bg-slate-200 text-slate-800 text-[11px] font-bold flex items-center gap-1">
                Search: "{searchQuery}"
                <button type="button" onClick={() => setSearchQuery('')} className="hover:text-slate-950">×</button>
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                setStatusFilter('all');
                setTypeFilter('all');
                setCashierFilter('all');
                setSearchQuery('');
              }}
              className="text-[11px] text-slate-500 hover:text-slate-900 underline font-medium ml-1"
            >
              Reset
            </button>
          </div>
        )}
      </div>

      {/* Anomalies List */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-slate-900">
              Identified Anomalies Registry
            </h2>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-slate-100 text-slate-700">
              {filtered.length} entries
            </span>
          </div>

          <span className="text-[12px] text-slate-400">
            Sorted chronologically • Unresolved alerts shown first
          </span>
        </div>

        {loading ? (
          <div className="p-12 text-center text-slate-500 text-xs">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto text-slate-400 mb-2" />
            Loading sequential integrity registry...
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-xs">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2 opacity-80" />
            <div className="font-bold text-slate-700 text-sm">No anomalies match your criteria</div>
            <p className="text-slate-400 text-xs max-w-sm mx-auto mt-1">
              The verified numbering sequences are continuous and free of undocumented duplicates.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map((anomaly) => {
              const isGap = anomaly.type === 'gap';
              const isResolved = normalizeAnomalyStatus(anomaly.status) === 'Explained';

              return (
                <div
                  key={anomaly.id}
                  className={`p-5 transition-colors ${
                    !isResolved ? 'bg-amber-50/20 hover:bg-amber-50/40' : 'hover:bg-slate-50/70'
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                    {/* Left: Badges & Details */}
                    <div className="space-y-2.5 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Type Badge */}
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border ${
                            isGap
                              ? 'bg-blue-50 text-blue-800 border-blue-200'
                              : 'bg-red-50 text-red-800 border-red-200'
                          }`}
                        >
                          {isGap ? (
                            <>
                              <Hash className="w-3.5 h-3.5 text-blue-600" />
                              Missing Number (Gap)
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5 text-red-600" />
                              Receipt Duplicate (Collision)
                            </>
                          )}
                        </span>

                        {/* Status Badge */}
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold border ${
                            isResolved
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : 'bg-amber-100 text-amber-900 border-amber-300 animate-pulse'
                          }`}
                        >
                          {isResolved ? (
                            <>
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                              Explained & Regularized
                            </>
                          ) : (
                            <>
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                              Unresolved (Active Alert)
                            </>
                          )}
                        </span>

                        <span className="font-mono text-[12px] text-slate-400 font-semibold">
                          ID: {anomaly.id}
                        </span>

                        <span className="text-[11px] text-slate-400">
                          • Detected on {new Date(anomaly.detectedAt).toLocaleDateString('en-US')} at {new Date(anomaly.detectedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>

                      {/* Main Comparison: Expected vs Found */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-white p-3.5 rounded-xl border border-slate-200">
                        <div>
                          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                            {isGap ? 'Expected Missing Receipt(s)' : 'Expected Unique Sequence #'}
                          </div>
                          <div className="font-mono text-sm font-black text-slate-900 mt-0.5">
                            {anomaly.expectedReceiptNumber}
                          </div>
                          {anomaly.startSequence && anomaly.endSequence && (
                            <div className="text-[11px] text-blue-700 font-semibold mt-0.5">
                              Sequence #{anomaly.startSequence}{anomaly.startSequence !== anomaly.endSequence ? ` to #${anomaly.endSequence}` : ''}
                            </div>
                          )}
                        </div>

                        <div>
                          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                            {isGap ? 'Surrounding Sequence Range' : 'Conflicting Receipts Issued'}
                          </div>
                          <div className="font-mono text-xs font-bold text-slate-800 mt-0.5">
                            {anomaly.actualReceiptNumber}
                          </div>
                          {anomaly.duplicateCount && anomaly.duplicateCount > 1 && (
                            <div className="text-[11px] text-red-700 font-bold mt-0.5">
                              {anomaly.duplicateCount} records with the same number!
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Cashier & Date Context */}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                        <div className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-slate-400" />
                          <span>Cashier: <strong>{anomaly.cashierName}</strong></span>
                        </div>
                        {anomaly.stationOffice && (
                          <div className="flex items-center gap-1.5">
                            <Building className="w-3.5 h-3.5 text-slate-400" />
                            <span>Station: <strong>{anomaly.stationOffice}</strong></span>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-slate-400" />
                          <span>Period: {anomaly.startDate} {anomaly.endDate !== anomaly.startDate ? `to ${anomaly.endDate}` : ''}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 font-medium">
                            Source: {anomaly.source === 'sync_offline' ? 'Offline Sync' : anomaly.source === 'manual_scan' ? 'Manual Audit' : 'Auto Monitor'}
                          </span>
                        </div>
                      </div>

                      {/* Explanation Note Quote if already explained */}
                      {isResolved && anomaly.resolutionNote && (
                        <div className="p-3 rounded-xl bg-emerald-50/80 border border-emerald-200 text-xs">
                          <div className="flex items-center justify-between text-[12px] text-emerald-900 font-bold mb-1">
                            <span className="flex items-center gap-1">
                              <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
                              Regularization Visa & Official Justification
                            </span>
                            {anomaly.resolvedByName && (
                              <span className="text-emerald-800/80 font-normal">
                                By {anomaly.resolvedByName} on {anomaly.resolvedAt ? new Date(anomaly.resolvedAt).toLocaleDateString('en-US') : ''}
                              </span>
                            )}
                          </div>
                          <p className="text-slate-800 italic bg-white/70 p-2 rounded-lg border border-emerald-200/60 font-sans">
                            « {anomaly.resolutionNote} »
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Right: Actions */}
                    <div className="flex flex-row lg:flex-col items-end gap-2 shrink-0">
                      {canResolve && (
                        <>
                          {!isResolved ? (
                            <button
                              id={`resolve-anomaly-btn-${anomaly.id}`}
                              type="button"
                              onClick={() => handleOpenResolveModal(anomaly)}
                              className="px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-amber-400 text-xs font-bold transition-colors shadow-xs flex items-center gap-1.5"
                            >
                              <ShieldCheck className="w-4 h-4 text-amber-400" />
                              <span>Mark Explained</span>
                            </button>
                          ) : (
                            <button
                              id={`reopen-anomaly-btn-${anomaly.id}`}
                              type="button"
                              onClick={() => handleReopen(anomaly)}
                              disabled={reopeningId === anomaly.id}
                              className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors border border-slate-200"
                            >
                              {reopeningId === anomaly.id ? 'Reopening...' : 'Reopen Anomaly'}
                            </button>
                          )}
                        </>
                      )}

                      {onNavigateToVerify && (
                        <button
                          type="button"
                          onClick={() => {
                            const recNum = anomaly.type === 'duplicate' 
                              ? (anomaly.actualReceiptNumber || '') 
                              : ((anomaly.expectedReceiptNumber || anomaly.actualReceiptNumber || (anomaly as any).receiptNumber || '').split(' ')[0]);
                            onNavigateToVerify(recNum);
                          }}
                          className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-100 text-slate-600 text-xs font-semibold transition-colors border border-slate-200 flex items-center gap-1"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>Verify Receipt</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Explanation / Resolution Modal */}
      {selectedAnomalyForResolve && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-xl w-full overflow-hidden shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500 flex items-center justify-center text-slate-950 font-bold">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Regularization Sign-off & Anomaly Justification
                  </h3>
                  <p className="text-[12px] text-slate-300">
                    Receipt Continuity Internal Control • DPRNK
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAnomalyForResolve(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleConfirmResolve} className="p-6 space-y-4 text-xs">
              {resolveError && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{resolveError}</span>
                </div>
              )}

              {/* Anomaly summary card */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-800">
                    Anomaly: {selectedAnomalyForResolve.type === 'gap' ? 'Sequence Gap (Missing)' : 'Receipt Collision (Duplicate)'}
                  </span>
                  <span className="font-mono font-bold text-slate-600 text-[12px]">
                    {selectedAnomalyForResolve.id}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[12px] text-slate-600 pt-1 border-t border-slate-200">
                  <div>
                    <span className="text-slate-400 block">Expected:</span>
                    <strong className="font-mono text-slate-900">{selectedAnomalyForResolve.expectedReceiptNumber}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Observed:</span>
                    <strong className="font-mono text-slate-900">{selectedAnomalyForResolve.actualReceiptNumber}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Cashier:</span>
                    <span className="text-slate-900 font-medium">{selectedAnomalyForResolve.cashierName}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block">Dates:</span>
                    <span className="text-slate-900 font-medium">{selectedAnomalyForResolve.startDate}</span>
                  </div>
                </div>
              </div>

              {/* Required Explanatory Note */}
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Required Justification / Explanatory Note *
                </label>
                <textarea
                  required
                  rows={3}
                  value={resolutionNoteInput}
                  onChange={(e) => setResolutionNoteInput(e.target.value)}
                  placeholder="e.g. Receipt voided following printer jam, see substitute receipt #... or duplicate offline entry reconciled."
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-white font-medium text-slate-900 focus:outline-hidden focus:border-slate-800 focus:ring-1 focus:ring-slate-800 resize-none"
                />
                <span className="text-[11px] text-slate-500">
                  This note will be recorded permanently in the official audit trail with your user identity and timestamp.
                </span>
              </div>

              {/* Preset suggestion chips */}
              <div>
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
                  Common justification templates:
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => applyPresetReason('Paper receipt voided due to counter printer malfunction.')}
                    className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-medium transition-colors"
                  >
                    + Print incident
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPresetReason('Offline sequence collision reconciled via official re-issuance.')}
                    className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-medium transition-colors"
                  >
                    + Offline sync collision
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPresetReason('Physical receipt slip damaged during collection, formal notice drafted.')}
                    className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-medium transition-colors"
                  >
                    + Damaged slip
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPresetReason('Technical test receipt voided prior to active shift opening.')}
                    className="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-medium transition-colors"
                  >
                    + Technical test
                  </button>
                </div>
              </div>

              {/* Visa signing box */}
              <div className="p-3 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-between text-[12px] text-slate-600">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>
                    Official Signatory: <strong>{userProfile?.displayName || currentUser?.displayName || 'Auditor / Supervisor'}</strong> ({userRole})
                  </span>
                </div>
                <span className="font-mono text-slate-400">
                  {todayDateString()}
                </span>
              </div>

              {/* Modal Actions */}
              <div className="pt-3 border-t border-slate-200 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setSelectedAnomalyForResolve(null)}
                  className="px-4 py-2 text-xs font-bold rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resolving || resolutionNoteInput.trim().length < 5}
                  className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-bold rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white shadow-md disabled:opacity-50 transition-colors"
                >
                  {resolving && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Sign Visa & Mark Explained</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
