import { formatMoney } from '../utils/money';
import { buildCsv } from '../utils/csv';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Repeat2,
  Plus,
  Download,
  Search,
  Banknote,
  CalendarClock,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Pause,
  Play,
  Pencil,
  Trash2,
  X,
  HandCoins,
  ReceiptText,
  Wallet,
  ShieldCheck,
} from 'lucide-react';
import { ExpenseCategory, ExpenseFrequency, ExpenseRecord, RecurringExpense, UserRole, EXPENSE_CATEGORIES, EXPENSE_FREQUENCIES, EXPENSE_FREQUENCY_LABELS } from '../types';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { PageHeader, Button, Badge, Panel, MetricStrip } from './ui';
import {
  EXPENSE_PAYMENT_METHODS,
  cancelExpenseRecord,
  computeNextDueDate,
  createRecurringExpense,
  deleteRecurringExpense,
  deriveRecordStatus,
  deriveScheduleState,
  generateUpcomingOccurrences,
  getExpenseRecords,
  getRecurringExpenses,
  logOneOffExpense,
  markRecordPaid,
  monthlyEquivalentUSD,
  recordSchedulePayment,
  setScheduleStatus,
  subscribeToExpenseRecords,
  subscribeToRecurringExpenses,
  updateRecurringExpense,
} from '../services/expenseService';
import { todayDateString } from '../utils/date';

interface ExpensesViewProps {
  userRole: UserRole;
}

const money = (amount: number) => formatMoney(amount);

const shortDate = (value?: string | null) => {
  if (!value) return '—';
  const parsed = new Date(`${value}T12:00:00`);
  if (isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const CATEGORY_TONE: Record<ExpenseCategory, string> = {
  Salaries: 'from-navy/90 to-navy2 text-white',
  Rent: 'from-accent/80 to-accent-dark text-white',
  Utilities: 'from-sage/85 to-sage/60 text-white',
  Fuel: 'from-warn/85 to-accent/70 text-white',
  Maintenance: 'from-navy/70 to-sage/70 text-white',
  'Office Supplies': 'from-accent/60 to-warn/60 text-white',
  Transport: 'from-sage/70 to-navy/70 text-white',
  Communication: 'from-accent/70 to-navy/80 text-white',
  'Bank Charges': 'from-navy2 to-navy text-white',
  'Taxes & Fees': 'from-danger/70 to-accent/70 text-white',
  Other: 'from-muted/70 to-navy2/70 text-white',
};

const initialsOf = (name: string) =>
  name.split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'EX';

interface ScheduleFormState {
  title: string;
  category: ExpenseCategory;
  payee: string;
  amount: string;
  frequency: ExpenseFrequency;
  startDate: string;
  endDate: string;
  occurrencesPlanned: string;
  paymentMethod: string;
  notes: string;
}

const emptyScheduleForm = (today: string): ScheduleFormState => ({
  title: '',
  category: 'Rent',
  payee: '',
  amount: '',
  frequency: 'Monthly',
  startDate: today,
  endDate: '',
  occurrencesPlanned: '',
  paymentMethod: EXPENSE_PAYMENT_METHODS[0],
  notes: '',
});

export const ExpensesView: React.FC<ExpensesViewProps> = ({ userRole }) => {
  const { showToast } = useToast();
  const { userProfile } = useAuth();
  const today = useMemo(() => todayDateString(), []);

  const [schedules, setSchedules] = useState<RecurringExpense[]>([]);
  const [records, setRecords] = useState<ExpenseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [activeTab, setActiveTab] = useState<'schedules' | 'ledger'>('schedules');
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | ExpenseCategory>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'Active' | 'Paused' | 'Overdue' | 'DueSoon' | 'Completed' | 'Cancelled'>('all');
  const [freqFilter, setFreqFilter] = useState<'all' | ExpenseFrequency>('all');

  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<RecurringExpense | null>(null);
  const [scheduleForm, setScheduleForm] = useState<ScheduleFormState>(() => emptyScheduleForm(todayDateString()));
  const [savingSchedule, setSavingSchedule] = useState(false);

  const [payTarget, setPayTarget] = useState<RecurringExpense | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(today);
  const [payMethod, setPayMethod] = useState<string>(EXPENSE_PAYMENT_METHODS[0]);
  const [payReference, setPayReference] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [recordingPay, setRecordingPay] = useState(false);

  const [oneOffOpen, setOneOffOpen] = useState(false);
  const [oneOffTitle, setOneOffTitle] = useState('');
  const [oneOffCategory, setOneOffCategory] = useState<ExpenseCategory>('Other');
  const [oneOffPayee, setOneOffPayee] = useState('');
  const [oneOffAmount, setOneOffAmount] = useState('');
  const [oneOffDate, setOneOffDate] = useState(today);
  const [oneOffMethod, setOneOffMethod] = useState<string>(EXPENSE_PAYMENT_METHODS[0]);
  const [oneOffReference, setOneOffReference] = useState('');
  const [oneOffNotes, setOneOffNotes] = useState('');

  const [confirmAction, setConfirmAction] = useState<
    | { kind: 'pause' | 'resume' | 'cancel-schedule' | 'delete'; schedule: RecurringExpense }
    | null
  >(null);
  const [cancelReason, setCancelReason] = useState('');

  const canManage = userRole === 'Admin' || userRole === 'Supervisor';
  const canRecord = canManage || userRole === 'Cashier';
  const actor = {
    uid: userProfile?.uid || 'local_session',
    displayName: userProfile?.displayName || 'Treasury Officer',
    role: userRole,
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setLoadError('');
    const ready = new Set<string>();
    const done = (source: string) => { ready.add(source); if (ready.size === 2) setLoading(false); };
    const fail = () => { if (mounted) { setLoadError('Impossible de charger le registre des dépenses.'); setLoading(false); } };
    const unsubSchedules = subscribeToRecurringExpenses((list) => {
      if (!mounted) return;
      setSchedules(list);
      done('schedules');
    }, fail);
    const unsubRecords = subscribeToExpenseRecords((list) => {
      if (!mounted) return;
      setRecords(list);
      done('records');
    }, fail);
    return () => {
      mounted = false;
      unsubSchedules();
      unsubRecords();
    };
  }, [reloadKey]);

  const metrics = useMemo(() => {
    const active = schedules.filter((s) => s.status === 'Active');
    const monthlyBurn = active.reduce((sum, s) => sum + monthlyEquivalentUSD(s.amountUSD, s.frequency), 0);
    const monthPrefix = today.slice(0, 7);
    const paidMTD = records
      .filter((r) => r.status === 'Paid' && (r.paidDate || '').startsWith(monthPrefix))
      .reduce((sum, r) => sum + r.amountUSD, 0);
    let overdue = 0;
    let dueSoon = 0;
    for (const s of active) {
      const { state } = deriveScheduleState(s, today);
      if (state === 'Overdue') overdue += 1;
      else if (state === 'DueSoon') dueSoon += 1;
    }
    return { monthlyBurn, paidMTD, overdue, dueSoon, activeCount: active.length };
  }, [schedules, records, today]);

  const filteredSchedules = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return schedules.filter((s) => {
      const matchesQuery =
        !normalized ||
        `${s.title} ${s.payee} ${s.category}`.toLowerCase().includes(normalized);
      const matchesCategory = categoryFilter === 'all' || s.category === categoryFilter;
      const matchesFreq = freqFilter === 'all' || s.frequency === freqFilter;
      let matchesStatus = true;
      if (statusFilter !== 'all') {
        if (statusFilter === 'Overdue' || statusFilter === 'DueSoon') {
          matchesStatus = deriveScheduleState(s, today).state === statusFilter && s.status === 'Active';
        } else {
          matchesStatus = s.status === statusFilter;
        }
      }
      return matchesQuery && matchesCategory && matchesFreq && matchesStatus;
    });
  }, [schedules, query, categoryFilter, freqFilter, statusFilter, today]);

  const filteredRecords = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return records
      .filter((r) => {
        const matchesQuery =
          !normalized || `${r.title} ${r.payee || ''} ${r.category}`.toLowerCase().includes(normalized);
        const matchesCategory = categoryFilter === 'all' || r.category === categoryFilter;
        return matchesQuery && matchesCategory;
      })
      .map((r) => ({ record: r, derived: deriveRecordStatus(r, today) }));
  }, [records, query, categoryFilter, today]);

  const openCreateModal = () => {
    if (!canManage) {
      showToast('Only Admin and Supervisor roles can register recurring expenses.', 'warning', 'Restricted action');
      return;
    }
    setEditingSchedule(null);
    setScheduleForm(emptyScheduleForm(today));
    setScheduleModalOpen(true);
  };

  const openEditModal = (schedule: RecurringExpense) => {
    if (!canManage) {
      showToast('Only Admin and Supervisor roles can edit recurring expenses.', 'warning', 'Restricted action');
      return;
    }
    setEditingSchedule(schedule);
    setScheduleForm({
      title: schedule.title,
      category: schedule.category,
      payee: schedule.payee,
      amount: String(schedule.amountUSD),
      frequency: schedule.frequency,
      startDate: schedule.startDate,
      endDate: schedule.endDate || '',
      occurrencesPlanned: schedule.occurrencesPlanned ? String(schedule.occurrencesPlanned) : '',
      paymentMethod: schedule.paymentMethod,
      notes: schedule.notes || '',
    });
    setScheduleModalOpen(true);
  };

  const submitSchedule = async (event: React.FormEvent) => {
    event.preventDefault();
    const amount = Number(scheduleForm.amount);
    if (!scheduleForm.title.trim()) {
      showToast('Give the expense a clear title (e.g. "SNEL electricity — City Hall").', 'warning', 'Title required');
      return;
    }
    if (!scheduleForm.payee.trim()) {
      showToast('Name the payee or vendor so treasury knows who gets paid.', 'warning', 'Payee required');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast('Enter an amount greater than zero.', 'warning', 'Check amount');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduleForm.startDate)) {
      showToast('Pick a valid start date for the recurrence.', 'warning', 'Start date required');
      return;
    }
    if (scheduleForm.endDate && scheduleForm.endDate < scheduleForm.startDate) {
      showToast('The end date cannot be before the start date.', 'warning', 'Check dates');
      return;
    }
    const occurrencesPlanned = scheduleForm.occurrencesPlanned
      ? Math.floor(Number(scheduleForm.occurrencesPlanned))
      : null;
    if (scheduleForm.occurrencesPlanned && (!Number.isFinite(occurrencesPlanned!) || occurrencesPlanned! <= 0)) {
      showToast('Occurrence limit must be a positive whole number.', 'warning', 'Check occurrences');
      return;
    }

    setSavingSchedule(true);
    try {
      if (editingSchedule) {
        await updateRecurringExpense(
          editingSchedule.id,
          {
            title: scheduleForm.title.trim(),
            category: scheduleForm.category,
            payee: scheduleForm.payee.trim(),
            amountUSD: amount,
            frequency: scheduleForm.frequency,
            startDate: scheduleForm.startDate,
            endDate: scheduleForm.endDate || null,
            occurrencesPlanned,
            paymentMethod: scheduleForm.paymentMethod,
            notes: scheduleForm.notes.trim(),
          },
          actor
        );
        showToast(`"${scheduleForm.title.trim()}" updated. Future dues follow the new terms.`, 'success', 'Schedule updated');
      } else {
        await createRecurringExpense(
          {
            title: scheduleForm.title.trim(),
            category: scheduleForm.category,
            payee: scheduleForm.payee.trim(),
            amountUSD: amount,
            frequency: scheduleForm.frequency,
            startDate: scheduleForm.startDate,
            endDate: scheduleForm.endDate || null,
            occurrencesPlanned,
            paymentMethod: scheduleForm.paymentMethod,
            notes: scheduleForm.notes.trim(),
            actor,
          }
        );
        showToast(`"${scheduleForm.title.trim()}" will now come due ${EXPENSE_FREQUENCY_LABELS[scheduleForm.frequency].toLowerCase()} from ${shortDate(scheduleForm.startDate)}.`, 'success', 'Recurring expense registered');
      }
      setScheduleModalOpen(false);
      setEditingSchedule(null);
    } catch (err: any) {
      showToast(err?.message || 'Could not save the recurring expense.', 'error', 'Save failed');
    } finally {
      setSavingSchedule(false);
    }
  };

  const openPayModal = (schedule: RecurringExpense) => {
    if (!canRecord) {
      showToast('Auditors have read-only access to expenses.', 'warning', 'Restricted action');
      return;
    }
    if (schedule.status !== 'Active') {
      showToast('Only active schedules accept payments. Resume it first.', 'warning', 'Schedule not active');
      return;
    }
    setPayTarget(schedule);
    setPayAmount(String(schedule.amountUSD));
    setPayDate(today);
    setPayMethod(schedule.paymentMethod);
    setPayReference('');
    setPayNotes('');
  };

  const submitPayment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!payTarget) return;
    const amount = Number(payAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast('Enter the amount actually paid.', 'warning', 'Check amount');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payDate)) {
      showToast('Pick the date the payment was made.', 'warning', 'Payment date required');
      return;
    }
    setRecordingPay(true);
    try {
      const { schedule: updated } = await recordSchedulePayment(payTarget, {
        paidDate: payDate,
        amountUSD: amount,
        paymentMethod: payMethod,
        reference: payReference,
        notes: payNotes,
        actor,
      });
      setSchedules((current) => current.map((s) => (s.id === updated.id ? updated : s)));
      const fresh = await getExpenseRecords().catch(() => null);
      if (fresh) setRecords(fresh);
      showToast(
        `Payment logged against "${payTarget.title}". Next due ${shortDate(updated.nextDueDate)}${updated.status === 'Completed' ? ' — schedule completed.' : '.'}`,
        'success',
        'Payment recorded'
      );
      setPayTarget(null);
    } catch (err: any) {
      showToast(err?.message || 'Could not record the payment.', 'error', 'Payment failed');
    } finally {
      setRecordingPay(false);
    }
  };

  const submitOneOff = async (event: React.FormEvent) => {
    event.preventDefault();
    const amount = Number(oneOffAmount);
    if (!oneOffTitle.trim() || !oneOffPayee.trim()) {
      showToast('A one-off expense needs a title and a payee.', 'warning', 'Missing details');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast('Enter an amount greater than zero.', 'warning', 'Check amount');
      return;
    }
    try {
      const record = await logOneOffExpense({
        title: oneOffTitle.trim(),
        category: oneOffCategory,
        payee: oneOffPayee.trim(),
        amountUSD: amount,
        dueDate: oneOffDate,
        paidDate: oneOffDate,
        paymentMethod: oneOffMethod,
        reference: oneOffReference,
        notes: oneOffNotes,
        actor,
      });
      setRecords((current) => [record, ...current]);
      setOneOffOpen(false);
      setActiveTab('ledger');
      setOneOffTitle('');
      setOneOffPayee('');
      setOneOffAmount('');
      setOneOffReference('');
      setOneOffNotes('');
      showToast(`One-off expense "${record.title}" logged as paid.`, 'success', 'Expense logged');
    } catch (err: any) {
      showToast(err?.message || 'Could not log the expense.', 'error', 'Log failed');
    }
  };

  const runConfirmAction = async () => {
    if (!confirmAction) return;
    const { kind, schedule } = confirmAction;
    try {
      if (kind === 'pause') {
        await setScheduleStatus(schedule, 'Paused', actor);
        showToast(`"${schedule.title}" paused. No dues accrue while paused.`, 'info', 'Schedule paused');
      } else if (kind === 'resume') {
        await updateRecurringExpense(schedule.id, { status: 'Active', pausedAt: undefined }, actor);
        showToast(`"${schedule.title}" resumed from ${shortDate(schedule.nextDueDate)}.`, 'success', 'Schedule resumed');
      } else if (kind === 'cancel-schedule') {
        await setScheduleStatus(schedule, 'Cancelled', actor, cancelReason);
        showToast(`"${schedule.title}" cancelled and closed.`, 'info', 'Schedule cancelled');
      } else if (kind === 'delete') {
        await deleteRecurringExpense(schedule, actor);
        showToast(`"${schedule.title}" permanently removed.`, 'info', 'Schedule deleted');
      }
      const fresh = await getRecurringExpenses().catch(() => null);
      if (fresh) setSchedules(fresh);
    } catch (err: any) {
      showToast(err?.message || 'Action failed.', 'error', 'Request failed');
    } finally {
      setConfirmAction(null);
      setCancelReason('');
    }
  };

  const handleMarkRecordPaid = async (record: ExpenseRecord) => {
    if (!canRecord) {
      showToast('Auditors have read-only access to expenses.', 'warning', 'Restricted action');
      return;
    }
    try {
      await markRecordPaid(record, today, actor);
      setRecords((current) =>
        current.map((r) => (r.id === record.id ? { ...r, status: 'Paid' as const, paidDate: today } : r))
      );
      showToast(`"${record.title}" marked as paid today.`, 'success', 'Ledger updated');
    } catch (err: any) {
      showToast(err?.message || 'Could not update the record.', 'error', 'Update failed');
    }
  };

  const handleCancelRecord = async (record: ExpenseRecord) => {
    if (!canManage) {
      showToast('Only Admin and Supervisor roles can cancel ledger entries.', 'warning', 'Restricted action');
      return;
    }
    try {
      await cancelExpenseRecord(record, actor);
      setRecords((current) =>
        current.map((r) => (r.id === record.id ? { ...r, status: 'Cancelled' as const } : r))
      );
      showToast(`Ledger entry "${record.title}" cancelled.`, 'info', 'Entry cancelled');
    } catch (err: any) {
      showToast(err?.message || 'Could not cancel the entry.', 'error', 'Cancel failed');
    }
  };

  const exportCsv = (scope: 'schedules' | 'ledger') => {
    const rows =
      scope === 'schedules'
        ? [
            ['Title', 'Category', 'Payee', 'Amount USD', 'Frequency', 'Next due', 'Status', 'Paid count', 'Total paid USD'],
            ...filteredSchedules.map((s) => [
              s.title, s.category, s.payee, String(s.amountUSD), s.frequency, s.nextDueDate, s.status,
              String(s.occurrencesLogged), String(s.totalPaidUSD),
            ]),
          ]
        : [
            ['Title', 'Category', 'Payee', 'Amount USD', 'Due date', 'Paid date', 'Status', 'Method', 'Reference'],
            ...filteredRecords.map(({ record }) => [
              record.title, record.category, record.payee || '', String(record.amountUSD), record.dueDate,
              record.paidDate || '', record.status, record.paymentMethod || '', record.reference || '',
            ]),
          ];
    const csv = buildCsv(rows);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = scope === 'schedules' ? 'goma-recurring-expenses.csv' : 'goma-expense-ledger.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(scope === 'schedules' ? 'Recurring expense register exported.' : 'Expense ledger exported.', 'success', 'Export ready');
  };

  const stateBadge = (schedule: RecurringExpense) => {
    const { state } = deriveScheduleState(schedule, today);
    if (schedule.status === 'Paused') return <Badge variant="warn" dot>Paused</Badge>;
    if (schedule.status === 'Cancelled') return <Badge variant="neutral">Cancelled</Badge>;
    if (schedule.status === 'Completed') return <Badge variant="sage" dot>Completed</Badge>;
    if (state === 'Overdue') return <Badge variant="danger" dot>Overdue</Badge>;
    if (state === 'DueSoon') return <Badge variant="warn" dot>Due soon</Badge>;
    return <Badge variant="sage" dot>On track</Badge>;
  };

  const recordBadge = (status: string) => {
    if (status === 'Paid') return <Badge variant="sage" dot>Paid</Badge>;
    if (status === 'Overdue') return <Badge variant="danger" dot>Overdue</Badge>;
    if (status === 'Due') return <Badge variant="warn" dot>Due today</Badge>;
    if (status === 'Cancelled') return <Badge variant="neutral">Cancelled</Badge>;
    return <Badge variant="neutral" dot>Scheduled</Badge>;
  };

  const upcomingPreview = useMemo(() => {
    if (!scheduleModalOpen || editingSchedule) return [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduleForm.startDate)) return [];
    return generateUpcomingOccurrences(
      { frequency: scheduleForm.frequency, nextDueDate: scheduleForm.startDate },
      4
    );
  }, [scheduleModalOpen, editingSchedule, scheduleForm.startDate, scheduleForm.frequency]);

  // Mirror recordSchedulePayment's anchor rule: an overdue schedule advances
  // from today (whole periods, preserving the cycle day), so the preview must
  // not promise the stale due date + 1 period.
  const nextAfterPayment = payTarget
    ? computeNextDueDate(payTarget.nextDueDate < today ? today : payTarget.nextDueDate, payTarget.frequency)
    : '';

  if (loadError || loading) return <div role="status" className="space-y-4">
    <p>{loadError || 'Chargement du registre des dépenses…'}</p>
    {loadError && <Button onClick={() => setReloadKey((k) => k + 1)}>Réessayer</Button>}
  </div>;

  return (
    <div className="space-y-8 font-sans">
      <PageHeader
        eyebrow="TREASURY • OPERATING COSTS"
        title="Recurring Expenses"
        description="Register every repeating cost once — rent, utilities, fuel, maintenance — then log each payment as it falls due. The next due date advances automatically."
        actions={
          <>
            <Button variant="ghost" size="md" icon={<Download className="w-4 h-4" />} onClick={() => exportCsv(activeTab === 'schedules' ? 'schedules' : 'ledger')}>
              Export {activeTab === 'schedules' ? 'register' : 'ledger'}
            </Button>
            {canRecord && (
              <Button variant="secondary" size="md" icon={<ReceiptText className="w-4 h-4" />} onClick={() => { setOneOffDate(today); setOneOffOpen(true); }}>
                Log one-off
              </Button>
            )}
            <Button variant="primary" size="md" icon={<Plus className="w-4 h-4" />} onClick={openCreateModal} disabled={!canManage}>
              New recurring expense
            </Button>
          </>
        }
      />

      {/* Hero: monthly burn */}
      <section className="relative overflow-hidden rounded-[24px] bg-navy text-white border border-navy2/80 shadow-[0_24px_60px_-28px_oklch(28%_0.045_258/0.7)]">
        <div className="absolute -right-16 -top-24 w-72 h-72 rounded-full bg-accent/20 blur-3xl" />
        <div className="absolute right-20 -bottom-28 w-64 h-64 rounded-full bg-sage/15 blur-3xl" />
        <div className="relative p-6 sm:p-8 lg:flex lg:items-center lg:justify-between gap-8">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <Badge variant="accent" dot>{metrics.activeCount} active schedules</Badge>
              {metrics.overdue > 0 && <Badge variant="danger" dot>{metrics.overdue} overdue</Badge>}
            </div>
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-[14px] bg-white/10 border border-white/15 flex items-center justify-center">
                <Repeat2 className="w-5 h-5 text-accent-soft" />
              </div>
              <div>
                <p className="text-xs font-semibold text-white/60 uppercase tracking-[0.14em]">Projected monthly burn</p>
                <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-[-0.04em] tabular-nums">{money(metrics.monthlyBurn)}</h2>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-white/55">
              <span>{metrics.dueSoon} due within 7 days</span>
              <span>Paid this month: {money(metrics.paidMTD)}</span>
            </div>
          </div>
          <div className="mt-7 lg:mt-0 shrink-0 lg:text-right">
            <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-white/50">Next dues</p>
            <div className="mt-2 space-y-1.5">
              {schedules.filter((s) => s.status === 'Active').slice(0, 3).map((s) => (
                <div key={s.id} className="flex items-center lg:justify-end gap-2 text-xs text-white/75">
                  <CalendarClock className="w-3.5 h-3.5 text-accent-soft" />
                  <span className="truncate max-w-[220px]">{s.title}</span>
                  <span className="font-bold text-white tabular-nums">{shortDate(s.nextDueDate)}</span>
                </div>
              ))}
              {schedules.filter((s) => s.status === 'Active').length === 0 && (
                <p className="text-xs text-white/50">No active schedules yet.</p>
              )}
            </div>
            <div className="inline-flex items-center gap-2 mt-4 px-3 py-2 rounded-full bg-white/10 border border-white/10 text-xs text-white/75">
              <ShieldCheck className="w-3.5 h-3.5 text-sage" />
              Every payment writes to the audit ledger
            </div>
          </div>
        </div>
      </section>

      <MetricStrip
        columns={4}
        className="mt-0"
        items={[
          { label: 'Monthly burn', value: money(metrics.monthlyBurn), subline: `${metrics.activeCount} active schedules`, icon: <Banknote className="w-4 h-4" /> },
          { label: 'Overdue dues', value: String(metrics.overdue), trend: metrics.overdue > 0 ? 'Act now' : 'Clear', trendType: metrics.overdue > 0 ? 'danger' : 'sage', subline: 'Past next-due date', icon: <AlertTriangle className="w-4 h-4" /> },
          { label: 'Due within 7 days', value: String(metrics.dueSoon), subline: 'Prepare treasury float', icon: <Clock3 className="w-4 h-4" /> },
          { label: 'Paid this month', value: money(metrics.paidMTD), subline: 'Ledger-confirmed outflow', icon: <CheckCircle2 className="w-4 h-4" /> },
        ]}
      />

      {/* Tabs + filters */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="inline-flex p-1 rounded-[14px] bg-surface2 border border-line w-fit">
          <button
            type="button"
            onClick={() => setActiveTab('schedules')}
            className={`px-4 py-2 rounded-[10px] text-xs font-bold transition-premium cursor-pointer ${activeTab === 'schedules' ? 'bg-surface text-ink shadow-xs' : 'text-muted hover:text-ink'}`}
          >
            Recurring schedules <span className="ml-1.5 text-[11px] opacity-60">{schedules.length}</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ledger')}
            className={`px-4 py-2 rounded-[10px] text-xs font-bold transition-premium cursor-pointer ${activeTab === 'ledger' ? 'bg-surface text-ink shadow-xs' : 'text-muted hover:text-ink'}`}
          >
            Payment ledger <span className="ml-1.5 text-[11px] opacity-60">{records.length}</span>
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 pl-8 pr-3 rounded-[10px] bg-surface2 border border-line text-xs text-ink placeholder:text-muted focus:border-accent outline-none w-44 lg:w-52"
            />
          </div>
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value as 'all' | ExpenseCategory)}
            className="h-9 px-3 rounded-[10px] bg-surface2 border border-line text-xs font-semibold text-muted cursor-pointer"
            aria-label="Filter by category"
          >
            <option value="all">All categories</option>
            {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {activeTab === 'schedules' && (
            <>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
                className="h-9 px-3 rounded-[10px] bg-surface2 border border-line text-xs font-semibold text-muted cursor-pointer"
                aria-label="Filter by schedule status"
              >
                <option value="all">All statuses</option>
                <option value="Active">Active</option>
                <option value="Overdue">Overdue</option>
                <option value="DueSoon">Due soon</option>
                <option value="Paused">Paused</option>
                <option value="Completed">Completed</option>
                <option value="Cancelled">Cancelled</option>
              </select>
              <select
                value={freqFilter}
                onChange={(event) => setFreqFilter(event.target.value as typeof freqFilter)}
                className="h-9 px-3 rounded-[10px] bg-surface2 border border-line text-xs font-semibold text-muted cursor-pointer"
                aria-label="Filter by frequency"
              >
                <option value="all">All frequencies</option>
                {EXPENSE_FREQUENCIES.map((f) => <option key={f} value={f}>{EXPENSE_FREQUENCY_LABELS[f]}</option>)}
              </select>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <Panel><div className="py-14 text-center text-sm text-muted">Loading expense workspace…</div></Panel>
      ) : activeTab === 'schedules' ? (
        <Panel
          title="Recurring schedules"
          subtitle="One record per repeating cost. Recording a payment stamps the ledger and rolls the next due date forward by exactly one period."
          padding="none"
        >
          <div className="overflow-x-auto">
            <table className="premium-table w-full text-left text-xs min-w-[900px]">
              <thead className="bg-surface2/70 border-b border-line">
                <tr className="text-[11px] uppercase tracking-[0.1em] text-muted">
                  <th className="font-bold px-6 py-3.5">Expense</th>
                  <th className="font-bold px-4 py-3.5">Cadence</th>
                  <th className="font-bold px-4 py-3.5 text-right">Amount</th>
                  <th className="font-bold px-4 py-3.5">Next due</th>
                  <th className="font-bold px-4 py-3.5">Progress</th>
                  <th className="font-bold px-6 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filteredSchedules.map((s) => {
                  const { state, daysUntilDue } = deriveScheduleState(s, today);
                  return (
                    <tr key={s.id} className="hover:bg-surface2/45 transition-premium">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-[11px] bg-gradient-to-br ${CATEGORY_TONE[s.category] || CATEGORY_TONE.Other} flex items-center justify-center font-display font-bold text-[12px] shadow-xs shrink-0`}>
                            {initialsOf(s.title)}
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-ink text-[14px] truncate">{s.title}</div>
                            <div className="text-[12px] text-muted truncate">{s.payee} · {s.category}</div>
                            <div className="mt-1.5 flex flex-wrap gap-1.5">{stateBadge(s)}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-ink"><Repeat2 className="w-3.5 h-3.5 text-accent" />{EXPENSE_FREQUENCY_LABELS[s.frequency]}</span>
                        <div className="text-[11px] text-muted mt-1">Since {shortDate(s.startDate)}</div>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div className="font-display font-bold text-ink text-sm tabular-nums">{money(s.amountUSD)}</div>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className={`font-bold tabular-nums ${s.status === 'Active' && state === 'Overdue' ? 'text-danger' : 'text-ink'}`}>{shortDate(s.nextDueDate)}</div>
                        <div className="text-[11px] text-muted">
                          {s.status !== 'Active' ? s.status : state === 'Overdue' ? `${Math.abs(daysUntilDue)}d overdue` : state === 'DueSoon' ? (daysUntilDue === 0 ? 'Due today' : `In ${daysUntilDue}d`) : `In ${daysUntilDue}d`}
                        </div>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <div className="text-xs font-bold text-ink tabular-nums">{s.occurrencesLogged}{s.occurrencesPlanned ? ` / ${s.occurrencesPlanned}` : ''} paid</div>
                        <div className="text-[11px] text-muted tabular-nums">Total {money(s.totalPaidUSD)}</div>
                      </td>
                      <td className="px-6 py-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5 justify-end flex-wrap">
                          {s.status === 'Active' && (
                            <Button variant="primary" size="sm" icon={<HandCoins className="w-3.5 h-3.5" />} onClick={() => openPayModal(s)} disabled={!canRecord}>
                              Record payment
                            </Button>
                          )}
                          {canManage && (
                            <>
                              <button type="button" title="Edit schedule" onClick={() => openEditModal(s)} className="p-2 rounded-[9px] border border-line bg-surface text-muted hover:text-ink hover:border-accent cursor-pointer" aria-label={`Edit ${s.title}`}>
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              {s.status === 'Active' ? (
                                <button type="button" title="Pause schedule" onClick={() => setConfirmAction({ kind: 'pause', schedule: s })} className="p-2 rounded-[9px] border border-line bg-surface text-muted hover:text-ink hover:border-accent cursor-pointer" aria-label={`Pause ${s.title}`}>
                                  <Pause className="w-3.5 h-3.5" />
                                </button>
                              ) : s.status === 'Paused' ? (
                                <button type="button" title="Resume schedule" onClick={() => setConfirmAction({ kind: 'resume', schedule: s })} className="p-2 rounded-[9px] border border-line bg-surface text-sage hover:border-sage cursor-pointer" aria-label={`Resume ${s.title}`}>
                                  <Play className="w-3.5 h-3.5" />
                                </button>
                              ) : null}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredSchedules.length === 0 && (
                  <tr><td colSpan={6} className="px-6 py-14 text-center text-sm text-muted">
                    No recurring expenses match your filters. {canManage ? 'Register the first one to start the cadence.' : ''}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-4 border-t border-line bg-surface2/40 flex flex-wrap items-center justify-between gap-3 text-[12px] text-muted">
            <span className="inline-flex items-center gap-1.5"><Wallet className="w-3.5 h-3.5 text-accent" /> Monthly burn {money(metrics.monthlyBurn)} across {metrics.activeCount} active schedules.</span>
            <span className="font-semibold text-ink">{filteredSchedules.length} of {schedules.length} schedules shown</span>
          </div>
        </Panel>
      ) : (
        <Panel
          title="Payment ledger"
          subtitle="Every recorded payment and one-off expense, confirmed against the treasury float."
          actions={canRecord ? <Button variant="secondary" size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => { setOneOffDate(today); setOneOffOpen(true); }}>Log one-off</Button> : undefined}
          padding="none"
        >
          <div className="overflow-x-auto">
            <table className="premium-table w-full text-left text-xs min-w-[860px]">
              <thead className="bg-surface2/70 border-b border-line">
                <tr className="text-[11px] uppercase tracking-[0.1em] text-muted">
                  <th className="font-bold px-6 py-3.5">Expense</th>
                  <th className="font-bold px-4 py-3.5 text-right">Amount</th>
                  <th className="font-bold px-4 py-3.5">Due → Paid</th>
                  <th className="font-bold px-4 py-3.5">Status</th>
                  <th className="font-bold px-6 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {filteredRecords.map(({ record, derived }) => (
                  <tr key={record.id} className="hover:bg-surface2/45 transition-premium">
                    <td className="px-6 py-4">
                      <div className="font-bold text-ink text-[14px]">{record.title}</div>
                      <div className="text-[12px] text-muted">{record.payee || '—'} · {record.category}{record.scheduleId ? ' · recurring' : ' · one-off'}</div>
                      {record.reference && <div className="text-[11px] text-muted font-mono mt-0.5">{record.reference}</div>}
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="font-display font-bold text-ink text-sm tabular-nums">{money(record.amountUSD)}</div>
                      <div className="text-[11px] text-muted">{record.paymentMethod || ''}</div>
                    </td>
                    <td className="px-4 py-4 whitespace-nowrap text-muted">
                      {shortDate(record.dueDate)} → {record.paidDate ? shortDate(record.paidDate) : '—'}
                    </td>
                    <td className="px-4 py-4">{recordBadge(record.status === 'Paid' || record.status === 'Cancelled' ? record.status : derived)}</td>
                    <td className="px-6 py-4 text-right whitespace-nowrap">
                      {(derived === 'Due' || derived === 'Overdue' || derived === 'Scheduled') && record.status !== 'Paid' && record.status !== 'Cancelled' ? (
                        <div className="inline-flex gap-1.5 justify-end">
                          <Button variant="ghost" size="sm" onClick={() => handleMarkRecordPaid(record)} disabled={!canRecord}>Mark paid</Button>
                          {canManage && <Button variant="ghost" size="sm" onClick={() => handleCancelRecord(record)}>Cancel</Button>}
                        </div>
                      ) : (
                        <span className="text-[12px] text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {filteredRecords.length === 0 && (
                  <tr><td colSpan={5} className="px-6 py-14 text-center text-sm text-muted">No ledger entries yet. Record a payment from a schedule to open the trail.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {/* Create / edit schedule */}
      {scheduleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/70 backdrop-blur-xs">
          <div className="bg-surface rounded-[22px] border border-line shadow-2xl w-full max-w-xl overflow-hidden animate-in fade-in zoom-in-95 duration-150 max-h-[92vh] overflow-y-auto">
            <div className="px-6 py-5 border-b border-line flex items-center justify-between sticky top-0 bg-surface">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-[13px] bg-accent/12 text-accent flex items-center justify-center"><Repeat2 className="w-5 h-5" /></div>
                <div>
                  <h3 className="font-display text-lg font-bold text-ink tracking-tight">{editingSchedule ? 'Edit recurring expense' : 'New recurring expense'}</h3>
                  <p className="text-xs text-muted mt-0.5">Register it once — dues recur automatically.</p>
                </div>
              </div>
              <button type="button" onClick={() => { setScheduleModalOpen(false); setEditingSchedule(null); }} className="p-2 rounded-lg text-muted hover:text-ink hover:bg-surface2 cursor-pointer" aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={submitSchedule} className="p-6 space-y-4">
              <label className="block">
                <span className="block text-xs font-bold text-ink mb-1.5">Expense title</span>
                <input value={scheduleForm.title} onChange={(e) => setScheduleForm({ ...scheduleForm, title: e.target.value })} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink placeholder:text-muted focus:border-accent outline-none" placeholder="SNEL electricity — City Hall counters" />
              </label>
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className="block text-xs font-bold text-ink mb-1.5">Category</span>
                  <select value={scheduleForm.category} onChange={(e) => setScheduleForm({ ...scheduleForm, category: e.target.value as ExpenseCategory })} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink cursor-pointer">
                    {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-xs font-bold text-ink mb-1.5">Payee / vendor</span>
                  <input value={scheduleForm.payee} onChange={(e) => setScheduleForm({ ...scheduleForm, payee: e.target.value })} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink placeholder:text-muted focus:border-accent outline-none" placeholder="SNEL Goma" />
                </label>
              </div>
              <label className="block">
                <span className="block text-xs font-bold text-ink mb-1.5">Amount per occurrence (USD)</span>
                <input type="number" min="0" step="0.01" value={scheduleForm.amount} onChange={(e) => setScheduleForm({ ...scheduleForm, amount: e.target.value })} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink tabular-nums" placeholder="220" />
              </label>
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className="block text-xs font-bold text-ink mb-1.5">Repeats</span>
                  <select value={scheduleForm.frequency} onChange={(e) => setScheduleForm({ ...scheduleForm, frequency: e.target.value as ExpenseFrequency })} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink cursor-pointer">
                    {EXPENSE_FREQUENCIES.map((f) => <option key={f} value={f}>{EXPENSE_FREQUENCY_LABELS[f]}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-xs font-bold text-ink mb-1.5">Default payment method</span>
                  <select value={scheduleForm.paymentMethod} onChange={(e) => setScheduleForm({ ...scheduleForm, paymentMethod: e.target.value })} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink cursor-pointer">
                    {EXPENSE_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
              </div>
              <div className="grid sm:grid-cols-3 gap-4">
                <label className="block">
                  <span className="block text-xs font-bold text-ink mb-1.5">First due</span>
                  <input type="date" value={scheduleForm.startDate} onChange={(e) => setScheduleForm({ ...scheduleForm, startDate: e.target.value })} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink" />
                </label>
                <label className="block">
                  <span className="block text-xs font-bold text-ink mb-1.5">Ends <span className="font-normal text-muted">(optional)</span></span>
                  <input type="date" value={scheduleForm.endDate} onChange={(e) => setScheduleForm({ ...scheduleForm, endDate: e.target.value })} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink" />
                </label>
                <label className="block">
                  <span className="block text-xs font-bold text-ink mb-1.5">Stop after <span className="font-normal text-muted">(optional)</span></span>
                  <input type="number" min="1" step="1" value={scheduleForm.occurrencesPlanned} onChange={(e) => setScheduleForm({ ...scheduleForm, occurrencesPlanned: e.target.value })} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink tabular-nums" placeholder="12" />
                </label>
              </div>
              {upcomingPreview.length > 0 && (
                <div className="p-4 rounded-[14px] bg-surface2 border border-line">
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted mb-2">First dues preview</p>
                  <div className="flex flex-wrap gap-1.5">
                    {upcomingPreview.map((d) => (
                      <span key={d} className="text-[12px] font-semibold px-2 py-1 rounded-full bg-surface border border-line text-ink tabular-nums">{shortDate(d)}</span>
                    ))}
                  </div>
                </div>
              )}
              <label className="block">
                <span className="block text-xs font-bold text-ink mb-1.5">Notes <span className="font-normal text-muted">(optional)</span></span>
                <textarea value={scheduleForm.notes} onChange={(e) => setScheduleForm({ ...scheduleForm, notes: e.target.value })} rows={2} className="w-full px-3 py-2.5 rounded-[10px] bg-surface2 border border-line text-sm text-ink resize-none" placeholder="Contract reference, meter numbers, treasury context…" />
              </label>
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" size="md" onClick={() => { setScheduleModalOpen(false); setEditingSchedule(null); }}>Cancel</Button>
                <Button type="submit" variant="primary" size="md" icon={<CheckCircle2 className="w-4 h-4" />} disabled={savingSchedule}>
                  {savingSchedule ? 'Saving…' : editingSchedule ? 'Save changes' : 'Register expense'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Record payment */}
      {payTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/70 backdrop-blur-xs">
          <div className="bg-surface rounded-[22px] border border-line shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-5 border-b border-line flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-[13px] bg-sage/12 text-sage flex items-center justify-center"><HandCoins className="w-5 h-5" /></div>
                <div>
                  <h3 className="font-display text-lg font-bold text-ink tracking-tight">Record payment</h3>
                  <p className="text-xs text-muted mt-0.5">{payTarget.title} · due {shortDate(payTarget.nextDueDate)}</p>
                </div>
              </div>
              <button type="button" onClick={() => setPayTarget(null)} className="p-2 rounded-lg text-muted hover:text-ink hover:bg-surface2 cursor-pointer" aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={submitPayment} className="p-6 space-y-4">
              <label className="block">
                <span className="block text-xs font-bold text-ink mb-1.5">Amount paid (USD)</span>
                <input type="number" min="0" step="0.01" value={payAmount} onChange={(e) => setPayAmount(e.target.value)} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink tabular-nums" />
              </label>
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className="block text-xs font-bold text-ink mb-1.5">Payment date</span>
                  <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink" />
                </label>
                <label className="block">
                  <span className="block text-xs font-bold text-ink mb-1.5">Method</span>
                  <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink cursor-pointer">
                    {EXPENSE_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="block text-xs font-bold text-ink mb-1.5">Reference <span className="font-normal text-muted">(optional)</span></span>
                <input value={payReference} onChange={(e) => setPayReference(e.target.value)} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink font-mono" placeholder="Slip / bordereau ref" />
              </label>
              <label className="block">
                <span className="block text-xs font-bold text-ink mb-1.5">Note <span className="font-normal text-muted">(optional)</span></span>
                <textarea value={payNotes} onChange={(e) => setPayNotes(e.target.value)} rows={2} className="w-full px-3 py-2.5 rounded-[10px] bg-surface2 border border-line text-sm text-ink resize-none" placeholder="Treasury context…" />
              </label>
              <div className="p-4 rounded-[14px] bg-surface2 border border-line flex items-center justify-between gap-4">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Next due after this payment</p>
                  <p className="text-xs text-muted mt-1">{EXPENSE_FREQUENCY_LABELS[payTarget.frequency]} cadence</p>
                </div>
                <p className="font-display text-lg font-bold text-ink tabular-nums">{shortDate(nextAfterPayment)}</p>
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" size="md" onClick={() => setPayTarget(null)}>Cancel</Button>
                <Button type="submit" variant="primary" size="md" icon={<CheckCircle2 className="w-4 h-4" />} disabled={recordingPay}>
                  {recordingPay ? 'Recording…' : 'Confirm payment'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* One-off expense */}
      {oneOffOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/70 backdrop-blur-xs">
          <div className="bg-surface rounded-[22px] border border-line shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150 max-h-[92vh] overflow-y-auto">
            <div className="px-6 py-5 border-b border-line flex items-center justify-between sticky top-0 bg-surface">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-[13px] bg-accent/12 text-accent flex items-center justify-center"><ReceiptText className="w-5 h-5" /></div>
                <div>
                  <h3 className="font-display text-lg font-bold text-ink tracking-tight">Log one-off expense</h3>
                  <p className="text-xs text-muted mt-0.5">Non-repeating costs land directly in the ledger.</p>
                </div>
              </div>
              <button type="button" onClick={() => setOneOffOpen(false)} className="p-2 rounded-lg text-muted hover:text-ink hover:bg-surface2 cursor-pointer" aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={submitOneOff} className="p-6 space-y-4">
              <label className="block">
                <span className="block text-xs font-bold text-ink mb-1.5">Expense title</span>
                <input value={oneOffTitle} onChange={(e) => setOneOffTitle(e.target.value)} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink placeholder:text-muted focus:border-accent outline-none" placeholder="Emergency printer repair" />
              </label>
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className="block text-xs font-bold text-ink mb-1.5">Category</span>
                  <select value={oneOffCategory} onChange={(e) => setOneOffCategory(e.target.value as ExpenseCategory)} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink cursor-pointer">
                    {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="block text-xs font-bold text-ink mb-1.5">Payee</span>
                  <input value={oneOffPayee} onChange={(e) => setOneOffPayee(e.target.value)} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink placeholder:text-muted focus:border-accent outline-none" placeholder="Vendor or beneficiary" />
                </label>
              </div>
              <label className="block">
                <span className="block text-xs font-bold text-ink mb-1.5">Amount (USD)</span>
                <input type="number" min="0" step="0.01" value={oneOffAmount} onChange={(e) => setOneOffAmount(e.target.value)} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink tabular-nums" placeholder="85" />
              </label>
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className="block text-xs font-bold text-ink mb-1.5">Paid on</span>
                  <input type="date" value={oneOffDate} onChange={(e) => setOneOffDate(e.target.value)} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink" />
                </label>
                <label className="block">
                  <span className="block text-xs font-bold text-ink mb-1.5">Method</span>
                  <select value={oneOffMethod} onChange={(e) => setOneOffMethod(e.target.value)} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink cursor-pointer">
                    {EXPENSE_PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
              </div>
              <label className="block">
                <span className="block text-xs font-bold text-ink mb-1.5">Reference <span className="font-normal text-muted">(optional)</span></span>
                <input value={oneOffReference} onChange={(e) => setOneOffReference(e.target.value)} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink font-mono" placeholder="Receipt ref" />
              </label>
              <label className="block">
                <span className="block text-xs font-bold text-ink mb-1.5">Note <span className="font-normal text-muted">(optional)</span></span>
                <textarea value={oneOffNotes} onChange={(e) => setOneOffNotes(e.target.value)} rows={2} className="w-full px-3 py-2.5 rounded-[10px] bg-surface2 border border-line text-sm text-ink resize-none" placeholder="Why was this spent?" />
              </label>
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" size="md" onClick={() => setOneOffOpen(false)}>Cancel</Button>
                <Button type="submit" variant="primary" size="md" icon={<Plus className="w-4 h-4" />}>Log expense</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Pause / resume / cancel / delete confirm */}
      {confirmAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/70 backdrop-blur-xs">
          <div className="bg-surface rounded-[22px] border border-line shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-5 border-b border-line flex items-center gap-3">
              <div className={`w-10 h-10 rounded-[13px] flex items-center justify-center ${confirmAction.kind === 'delete' || confirmAction.kind === 'cancel-schedule' ? 'bg-danger/12 text-danger' : 'bg-warn/12 text-warn'}`}>
                {confirmAction.kind === 'delete' ? <Trash2 className="w-5 h-5" /> : confirmAction.kind === 'resume' ? <Play className="w-5 h-5" /> : <Pause className="w-5 h-5" />}
              </div>
              <div>
                <h3 className="font-display text-lg font-bold text-ink tracking-tight">
                  {confirmAction.kind === 'pause' && 'Pause this schedule?'}
                  {confirmAction.kind === 'resume' && 'Resume this schedule?'}
                  {confirmAction.kind === 'cancel-schedule' && 'Cancel this schedule?'}
                  {confirmAction.kind === 'delete' && 'Delete this schedule?'}
                </h3>
                <p className="text-xs text-muted mt-0.5">{confirmAction.schedule.title}</p>
              </div>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-muted leading-relaxed">
                {confirmAction.kind === 'pause' && 'Dues stop accruing while paused. Logged payment history is kept untouched.'}
                {confirmAction.kind === 'resume' && `Dues resume from ${shortDate(confirmAction.schedule.nextDueDate)}. Overdue dues become visible immediately.`}
                {confirmAction.kind === 'cancel-schedule' && 'The schedule closes permanently. The payment ledger keeps every confirmed payment for audit.'}
                {confirmAction.kind === 'delete' && 'The schedule is removed from the register. Ledger payments already recorded stay in history.'}
              </p>
              {confirmAction.kind === 'cancel-schedule' && (
                <label className="block">
                  <span className="block text-xs font-bold text-ink mb-1.5">Cancellation reason</span>
                  <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink placeholder:text-muted focus:border-accent outline-none" placeholder="e.g. Lease terminated end of October" />
                </label>
              )}
              {canManage && confirmAction.kind !== 'resume' && confirmAction.kind !== 'pause' && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      const s = confirmAction.schedule;
                      setConfirmAction({ kind: 'delete', schedule: s });
                    }}
                    className={`text-[12px] font-semibold underline underline-offset-2 cursor-pointer ${confirmAction.kind === 'delete' ? 'text-muted' : 'text-danger hover:text-danger/80'}`}
                  >
                    {confirmAction.kind === 'delete' ? '' : 'Delete instead of cancelling'}
                  </button>
                </div>
              )}
              <div className="flex items-center justify-end gap-2">
                <Button type="button" variant="ghost" size="md" onClick={() => { setConfirmAction(null); setCancelReason(''); }}>Back</Button>
                {confirmAction.kind === 'pause' && (
                  <>
                    {canManage && <Button type="button" variant="ghost" size="md" onClick={() => setConfirmAction({ kind: 'cancel-schedule', schedule: confirmAction.schedule })}>Cancel instead</Button>}
                    <Button type="button" variant="primary" size="md" onClick={runConfirmAction}>Pause schedule</Button>
                  </>
                )}
                {confirmAction.kind === 'resume' && <Button type="button" variant="primary" size="md" onClick={runConfirmAction}>Resume schedule</Button>}
                {confirmAction.kind === 'cancel-schedule' && <Button type="button" variant="danger" size="md" onClick={runConfirmAction}>Confirm cancellation</Button>}
                {confirmAction.kind === 'delete' && <Button type="button" variant="danger" size="md" icon={<Trash2 className="w-4 h-4" />} onClick={runConfirmAction}>Delete permanently</Button>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
