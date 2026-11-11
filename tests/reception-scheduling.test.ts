import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serviceHarness } from './helpers/serviceHarness.ts';
import { todayDateString, shiftDateString } from '../src/utils/date.ts';
const actor = { uid: 'clerk', displayName: 'Clerk', role: 'Cashier' };
const entry = { id: 'v', visitorName: 'Visitor', status: 'Waiting', checkedInAt: '2026-01-01T08:00:00Z' };

test('scheduling moves a waiting ticket out of the queue and retains its original check-in', async () => {
  const h = await serviceHarness('src/services/receptionService.ts');
  h.records.set('receptionEntries/v', entry);
  const date = shiftDateString(todayDateString(), 5);
  const updated = await h.api.scheduleReceptionVisitor('v', date, actor);
  assert.equal(updated.status, 'Scheduled');
  assert.equal(updated.scheduledFor, date);
  assert.equal(updated.originalCheckedInAt, entry.checkedInAt);
  assert.equal(h.api.pickNextVisitor([updated]), null);
  assert.equal(h.api.waitMinutesFor(updated), 0);
  await assert.rejects(h.api.callVisitor(entry, { window: 'Counter 1', actor }), /attente/);
  await assert.rejects(h.api.scheduleReceptionVisitor('v', null, actor), /arrivée/);
});

test('invalid dates, nonfuture dates, read-only users and stale tickets cannot schedule', async () => {
  const h = await serviceHarness('src/services/receptionService.ts');
  h.records.set('receptionEntries/v', entry);
  for (const date of ['', '2027-02-30', todayDateString(), '2020-01-01']) {
    await assert.rejects(h.api.scheduleReceptionVisitor('v', date, actor), /future/);
  }
  await assert.rejects(h.api.scheduleReceptionVisitor('v', '2099-01-01', { ...actor, role: 'Auditor' }), /lecture/);
  h.records.set('receptionEntries/v', { ...entry, status: 'InService' });
  await assert.rejects(h.api.scheduleReceptionVisitor('v', '2099-01-01', actor), /planifié/);
  assert.equal(h.records.get('receptionEntries/v').status, 'InService');
});

test('return check-in restarts the waiting clock on the same ticket when the date arrives', async () => {
  const h = await serviceHarness('src/services/receptionService.ts');
  h.records.set('receptionEntries/v', { ...entry, status: 'Scheduled', scheduledFor: todayDateString() });
  const updated = await h.api.scheduleReceptionVisitor('v', null, actor);
  assert.equal(updated.id, 'v');
  assert.equal(updated.status, 'Waiting');
  assert.notEqual(updated.checkedInAt, entry.checkedInAt);
  assert.equal(h.api.waitMinutesFor(updated), 0);
  await assert.rejects(h.api.scheduleReceptionVisitor('v', null, actor), /planifié/);
  assert.equal([...h.records.keys()].filter((key) => key.startsWith('receptionEntries/')).length, 1);
});
