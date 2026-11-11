import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meetingCalendarDays } from '../src/utils/meetingCalendar.ts';
import { serviceHarness } from './helpers/serviceHarness.ts';
import { shiftDateString, todayDateString } from '../src/utils/date.ts';

test('calendar handles Monday-first weeks, leap days and year boundaries', () => {
  const november = meetingCalendarDays(2026, 10);
  assert.equal(november.length, 42);
  assert.equal(november[0], '2026-10-26');
  assert.equal(november[41], '2026-12-06');
  assert.ok(meetingCalendarDays(2024, 1).includes('2024-02-29'));
  assert.ok(!meetingCalendarDays(2025, 1).includes('2025-02-29'));
  assert.equal(meetingCalendarDays(2027, 0)[0], '2026-12-28');
});
const actor = { uid: 'clerk', displayName: 'Clerk', role: 'Cashier' };
test('meetings are saved as scheduled and retries reuse the same ticket', async () => {
  const h = await serviceHarness('src/services/receptionService.ts');
  const input = { submissionId: 'request-1', visitorName: 'Visitor', date: shiftDateString(todayDateString(), 2), time: '14:30' };
  const first = await h.api.createReceptionMeeting(input, actor);
  assert.equal(first.status, 'Scheduled');
  assert.equal(first.scheduledFor, input.date);
  assert.equal(first.scheduledTime, '14:30');
  const retry = await h.api.createReceptionMeeting(input, actor);
  assert.equal(retry.id, first.id);
  assert.equal(h.api.pickNextVisitor([first]), null);
  assert.equal(h.api.waitMinutesFor(first), 0);
  const next = await h.api.createReceptionMeeting({ ...input, submissionId: 'request-2' }, actor);
  assert.notEqual(next.id, first.id);
  assert.equal([...h.records.keys()].filter((key) => key.startsWith('receptionEntries/')).length, 2);
});
test('meeting validation refuses invalid dates, times and unauthorized users before writing', async () => {
  const h = await serviceHarness('src/services/receptionService.ts');
  const input = { submissionId: 'request', visitorName: 'Visitor', date: shiftDateString(todayDateString(), 1) };
  await assert.rejects(h.api.createReceptionMeeting({ ...input, date: todayDateString() }, actor), /future/);
  await assert.rejects(h.api.createReceptionMeeting({ ...input, time: '25:30' }, actor), /Heure/);
  await assert.rejects(h.api.createReceptionMeeting({ ...input, visitorName: ' ' }, actor), /nom/);
  await assert.rejects(h.api.createReceptionMeeting(input, { ...actor, role: 'Auditor' }), /lecture/);
  assert.equal(h.records.size, 0);
});
