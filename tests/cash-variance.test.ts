/**
 * Reproduction tests for the cash-shift variance.
 *
 * A counted drawer that is within a cent of the expected amount is not a
 * shortage — but it is not a zero variance either, and the immutable audit
 * ledger must not record "zero variance (0.00)" for a drawer that closed one
 * cent off.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { roundMoney } from '../src/utils/frenchNumber.ts';
import {
  CASH_VARIANCE_TOLERANCE_USD,
  cashVarianceLabel,
  classifyCashVariance,
  describeCashVariance,
  hasCashVariance,
} from '../src/utils/cashVariance.ts';

/** The variance a shift closes with, exactly as closeCashSession computes it. */
const varianceOf = (counted: number, expected: number) => roundMoney(counted - expected);

describe('cash variance classification', () => {
  test('a difference above the tolerance is a shortage or a surplus', () => {
    assert.equal(classifyCashVariance(-5), 'shortage');
    assert.equal(classifyCashVariance(5), 'surplus');
    assert.equal(hasCashVariance(-5), true);
    assert.equal(hasCashVariance(5), true);
  });

  test('a difference of exactly one cent is within tolerance, not a shortage', () => {
    assert.equal(classifyCashVariance(-0.01), 'tolerance');
    assert.equal(classifyCashVariance(0.01), 'tolerance');
    assert.equal(hasCashVariance(-0.01), false);
    assert.equal(hasCashVariance(0.01), false);
  });

  test('no difference at all is an exact count', () => {
    assert.equal(classifyCashVariance(0), 'exact');
    assert.equal(hasCashVariance(0), false);
  });
});

describe('the audit ledger line for a closed shift', () => {
  test('never claims a zero variance for a shift that closed off by a cent', () => {
    const oneCentShort = varianceOf(99.99, 100);
    const oneCentOver = varianceOf(100, 99.99);

    for (const variance of [oneCentShort, oneCentOver]) {
      assert.equal(variance, variance); // the shift really did record a variance
      const line = describeCashVariance(variance);
      assert.doesNotMatch(
        line,
        /zero variance/i,
        `a variance of ${variance} must not be written as a zero variance`
      );
      assert.match(line, /0\.01/);
    }
  });

  test('a shift that closed exactly says so', () => {
    assert.match(describeCashVariance(0), /zero variance \(0\.00\)/i);
  });

  test('a real shortage is still a warning', () => {
    assert.match(describeCashVariance(-2.5, 'Shortage of 2,50$'), /^WARNING:/);
  });
});

describe('the badge shown to the supervisor', () => {
  test('never shows "Variance 0.00" for a shift that has a variance', () => {
    assert.doesNotMatch(cashVarianceLabel(0.01), /0\.00/);
    assert.doesNotMatch(cashVarianceLabel(-0.01), /0\.00/);
    assert.match(cashVarianceLabel(0.01), /within tolerance/i);
    assert.match(cashVarianceLabel(-0.01), /within tolerance/i);
  });

  test('shows the exact count only when there was none', () => {
    assert.match(cashVarianceLabel(0), /Exact Count/);
  });
});

describe('the tolerance itself', () => {
  test('is one cent', () => {
    assert.equal(CASH_VARIANCE_TOLERANCE_USD, 0.01);
  });
});
