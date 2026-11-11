import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serviceHarness } from './helpers/serviceHarness.ts';
const actor = { uid: 'cashier', displayName: 'Test', role: 'Supervisor' };
const input = { kind: 'foncier', calculationId: 'calc', contribuableName: 'Test', amountUSD: 100, reference: 'BANK-1' };

async function bank() {
  const h = await serviceHarness('src/services/bankConfirmationService.ts');
  h.records.set('declarationAdmin/foncier_calc', {});
  h.records.set('foncierCalculations/calc', { totalImpotDuUSD: 100 });
  return h;
}
test('bank confirmation reads all documents before writing and issues a receipt', async () => {
  const h = await bank();
  const r = await h.api.confirmPayment(input, actor, new Set());
  assert.equal(r.receiptSequence, 1);
  assert.equal(h.records.get('bankConfirmations/foncier_calc').amountUSD, 100);
  assert.equal([...h.records.keys()].filter((k) => k.startsWith('bankReferenceClaims/')).length, 1);
  await assert.rejects(h.api.confirmPayment(input, actor, new Set()), /déjà/);
});
test('bank cannot confirm a stale amount or missing declaration', async () => {
  const h = await bank();
  await assert.rejects(h.api.confirmPayment({ ...input, amountUSD: 90 }, actor, new Set()), /montant/);
  h.records.delete('foncierCalculations/calc');
  await assert.rejects(h.api.confirmPayment(input, actor, new Set()), /existe/);
  assert.equal(h.records.has('bankConfirmations/foncier_calc'), false);
});
test('a denied claim or counter never falls back to an unprotected confirmation', async () => {
  for (const denied of ['bankReferenceClaims/', 'counters/']) {
    const h = await bank(); h.denied.add(denied);
    await assert.rejects(h.api.confirmPayment(input, actor, new Set()), /Permission/);
    assert.equal(h.records.has('bankConfirmations/foncier_calc'), false);
  }
});
test('void restores the balance atomically without a read-after-write error', async () => {
  const h = await serviceHarness('src/services/dbService.ts');
  h.records.set('payments/p', { id: 'p', receiptNumber: 'REC-1', assessmentId: 'a', amountPaidUSD: 0.2 });
  h.records.set('assessments/a', { amountDueUSD: 0.3, amountPaidUSD: 0.3, remainingBalanceUSD: 0, status: 'Paid', dueDate: '2020-01-01' });
  await h.api.voidPaymentReceipt('p', 'REC-1', 'Correction', actor);
  assert.equal(h.records.get('payments/p').isVoided, true);
  assert.equal(h.records.get('assessments/a').amountPaidUSD, 0.1);
  assert.equal(h.records.get('assessments/a').remainingBalanceUSD, 0.2);
  assert.equal(h.records.get('assessments/a').status, 'Overdue');
  await assert.rejects(h.api.voidPaymentReceipt('p', 'REC-1', 'Correction', actor), /already/);
});
test('cash receipt and shift totals commit together; a closed shift rejects payment', async () => {
  const h = await serviceHarness('src/services/dbService.ts');
  h.records.set('assessments/a', { id: 'a', amountDueUSD: 100, amountPaidUSD: 0, status: 'Pending' });
  h.records.set('cashSessions/s', { cashierId: 'cashier', status: 'open', paymentIds: [] });
  const args = { assessmentId: 'a', amountPaidUSD: 25, cashierId: 'cashier', cashierName: 'Test', sessionId: 's', paymentType: 'full' };
  const r = await h.api.recordCashPayment(args);
  assert.equal(r.paymentType, 'partial');
  assert.equal(h.records.get('cashSessions/s').totalPaymentsCashUSD, 25);
  assert.equal(h.records.get('cashSessions/s').paymentCount, 1);
  h.records.get('cashSessions/s').status = 'closed';
  await assert.rejects(h.api.recordCashPayment(args), /session/);
  assert.equal(h.records.get('assessments/a').amountPaidUSD, 25);
});
test('cash close reads the current shift and refuses invalid counts and repeated closing', async () => {
  const h = await serviceHarness('src/services/cashService.ts');
  h.records.set('cashSessions/s', { id: 's', cashierId: 'cashier', status: 'open', openingBalanceUSD: 10, totalPaymentsCashUSD: 25 });
  await assert.rejects(h.api.closeCashSession('s', { cashierId: 'cashier', countedCashUSD: NaN }), /montant/);
  const r = await h.api.closeCashSession('s', { cashierId: 'cashier', countedCashUSD: 35 });
  assert.equal(r.expectedCashUSD, 35); assert.equal(r.varianceUSD, 0);
  await assert.rejects(h.api.closeCashSession('s', { cashierId: 'cashier', countedCashUSD: 35 }), /ouverte/);
});

test('a denied session update rolls back the receipt and its assessment', async () => {
  const h = await serviceHarness('src/services/dbService.ts');
  h.records.set('payments/p', { id: 'p', receiptNumber: 'REC-1', assessmentId: 'a', sessionId: 's', amountPaidUSD: 20 });
  h.records.set('assessments/a', { amountDueUSD: 100, amountPaidUSD: 20, remainingBalanceUSD: 80 });
  h.records.set('cashSessions/s', { status: 'open', paymentIds: ['p'], totalPaymentsCashUSD: 20 });
  h.denied.add('cashSessions/');
  await assert.rejects(h.api.voidPaymentReceipt('p', 'REC-1', 'Correction', actor), /Permission/);
  assert.equal(h.records.get('payments/p').isVoided, undefined);
  assert.equal(h.records.get('assessments/a').amountPaidUSD, 20);
});
test('void updates the linked cash session in the same commit', async () => {
  const h = await serviceHarness('src/services/dbService.ts');
  h.records.set('payments/p', { id: 'p', receiptNumber: 'REC-1', assessmentId: 'a', sessionId: 's', amountPaidUSD: 20, paymentMethod: 'Cash_Guichet' });
  h.records.set('assessments/a', { amountDueUSD: 100, amountPaidUSD: 20, remainingBalanceUSD: 80 });
  h.records.set('cashSessions/s', { status: 'closed', closedAt: '2026-11-10', countedCashUSD: 30, openingBalanceUSD: 10, paymentIds: ['p'], paymentCount: 1, totalPaymentsCashUSD: 20 });
  await h.api.voidPaymentReceipt('p', 'REC-1', 'Correction', actor);
  const session = h.records.get('cashSessions/s');
  assert.equal(session.totalPaymentsCashUSD, 0);
  assert.equal(session.expectedCashUSD, 10);
  assert.equal(session.varianceUSD, 20);
  assert.equal(session.paymentCount, 0);
});
test('a treasury selection cannot count the same cash session twice', async () => {
  const h = await serviceHarness('src/services/cashService.ts');
  h.records.set('cashSessions/s', { id: 's', status: 'approved', cashStatus: 'in_custody', countedCashUSD: 100 });
  await assert.rejects(h.api.recordTreasuryDeposit({ sessionIds: ['s', 's'], depositAmountUSD: 200 }), /does not match/);
  assert.equal(h.records.get('cashSessions/s').cashStatus, 'in_custody');
  const deposit = await h.api.recordTreasuryDeposit({ sessionIds: ['s', 's'], depositAmountUSD: 100 });
  assert.equal(deposit.depositAmountUSD, 100);
  assert.equal(deposit.sessionIds.length, 1);
});

test('notes cannot bypass reference reservation or confirm a mismatched payment', async () => {
  const h = await serviceHarness('src/services/notePerceptionService.ts');
  const note = { id: 'n', taxateur: { numeroFacture: 'NP-1', montantUSD: 100 }, comptable: { montantUSD: 100 } };
  h.records.set('notesPerception/n', note);
  h.denied.add('counters/');
  await assert.rejects(h.api.confirmerPaiementNote(note, 'REF-1', actor, new Set()), /Permission/);
  assert.equal(h.records.get('notesPerception/n').confirmation, undefined);
  h.denied.clear();
  h.records.get('notesPerception/n').comptable.montantUSD = 50;
  await assert.rejects(h.api.confirmerPaiementNote(note, 'REF-1', actor, new Set()), /correspond/);
  h.records.get('notesPerception/n').comptable.montantUSD = 100;
  const confirmation = await h.api.confirmerPaiementNote(note, 'REF-1', actor, new Set());
  assert.equal(confirmation.receiptSequence, 1);
});
test('invalid rental-tax inputs cannot be saved as zero-valued declarations', async () => {
  const h = await serviceHarness('src/services/taxCalculationService.ts');
  await assert.rejects(h.api.addTaxCalculation({ contribuable: { type: 'bailleur', name: 'Test', refId: 'b' }, revenuBrutUSD: NaN, retenuesUSD: 0, modePaiement: 'especes' }, actor), /Revenu/);
  assert.equal([...h.records.keys()].filter((k) => k.startsWith('taxCalculations/')).length, 0);
});
