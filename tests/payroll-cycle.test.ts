/**
 * The payroll cycle and its payday.
 *
 * They used to be literals in the payroll screen — "October 2026",
 * "Oct 31, 2026", "2026-10-31" — pinned in the seed and never editable. A
 * salary advance was therefore filed with a repayment date that was already
 * overdue the moment it existed.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { currentCycleLabel, defaultAdvanceDueDate, nextPayday } from '../src/utils/payroll.ts';

describe('the payroll cycle', () => {
  test('is the month the office is in', () => {
    const now = new Date(2026, 10, 6); // 6 November 2026
    assert.equal(currentCycleLabel(now), 'November 2026');
    assert.equal(currentCycleLabel(new Date(2026, 0, 15)), 'January 2026');
  });
});

describe('the next payday', () => {
  test('is the last day of the month', () => {
    const payday = nextPayday(new Date(2026, 10, 6));
    assert.equal(payday.getFullYear(), 2026);
    assert.equal(payday.getMonth(), 10);
    assert.equal(payday.getDate(), 30);
  });

  test('rolls to the month after once the payday has passed', () => {
    // On the last day of the month, once the day is under way, the payday
    // that is still ahead is the end of the next month.
    const payday = nextPayday(new Date(2026, 10, 30, 18, 0));
    assert.equal(payday.getMonth(), 11);
    assert.equal(payday.getDate(), 31);
  });

  test('is never in the past', () => {
    const now = new Date();
    assert.ok(nextPayday(now).getTime() >= now.getTime());
  });
});

describe('the repayment date a new advance defaults to', () => {
  test('is a month ahead, never in the past', () => {
    assert.equal(defaultAdvanceDueDate('2026-11-06'), '2026-12-06');
    assert.equal(defaultAdvanceDueDate('2026-01-15'), '2026-02-14');
    assert.equal(defaultAdvanceDueDate('2026-12-20'), '2027-01-19');
  });

  test('is always after today', () => {
    for (const today of ['2026-01-01', '2026-02-28', '2026-11-30', '2026-12-31']) {
      assert.ok(
        defaultAdvanceDueDate(today) > today,
        `an advance due on ${defaultAdvanceDueDate(today)} must not be due before ${today}`
      );
    }
  });
});
