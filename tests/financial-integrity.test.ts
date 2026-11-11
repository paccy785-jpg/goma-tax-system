import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paymentBalances, requireMoney } from '../src/utils/paymentAmounts.ts';
import { rollPayrollCycle } from '../src/utils/payroll.ts';
import { computePeriodRevenue, computeCommuneRevenue, computeComplianceSummary, computeSectorRevenue, computeTaxTypeRevenue, computeCashierReconciliation } from '../src/services/reportsService.ts';
import { isValidDateString } from '../src/utils/date.ts';
import type { Payment, Assessment, Business } from '../src/types/index.ts';

const payment = (overrides = {}) => ({ id: 'p', amountPaidUSD: 100, paymentDate: '2026-11-10', ...overrides } as Payment);
const business = (overrides = {}) => ({ id: 'b', businessName: 'Test', status: 'Active', commune: 'Goma', sizeClass: 'Small', activitySector: 'Commerce', ...overrides } as Business);
const assessment = (overrides = {}) => ({ id: 'a', businessId: 'b', amountDueUSD: 100, amountPaidUSD: 0, status: 'Pending', dueDate: '2020-01-01', ...overrides } as Assessment);

test('cent arithmetic settles 0.30 after payments of 0.10 and 0.20 exactly', () => {
  assert.deepEqual(paymentBalances(0.3, 0.1, 0.2), { paid: 0.3, remaining: 0, fullyPaid: true });
});
test('invalid, sub-cent and excess payments are rejected instead of clamped', () => {
  for (const n of [NaN, Infinity, -1, 0, 0.001, 8.075]) assert.throws(() => requireMoney(n, 'Payment'));
  assert.throws(() => paymentBalances(100, 50, 50.01));
  assert.throws(() => paymentBalances(100, 100, 1));
  assert.equal(requireMoney(0, 'Count', true), 0);
});
test('undated receipts never acquire a fictional collection year', () => {
  const r = computePeriodRevenue([payment({ paymentDate: '', fiscalYear: 2025 }), payment({ isVoided: true })]);
  assert.equal(r.totalRevenueUSD, 100);
  assert.equal(r.undated.totalUSD, 100);
  assert.equal(r.yearly.length, 0);
  assert.equal(r.daily.length, 0);
});
test('invalid dates remain undated and payment year takes precedence over assessment year', () => {
  const r = computePeriodRevenue([payment({ paymentDate: '2026-02-31' }), payment({ fiscalYear: 2025 })]);
  assert.equal(r.undated.count, 1);
  assert.equal(r.yearly[0].year, 2026);
  assert.equal(r.yearly[0].totalUSD, 100);
  assert.equal(isValidDateString('2024-02-29'), true);
  assert.equal(isValidDateString('2025-02-29'), false);
});
test('unrecorded locations do not inflate Goma or invent Centre', () => {
  const r = computeCommuneRevenue([payment({ businessId: 'b' })], [business({ commune: '', quartier: '' })], []);
  assert.equal(r.find((x) => x.commune === 'Goma')!.totalUSD, 0);
  assert.equal(r.find((x) => x.commune === 'Unattributed')!.totalUSD, 100);
  assert.equal(r.find((x) => x.commune === 'Unattributed')!.quartiers[0].quartier, 'Unattributed');
});
test('other communes and taxpayerId-only notices retain their attribution', () => {
  const r = computeCommuneRevenue([payment({ taxpayerId: 't' })], [], [assessment({ businessId: undefined, taxpayerId: 't', commune: 'Sake' })]);
  assert.equal(r.find((x) => x.commune === 'Sake')!.totalUSD, 100);
});
test('inactive debt does not reduce the active-business compliance rate', () => {
  const r = computeComplianceSummary([business(), business({ id: 'inactive', status: 'Inactive' })], [assessment({ businessId: 'inactive' })]);
  assert.equal(r.complianceRatePercent, 100);
  assert.equal(r.byCommune[0].complianceRate, 100);
  assert.equal(r.bySizeClass[0].complianceRate, 100);
  assert.equal(r.totalOverdueUSD, 100);
});
test('draft and awaiting-approval notices are excluded from debt and assessed revenue', () => {
  const a = [assessment({ status: 'Draft' }), assessment({ status: 'Pending_Approval' })];
  assert.equal(computeComplianceSummary([business()], a).totalOverdueUSD, 0);
  assert.equal(computeTaxTypeRevenue([], a).length, 0);
  assert.equal(computeSectorRevenue([], [business()], a).reduce((s, r) => s + r.totalAssessedUSD, 0), 0);
});
test('recovery rates reveal collections above assessments and normalize French sectors', () => {
  const r = computeSectorRevenue([payment({ businessId: 'b', amountPaidUSD: 150 })], [business({ activitySector: 'restauration' })], [assessment({ activitySector: 'restauration' })]);
  const food = r.find((x) => x.sector === 'Food Service')!;
  assert.equal(food.totalAssessedUSD, 100);
  assert.equal(food.totalCollectedUSD, 150);
  assert.equal(food.recoveryRatePercent, 150);
});
test('missing cashier is explicitly unattributed', () => {
  assert.equal(computeCashierReconciliation([payment()])[0].cashierName, 'Unattributed');
});
test('payroll rollover archives prior payments and resets the new month', () => {
  const old = { cycle: 'October 2026', employees: [{ status: 'paid' as const, paidAt: '2026-10-31', reference: 'ref', name: 'Test' }], advances: [{ amountUSD: 50 }] };
  const next = rollPayrollCycle(old, new Date(2026, 10, 10));
  assert.equal(next.employees[0].status, 'ready');
  assert.equal(next.employees[0].paidAt, undefined);
  assert.equal(next.history?.[0].employees[0].reference, 'ref');
  assert.equal(next.advances[0].amountUSD, 50);
  assert.equal(old.employees[0].status, 'paid');
  assert.equal(rollPayrollCycle(next, new Date(2026, 10, 11)).history?.length, 1);
});

test('rates with no denominator are unavailable, not fabricated success or failure', () => {
  assert.equal(computeComplianceSummary([], []).complianceRatePercent, null);
  assert.equal(computeSectorRevenue([payment()], [], []).find((r) => r.sector === 'Other')!.recoveryRatePercent, null);
  assert.equal(computeTaxTypeRevenue([payment()], [])[0].recoveryRatePercent, null);
});
