import { Payment } from '../types';

/**
 * The receipt sequence of the office, and the holes in it.
 *
 * Receipt numbers are minted from ONE office-wide counter
 * (`counters/receiptCounter`), so the sequence is global: receipt #2 may
 * belong to a different cashier than #1 and #3. A gap is therefore a hole in
 * that global sequence — not in any single cashier's own run of receipts.
 *
 * This lives apart from the anomaly service because it is the part that has
 * to be right: reading each cashier's own subsequence filed a "missing
 * receipt" for every receipt another cashier had actually taken, and with two
 * cashiers on duty those phantom gaps buried the real ones.
 */

/** The sequence number carried by a receipt, or null when it carries none. */
export function receiptSequenceNumber(p: Payment): number | null {
  if (typeof p.sequenceNumber === 'number' && p.sequenceNumber > 0) {
    return p.sequenceNumber;
  }
  // Match REC-YYYY-00042
  const match = (p.receiptNumber || '').match(/REC-(?:\d{4}|OFFLINE)-(\d+)/i);
  if (match) {
    const parsed = parseInt(match[1], 10);
    if (!isNaN(parsed)) return parsed;
  }
  return null;
}

/** A hole in the office-wide receipt sequence. */
export interface ReceiptSequenceGap {
  /** The receipt that precedes the hole. */
  previous: Payment;
  /** The receipt that follows the hole. */
  next: Payment;
  previousSequence: number;
  nextSequence: number;
  /** First sequence number that was never issued. */
  startSequence: number;
  /** Last sequence number that was never issued. */
  endSequence: number;
}

/**
 * The gaps in the office-wide receipt sequence.
 *
 * A gap is filed once, for the hole itself. Two cashiers sharing the counter
 * interleave the global numbers — #1 Alice, #2 Bob, #3 Alice — and every
 * receipt exists, so there is no hole to report.
 */
export function detectReceiptSequenceGaps(payments: Payment[]): ReceiptSequenceGap[] {
  const withSequence = payments
    .map((payment) => ({ payment, seq: receiptSequenceNumber(payment) }))
    .filter((item): item is { payment: Payment; seq: number } => item.seq !== null)
    .sort((a, b) => a.seq - b.seq);

  const gaps: ReceiptSequenceGap[] = [];
  for (let i = 0; i < withSequence.length - 1; i++) {
    const current = withSequence[i];
    const next = withSequence[i + 1];
    if (next.seq - current.seq > 1) {
      gaps.push({
        previous: current.payment,
        next: next.payment,
        previousSequence: current.seq,
        nextSequence: next.seq,
        startSequence: current.seq + 1,
        endSequence: next.seq - 1,
      });
    }
  }
  return gaps;
}
