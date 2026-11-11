import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Search,
  Filter,
  Download,
  Clock,
  User,
  FileText,
  Lock,
  RefreshCw,
  GitCompare,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Building2,
  Receipt,
  Scale,
  DollarSign,
  UserX,
  FileCheck2,
  CheckCircle2,
  ArrowRight
} from 'lucide-react';
import { AuditLog, UserRole } from '../types';
import { getAuditLogs, subscribeToAuditLogs } from '../services/dbService';
import { todayDateString } from '../utils/date';
import { buildCsv } from '../utils/csv';
import { PageHeader, Button, Badge, Panel, MetricStrip } from './ui';

interface AuditLogViewProps {
  userRole: UserRole;
}

export const AuditLogView: React.FC<AuditLogViewProps> = ({ userRole }) => {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [entityFilter, setEntityFilter] = useState<string>('ALL');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set());

  const isAuthorized = userRole === 'Admin' || userRole === 'Auditor';

  useEffect(() => {
    if (!isAuthorized) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubscribe = subscribeToAuditLogs(
      (data) => {
        setLogs(data || []);
        setLoading(false);
      },
      (err) => {
        console.error('[Audit Logs] Real-time listener error:', err);
        setLoading(false);
      }
    );

    return () => {
      unsubscribe();
    };
  }, [isAuthorized]);

  const reloadLogs = async () => {
    setLoading(true);
    try {
      const data = await getAuditLogs();
      setLogs(data || []);
    } catch (err) {
      console.warn('[Audit Logs] Reload error:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (logId: string) => {
    setExpandedLogIds((prev) => {
      const next = new Set(prev);
      if (next.has(logId)) {
        next.delete(logId);
      } else {
        next.add(logId);
      }
      return next;
    });
  };

  const expandAllWithDiff = () => {
    const withDiff = filtered.filter((l) => l.beforeValue || l.afterValue).map((l) => l.id);
    setExpandedLogIds(new Set(withDiff));
  };

  const collapseAll = () => {
    setExpandedLogIds(new Set());
  };

  const filtered = logs.filter((l) => {
    const q = (searchQuery || '').toLowerCase();
    const matchesSearch =
      (l.userName || '').toLowerCase().includes(q) ||
      (l.action || '').toLowerCase().includes(q) ||
      (l.entityId || '').toLowerCase().includes(q) ||
      (l.details || '').toLowerCase().includes(q);

    const matchesEntity = entityFilter === 'ALL' || l.entityType === entityFilter;
    const matchesRole = roleFilter === 'ALL' || l.userRole === roleFilter;

    return matchesSearch && matchesEntity && matchesRole;
  });

  // CSV Export Functionality
  const exportToCSV = () => {
    if (filtered.length === 0) return;

    const headers = [
      'ID_Audit',
      'Date_Heure',
      'Agent_Nom',
      'Agent_Role',
      'Action_Code',
      'Entite_Type',
      'Entite_ID',
      'Details',
      'Valeur_Avant',
      'Valeur_Apres'
    ];

    const formatValueForCsv = (val: any): string => {
      if (val === null || val === undefined) return '';
      if (typeof val === 'object') return JSON.stringify(val);
      return String(val);
    };

    const rows = filtered.map((log) => [
      log.id,
      log.timestamp,
      log.userName || '',
      log.userRole,
      log.action,
      log.entityType,
      log.entityId,
      log.details || '',
      formatValueForCsv(log.beforeValue),
      formatValueForCsv(log.afterValue),
    ]);

    const csvContent = '\uFEFF' + buildCsv([headers, ...rows], ';');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStr = todayDateString();
    link.setAttribute('href', url);
    link.setAttribute('download', `journal_audit_patente_goma_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'Admin':
        return (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-purple-100 text-purple-800 border border-purple-200">
            Admin
          </span>
        );
      case 'Supervisor':
        return (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
            Supervisor
          </span>
        );
      case 'Cashier':
        return (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
            Cashier
          </span>
        );
      default:
        return (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
            Auditor
          </span>
        );
    }
  };

  const getEntityIcon = (type: AuditLog['entityType']) => {
    switch (type) {
      case 'Business':
      case 'Taxpayer':
        return <Building2 className="w-3.5 h-3.5 text-blue-600" />;
      case 'TaxRate':
      case 'TaxRateConfig':
        return <Scale className="w-3.5 h-3.5 text-purple-600" />;
      case 'Assessment':
        return <FileCheck2 className="w-3.5 h-3.5 text-amber-600" />;
      case 'Payment':
        return <Receipt className="w-3.5 h-3.5 text-emerald-600" />;
      case 'Deregistration':
      case 'Compliance':
        return <UserX className="w-3.5 h-3.5 text-red-600" />;
      default:
        return <FileText className="w-3.5 h-3.5 text-slate-500" />;
    }
  };

  const getActionBadge = (action: string) => {
    if (action.includes('PAYMENT')) {
      return (
        <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 font-mono font-bold text-[11px] border border-emerald-200">
          {action}
        </span>
      );
    }
    if (action.includes('DEREGISTERED') || action.includes('CANCEL')) {
      return (
        <span className="px-2 py-0.5 rounded bg-red-50 text-red-800 font-mono font-bold text-[11px] border border-red-200">
          {action}
        </span>
      );
    }
    if (action.includes('RATE') || action.includes('VERSION')) {
      return (
        <span className="px-2 py-0.5 rounded bg-purple-50 text-purple-800 font-mono font-bold text-[11px] border border-purple-200">
          {action}
        </span>
      );
    }
    if (action.includes('ASSESSMENT')) {
      return (
        <span className="px-2 py-0.5 rounded bg-amber-50 text-amber-800 font-mono font-bold text-[11px] border border-amber-200">
          {action}
        </span>
      );
    }
    return (
      <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-800 font-mono font-bold text-[11px] border border-slate-200">
        {action}
      </span>
    );
  };

  const renderValuePreview = (val: any) => {
    if (val === null || val === undefined) {
      return <span className="text-slate-400 italic">No data</span>;
    }
    if (typeof val === 'string') {
      return <span className="font-mono text-slate-800">{val}</span>;
    }
    return (
      <pre className="text-[12px] font-mono text-slate-800 whitespace-pre-wrap overflow-x-auto p-2 rounded bg-white/80 border border-slate-200">
        {JSON.stringify(val, null, 2)}
      </pre>
    );
  };

  // Guard: Admin & Auditor only
  if (!isAuthorized) {
    return (
      <div className="bg-white rounded-xl border border-red-200 p-8 text-center max-w-lg mx-auto my-12 shadow-sm">
        <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4 border border-red-200">
          <Lock className="w-6 h-6" />
        </div>
        <h3 className="text-lg font-bold text-slate-900 mb-1">
          Restricted Access: Reserved for Admin / Auditor
        </h3>
        <p className="text-xs text-slate-600 leading-relaxed">
          The Immutable Audit Trail maintains a certified cryptographic log of all
fiscal events (business registrations, rate schedule updates, assessments, and collections). Your current role (
<span className="font-bold text-slate-800">{userRole}</span>) does not possess the required inspection clearance.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 font-sans">
      
      {/* Official Header */}
      <PageHeader
        eyebrow="Governance"
        title="Official Audit Trail"
        description="Complete read-only chronological ledger: business registrations, rate versions, assessments, and cashier receipts."
        actions={
          <>
            <Button
              variant="ghost"
              size="md"
              icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
              onClick={reloadLogs}
              disabled={loading}
            >
              Refresh
            </Button>
            <Button
              variant="primary"
              size="md"
              icon={<Download className="w-3.5 h-3.5" />}
              onClick={exportToCSV}
              disabled={filtered.length === 0}
            >
              Export CSV ({filtered.length})
            </Button>
          </>
        }
      />

      {/* Auditor Clearance Banner */}
      <div className="p-4 rounded-xl bg-amber-50/80 border border-amber-200 text-xs text-amber-950 flex items-start gap-3 shadow-xs">
        <Lock className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
        <div>
          <span className="font-bold text-amber-900">Guaranteed Regulatory Control:</span> In accordance with
          North Kivu Provincial Finance standards, each record permanently logs the operating officer, certified
          timestamp, target ID, and exact values{' '}
          <span className="font-bold underline">Before and After</span> each mutation.
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-surface rounded-[18px] border border-line p-4 shadow-card flex flex-col md:flex-row items-stretch md:items-center gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            id="audit-search-input"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs rounded-[10px] border border-line bg-surface2 focus:outline-hidden focus:ring-2 focus:ring-accent text-ink placeholder:text-muted transition-premium font-sans"
          />
        </div>

        {/* Category Filter */}
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-muted shrink-0" />
          <select
            id="audit-entity-filter"
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
            className="px-3 py-2 text-xs rounded-[10px] border border-line bg-surface2 text-ink font-medium font-sans cursor-pointer"
          >
            <option value="ALL">All Categories</option>
            <option value="Business">Businesses (/businesses)</option>
            <option value="TaxRate">Rate Schedule (/taxRates)</option>
            <option value="Assessment">Assessments (/assessments)</option>
            <option value="Payment">Payments (/payments)</option>
            <option value="Deregistration">Closure & Compliance</option>
            <option value="Taxpayer">Taxpayers (/taxpayers)</option>
            <option value="User">Users & Roles</option>
          </select>
        </div>

        {/* Actor Role Filter */}
        <select
          id="audit-role-filter"
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          className="px-3 py-2 text-xs rounded-[10px] border border-line bg-surface2 text-ink font-medium font-sans cursor-pointer"
        >
          <option value="ALL">All Roles</option>
          <option value="Admin">Admin</option>
          <option value="Supervisor">Supervisor</option>
          <option value="Cashier">Cashier</option>
          <option value="Auditor">Auditor</option>
        </select>

        {/* Quick expand/collapse diffs */}
        <div className="flex items-center gap-1.5 border-l border-line pl-2">
          <button
            type="button"
            onClick={expandAllWithDiff}
            className="px-2.5 py-1 text-[12px] font-semibold text-muted hover:text-ink hover:bg-surface2 rounded-[8px] transition-premium cursor-pointer"
          >
            Expand Diffs
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="px-2.5 py-1 text-[12px] font-semibold text-muted hover:text-ink hover:bg-surface2 rounded-[8px] transition-premium cursor-pointer"
          >
            Collapse All
          </button>
        </div>
      </div>

      {/* Main Ledger Table */}
      <Panel
        title="Immutable Audit Ledger"
        subtitle={`Displaying ${filtered.length} of ${logs.length} logged municipal events`}
        padding="none"
      >
        <div className="overflow-x-auto">
          <table className="premium-table w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-surface2/60 border-b border-line text-faint font-bold uppercase tracking-[0.1em] text-[11px]">
                <th className="py-3 px-4">Timestamp (Goma / UTC)</th>
                <th className="py-3 px-4">Actor & Role</th>
                <th className="py-3 px-4">Action Code</th>
                <th className="py-3 px-4">Target Entity</th>
                <th className="py-3 px-4">Description & Justification</th>
                <th className="py-3 px-4 text-right">Changes (Before / After)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-slate-400" />
                    Loading audit trail ledger...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-slate-400">
                    No audit events match current filters.
                  </td>
                </tr>
              ) : (
                filtered.map((log) => {
                  const isExpanded = expandedLogIds.has(log.id);
                  const hasDiff = log.beforeValue !== undefined && log.beforeValue !== null ||
                    log.afterValue !== undefined && log.afterValue !== null;

                  return (
                    <React.Fragment key={log.id}>
                      <tr
                        className={`hover:bg-slate-50/70 transition-colors ${
                          isExpanded ? 'bg-slate-50/90' : ''
                        }`}
                      >
                        {/* Timestamp */}
                        <td className="py-3 px-4 font-mono text-[12px] text-slate-500 whitespace-nowrap">
                          {new Date(log.timestamp).toLocaleString('en-US', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                          })}
                        </td>

                        {/* Actor & Role */}
                        <td className="py-3 px-4">
                          <div className="font-bold text-slate-900">{log.userName}</div>
                          <div className="mt-0.5">{getRoleBadge(log.userRole)}</div>
                        </td>

                        {/* Action Code */}
                        <td className="py-3 px-4 whitespace-nowrap">
                          {getActionBadge(log.action)}
                        </td>

                        {/* Target Entity */}
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-1.5 font-semibold text-slate-800">
                            {getEntityIcon(log.entityType)}
                            <span>{log.entityType}</span>
                          </div>
                          <div className="font-mono text-[11px] text-slate-400 truncate max-w-[120px]">
                            {log.entityId}
                          </div>
                        </td>

                        {/* Details */}
                        <td className="py-3 px-4 text-slate-600 text-xs max-w-md">
                          {log.details}
                        </td>

                        {/* Before / After toggle */}
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          {hasDiff ? (
                            <button
                              type="button"
                              onClick={() => toggleExpand(log.id)}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-semibold border transition-colors ${
                                isExpanded
                                  ? 'bg-slate-900 text-amber-300 border-slate-800'
                                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                              }`}
                            >
                              <GitCompare className="w-3 h-3" />
                              <span>{isExpanded ? 'Hide Diff' : 'View Diff'}</span>
                              {isExpanded ? (
                                <ChevronUp className="w-3 h-3 ml-0.5" />
                              ) : (
                                <ChevronDown className="w-3 h-3 ml-0.5" />
                              )}
                            </button>
                          ) : (
                            <span className="text-[12px] text-slate-400 italic">No changes</span>
                          )}
                        </td>
                      </tr>

                      {/* Expanded Before / After Row */}
                      {isExpanded && hasDiff && (
                        <tr className="bg-slate-50/90 border-b border-slate-200">
                          <td colSpan={6} className="px-6 py-4">
                            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
                              <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
                                <div className="flex items-center gap-2">
                                  <GitCompare className="w-4 h-4 text-amber-600" />
                                  <span className="text-xs font-bold text-slate-900">
                                    Certified state comparison (Before vs After mutation)
                                  </span>
                                </div>
                                <span className="text-[11px] font-mono text-slate-400">
                                  Event: {log.id}
                                </span>
                              </div>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* Before Value Card */}
                                <div className="rounded-lg border border-red-200 bg-red-50/30 p-3 space-y-1.5">
                                  <div className="flex items-center justify-between text-xs font-bold text-red-800">
                                    <span>Prior State (Before)</span>
                                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                                      {log.beforeValue === null ? 'Created' : 'Modified'}
                                    </span>
                                  </div>
                                  <div className="text-xs text-slate-700">
                                    {log.beforeValue === null ? (
                                      <div className="text-slate-400 italic py-2 text-[12px]">
                                        No prior state (New record created in the system).
                                      </div>
                                    ) : (
                                      renderValuePreview(log.beforeValue)
                                    )}
                                  </div>
                                </div>

                                {/* After Value Card */}
                                <div className="rounded-lg border border-emerald-200 bg-emerald-50/30 p-3 space-y-1.5">
                                  <div className="flex items-center justify-between text-xs font-bold text-emerald-800">
                                    <span>Subsequent State (After)</span>
                                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                                      Recorded
                                    </span>
                                  </div>
                                  <div className="text-xs text-slate-700">
                                    {renderValuePreview(log.afterValue)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Table footer with row count */}
        <div className="p-3.5 bg-surface2/50 border-t border-line flex items-center justify-between text-xs text-muted">
          <div>
            Showing <span className="font-bold text-ink tabular-nums">{filtered.length}</span> record(s) out of{' '}
            <span className="font-bold text-ink tabular-nums">{logs.length}</span> total
          </div>
          <div className="text-[12px] text-faint">
                Immutable Audit Trail • DPRNK Fiscal Ledger
          </div>
        </div>
      </Panel>
    </div>
  );
};
