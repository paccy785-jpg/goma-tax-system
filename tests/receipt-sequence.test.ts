/**
 * Reproduction tests for the receipt sequence gap detection.
 *
 * Receipt numbers come from ONE office-wide counter, so the sequence is
 * global. Two cashiers sharing the counter interleave those numbers, and every
 * receipt exists — there is no hole to report.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { detectReceiptSequenceGaps } from '../src/utils/receiptSequence.ts';
import type { Payment } from '../src/types/index.ts';

/** A receipt as the office mints it: a global sequence number and a cashier. */
function receipt(seq: number, cashierId: string, cashierName: string): Payment {
  return {
    id: `pay_2026_${String(seq).padStart(5, '0')}`,
    receiptNumber: `REC-2026-${String(seq).padStart(5, '0')}`,
    sequenceNumber: seq,
    cashierId,
    cashierName,
    fiscalYear: 2026,
  } as unknown as Payment;
}

describe('the receipt sequence', () => {
  test('two cashiers sharing the counter produce no gap at all', () => {
    // Alice takes #1, Bob takes #2, Alice takes #3 — every receipt exists.
    const payments = [
      receipt(1, 'alice', 'Alice'),
      receipt(2, 'bob', 'Bob'),
      receipt(3, 'alice', 'Alice'),
    ];

    const gaps = detectReceiptSequenceGaps(payments);

    assert.deepEqual(
      gaps.map((g) => [g.startSequence, g.endSequence]),
      [],
      'interleaved cashiers must not raise a missing-receipt anomaly'
    );
  });

  test('a receipt that really was never issued is still caught', () => {
    // #2 was never taken, by anyone.
    const payments = [
      receipt(1, 'alice', 'Alice'),
      receipt(3, 'bob', 'Bob'),
    ];

    const gaps = detectReceiptSequenceGaps(payments);

    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].startSequence, 2);
    assert.equal(gaps[0].endSequence, 2);
  });

  test('a range of receipts that were never issued is reported once', () => {
    const payments = [
      receipt(1, 'alice', 'Alice'),
      receipt(6, 'alice', 'Alice'),
    ];

    const gaps = detectReceiptSequenceGaps(payments);

    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].startSequence, 2);
    assert.equal(gaps[0].endSequence, 5);
  });

  test('a hole is found even when other cashiers took the receipts around it', () => {
    const payments = [
      receipt(1, 'alice', 'Alice'),
      receipt(2, 'bob', 'Bob'),
      receipt(4, 'carol', 'Carol'),
    ];

    const gaps = detectReceiptSequenceGaps(payments);

    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].startSequence, 3);
    assert.equal(gaps[0].endSequence, 3);
  });

  test('a contiguous run of receipts has no gap, whoever took them', () => {
    const payments = [
      receipt(1, 'alice', 'Alice'),
      receipt(2, 'bob', 'Bob'),
      receipt(3, 'carol', 'Carol'),
      receipt(4, 'alice', 'Alice'),
    ];

    assert.deepEqual(detectReceiptSequenceGaps(payments), []);
  });

  test('the sequence is read from the receipt number when it carries none', () => {
    const payments = [
      { receiptNumber: 'REC-2026-00001', cashierId: 'alice' } as unknown as Payment,
      { receiptNumber: 'REC-2026-00003', cashierId: 'bob' } as unknown as Payment,
    ];

    const gaps = detectReceiptSequenceGaps(payments);

    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].startSequence, 2);
    assert.equal(gaps[0].endSequence, 2);
  });
});
