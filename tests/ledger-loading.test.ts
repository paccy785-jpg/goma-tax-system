import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serviceHarness } from './helpers/serviceHarness.ts';

test('complete ledger waits for every source and retains more than 5,000 receipts', async () => {
  const h = await serviceHarness('src/services/revenueSources.ts');
  const states: any[] = [];
  const stop = h.api.subscribeRevenueSources((s: any) => states.push(s));
  const names = [...h.listeners.keys()];
  for (const name of names.slice(0, -1)) h.emit(name, name === 'payments' ? Array.from({ length: 5001 }, (_, id) => ({ id, amountPaidUSD: 1 })) : []);
  assert.equal(states.length, 1);
  assert.equal(states[0].loading, true);
  h.emit(names.at(-1)!);
  assert.equal(states.at(-1).sources.payments.length, 5001);
  assert.equal(states.at(-1).loading, false);
  stop(); assert.equal(h.listeners.size, 0);
});
test('cached totals remain marked until every source is confirmed by the server', async () => {
  const h = await serviceHarness('src/services/revenueSources.ts');
  const states: any[] = [];
  h.api.subscribeRevenueSources((s: any) => states.push(s));
  for (const name of h.listeners.keys()) h.emit(name, [], true);
  assert.equal(states.at(-1).cached, true);
  for (const name of h.listeners.keys()) h.emit(name);
  assert.equal(states.at(-1).cached, false);
});
test('a failed collection does not turn into a successful zero-total report', async () => {
  const h = await serviceHarness('src/services/revenueSources.ts');
  const states: any[] = [];
  h.api.subscribeRevenueSources((s: any) => states.push(s));
  h.listeners.get('payments')!.error(new Error('Permission denied'));
  for (const name of h.listeners.keys()) h.emit(name);
  assert.ok(states.at(-1).error);
  assert.equal(states.at(-1).loading, false);
});
test('ledger counts actual confirmed note amounts and excludes demonstration notes', async () => {
  const h = await serviceHarness('src/services/reportLedger.ts');
  const note = { id: 'n', createdAt: '2026-11-10T10:00:00Z', taxateur: { numeroFacture: 'NP-1', montantUSD: 100, contribuableName: 'Test' }, comptable: { montantUSD: 40 }, confirmation: { confirmedAt: '2026-11-10T10:00:00Z' } };
  const ledger = h.api.comptableLedger({ confirmations: [], fonciers: [], locatifs: [], notes: [note, { ...note, id: 'demo', taxateur: { ...note.taxateur, numeroFacture: 'NP-DEMO-1' } }], businesses: [] });
  assert.equal(ledger.payments.length, 1);
  assert.equal(ledger.payments[0].amountPaidUSD, 40);
  assert.equal(ledger.assessments[0].remainingBalanceUSD, 60);
});
test('matching names never assign a receipt to an arbitrary taxpayer', async () => {
  const h = await serviceHarness('src/services/reportLedger.ts');
  const ledger = h.api.comptableLedger({ confirmations: [{ id: 'foncier_x', kind: 'foncier', calculationId: 'x', contribuableName: 'Same Name', amountUSD: 100, confirmedAt: '2026-11-10T10:00:00Z' }], fonciers: [], locatifs: [], notes: [], businesses: [{ id: 'a', businessName: 'Same Name' }, { id: 'b', businessName: 'Same Name' }] });
  assert.equal(ledger.payments[0].taxpayerId, '');
});
