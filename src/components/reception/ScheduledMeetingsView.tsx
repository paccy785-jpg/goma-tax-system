import React, { useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Plus, X } from 'lucide-react';
import { ReceptionEntry, UserRole } from '../../types';
import { createReceptionMeeting } from '../../services/receptionService';
import { meetingCalendarDays } from '../../utils/meetingCalendar';
import { shiftDateString, todayDateString } from '../../utils/date';
import { useLanguage } from '../../i18n/LanguageContext';
import { useToast } from '../../contexts/ToastContext';
import { Button } from '../ui';

export function ScheduledMeetingsView({ entries, actor, canManage, onSaved, onReturn, onReschedule, loading }: {
  entries: ReceptionEntry[];
  actor: { uid: string; displayName: string; role: UserRole };
  canManage: boolean; loading: boolean;
  onSaved: (entry: ReceptionEntry) => void;
  onReturn: (entry: ReceptionEntry) => void;
  onReschedule: (entry: ReceptionEntry) => void;
}) {
  const { lang } = useLanguage();
  const { showToast } = useToast();
  const locale = lang === 'fr' ? 'fr-FR' : 'en-GB';
  const today = todayDateString();
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selected, setSelected] = useState(today);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [service, setService] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const submission = useRef('');
  const meetings = useMemo(() => entries.filter((e) => e.status === 'Scheduled').sort((a, b) =>
    (a.scheduledFor || '').localeCompare(b.scheduledFor || '') || (a.scheduledTime || '').localeCompare(b.scheduledTime || '')), [entries]);
  const days = meetingCalendarDays(month.getFullYear(), month.getMonth());
  const dayMeetings = meetings.filter((e) => e.scheduledFor === selected);
  const labelDate = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
  const startMeeting = () => {
    submission.current = crypto.randomUUID();
    setName(''); setDate(selected > today ? selected : shiftDateString(today, 1));
    setTime(''); setService(''); setNotes(''); setOpen(true);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canManage || busy.current) return;
    busy.current = true; setSaving(true);
    try {
      const entry = await createReceptionMeeting({ submissionId: submission.current, visitorName: name, date, time, service, notes }, actor);
      onSaved(entry); setSelected(date);
      const parsed = new Date(`${date}T12:00:00`); setMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
      setOpen(false); showToast('Meeting scheduled.', 'success', 'Reception');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not schedule meeting.', 'error', 'Reception');
    } finally { busy.current = false; setSaving(false); }
  };
  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h2 className="text-2xl font-display font-bold text-ink">Scheduled Meetings</h2><p className="text-sm text-muted mt-1">Select a day to view its meetings and visits.</p></div>
      {canManage && <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={startMeeting} disabled={loading}>Schedule meeting</Button>}
    </div>
    {loading ? <p role="status">Loading meetings…</p> : <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.8fr)_minmax(280px,1fr)] gap-7 items-start">
      <div className="meeting-calendar-shell">
        <div className="meeting-calendar">
          <div className="flex flex-wrap items-center justify-between gap-3 p-5 sm:p-6 bg-navy text-white rounded-t-[20px]">
            <div className="flex items-center gap-3"><CalendarDays className="w-6 h-6 text-white/70" /><h3 className="text-xl font-display font-bold capitalize" aria-live="polite">{month.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</h3></div>
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="p-2 rounded-lg hover:bg-white/15"><ChevronLeft className="w-4 h-4" /></button>
              <button type="button" onClick={() => { const now = new Date(); setMonth(new Date(now.getFullYear(), now.getMonth(), 1)); setSelected(today); }} className="text-xs px-3 py-2 rounded-lg bg-white/10">Today</button>
              <button type="button" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="p-2 rounded-lg hover:bg-white/15"><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
          <div className="grid grid-cols-7 px-3 pt-4 pb-2 text-center text-[11px] font-bold uppercase tracking-wider text-muted">
            {Array.from({ length: 7 }, (_, i) => <div key={i}>{new Date(2026, 0, 5 + i).toLocaleDateString(locale, { weekday: 'short' })}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1 sm:gap-2 p-3 pb-5">
            {days.map((day) => {
              const items = meetings.filter((entry) => entry.scheduledFor === day);
              const inMonth = day.slice(0, 7) === days[15].slice(0, 7);
              return <button type="button" key={day} aria-label={`${labelDate(day)}, ${items.length}`} aria-pressed={selected === day} onClick={() => setSelected(day)} className={`meeting-day ${selected === day ? 'meeting-day-selected' : ''} ${inMonth ? '' : 'opacity-40'}`}>
                <span className={`text-sm font-bold inline-flex w-7 h-7 items-center justify-center rounded-full ${day === today ? 'bg-accent text-white' : ''}`}>{Number(day.slice(-2))}</span>
                <span className="flex gap-1 mt-2 justify-center" aria-hidden="true">{items.slice(0, 3).map((item) => <span key={item.id} className="w-1.5 h-1.5 rounded-full bg-accent" />)}</span>
                {items.length > 0 && <span className="hidden sm:block text-[10px] text-muted mt-1 tabular-nums">{items.length}</span>}
              </button>;
            })}
          </div>
        </div>
      </div>
      <aside className="rounded-[20px] border border-line bg-surface p-5 shadow-card space-y-4">
        <div><p className="text-[11px] font-bold uppercase tracking-wider text-accent">Day agenda</p><h3 className="text-lg font-display font-bold text-ink mt-1">{labelDate(selected)}</h3></div>
        {dayMeetings.length === 0 ? <div className="py-10 text-center text-muted"><CalendarDays className="w-8 h-8 mx-auto mb-3 opacity-40" /><p className="text-sm">No meetings scheduled for this day.</p></div> : dayMeetings.map((entry) => <div key={entry.id} className="rounded-xl border border-line bg-surface2/60 p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs text-accent font-bold"><Clock3 className="w-3.5 h-3.5" />{entry.scheduledTime || (lang === 'fr' ? 'Heure non précisée' : 'Time not specified')}</div>
          <p className="font-bold text-ink">{entry.visitorName}</p><p className="text-xs text-muted">{entry.service}</p>
          {entry.notes && <p className="text-xs text-muted whitespace-pre-wrap">{entry.notes}</p>}
          {canManage && <div className="flex gap-2 pt-2"><Button size="sm" onClick={() => onReschedule(entry)}>Reschedule</Button><Button size="sm" variant="primary" disabled={!entry.scheduledFor || entry.scheduledFor > today} onClick={() => onReturn(entry)}>Check in</Button></div>}
        </div>)}
      </aside>
    </div>}
    {open && <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-navy/70 backdrop-blur-xs">
      <div role="dialog" aria-modal="true" aria-labelledby="new-meeting-title" className="bg-surface rounded-[22px] border border-line shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-5"><h3 id="new-meeting-title" className="text-lg font-bold text-ink">Schedule meeting</h3><Button icon={<X className="w-4 h-4" />} aria-label="Close" onClick={() => setOpen(false)} disabled={saving} /></div>
        <form onSubmit={submit} className="space-y-4">
          <label className="block text-xs font-bold text-ink">Visitor name<input required value={name} onChange={(e) => setName(e.target.value)} className="meeting-input" autoFocus /></label>
          <div className="grid grid-cols-2 gap-4"><label className="block text-xs font-bold text-ink">Appointment date<input required type="date" min={shiftDateString(today, 1)} value={date} onChange={(e) => setDate(e.target.value)} className="meeting-input" /></label><label className="block text-xs font-bold text-ink">Time (optional)<input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="meeting-input" /></label></div>
          <label className="block text-xs font-bold text-ink">Service wanted<input value={service} onChange={(e) => setService(e.target.value)} className="meeting-input" /></label>
          <label className="block text-xs font-bold text-ink">Notes<textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} className="meeting-input" /></label>
          <div className="flex justify-end gap-2"><Button onClick={() => setOpen(false)} disabled={saving}>Cancel</Button><Button type="submit" variant="primary" disabled={saving}>{saving ? 'Saving…' : 'Confirm schedule'}</Button></div>
        </form>
      </div>
    </div>}
  </div>;
}
