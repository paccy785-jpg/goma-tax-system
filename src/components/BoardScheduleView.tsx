import React, { useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  X,
  CheckCircle2,
  RotateCcw,
  Trash2,
  Clock3,
  MapPin,
  AlertTriangle,
  Handshake,
  Hourglass,
} from 'lucide-react';
import { BoardDepartment, ScheduleEvent, ScheduleEventKind, UserRole, BOARD_DEPARTMENTS, BOARD_DEPARTMENT_LABELS } from '../types';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { Button, Badge, Panel, MetricStrip } from './ui';
import {
  WEEKDAY_HEADERS,
  createScheduleEvent,
  deleteScheduleEvent,
  getScheduleEvents,
  isDeadlineHot,
  isOverdue,
  monthCells,
  monthLabel,
  setScheduleEventStatus,
  shiftMonth,
  sortEventsChronologically,
  subscribeToScheduleEvents,
} from '../services/scheduleService';
import { todayDateString } from '../utils/date';

interface BoardScheduleViewProps {
  userRole: UserRole;
}

const dayNumber = (dateStr: string) => String(Number(dateStr.slice(8, 10)));

const prettyDay = (dateStr: string) => {
  const parsed = new Date(`${dateStr}T12:00:00`);
  if (isNaN(parsed.getTime())) return dateStr;
  return parsed.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
};

export const BoardScheduleView: React.FC<BoardScheduleViewProps> = ({ userRole }) => {
  const { showToast } = useToast();
  const { userProfile } = useAuth();
  const today = useMemo(() => todayDateString(), []);

  const [events, setEvents] = useState<ScheduleEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [kindFilter, setKindFilter] = useState<'all' | ScheduleEventKind>('all');
  const [deptFilter, setDeptFilter] = useState<'all' | BoardDepartment>('all');

  const [modalOpen, setModalOpen] = useState(false);
  const [formKind, setFormKind] = useState<ScheduleEventKind>('Meeting');
  const [formTitle, setFormTitle] = useState('');
  const [formDate, setFormDate] = useState(today);
  const [formTime, setFormTime] = useState('09:00');
  const [formDept, setFormDept] = useState<BoardDepartment>('General');
  const [formLocation, setFormLocation] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const canManage = userRole === 'Admin' || userRole === 'Supervisor' || userRole === 'Cashier';
  const actor = {
    uid: userProfile?.uid || 'local_session',
    displayName: userProfile?.displayName || 'DPRNK Officer',
    role: userRole,
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    getScheduleEvents()
      .then((list) => {
        if (mounted) setEvents(list);
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setLoading(false);
      });
    const unsub = subscribeToScheduleEvents((list) => {
      if (!mounted) return;
      setEvents(list);
      setLoading(false);
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, []);

  const filtered = useMemo(
    () =>
      events.filter(
        (e) =>
          (kindFilter === 'all' || e.kind === kindFilter) &&
          (deptFilter === 'all' || e.department === deptFilter)
      ),
    [events, kindFilter, deptFilter]
  );

  const eventsByDate = useMemo(() => {
    const map = new Map<string, ScheduleEvent[]>();
    for (const e of filtered) {
      const list = map.get(e.date) || [];
      list.push(e);
      map.set(e.date, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
    }
    return map;
  }, [filtered]);

  const metrics = useMemo(() => {
    const upcomingMeetings = filtered.filter((e) => e.kind === 'Meeting' && e.status === 'Scheduled' && e.date >= today).length;
    const pendingDeadlines = filtered.filter((e) => e.kind === 'Deadline' && e.status === 'Scheduled').length;
    const overdue = filtered.filter((e) => isOverdue(e, today)).length;
    const doneThisMonth = filtered.filter(
      (e) => e.status === 'Done' && e.date.slice(0, 7) === today.slice(0, 7)
    ).length;
    return { upcomingMeetings, pendingDeadlines, overdue, doneThisMonth };
  }, [filtered, today]);

  const upcoming = useMemo(
    () =>
      sortEventsChronologically(
        filtered.filter((e) => e.status === 'Scheduled' && e.date >= today)
      ).slice(0, 6),
    [filtered, today]
  );

  const overdueList = useMemo(
    () => sortEventsChronologically(filtered.filter((e) => isOverdue(e, today))),
    [filtered, today]
  );

  const selectedEvents = useMemo(
    () => sortEventsChronologically(eventsByDate.get(selectedDate) || []),
    [eventsByDate, selectedDate]
  );

  const cells = useMemo(() => monthCells(cursor.year, cursor.month), [cursor]);

  const openModal = (kind: ScheduleEventKind, date?: string) => {
    if (!canManage) {
      showToast('Auditors have read-only access to the schedule.', 'warning', 'Restricted action');
      return;
    }
    setFormKind(kind);
    setFormTitle('');
    setFormDate(date || selectedDate);
    setFormTime('09:00');
    setFormDept('General');
    setFormLocation('');
    setFormNotes('');
    setModalOpen(true);
  };

  const submitEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) {
      showToast(formKind === 'Deadline' ? 'Name the report that is due.' : 'Name the meeting.', 'warning', 'Title required');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(formDate)) {
      showToast('Pick a valid date.', 'warning', 'Date required');
      return;
    }
    setSaving(true);
    try {
      const created = await createScheduleEvent({
        title: formTitle.trim(),
        kind: formKind,
        date: formDate,
        time: formTime,
        department: formDept,
        location: formLocation.trim(),
        notes: formNotes.trim(),
        actor,
      });
      setEvents((current) => [created, ...current]);
      setSelectedDate(created.date);
      const createdMonth = new Date(`${created.date}T12:00:00`);
      if (!isNaN(createdMonth.getTime())) {
        setCursor({ year: createdMonth.getFullYear(), month: createdMonth.getMonth() });
      }
      setModalOpen(false);
      showToast(
        formKind === 'Deadline'
          ? `Deadline set for ${created.date}. It now shows on the calendar.`
          : `Meeting set for ${created.date}${created.time ? ` at ${created.time}` : ''}.`,
        'success',
        formKind === 'Deadline' ? 'Deadline scheduled' : 'Meeting scheduled'
      );
    } catch (err: any) {
      showToast(err?.message || 'Could not save the entry.', 'error', 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (event: ScheduleEvent, status: 'Scheduled' | 'Done' | 'Cancelled') => {
    const allowed = canManage || event.createdBy === actor.uid;
    if (!allowed) {
      showToast('Auditors have read-only access to the schedule.', 'warning', 'Restricted action');
      return;
    }
    try {
      await setScheduleEventStatus(event, status, actor);
      setEvents((current) => current.map((e) => (e.id === event.id ? { ...e, status } : e)));
    } catch (err: any) {
      showToast(err?.message || 'Could not update the entry.', 'error', 'Update failed');
    }
  };

  const removeEvent = async (event: ScheduleEvent) => {
    const allowed = canManage || event.createdBy === actor.uid;
    if (!allowed) {
      showToast('Auditors have read-only access to the schedule.', 'warning', 'Restricted action');
      return;
    }
    try {
      await deleteScheduleEvent(event, actor);
      setEvents((current) => current.filter((e) => e.id !== event.id));
      showToast('Entry removed from the schedule.', 'info', 'Deleted');
    } catch (err: any) {
      showToast(err?.message || 'Could not delete the entry.', 'error', 'Delete failed');
    }
  };

  const kindBadge = (kind: ScheduleEventKind) =>
    kind === 'Deadline' ? <Badge variant="danger" dot>Deadline</Badge> : <Badge variant="accent" dot>Meeting</Badge>;

  const statusBadge = (event: ScheduleEvent) => {
    if (event.status === 'Done') return <Badge variant="sage" dot>Done</Badge>;
    if (event.status === 'Cancelled') return <Badge variant="neutral">Cancelled</Badge>;
    if (isOverdue(event, today)) return <Badge variant="danger" dot>Overdue</Badge>;
    if (isDeadlineHot(event, today)) return <Badge variant="warn" dot>Due</Badge>;
    return <Badge variant="neutral" dot>Scheduled</Badge>;
  };

  const renderEventRow = (event: ScheduleEvent) => (
    <div
      key={event.id}
      className={`p-3.5 rounded-[14px] border transition-premium ${
        event.status !== 'Scheduled'
          ? 'border-line bg-surface2/40 opacity-70'
          : isOverdue(event, today)
            ? 'border-danger/40 bg-danger/5'
            : 'border-line bg-surface2/40 hover:bg-surface2/70'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {kindBadge(event.kind)}
            {statusBadge(event)}
            <Badge variant="neutral">{event.department === 'General' ? 'All staff' : event.department}</Badge>
          </div>
          <div className={`mt-1.5 font-bold text-ink text-[14px] leading-snug ${event.status !== 'Scheduled' ? 'line-through' : ''}`}>
            {event.title}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted">
            {event.time && (
              <span className="inline-flex items-center gap-1 font-mono font-bold text-ink/80"><Clock3 className="w-3 h-3" />{event.time}</span>
            )}
            {event.location && (
              <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{event.location}</span>
            )}
          </div>
          {event.notes && <p className="mt-1.5 text-[12px] text-muted leading-relaxed">{event.notes}</p>}
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          {event.status === 'Scheduled' ? (
            <button
              type="button"
              title={event.kind === 'Deadline' ? 'Mark done' : 'Mark done'}
              onClick={() => changeStatus(event, 'Done')}
              className="p-2 rounded-[9px] border border-line bg-surface text-muted hover:text-sage hover:border-sage cursor-pointer"
              aria-label={`Mark done ${event.title}`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              title="Reopen"
              onClick={() => changeStatus(event, 'Scheduled')}
              className="p-2 rounded-[9px] border border-line bg-surface text-muted hover:text-ink hover:border-accent cursor-pointer"
              aria-label={`Reopen ${event.title}`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            title="Delete"
            onClick={() => removeEvent(event)}
            className="p-2 rounded-[9px] border border-line bg-surface text-muted hover:text-danger hover:border-danger/40 cursor-pointer"
            aria-label={`Delete ${event.title}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <MetricStrip
        columns={4}
        className="mt-0"
        items={[
          { label: 'Meetings ahead', value: String(metrics.upcomingMeetings), subline: 'Scheduled, not yet held', icon: <Handshake className="w-4 h-4" /> },
          { label: 'Deadlines pending', value: String(metrics.pendingDeadlines), subline: 'Reports due', icon: <Hourglass className="w-4 h-4" /> },
          { label: 'Overdue', value: String(metrics.overdue), trend: metrics.overdue > 0 ? 'Act now' : 'Clear', trendType: metrics.overdue > 0 ? 'danger' : 'sage', subline: 'Past date, still open', icon: <AlertTriangle className="w-4 h-4" /> },
          { label: 'Closed this month', value: String(metrics.doneThisMonth), subline: 'Meetings held + reports filed', icon: <CheckCircle2 className="w-4 h-4" /> },
        ]}
      />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex p-1 rounded-[14px] bg-surface2 border border-line w-fit">
          {(['all', 'Meeting', 'Deadline'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => setKindFilter(kind)}
              className={`px-4 py-2 rounded-[10px] text-xs font-bold transition-premium cursor-pointer ${kindFilter === kind ? 'bg-surface text-ink shadow-xs' : 'text-muted hover:text-ink'}`}
            >
              {kind === 'all' ? 'Everything' : kind === 'Meeting' ? 'Meetings' : 'Deadlines'}
            </button>
          ))}
        </div>
        <select
          value={deptFilter}
          onChange={(event) => setDeptFilter(event.target.value as 'all' | BoardDepartment)}
          className="h-9 px-3 rounded-[10px] bg-surface2 border border-line text-xs font-semibold text-muted cursor-pointer"
          aria-label="Filter by department"
        >
          <option value="all">All departments</option>
          {BOARD_DEPARTMENTS.map((d) => (
            <option key={d} value={d}>{BOARD_DEPARTMENT_LABELS[d]}</option>
          ))}
        </select>
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" size="sm" icon={<Hourglass className="w-4 h-4" />} onClick={() => openModal('Deadline', selectedDate)} disabled={!canManage}>
            Set deadline
          </Button>
          <Button variant="primary" size="sm" icon={<Plus className="w-4 h-4" />} onClick={() => openModal('Meeting', selectedDate)} disabled={!canManage}>
            Set meeting
          </Button>
        </div>
      </div>

      {loading ? (
        <Panel><div className="py-14 text-center text-sm text-muted">Opening the schedule…</div></Panel>
      ) : (
        <div className="grid lg:grid-cols-[1.5fr_1fr] gap-4 items-start">
          {/* Month calendar */}
          <Panel padding="none">
            <div className="px-5 py-4 border-b border-line flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-[11px] bg-accent/12 text-accent flex items-center justify-center">
                  <CalendarDays className="w-4.5 h-4.5" />
                </div>
                <h3 className="font-display text-base font-bold text-ink tracking-tight">{monthLabel(cursor.year, cursor.month)}</h3>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    const now = new Date();
                    setCursor({ year: now.getFullYear(), month: now.getMonth() });
                    setSelectedDate(today);
                  }}
                  className="h-8 px-3 rounded-[9px] border border-line bg-surface text-[12px] font-bold text-muted hover:text-ink cursor-pointer"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => setCursor((c) => shiftMonth(c.year, c.month, -1))}
                  className="w-8 h-8 rounded-[9px] border border-line bg-surface text-muted hover:text-ink flex items-center justify-center cursor-pointer"
                  aria-label="Previous month"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setCursor((c) => shiftMonth(c.year, c.month, 1))}
                  className="w-8 h-8 rounded-[9px] border border-line bg-surface text-muted hover:text-ink flex items-center justify-center cursor-pointer"
                  aria-label="Next month"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="p-4 sm:p-5">
              <div className="grid grid-cols-7 gap-1.5 mb-1.5">
                {WEEKDAY_HEADERS.map((day) => (
                  <div key={day} className="text-center text-[11px] font-bold uppercase tracking-[0.1em] text-muted py-1">
                    {day}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {cells.map((dateStr, index) => {
                  if (!dateStr) return <div key={`pad-${index}`} className="min-h-[64px] sm:min-h-[76px] rounded-[12px]" />;
                  const dayEvents = eventsByDate.get(dateStr) || [];
                  const hasOverdue = dayEvents.some((e) => isOverdue(e, today));
                  const hasHot = dayEvents.some((e) => isDeadlineHot(e, today));
                  const isSelected = selectedDate === dateStr;
                  const isToday = today === dateStr;
                  return (
                    <button
                      key={dateStr}
                      type="button"
                      onClick={() => setSelectedDate(dateStr)}
                      className={`min-h-[64px] sm:min-h-[76px] rounded-[12px] border p-1.5 text-left transition-premium cursor-pointer flex flex-col ${
                        isSelected
                          ? 'border-accent bg-accent-soft/50 shadow-xs'
                          : hasOverdue
                            ? 'border-danger/40 bg-danger/5 hover:border-danger/60'
                            : 'border-line bg-surface2/30 hover:bg-surface2/70 hover:border-accent/40'
                      }`}
                    >
                      <span
                        className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[12px] font-bold tabular-nums ${
                          isToday ? 'bg-navy text-white' : isSelected ? 'text-ink' : 'text-muted'
                        }`}
                      >
                        {dayNumber(dateStr)}
                      </span>
                      <span className="mt-auto flex flex-wrap gap-1 pt-1">
                        {dayEvents.filter((e) => e.status === 'Scheduled').slice(0, 3).map((e) => (
                          <span
                            key={e.id}
                            title={e.title}
                            className={`h-1.5 flex-1 min-w-[10px] rounded-full ${
                              e.kind === 'Deadline' ? (hasOverdue || hasHot ? 'bg-danger' : 'bg-warn') : 'bg-accent'
                            }`}
                          />
                        ))}
                        {dayEvents.filter((e) => e.status === 'Scheduled').length > 3 && (
                          <span className="text-[10px] font-bold text-muted leading-none">+{dayEvents.filter((e) => e.status === 'Scheduled').length - 3}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
                <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-accent" /> Meeting</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-warn" /> Deadline</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-danger" /> Due / overdue</span>
              </div>
            </div>
          </Panel>

          {/* Selected day + upcoming */}
          <div className="space-y-4">
            <Panel
              title={prettyDay(selectedDate)}
              subtitle={`${selectedEvents.length} ${selectedEvents.length === 1 ? 'entry' : 'entries'} scheduled`}
              actions={
                <Button variant="ghost" size="sm" icon={<Plus className="w-3.5 h-3.5" />} onClick={() => openModal('Meeting', selectedDate)} disabled={!canManage}>
                  Add
                </Button>
              }
            >
              {selectedEvents.length > 0 ? (
                <div className="space-y-2.5">{selectedEvents.map(renderEventRow)}</div>
              ) : (
                <p className="text-xs text-muted py-4 text-center">Nothing scheduled this day — enjoy the calm, or set a meeting.</p>
              )}
            </Panel>

            {overdueList.length > 0 && (
              <Panel title="Overdue — needs action" subtitle={`${overdueList.length} open past their date`}>
                <div className="space-y-2.5">{overdueList.slice(0, 3).map(renderEventRow)}</div>
              </Panel>
            )}

            <Panel title="Coming up" subtitle="Next scheduled entries">
              {upcoming.length > 0 ? (
                <div className="space-y-2.5">
                  {upcoming.map((event) => (
                    <div key={event.id} className="flex items-center gap-3 p-3 rounded-[12px] border border-line bg-surface2/40">
                      <div className={`w-8 h-8 rounded-[10px] flex items-center justify-center shrink-0 ${event.kind === 'Deadline' ? 'bg-danger/12 text-danger' : 'bg-accent/12 text-accent'}`}>
                        {event.kind === 'Deadline' ? <Hourglass className="w-4 h-4" /> : <Handshake className="w-4 h-4" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-ink truncate">{event.title}</div>
                        <div className="text-[11px] text-muted">
                          {event.date}
                          {event.time ? ` · ${event.time}` : ''} · {event.department === 'General' ? 'All staff' : event.department}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedDate(event.date);
                          const parsed = new Date(`${event.date}T12:00:00`);
                          if (!isNaN(parsed.getTime())) setCursor({ year: parsed.getFullYear(), month: parsed.getMonth() });
                        }}
                        className="text-[12px] font-bold text-accent hover:text-accent-dark cursor-pointer shrink-0"
                      >
                        View
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted py-4 text-center">Nothing coming up under these filters.</p>
              )}
            </Panel>
          </div>
        </div>
      )}

      {/* Set meeting / deadline */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/70 backdrop-blur-xs">
          <div className="bg-surface rounded-[22px] border border-line shadow-2xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150 max-h-[92vh] overflow-y-auto">
            <div className="px-6 py-5 border-b border-line flex items-center justify-between sticky top-0 bg-surface">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-[13px] flex items-center justify-center ${formKind === 'Deadline' ? 'bg-danger/12 text-danger' : 'bg-accent/12 text-accent'}`}>
                  {formKind === 'Deadline' ? <Hourglass className="w-5 h-5" /> : <Handshake className="w-5 h-5" />}
                </div>
                <div>
                  <h3 className="font-display text-lg font-bold text-ink tracking-tight">
                    {formKind === 'Deadline' ? 'Set a report deadline' : 'Set a meeting'}
                  </h3>
                  <p className="text-xs text-muted mt-0.5">It appears on the calendar for every officer.</p>
                </div>
              </div>
              <button type="button" onClick={() => setModalOpen(false)} className="p-2 rounded-lg text-muted hover:text-ink hover:bg-surface2 cursor-pointer" aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={submitEvent} className="p-6 space-y-4">
              <div>
                <span className="block text-xs font-bold text-ink mb-1.5">Entry type</span>
                <div className="grid grid-cols-2 gap-2">
                  {(['Meeting', 'Deadline'] as const).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => setFormKind(kind)}
                      className={`h-10 rounded-[10px] border text-xs font-bold transition-premium cursor-pointer ${formKind === kind ? 'bg-navy text-white border-navy' : 'bg-surface2 text-muted border-line hover:text-ink'}`}
                    >
                      {kind === 'Meeting' ? 'Meeting day' : 'Report deadline'}
                    </button>
                  ))}
                </div>
              </div>
              <label className="block">
                <span className="block text-xs font-bold text-ink mb-1.5">
                  {formKind === 'Deadline' ? 'Report title' : 'Meeting title'}
                </span>
                <input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink placeholder:text-muted focus:border-accent outline-none" placeholder={formKind === 'Deadline' ? 'e.g. October cashier shift summaries' : 'e.g. Weekly revenue coordination'} />
              </label>
              <div className="grid sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className="block text-xs font-bold text-ink mb-1.5">Date</span>
                  <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink" />
                </label>
                <label className="block">
                  <span className="block text-xs font-bold text-ink mb-1.5">Time <span className="font-normal text-muted">(optional)</span></span>
                  <input type="time" value={formTime} onChange={(e) => setFormTime(e.target.value)} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink" />
                </label>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <span className="block text-xs font-bold text-ink mb-1.5">Concerns</span>
                  <div className="grid grid-cols-3 gap-2">
                    {BOARD_DEPARTMENTS.map((dept) => (
                      <button
                        key={dept}
                        type="button"
                        onClick={() => setFormDept(dept)}
                        className={`h-10 rounded-[10px] border text-xs font-bold transition-premium cursor-pointer ${formDept === dept ? 'bg-navy text-white border-navy' : 'bg-surface2 text-muted border-line hover:text-ink'}`}
                      >
                        {dept === 'General' ? 'All' : dept}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="block">
                  <span className="block text-xs font-bold text-ink mb-1.5">Location <span className="font-normal text-muted">(meetings)</span></span>
                  <input value={formLocation} onChange={(e) => setFormLocation(e.target.value)} className="w-full h-10 px-3 rounded-[10px] bg-surface2 border border-line text-sm text-ink placeholder:text-muted focus:border-accent outline-none" placeholder="Meeting room…" />
                </label>
              </div>
              <label className="block">
                <span className="block text-xs font-bold text-ink mb-1.5">Notes <span className="font-normal text-muted">(optional)</span></span>
                <textarea value={formNotes} onChange={(e) => setFormNotes(e.target.value)} rows={3} className="w-full px-3 py-2.5 rounded-[10px] bg-surface2 border border-line text-sm text-ink resize-none" placeholder="Agenda, expected reports, who must attend…" />
              </label>
              <div className="flex items-center justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" size="md" onClick={() => setModalOpen(false)}>Cancel</Button>
                <Button type="submit" variant="primary" size="md" icon={<CheckCircle2 className="w-4 h-4" />} disabled={saving}>
                  {saving ? 'Saving…' : formKind === 'Deadline' ? 'Set deadline' : 'Set meeting'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
