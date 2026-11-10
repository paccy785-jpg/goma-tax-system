import { formatMoney } from '../utils/money';
import { buildCsv } from '../utils/csv';
import React, { useEffect, useMemo, useState } from 'react';
import {
  WalletCards,
  Send,
  Download,
  Search,
  UsersRound,
  Banknote,
  CalendarDays,
  CheckCircle2,
  Clock3,
  ArrowUpRight,
  Plus,
  HandCoins,
  Landmark,
  MoreHorizontal,
  X,
  Filter,
  CircleDollarSign,
  TrendingUp,
  ShieldCheck,
} from 'lucide-react';
import { UserRole } from '../types';
import { todayDateString } from '../utils/date';
import { currentCycleLabel, defaultAdvanceDueDate, nextPayday } from '../utils/payroll';
import { parseAmount } from '../utils/taxCalc';
import { useToast } from '../contexts/ToastContext';
import { PageHeader, Button, Badge, Panel, MetricStrip } from './ui';

interface PayrollEmployee {
  id: string;
  name: string;
  role: string;
  department: string;
  initials: string;
  account: string;
  grossUSD: number;
  status: 'ready' | 'paid';
  paidAt?: string;
  paymentMethod?: string;
  reference?: string;
}

interface SalaryAdvance {
  id: string;
  employeeId: string;
  employeeName: string;
  amountUSD: number;
  issuedAt: string;
  dueDate: string;
  reason: string;
  status: 'outstanding' | 'settled';
  repaidAt?: string;
}

interface PayrollState {
  employees: PayrollEmployee[];
  advances: SalaryAdvance[];
  cycle: string;
}

interface PayrollViewProps {
  userRole: UserRole;
}

const STORAGE_KEY = 'goma_payroll_workspace_v1';

const seedPayrollState = (): PayrollState => ({
  cycle: currentCycleLabel(),
  employees: [],
  advances: [],
});

const loadPayrollState = (): PayrollState => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as PayrollState;
      // Keyed on the array existing, not on it being non-empty: an empty
      // employee list is a real state once employees can be removed, and
      // falling back to the seed would silently discard the advance ledger.
      //
      // The cycle is refreshed to the current month on every load: it was
      // seeded from a literal, so a workspace restored from an earlier month
      // would keep announcing a cycle that had already gone by.
      if (Array.isArray(parsed?.employees)) {
        return { ...parsed, cycle: currentCycleLabel() };
      }
    }
  } catch {
    // A malformed cache should never block the payroll workspace.
  }
  return seedPayrollState();
};

const money = (amount: number) => formatMoney(amount);

const shortDate = (value?: string) => {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const avatarTone = (index: number) => {
  const tones = [
    'from-accent/80 to-accent-dark text-white',
    'from-navy/90 to-navy2 text-white',
    'from-sage/85 to-sage/60 text-white',
    'from-warn/85 to-accent/70 text-white',
  ];
  return tones[index % tones.length];
};

/** Two-letter monogram for the avatar, derived from the name itself. */
const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

/**
 * Salary input is free text, so accept the separators an officer may type.
 *
 * Delegates to the shared parser, which understands French thousands grouping:
 * the local copy swapped the first comma for a dot, so a salary typed "1,250"
 * was read as 1.25 and the payroll line was computed from a hundredth of it.
 */
const parseSalary = (raw: string): number => {
  if (!raw.trim()) return NaN;
  return parseAmount(raw);
};

export const PayrollView: React.FC<PayrollViewProps> = ({ userRole }) => {
  const { showToast } = useToast();
  const [workspace, setWorkspace] = useState<PayrollState>(() => loadPayrollState());
  const [activeTab, setActiveTab] = useState<'run' | 'advances' | 'employees'>('run');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'ready' | 'paid'>('all');

  // Employee register — the roster the payroll run and advances both draw from.
  const [employeeModalOpen, setEmployeeModalOpen] = useState(false);
  const [employeeName, setEmployeeName] = useState('');
  const [employeeRole, setEmployeeRole] = useState('');
  const [employeeSalary, setEmployeeSalary] = useState('');
  const [disbursementTarget, setDisbursementTarget] = useState<'batch' | PayrollEmployee | null>(null);
  const [advanceModalOpen, setAdvanceModalOpen] = useState(false);
  const [selectedAdvanceEmployee, setSelectedAdvanceEmployee] = useState('');
  const [advanceAmount, setAdvanceAmount] = useState('');
  const [advanceReason, setAdvanceReason] = useState('');
  // No date or method is chosen on the officer's behalf. The payment date was
  // previously frozen at a literal in the source, so every payroll run was filed
  // as if it happened on that day.
  const [advanceDueDate, setAdvanceDueDate] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentDate, setPaymentDate] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');

  const canDisburse = userRole === 'Admin' || userRole === 'Supervisor';
  const canManageAdvances = canDisburse;
  const canManageEmployees = canDisburse;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
    } catch {
      // Persistence is a convenience; the active session remains usable without it.
    }
  }, [workspace]);

  const metrics = useMemo(() => {
    const gross = workspace.employees.reduce((sum, employee) => sum + employee.grossUSD, 0);
    const disbursed = workspace.employees.filter((employee) => employee.status === 'paid').reduce((sum, employee) => sum + employee.grossUSD, 0);
    const outstanding = workspace.advances.filter((advance) => advance.status === 'outstanding').reduce((sum, advance) => sum + advance.amountUSD, 0);
    const readyCount = workspace.employees.filter((employee) => employee.status === 'ready').length;
    return { gross, disbursed, outstanding, readyCount, paidCount: workspace.employees.length - readyCount, progress: gross ? Math.round((disbursed / gross) * 100) : 0 };
  }, [workspace]);

  const filteredEmployees = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return workspace.employees.filter((employee) => {
      const matchesQuery = !normalized || `${employee.name} ${employee.role} ${employee.department}`.toLowerCase().includes(normalized);
      const matchesStatus = statusFilter === 'all' || employee.status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [query, statusFilter, workspace.employees]);

  const outstandingAdvances = workspace.advances.filter((advance) => advance.status === 'outstanding');
  const readyEmployees = workspace.employees.filter((employee) => employee.status === 'ready');

  const openBatchDisbursement = () => {
    if (!canDisburse || readyEmployees.length === 0) return;
    setPaymentReference(`PAY-${workspace.cycle.slice(0, 3).toUpperCase()}-${String(workspace.employees.length + 1).padStart(3, '0')}`);
    setDisbursementTarget('batch');
  };

  const openEmployeeDisbursement = (employee: PayrollEmployee) => {
    if (!canDisburse || employee.status === 'paid') return;
    setPaymentReference(`PAY-${workspace.cycle.slice(0, 3).toUpperCase()}-${employee.id.slice(-3)}`);
    setDisbursementTarget(employee);
  };

  const closeDisbursement = () => {
    setDisbursementTarget(null);
    setPaymentNotes('');
  };

  const confirmDisbursement = (event: React.FormEvent) => {
    event.preventDefault();
    if (!disbursementTarget || !paymentReference.trim()) {
      showToast('Add a payment reference before confirming this run.', 'warning', 'Reference required');
      return;
    }

    const targetIds = disbursementTarget === 'batch'
      ? readyEmployees.map((employee) => employee.id)
      : [disbursementTarget.id];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
      showToast('Pick a valid payment date before confirming this run.', 'warning', 'Invalid date');
      return;
    }
    if (!paymentMethod) {
      showToast('State how these salaries are being paid.', 'warning', 'Payment method required');
      return;
    }
    const paidAt = new Date(`${paymentDate}T12:00:00`).toISOString();

    setWorkspace((current) => ({
      ...current,
      employees: current.employees.map((employee) => targetIds.includes(employee.id)
        ? { ...employee, status: 'paid', paidAt, paymentMethod, reference: paymentReference.trim() }
        : employee),
    }));
    showToast(
      `${targetIds.length} salary ${targetIds.length === 1 ? 'payment' : 'payments'} marked as disbursed.`,
      'success',
      'Payroll run confirmed'
    );
    closeDisbursement();
  };

  const openEmployeeModal = () => {
    if (!canManageEmployees) return;
    setEmployeeName('');
    setEmployeeRole('');
    setEmployeeSalary('');
    setEmployeeModalOpen(true);
  };

  const submitEmployee = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManageEmployees) return;

    const name = employeeName.trim().replace(/\s+/g, ' ');
    if (!name) {
      showToast('Enter the employee’s full name to add them to the payroll.', 'warning', 'Name required');
      return;
    }
    const salary = parseSalary(employeeSalary);
    if (!Number.isFinite(salary) || salary <= 0) {
      showToast('Enter the gross monthly salary, greater than zero.', 'warning', 'Salary required');
      return;
    }

    const employee: PayrollEmployee = {
      id: `emp-${Date.now()}`,
      name,
      role: employeeRole.trim() || 'Employee',
      department: '',
      initials: initialsOf(name),
      account: '—',
      // Rounded to cents here, so the ledger never carries float noise into the
      // payroll total.
      grossUSD: Math.round(salary * 100) / 100,
      status: 'ready',
    };

    setWorkspace((current) => ({ ...current, employees: [employee, ...current.employees] }));
    setEmployeeModalOpen(false);
    showToast(`${name} added to payroll at ${money(employee.grossUSD)} gross.`, 'success', 'Employee added');
  };

  /**
   * Remove an employee who has not been paid yet.
   *
   * A released salary is a disbursement record, not just a roster entry —
   * deleting it would erase what the treasury actually paid out, so those rows
   * are locked. Correcting a name or salary means removing an unpaid row and
   * re-adding it.
   */
  const removeEmployee = (employee: PayrollEmployee) => {
    if (!canManageEmployees || employee.status === 'paid') return;
    setWorkspace((current) => ({
      ...current,
      employees: current.employees.filter((item) => item.id !== employee.id),
    }));
    showToast(`${employee.name} removed from the payroll roster.`, 'success', 'Employee removed');
  };

  const openAdvanceModal = () => {
    if (!canManageAdvances) return;
    setSelectedAdvanceEmployee(workspace.employees[0]?.id || '');
    setAdvanceAmount('');
    setAdvanceReason('');
    setAdvanceDueDate(defaultAdvanceDueDate(todayDateString()));
    setAdvanceModalOpen(true);
  };

  const submitAdvance = (event: React.FormEvent) => {
    event.preventDefault();
    // Read the amount the way the salary field on the same screen is read:
    // "2 500" is 2 500 in the system's own number format, and refusing it
    // here while accepting it a few fields up is just confusing.
    const amount = parseSalary(advanceAmount);
    const employee = workspace.employees.find((item) => item.id === selectedAdvanceEmployee);
    if (!employee || !Number.isFinite(amount) || amount <= 0) {
      showToast('Enter a valid advance amount greater than zero.', 'warning', 'Check advance details');
      return;
    }
    if (amount > employee.grossUSD * 0.5) {
      showToast('Advances are capped at 50% of the employee’s gross salary.', 'warning', 'Advance limit reached');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(advanceDueDate)) {
      showToast('Set the date the advance falls due.', 'warning', 'Repayment date required');
      return;
    }
    const advance: SalaryAdvance = {
      id: `adv-${Date.now()}`,
      employeeId: employee.id,
      employeeName: employee.name,
      amountUSD: amount,
      issuedAt: new Date().toISOString(),
      dueDate: advanceDueDate,
      reason: advanceReason.trim() || 'Salary advance',
      status: 'outstanding',
    };
    setWorkspace((current) => ({ ...current, advances: [advance, ...current.advances] }));
    setAdvanceModalOpen(false);
    setActiveTab('advances');
    showToast(`${money(amount)} advance issued to ${employee.name}.`, 'success', 'Advance recorded');
  };

  const settleAdvance = (advance: SalaryAdvance) => {
    setWorkspace((current) => ({
      ...current,
      advances: current.advances.map((item) => item.id === advance.id
        ? { ...item, status: 'settled', repaidAt: new Date().toISOString() }
        : item),
    }));
    showToast(`Advance for ${advance.employeeName} marked as fully repaid.`, 'success', 'Advance settled');
  };

  const exportLedger = () => {
    const rows = [
      ['Employee', 'Department', 'Gross USD', 'Status', 'Paid at', 'Reference'],
      ...workspace.employees.map((employee) => [employee.name, employee.department, String(employee.grossUSD), employee.status, employee.paidAt || '', employee.reference || '']),
    ];
    const csv = buildCsv(rows);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'goma-payroll-ledger.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('Payroll ledger exported as CSV.', 'success', 'Export ready');
  };


  return (
    <div className="space-y-8 font-sans">
      <PageHeader
        eyebrow="PEOPLE OPERATIONS • PAYROLL CYCLE"
        title="Payroll Command Center"
        description="Disburse salaries with confidence and keep every salary advance visible, accountable, and on schedule."
        actions={
          <>
            <Button variant="ghost" size="md" icon={<Download className="w-4 h-4" />} onClick={exportLedger}>
              Export ledger
            </Button>
            <Button variant="primary" size="md" icon={<Send className="w-4 h-4" />} onClick={openBatchDisbursement} disabled={!canDisburse || readyEmployees.length === 0}>
              Disburse payroll
            </Button>
          </>
        }
      />

      {/* Premium payroll cycle hero */}
      <section className="relative overflow-hidden rounded-[24px] bg-navy text-white border border-navy2/80 shadow-[0_24px_60px_-28px_oklch(28%_0.045_258/0.7)]">
        <div className="absolute -right-16 -top-24 w-72 h-72 rounded-full bg-accent/20 blur-3xl" />
        <div className="absolute right-20 -bottom-28 w-64 h-64 rounded-full bg-sage/15 blur-3xl" />
        <div className="relative p-6 sm:p-8 lg:flex lg:items-center lg:justify-between gap-8">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <Badge variant="accent" dot>Cycle open</Badge>
              <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/50">Last updated just now</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-[14px] bg-white/10 border border-white/15 flex items-center justify-center">
                <WalletCards className="w-5 h-5 text-accent-soft" />
              </div>
              <div>
                <p className="text-xs font-semibold text-white/60 uppercase tracking-[0.14em]">Scheduled payroll</p>
                <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-[-0.04em]">{workspace.cycle}</h2>
              </div>
            </div>
            <div className="mt-6 max-w-xl">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="text-white/60">Disbursement progress</span>
                <span className="font-bold text-white tabular-nums">{metrics.progress}% complete</span>
              </div>
              <div className="h-2.5 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-accent to-sage transition-all duration-700" style={{ width: `${metrics.progress}%` }} />
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-white/55">
                <span>{metrics.paidCount} paid</span>
                <span>{metrics.readyCount} ready to release</span>
                <span>Next payroll: {nextPayday().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
              </div>
            </div>
          </div>

          <div className="mt-7 lg:mt-0 shrink-0 lg:text-right">
            {/* Label the figure honestly: the payroll model has no deduction
                step — disbursement releases each employee's full gross — so the
                hero figure was the gross, not the net. */}
            <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-white/50">Gross cycle value</p>
            <div className="font-display text-4xl sm:text-5xl font-bold tracking-[-0.06em] mt-1 tabular-nums">{money(metrics.gross)}</div>
            <div className="inline-flex items-center gap-2 mt-4 px-3 py-2 rounded-full bg-white/10 border border-white/10 text-xs text-white/75">
              <ShieldCheck className="w-3.5 h-3.5 text-sage" />
              Maker-checker ready
            </div>
          </div>
        </div>
      </section>

      <MetricStrip
        columns={4}
        className="mt-0"
        items={[
          { label: 'Gross payroll', value: money(metrics.gross), subline: `${workspace.employees.length} employees`, icon: <Banknote className="w-4 h-4" /> },
          { label: 'Disbursed', value: money(metrics.disbursed), trend: `${metrics.progress}%`, trendType: 'sage', subline: 'This cycle', icon: <CheckCircle2 className="w-4 h-4" /> },
          { label: 'Advances outstanding', value: money(metrics.outstanding), trend: `${outstandingAdvances.length} active`, trendType: 'warn', subline: 'Repayment watchlist', icon: <HandCoins className="w-4 h-4" /> },
          { label: 'Next payday', value: nextPayday().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), subline: 'Monthly • 30-day cycle', icon: <CalendarDays className="w-4 h-4" /> },
        ]}
      />

      {/* Workspace tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="inline-flex p-1 rounded-[14px] bg-surface2 border border-line w-fit">
          <button
            type="button"
            onClick={() => setActiveTab('run')}
            className={`px-4 py-2 rounded-[10px] text-xs font-bold transition-premium cursor-pointer ${activeTab === 'run' ? 'bg-surface text-ink shadow-xs' : 'text-muted hover:text-ink'}`}
          >
            Payroll run <span className="ml-1.5 text-[11px] opacity-60">{workspace.employees.length}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('advances')}
            className={`px-4 py-2 rounded-[10px] text-xs font-bold transition-premium cursor-pointer ${activeTab === 'advances' ? 'bg-surface text-ink shadow-xs' : 'text-muted hover:text-ink'}`}
          >
            Salary advances <span className="ml-1.5 text-[11px] opacity-60">{workspace.advances.length}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('employees')}
            className={`px-4 py-2 rounded-[10px] text-xs font-bold transition-premium cursor-pointer ${activeTab === 'employees' ? 'bg-surface text-ink shadow-xs' : 'text-muted hover:text-ink'}`}
          >
            Employees <span className="ml-1.5 text-[11px] opacity-60">{workspace.employees.length}</span>
          </button>
        </div>
        <div className="flex items-center gap-2">
          {canManageAdvances && (
            <Button variant="secondary" size="sm" icon={<Plus className="w-4 h-4" />} onClick={openAdvanceModal}>Issue advance</Button>
          )}
          {canManageEmployees && activeTab === 'employees' && (
            <Button variant="primary" size="sm" icon={<UsersRound className="w-4 h-4" />} onClick={openEmployeeModal}>Add employee</Button>
          )}
        </div>
      </div>

      {activeTab === 'run' ? (
        <Panel
          title="Salary disbursement run"
          subtitle="Release approved salaries individually or clear the full ready queue in one controlled action."
          actions={
            <div className="flex items-center gap-2">
              <div className="relative hidden sm:block">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="w-44 lg:w-56 h-9 pl-8 pr-3 rounded-[10px] bg-surface2 border border-line text-xs text-ink placeholder:text-muted focus:border-accent outline-none"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as 'all' | 'ready' | 'paid')}
                className="h-9 px-3 rounded-[10px] bg-surface2 border border-line text-xs font-semibold text-muted cursor-pointer"
                aria-label="Filter payroll status"
              >
                <option value="all">All statuses</option>
                <option value="ready">Ready</option>
                <option value="paid">Paid</option>
              </select>
              <Button variant="primary" size="sm" icon={<Send className="w-4 h-4" />} onClick={openBatchDisbursement} disabled={!canDisburse || readyEmployees.length === 0}>Run payroll</Button>
            </div>
          }
          padding="none"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[820px]">
              <thead className="bg-surface2/70 border-b border-line">
                <tr className="text-[11px] uppercase tracking-[0.1em] text-muted">
                  <th className="font-bold px-6 py-3.5">Employee</th>
                  <th className="font-bold px-4 py-3.5">Account</th>
                  <th className="font-bold px-4 py-3.5 text-right">Gross salary</th>
                  <th className="font-bold px-4 py-3.5">Status</th>
                  <th className="font-bold px-6 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filteredEmployees.map((employee, index) => (
                  <tr key={employee.id} className="hover:bg-surface2/45 transition-premium">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-[11px] bg-gradient-to-br ${avatarTone(index)} flex items-center justify-center font-display font-bold text-[12px] shadow-xs`}>{employee.initials}</div>
                        <div className="min-w-0">
                          <div className="font-bold text-ink text-[14px] truncate">{employee.name}</div>
                          <div className="text-[12px] text-muted truncate">{employee.role}{employee.department ? ` · ${employee.department}` : ''}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-muted whitespace-nowrap">{employee.account}</td>
                    <td className="px-4 py-4 text-right">
                      <div className="font-display font-bold text-ink text-sm tabular-nums">{money(employee.grossUSD)}</div>
                    </td>
                    <td className="px-4 py-4">
                      {employee.status === 'paid' ? (
                        <Badge variant="sage" dot>Paid</Badge>
                      ) : (
                        <Badge variant="warn" dot>Ready</Badge>
                      )}
                      {employee.status === 'paid' && employee.reference && <div className="text-[11px] text-muted mt-1.5 tabular-nums">{employee.reference}</div>}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {employee.status === 'paid' ? (
                        <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-sage"><CheckCircle2 className="w-3.5 h-3.5" /> Released</span>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => openEmployeeDisbursement(employee)} disabled={!canDisburse}>Disburse</Button>
                      )}
                    </td>
                  </tr>
                ))}
                {filteredEmployees.length === 0 && (
                  <tr><td colSpan={5} className="px-6 py-14 text-center text-sm text-muted">No employees match your search.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-4 border-t border-line bg-surface2/40 flex flex-wrap items-center justify-between gap-3 text-[12px] text-muted">
            <span className="inline-flex items-center gap-1.5"><Clock3 className="w-3.5 h-3.5 text-accent" /> Disbursements are recorded locally for this preview workspace.</span>
            <span className="font-semibold text-ink">{filteredEmployees.length} of {workspace.employees.length} employees shown</span>
          </div>
        </Panel>
      ) : activeTab === 'advances' ? (
        <Panel
          title="Salary advances ledger"
          subtitle="Track issued advances, due dates, and repayments without losing sight of the next payroll impact."
          actions={<Button variant="secondary" size="sm" icon={<HandCoins className="w-4 h-4" />} onClick={openAdvanceModal} disabled={!canManageAdvances}>New advance</Button>}
          padding="none"
        >
          <div className="grid lg:grid-cols-[1.1fr_0.9fr] divide-y lg:divide-y-0 lg:divide-x divide-line">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Outstanding exposure</p>
                  <div className="font-display text-3xl font-bold text-ink tracking-[-0.05em] mt-1 tabular-nums">{money(metrics.outstanding)}</div>
                </div>
                <div className="w-10 h-10 rounded-[13px] bg-warn/12 text-warn flex items-center justify-center"><TrendingUp className="w-5 h-5" /></div>
              </div>
              <div className="space-y-3">
                {outstandingAdvances.map((advance, index) => {
                  const isOverdue = advance.dueDate < todayDateString();
                  return (
                    <div key={advance.id} className="p-4 rounded-[15px] border border-line bg-surface2/35 hover:bg-surface2/70 transition-premium">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-8 h-8 rounded-[10px] bg-gradient-to-br ${avatarTone(index)} text-white flex items-center justify-center font-display text-[11px] font-bold`}>{(advance.employeeName || '').split(' ').map((part) => part[0]).filter(Boolean).slice(0, 2).join('')}</div>
                          <div className="min-w-0">
                            <div className="font-bold text-ink text-[14px] truncate">{advance.employeeName}</div>
                            <div className="text-[12px] text-muted truncate">{advance.reason}</div>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-display font-bold text-ink text-sm tabular-nums">{money(advance.amountUSD)}</div>
                          <div className={`text-[11px] font-bold ${isOverdue ? 'text-danger' : 'text-muted'}`}>{isOverdue ? 'Overdue' : `Due ${shortDate(advance.dueDate)}`}</div>
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t border-line flex items-center justify-between gap-3">
                        <span className="text-[11px] text-muted">Issued {shortDate(advance.issuedAt)}</span>
                        {canManageAdvances && <Button variant="ghost" size="sm" onClick={() => settleAdvance(advance)}>Mark repaid</Button>}
                      </div>
                    </div>
                  );
                })}
                {outstandingAdvances.length === 0 && <div className="py-10 text-center text-sm text-muted">No outstanding advances. Nice and tidy.</div>}
              </div>
            </div>

            <div className="p-6 bg-surface2/30">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">Advance history</p>
                  <h3 className="font-display text-lg font-bold text-ink tracking-tight mt-1">Repayment activity</h3>
                </div>
                <Badge variant="neutral">{workspace.advances.length} records</Badge>
              </div>
              <div className="space-y-4">
                {workspace.advances.map((advance) => (
                  <div key={advance.id} className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${advance.status === 'settled' ? 'bg-sage/12 text-sage' : 'bg-warn/12 text-warn'}`}>
                      {advance.status === 'settled' ? <CheckCircle2 className="w-4 h-4" /> : <Clock3 className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-bold text-ink truncate">{advance.employeeName}</span>
                        <span className="text-xs font-bold text-ink tabular-nums">{money(advance.amountUSD)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-3 mt-0.5">
                        <span className="text-[11px] text-muted truncate">{advance.reason}</span>
                        <span className={`text-[11px] font-bold ${advance.status === 'settled' ? 'text-sage' : 'text-warn'}`}>{advance.status === 'settled' ? 'Settled' : 'Outstanding'}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-7 p-4 rounded-[15px] bg-navy text-white border border-navy2">
                <div className="flex items-start gap-3">
                  <CircleDollarSign className="w-4 h-4 text-accent-soft mt-0.5" />
                  <div>
                    <p className="text-xs font-bold">Payroll-safe guardrail</p>
                    <p className="text-[12px] leading-relaxed text-white/60 mt-1">New advances are capped at 50% of gross salary and appear immediately in the outstanding exposure metric.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Panel>
      ) : (
        <Panel
          title="Employee register"
          subtitle="The roster every payroll run and salary advance is drawn from. Add an employee once, with the gross salary they are paid."
          actions={
            <Button variant="secondary" size="sm" icon={<UsersRound className="w-4 h-4" />} onClick={openEmployeeModal} disabled={!canManageEmployees}>
              Add employee
            </Button>
          }
          padding="none"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[820px]">
              <thead className="bg-surface2/70 border-b border-line">
                <tr className="text-[11px] uppercase tracking-[0.1em] text-muted">
                  <th className="font-bold px-6 py-3.5">Employee</th>
                  <th className="font-bold px-4 py-3.5">Account</th>
                  <th className="font-bold px-4 py-3.5 text-right">Gross salary</th>
                  <th className="font-bold px-4 py-3.5">Status</th>
                  <th className="font-bold px-6 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {workspace.employees.map((employee, index) => (
                  <tr key={employee.id} className="hover:bg-surface2/45 transition-premium">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-[11px] bg-gradient-to-br ${avatarTone(index)} flex items-center justify-center font-display font-bold text-[12px] shadow-xs`}>{employee.initials}</div>
                        <div className="min-w-0">
                          <div className="font-bold text-ink text-[14px] truncate">{employee.name}</div>
                          <div className="text-[12px] text-muted truncate">{employee.role}{employee.department ? ` · ${employee.department}` : ''}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-muted whitespace-nowrap">{employee.account}</td>
                    <td className="px-4 py-4 text-right">
                      <div className="font-display font-bold text-ink text-sm tabular-nums">{money(employee.grossUSD)}</div>
                      <div className="text-[11px] text-muted mt-0.5">per month</div>
                    </td>
                    <td className="px-4 py-4">
                      {employee.status === 'paid' ? (
                        <Badge variant="sage" dot>Paid</Badge>
                      ) : (
                        <Badge variant="warn" dot>Ready</Badge>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {employee.status === 'paid' ? (
                        <span
                          className="text-[12px] font-semibold text-muted"
                          title="A released salary is a disbursement record and cannot be removed."
                        >
                          Locked
                        </span>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => removeEmployee(employee)} disabled={!canManageEmployees}>Remove</Button>
                      )}
                    </td>
                  </tr>
                ))}
                {workspace.employees.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-14 text-center">
                      <div className="flex flex-col items-center gap-2 text-sm text-muted">
                        <UsersRound className="w-6 h-6 text-muted/60" />
                        <span>No employees on the payroll yet.</span>
                        {canManageEmployees && (
                          <Button variant="primary" size="sm" icon={<Plus className="w-4 h-4" />} onClick={openEmployeeModal}>
                            Add the first employee
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-4 border-t border-line bg-surface2/40 flex flex-wrap items-center justify-between gap-3 text-[12px] text-muted">
            <span className="inline-flex items-center gap-1.5"><Clock3 className="w-3.5 h-3.5 text-accent" /> Salaries are recorded locally for this preview workspace.</span>
            <span className="font-semibold text-ink">{workspace.employees.length} on the roster</span>
          </div>
        </Panel>
      )}

      {/* Disbursement confirmation */}
      {disbursementTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/70 backdrop-blur-xs">
          <div className="bg-surface rounded-[22px] border border-line shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-5 border-b border-line flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-[13px] bg-accent/12 text-accent flex items-center justify-center"><Send className="w-5 h-5" /></div>
                <div><h3 className="font-display text-lg font-bold text-ink tracking-tight">Confirm salary disbursement</h3><p className="text-xs text-muted mt-0.5">{disbursementTarget === 'batch' ? `${readyEmployees.length} employees ready for release` : disbursementTarget.name}</p></div>
              </div>
              <button type="button" onClick={closeDisbursement} className="p-2 rounded-lg text-muted hover:text-ink hover:bg-surface2 cursor-pointer" aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={confirmDisbursement} className="p-6 space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="block"><span className="block text-xs font-bold text-ink mb-1.5">Payment date</span><input type="date" required value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink" /></label>
                <label className="block"><span className="block text-xs font-bold text-ink mb-1.5">Payment method</span><select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink"><option value="">— Sélectionner —</option><option>Bank Transfer</option><option>Mobile Money</option><option>Cash Payroll</option></select></label>
              </div>
              <label className="block"><span className="block text-xs font-bold text-ink mb-1.5">Payment reference</span><input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink font-mono" placeholder="PAY-OCT-001" /></label>
              <label className="block"><span className="block text-xs font-bold text-ink mb-1.5">Run note <span className="font-normal text-muted">(optional)</span></span><textarea value={paymentNotes} onChange={(event) => setPaymentNotes(event.target.value)} rows={3} className="w-full px-3 py-2.5 rounded-[10px] bg-surface2 border border-line text-sm text-ink resize-none" placeholder="Treasury approval, batch note, or audit context…" /></label>
              <div className="p-4 rounded-[14px] bg-surface2 border border-line flex items-center justify-between gap-4"><div><p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Total to release</p><p className="text-xs text-muted mt-1">{disbursementTarget === 'batch' ? `${readyEmployees.length} employees` : disbursementTarget.role}</p></div><div className="text-right"><p className="font-display text-xl font-bold text-ink tabular-nums">{money(disbursementTarget === 'batch' ? metrics.gross - metrics.disbursed : disbursementTarget.grossUSD)}</p></div></div>
              <div className="flex items-center justify-end gap-2 pt-1"><Button type="button" variant="ghost" size="md" onClick={closeDisbursement}>Cancel</Button><Button type="submit" variant="primary" size="md" icon={<CheckCircle2 className="w-4 h-4" />}>Confirm disbursement</Button></div>
            </form>
          </div>
        </div>
      )}

      {/* Add employee */}
      {employeeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/70 backdrop-blur-xs">
          <div className="bg-surface rounded-[22px] border border-line shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-5 border-b border-line flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-[13px] bg-accent/12 text-accent flex items-center justify-center"><UsersRound className="w-5 h-5" /></div>
                <div>
                  <h3 className="font-display text-lg font-bold text-ink tracking-tight">Add employee</h3>
                  <p className="text-xs text-muted mt-0.5">They join the roster ready for the next payroll run.</p>
                </div>
              </div>
              <button type="button" onClick={() => setEmployeeModalOpen(false)} className="p-2 rounded-lg text-muted hover:text-ink hover:bg-surface2 cursor-pointer" aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={submitEmployee} className="p-6 space-y-4">
              <label className="block">
                <span className="block text-xs font-bold text-ink mb-1.5">Full name</span>
                <input value={employeeName} onChange={(event) => setEmployeeName(event.target.value)} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink placeholder:text-muted focus:border-accent outline-none" placeholder="e.g. Paccy Mwamba" autoFocus />
              </label>
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className="block text-xs font-bold text-ink mb-1.5">Job title</span>
                  <input value={employeeRole} onChange={(event) => setEmployeeRole(event.target.value)} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink placeholder:text-muted focus:border-accent outline-none" placeholder="e.g. Tax Officer" />
                </label>
                <label className="block">
                  <span className="block text-xs font-bold text-ink mb-1.5">Monthly Salary</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={employeeSalary}
                    onChange={(event) => setEmployeeSalary(event.target.value)}
                    className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink placeholder:text-muted focus:border-accent outline-none tabular-nums"
                    placeholder="e.g. 450"
                  />
                </label>
              </div>
              <div className="p-4 rounded-[14px] bg-sage/8 border border-sage/20 flex gap-3">
                <Landmark className="w-4 h-4 text-sage mt-0.5" />
                <p className="text-xs leading-relaxed text-muted">The monthly salary is what the payroll run releases each month, and the ceiling a salary advance is measured against (50%).</p>
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" size="md" onClick={() => setEmployeeModalOpen(false)}>Cancel</Button>
                <Button type="submit" variant="primary" size="md" icon={<Plus className="w-4 h-4" />}>Add employee</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Issue advance */}
      {advanceModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/70 backdrop-blur-xs">
          <div className="bg-surface rounded-[22px] border border-line shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-5 border-b border-line flex items-center justify-between">
              <div className="flex items-center gap-3"><div className="w-10 h-10 rounded-[13px] bg-sage/12 text-sage flex items-center justify-center"><HandCoins className="w-5 h-5" /></div><div><h3 className="font-display text-lg font-bold text-ink tracking-tight">Issue salary advance</h3><p className="text-xs text-muted mt-0.5">Create a tracked advance with a clear repayment date.</p></div></div>
              <button type="button" onClick={() => setAdvanceModalOpen(false)} className="p-2 rounded-lg text-muted hover:text-ink hover:bg-surface2 cursor-pointer" aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={submitAdvance} className="p-6 space-y-4">
              <label className="block"><span className="block text-xs font-bold text-ink mb-1.5">Employee</span><select value={selectedAdvanceEmployee} onChange={(event) => setSelectedAdvanceEmployee(event.target.value)} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink">{workspace.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}{employee.department ? ` · ${employee.department}` : ''}</option>)}</select></label>
              <div className="grid sm:grid-cols-2 gap-4"><label className="block"><span className="block text-xs font-bold text-ink mb-1.5">Amount (USD)</span><input type="number" min="1" step="1" value={advanceAmount} onChange={(event) => setAdvanceAmount(event.target.value)} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink" placeholder="250" /></label><label className="block"><span className="block text-xs font-bold text-ink mb-1.5">Repayment due</span><input type="date" required value={advanceDueDate} onChange={(event) => setAdvanceDueDate(event.target.value)} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink" /></label></div>
              <label className="block"><span className="block text-xs font-bold text-ink mb-1.5">Reason</span><input value={advanceReason} onChange={(event) => setAdvanceReason(event.target.value)} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink" placeholder="School fees, medical expense…" /></label>
              <div className="p-4 rounded-[14px] bg-sage/8 border border-sage/20 flex gap-3"><Landmark className="w-4 h-4 text-sage mt-0.5" /><p className="text-xs leading-relaxed text-muted">Advances are capped at 50% of gross salary and will appear in the outstanding exposure metric immediately.</p></div>
              <div className="flex items-center justify-end gap-2 pt-1"><Button type="button" variant="ghost" size="md" onClick={() => setAdvanceModalOpen(false)}>Cancel</Button><Button type="submit" variant="primary" size="md" icon={<Plus className="w-4 h-4" />}>Issue advance</Button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

