import React, { useEffect, useMemo, useState } from 'react';
import {
  BellRing,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  Download,
  Hourglass,
  Megaphone,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  Timer,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import { ReceptionEntry, UserRole, RECEPTION_SERVICES } from '../types';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { PageHeader, Button, Badge, Panel, MetricStrip } from './ui';
import {
  RECEPTION_WINDOWS,
  averageWaitForDay,
  callVisitor,
  closeVisitWithoutService,
  completeVisit,
  formatWait,
  getReceptionQueue,
  minutesBetween,
  pickNextVisitor,
  registerVisitor,
  serviceMinutesFor,
  sortQueueForDisplay,
  subscribeToReceptionQueue,
  waitMinutesFor,
} from '../services/receptionService';
import { localDateFromIsoTimestamp, todayDateString } from '../utils/date';
import { buildCsv } from '../utils/csv';

interface ReceptionViewProps {
  userRole: UserRole;
}

const checkInTime = (iso: string) => {
  const parsed = new Date(iso);
  if (isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
};

const initialsOf = (name: string) =>
  name.split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'V';

const SERVICE_TONE: Record<string, string> = {
  'Business Registration': 'from-accent/80 to-accent-dark text-white',
  'Tax Assessment': 'from-navy/90 to-navy2 text-white',
  'Payment at Counter': 'from-sage/85 to-sage/60 text-white',
  'Receipt Verification': 'from-warn/85 to-accent/70 text-white',
  'License Certificate': 'from-navy/70 to-sage/70 text-white',
  'Complaint / Inquiry': 'from-danger/70 to-accent/70 text-white',
  'Document Pickup': 'from-accent/60 to-warn/60 text-white',
  'Deregistration Request': 'from-navy2 to-navy text-white',
  Other: 'from-muted/70 to-navy2/70 text-white',
};

export const ReceptionView: React.FC<ReceptionViewProps> = ({ userRole }) => {
  const { showToast } = useToast();
  const { userProfile } = useAuth();
  const today = useMemo(() => todayDateString(), []);

  const [queue, setQueue] = useState<ReceptionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [nowIso, setNowIso] = useState(() => new Date().toISOString());
  const [query, setQuery] = useState('');
  const [serviceFilter, setServiceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'active' | 'Waiting' | 'InService' | 'Completed' | 'all'>('active');

  const [registerOpen, setRegisterOpen] = useState(false);
  const [visitorName, setVisitorName] = useState('');
  const [visitorNotes, setVisitorNotes] = useState('');
  const [registering, setRegistering] = useState(false);

  const [callTarget, setCallTarget] = useState<ReceptionEntry | null>(null);
  const [callWindow, setCallWindow] = useState<string>(RECEPTION_WINDOWS[0]);
  const [calling, setCalling] = useState(false);

  const canManage = userRole === 'Admin' || userRole === 'Supervisor' || userRole === 'Cashier';
  const actor = {
    uid: userProfile?.uid || 'local_session',
    displayName: userProfile?.displayName || 'Reception Officer',
    role: userRole,
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    getReceptionQueue()
      .then((list) => {
        if (mounted) setQueue(list);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoading(false);
      });
    const unsub = subscribeToReceptionQueue((list) => {
      if (!mounted) return;
      setQueue(list);
      setLoading(false);
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  // Re-render the live waiting clocks every 30 seconds.
  useEffect(() => {
    const interval = setInterval(() => setNowIso(new Date().toISOString()), 30000);
    return () => clearInterval(interval);
  }, []);

  const metrics = useMemo(() => {
    const waiting = queue.filter((e) => e.status === 'Waiting');
    const inService = queue.filter((e) => e.status === 'InService');
    const servedToday = queue.filter(
      (e) => e.status === 'Completed' && localDateFromIsoTimestamp(e.checkedInAt) === today
    );
    const longest = waiting.reduce((max, e) => Math.max(max, waitMinutesFor(e, nowIso)), 0);
    const avgWait = averageWaitForDay(queue, today);
    const waitingNow = waiting.length > 0
      ? Math.round(waiting.reduce((sum, e) => sum + waitMinutesFor(e, nowIso), 0) / waiting.length)
      : 0;
    return { waiting: waiting.length, inService: inService.length, servedToday: servedToday.length, longest, avgWait, waitingNow };
  }, [queue, nowIso, today]);

  const visibleQueue = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return sortQueueForDisplay(queue).filter((e) => {
      const matchesQuery =
        !normalized || `${e.visitorName} ${e.phone || ''} ${e.service}`.toLowerCase().includes(normalized);
      const matchesService = serviceFilter === 'all' || e.service === serviceFilter;
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active'
          ? e.status === 'Waiting' || e.status === 'InService'
          : e.status === statusFilter);
      return matchesQuery && matchesService && matchesStatus;
    });
  }, [queue, query, serviceFilter, statusFilter]);

  /** Known desks first, then any free-text service already in the queue. */
  const serviceOptions = useMemo(() => {
    const services = new Set<string>(RECEPTION_SERVICES);
    queue.forEach((entry) => {
      if (entry.service) services.add(entry.service);
    });
    return Array.from(services);
  }, [queue]);

  const nextUp = useMemo(() => pickNextVisitor(queue), [queue]);

  const openRegister = () => {
    if (!canManage) {
      showToast('Auditors have read-only access to the reception queue.', 'warning', 'Restricted action');
      return;
    }
    setVisitorName('');
    setVisitorNotes('');
    setRegisterOpen(true);
  };

  const submitRegistration = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!visitorName.trim()) {
      showToast('Enter the visitor’s name to open their queue ticket.', 'warning', 'Name required');
      return;
    }
    setRegistering(true);
    try {
      const entry = await registerVisitor({
        visitorName: visitorName.trim(),
        phone: '',
        service: '',
        priority: 'Normal',
        notes: visitorNotes.trim(),
        actor,
      });
      setQueue((current) => [entry, ...current]);
      setRegisterOpen(false);
      showToast(`"${entry.visitorName}" checked in. Waiting clock started.`, 'success', 'Visitor registered');
    } catch (err: any) {
      showToast(err?.message || 'Could not register the visitor.', 'error', 'Check-in failed');
    } finally {
      setRegistering(false);
    }
  };

  const openCall = (entry: ReceptionEntry) => {
    if (!canManage) {
      showToast('Auditors have read-only access to the reception queue.', 'warning', 'Restricted action');
      return;
    }
    setCallTarget(entry);
    setCallWindow(RECEPTION_WINDOWS[0]);
  };

  const submitCall = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!callTarget) return;
    setCalling(true);
    try {
      const updated = await callVisitor(callTarget, { window: callWindow, actor });
      setQueue((current) => current.map((e) => (e.id === updated.id ? updated : e)));
      showToast(`"${updated.visitorName}" called to ${callWindow} after waiting ${formatWait(waitMinutesFor(callTarget, nowIso))}.`, 'success', 'Visitor called');
      setCallTarget(null);
    } catch (err: any) {
      showToast(err?.message || 'Could not call the visitor.', 'error', 'Call failed');
    } finally {
      setCalling(false);
    }
  };

  const handleCallNext = () => {
    if (!nextUp) {
      showToast('The waiting queue is empty — no one to call.', 'info', 'Queue clear');
      return;
    }
    openCall(nextUp);
  };

  const handleComplete = async (entry: ReceptionEntry) => {
    try {
      const updated = await completeVisit(entry, actor);
      setQueue((current) => current.map((e) => (e.id === updated.id ? updated : e)));
      showToast(`Visit completed for "${entry.visitorName}".`, 'success', 'Served');
    } catch (err: any) {
      showToast(err?.message || 'Could not complete the visit.', 'error', 'Update failed');
    }
  };

  const handleClose = async (entry: ReceptionEntry, outcome: 'Cancelled' | 'NoShow') => {
    if (!canManage) {
      showToast('Auditors have read-only access to the reception queue.', 'warning', 'Restricted action');
      return;
    }
    try {
      const updated = await closeVisitWithoutService(entry, outcome, actor);
      setQueue((current) => current.map((e) => (e.id === updated.id ? updated : e)));
      showToast(
        outcome === 'NoShow' ? `"${entry.visitorName}" marked as no-show.` : `Ticket for "${entry.visitorName}" cancelled.`,
        'info',
        outcome === 'NoShow' ? 'No-show' : 'Cancelled'
      );
    } catch (err: any) {
      showToast(err?.message || 'Could not close the ticket.', 'error', 'Update failed');
    }
  };

  const exportQueue = () => {
    const rows = [
      ['Visitor', 'Phone', 'Service', 'Priority', 'Status', 'Checked in', 'Wait (min)', 'Served by', 'Window'],
      ...visibleQueue.map((e) => [
        e.visitorName, e.phone || '', e.service, e.priority, e.status, e.checkedInAt,
        String(waitMinutesFor(e, nowIso)), e.servedByName || '', e.window || '',
      ]),
    ];
    const csv = buildCsv(rows);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'goma-reception-queue.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('Reception queue exported as CSV.', 'success', 'Export ready');
  };

  const statusBadge = (entry: ReceptionEntry) => {
    if (entry.status === 'Waiting') {
      const waited = waitMinutesFor(entry, nowIso);
      if (waited >= 30) return <Badge variant="danger" dot>Waiting {formatWait(waited)}</Badge>;
      if (waited >= 15) return <Badge variant="warn" dot>Waiting {formatWait(waited)}</Badge>;
      return <Badge variant="accent" dot>Waiting {formatWait(waited)}</Badge>;
    }
    if (entry.status === 'InService') return <Badge variant="warn" dot>In service</Badge>;
    if (entry.status === 'Completed') return <Badge variant="sage" dot>Served</Badge>;
    if (entry.status === 'NoShow') return <Badge variant="neutral">No-show</Badge>;
    return <Badge variant="neutral">Cancelled</Badge>;
  };

  return (
    <div className="space-y-8 font-sans">
      <PageHeader
        eyebrow="FRONT DESK • VISITOR FLOW"
        title="Reception"
        description="Check visitors in and start their waiting clock. A live clock runs on every ticket until the visitor is called."
        actions={
          <>
            <Button variant="ghost" size="md" icon={<Download className="w-4 h-4" />} onClick={exportQueue}>
              Export queue
            </Button>
            <Button variant="secondary" size="md" icon={<Megaphone className="w-4 h-4" />} onClick={handleCallNext} disabled={!canManage || !nextUp}>
              Call next
            </Button>
            <Button variant="primary" size="md" icon={<Plus className="w-4 h-4" />} onClick={openRegister} disabled={!canManage}>
              Check in visitor
            </Button>
          </>
        }
      />

      {/* Hero: live waiting room */}
      <section className="relative overflow-hidden rounded-[24px] bg-navy text-white border border-navy2/80 shadow-[0_24px_60px_-28px_oklch(28%_0.045_258/0.7)]">
        <div className="absolute -right-16 -top-24 w-72 h-72 rounded-full bg-accent/20 blur-3xl" />
        <div className="absolute right-20 -bottom-28 w-64 h-64 rounded-full bg-sage/15 blur-3xl" />
        <div className="relative p-6 sm:p-8 lg:flex lg:items-center lg:justify-between gap-8">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <Badge variant="accent" dot>{metrics.waiting} waiting now</Badge>
              {metrics.longest >= 30 && metrics.waiting > 0 && <Badge variant="danger" dot>Longest {formatWait(metrics.longest)}</Badge>}
            </div>
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-[14px] bg-white/10 border border-white/15 flex items-center justify-center">
                <Hourglass className="w-5 h-5 text-accent-soft" />
              </div>
              <div>
                <p className="text-xs font-semibold text-white/60 uppercase tracking-[0.14em]">Longest wait in the room</p>
                <h2 className="font-display text-2xl sm:text-3xl font-bold tracking-[-0.04em] tabular-nums">
                  {metrics.waiting > 0 ? formatWait(metrics.longest) : 'Room clear'}
                </h2>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-white/55">
              <span>{metrics.inService} at counters</span>
              <span>{metrics.servedToday} served today</span>
              <span>Avg wait today: {metrics.avgWait > 0 ? formatWait(metrics.avgWait) : '—'}</span>
            </div>
          </div>
          <div className="mt-7 lg:mt-0 shrink-0 lg:text-right">
            <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-white/50">Next up</p>
            {nextUp ? (
              <div className="mt-2">
                <p className="font-display text-xl font-bold tracking-tight truncate max-w-[260px]">{nextUp.visitorName}</p>
                <p className="text-xs text-white/55 mt-0.5">{nextUp.service ? `${nextUp.service} · ` : ''}waiting {formatWait(waitMinutesFor(nextUp, nowIso))}{nextUp.priority === 'Priority' ? ' · priority' : ''}</p>
                <div className="mt-3">
                  <Button variant="primary" size="sm" icon={<BellRing className="w-4 h-4" />} onClick={() => openCall(nextUp)} disabled={!canManage}>
                    Call now
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-white/50 mt-2">No one waiting.</p>
            )}
            <div className="inline-flex items-center gap-2 mt-4 px-3 py-2 rounded-full bg-white/10 border border-white/10 text-xs text-white/75">
              <ShieldCheck className="w-3.5 h-3.5 text-sage" />
              Clocks tick live every 30s
            </div>
          </div>
        </div>
      </section>

      <MetricStrip
        columns={4}
        className="mt-0"
        items={[
          { label: 'Waiting now', value: String(metrics.waiting), trend: metrics.waiting > 0 ? `Avg ${formatWait(metrics.waitingNow)}` : 'Clear', trendType: metrics.longest >= 30 ? 'danger' : metrics.waiting > 0 ? 'warn' : 'sage', subline: 'Live queue', icon: <Clock3 className="w-4 h-4" /> },
          { label: 'Longest wait', value: metrics.waiting > 0 ? formatWait(metrics.longest) : '—', subline: 'Oldest ticket in room', icon: <Timer className="w-4 h-4" /> },
          { label: 'At counters', value: String(metrics.inService), subline: 'Being served now', icon: <UserCheck className="w-4 h-4" /> },
          { label: 'Served today', value: String(metrics.servedToday), trend: metrics.avgWait > 0 ? `Avg wait ${formatWait(metrics.avgWait)}` : undefined, trendType: 'muted', subline: 'Completed visits', icon: <CheckCircle2 className="w-4 h-4" /> },
        ]}
      />

      {/* Filters */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div className="inline-flex p-1 rounded-[14px] bg-surface2 border border-line w-fit">
          {(['active', 'Waiting', 'InService', 'Completed', 'all'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setStatusFilter(tab)}
              className={`px-4 py-2 rounded-[10px] text-xs font-bold transition-premium cursor-pointer ${statusFilter === tab ? 'bg-surface text-ink shadow-xs' : 'text-muted hover:text-ink'}`}
            >
              {tab === 'active' ? 'Live queue' : tab === 'Waiting' ? 'Waiting' : tab === 'InService' ? 'In service' : tab === 'Completed' ? 'Served' : 'Everything'}
            </button>
          ))}
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
            value={serviceFilter}
            onChange={(event) => setServiceFilter(event.target.value)}
            className="h-9 px-3 rounded-[10px] bg-surface2 border border-line text-xs font-semibold text-muted cursor-pointer"
            aria-label="Filter by service"
          >
            <option value="all">All services</option>
            {serviceOptions.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <Panel><div className="py-14 text-center text-sm text-muted">Opening the reception desk…</div></Panel>
      ) : (
        <Panel
          title={statusFilter === 'Completed' ? 'Served visitors' : 'Visitor queue'}
          subtitle="Priority tickets jump ahead; everyone else is served in check-in order. The waiting clock freezes the moment a visitor is called."
          padding="none"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs min-w-[920px]">
              <thead className="bg-surface2/70 border-b border-line">
                <tr className="text-[11px] uppercase tracking-[0.1em] text-muted">
                  <th className="font-bold px-6 py-3.5">Visitor</th>
                  <th className="font-bold px-4 py-3.5">Service wanted</th>
                  <th className="font-bold px-4 py-3.5 text-right">Waiting</th>
                  <th className="font-bold px-4 py-3.5">Status</th>
                  <th className="font-bold px-6 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visibleQueue.map((entry, index) => {
                  const waited = waitMinutesFor(entry, nowIso);
                  const isNext = nextUp?.id === entry.id && entry.status === 'Waiting';
                  return (
                    <tr key={entry.id} className={`transition-premium ${isNext ? 'bg-accent-soft/30 hover:bg-accent-soft/50' : 'hover:bg-surface2/45'}`}>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-[11px] bg-gradient-to-br ${SERVICE_TONE[entry.service] || SERVICE_TONE.Other} flex items-center justify-center font-display font-bold text-[12px] shadow-xs shrink-0`}>
                            {initialsOf(entry.visitorName)}
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-ink text-[14px] truncate flex items-center gap-2">
                              {isNext && <ChevronRight className="w-3.5 h-3.5 text-accent shrink-0" />}
                              {entry.visitorName}
                              {entry.priority === 'Priority' && <Badge variant="warn" size="sm">Priority</Badge>}
                            </div>
                            <div className="text-[12px] text-muted truncate flex items-center gap-1">
                              {entry.phone && <><Phone className="w-3 h-3" />{entry.phone} · </>}
                              In at {checkInTime(entry.checkedInAt)}
                            </div>
                            {entry.notes && <div className="text-[11px] text-muted truncate mt-0.5 max-w-[280px]">{entry.notes}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 whitespace-nowrap">
                        <span className="font-semibold text-ink">{entry.service || '—'}</span>
                        {entry.status === 'InService' || entry.status === 'Completed' ? (
                          <div className="text-[11px] text-muted mt-1">
                            {entry.window || 'Counter'}{entry.servedByName ? ` · ${entry.servedByName}` : ''}
                            {entry.status === 'InService' && entry.calledAt && ` · serving ${formatWait(serviceMinutesFor(entry, nowIso))}`}
                          </div>
                        ) : (
                          <div className="text-[11px] text-muted mt-1">Queue #{index + 1}</div>
                        )}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div className={`font-display font-bold text-base tabular-nums ${entry.status === 'Waiting' && waited >= 30 ? 'text-danger' : entry.status === 'Waiting' && waited >= 15 ? 'text-warn' : 'text-ink'}`}>
                          {formatWait(waited)}
                        </div>
                        <div className="text-[11px] text-muted">
                          {entry.status === 'Waiting' ? 'ticking…' : `final wait${entry.status === 'Completed' && entry.completedAt && entry.calledAt ? ` · served ${formatWait(minutesBetween(entry.calledAt, entry.completedAt))}` : ''}`}
                        </div>
                      </td>
                      <td className="px-4 py-4">{statusBadge(entry)}</td>
                      <td className="px-6 py-4 text-right whitespace-nowrap">
                        {entry.status === 'Waiting' && (
                          <div className="inline-flex gap-1.5 justify-end flex-wrap">
                            <Button variant="primary" size="sm" icon={<BellRing className="w-3.5 h-3.5" />} onClick={() => openCall(entry)} disabled={!canManage}>
                              Call
                            </Button>
                            {canManage && (
                              <button type="button" title="Mark as no-show" onClick={() => handleClose(entry, 'NoShow')} className="p-2 rounded-[9px] border border-line bg-surface text-muted hover:text-danger hover:border-danger/40 cursor-pointer" aria-label={`No-show ${entry.visitorName}`}>
                                <UserX className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                        {entry.status === 'InService' && (
                          <div className="inline-flex gap-1.5 justify-end flex-wrap">
                            <Button variant="primary" size="sm" icon={<CheckCircle2 className="w-3.5 h-3.5" />} onClick={() => handleComplete(entry)} disabled={!canManage}>
                              Complete
                            </Button>
                            {canManage && <Button variant="ghost" size="sm" onClick={() => handleClose(entry, 'NoShow')}>No-show</Button>}
                          </div>
                        )}
                        {(entry.status === 'Completed' || entry.status === 'Cancelled' || entry.status === 'NoShow') && (
                          <span className="text-[12px] text-muted">
                            {entry.completedAt ? `Done ${checkInTime(entry.completedAt)}` : 'Closed'}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {visibleQueue.length === 0 && (
                  <tr><td colSpan={5} className="px-6 py-14 text-center text-sm text-muted">
                    <ClipboardList className="w-6 h-6 mx-auto mb-2 text-faint" />
                    No tickets here. Check a visitor in to start their waiting clock.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-4 border-t border-line bg-surface2/40 flex flex-wrap items-center justify-between gap-3 text-[12px] text-muted">
            <span className="inline-flex items-center gap-1.5"><Timer className="w-3.5 h-3.5 text-accent" /> Waiting clocks refresh automatically — no page reload needed.</span>
            <span className="font-semibold text-ink">{visibleQueue.length} of {queue.length} tickets shown</span>
          </div>
        </Panel>
      )}

      {/* Check-in modal */}
      {registerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/70 backdrop-blur-xs">
          <div className="bg-surface rounded-[22px] border border-line shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-5 border-b border-line flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-[13px] bg-accent/12 text-accent flex items-center justify-center"><Plus className="w-5 h-5" /></div>
                <div>
                  <h3 className="font-display text-lg font-bold text-ink tracking-tight">Check in visitor</h3>
                  <p className="text-xs text-muted mt-0.5">Their waiting clock starts the moment you confirm.</p>
                </div>
              </div>
              <button type="button" onClick={() => setRegisterOpen(false)} className="p-2 rounded-lg text-muted hover:text-ink hover:bg-surface2 cursor-pointer" aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={submitRegistration} className="p-6 space-y-4">
              <label className="block">
                <span className="block text-xs font-bold text-ink mb-1.5">Visitor name</span>
                <input value={visitorName} onChange={(e) => setVisitorName(e.target.value)} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink placeholder:text-muted focus:border-accent outline-none" placeholder="Full name" autoFocus />
              </label>
              <label className="block">
                <span className="block text-xs font-bold text-ink mb-1.5">Note <span className="font-normal text-muted">(optional)</span></span>
                <textarea value={visitorNotes} onChange={(e) => setVisitorNotes(e.target.value)} rows={2} className="w-full px-3 py-2.5 rounded-[10px] bg-surface2 border border-line text-sm text-ink resize-none" placeholder="What did they come about?" />
              </label>
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" size="md" onClick={() => setRegisterOpen(false)}>Cancel</Button>
                <Button type="submit" variant="primary" size="md" icon={<CheckCircle2 className="w-4 h-4" />} disabled={registering}>
                  {registering ? 'Checking in…' : 'Start waiting clock'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Call modal */}
      {callTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/70 backdrop-blur-xs">
          <div className="bg-surface rounded-[22px] border border-line shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            <div className="px-6 py-5 border-b border-line flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-[13px] bg-sage/12 text-sage flex items-center justify-center"><BellRing className="w-5 h-5" /></div>
                <div>
                  <h3 className="font-display text-lg font-bold text-ink tracking-tight">Call visitor</h3>
                  <p className="text-xs text-muted mt-0.5">{callTarget.visitorName} · waited {formatWait(waitMinutesFor(callTarget, nowIso))}</p>
                </div>
              </div>
              <button type="button" onClick={() => setCallTarget(null)} className="p-2 rounded-lg text-muted hover:text-ink hover:bg-surface2 cursor-pointer" aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={submitCall} className="p-6 space-y-4">
              <label className="block">
                <span className="block text-xs font-bold text-ink mb-1.5">Send to</span>
                <select value={callWindow} onChange={(e) => setCallWindow(e.target.value)} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink cursor-pointer">
                  {RECEPTION_WINDOWS.map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </label>
              <div className="p-4 rounded-[14px] bg-surface2 border border-line text-xs text-muted leading-relaxed">
                Calling freezes the waiting clock at <span className="font-bold text-ink tabular-nums">{formatWait(waitMinutesFor(callTarget, nowIso))}</span> and
                records you as the serving officer. Mark <span className="font-bold text-ink">Complete</span> when their {callTarget.service ? `${callTarget.service.toLowerCase()} ` : ''}request is done.
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" size="md" onClick={() => setCallTarget(null)}>Back</Button>
                <Button type="submit" variant="primary" size="md" icon={<BellRing className="w-4 h-4" />} disabled={calling}>
                  {calling ? 'Calling…' : 'Confirm call'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
