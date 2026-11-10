import { formatMoney } from './money';

/**
 * The variance of a closed cash shift, and how it is described.
 *
 * A counted drawer that differs from the expected amount by a cent or less is
 * within tolerance: it is not a shortage, and the cashier is not asked to
 * explain it. It is NOT, however, a zero variance — the shift still records the
 * real figure, and the audit trail must never claim "zero variance (0.00)" for
 * a drawer that closed one cent off. The rule and the wording live here so the
 * immutable ledger, the stored record and the supervisor's screen cannot
 * disagree with each other.
 */

/**
 * Largest difference that is not reported as a shortage or a surplus, in USD.
 *
 * One cent is the smallest difference the drawer can actually produce, so a
 * difference of that size is noise rather than a discrepancy worth a warning.
 */
export const CASH_VARIANCE_TOLERANCE_USD = 0.01;

/** How a shift's variance is reported. */
export type CashVarianceKind = 'shortage' | 'surplus' | 'tolerance' | 'exact';

/**
 * Classify a variance.
 *
 * `tolerance` is the case the audit trail used to lose: a non-zero difference
 * that is small enough not to be flagged, but that is still not zero.
 */
export function classifyCashVariance(varianceUSD: number): CashVarianceKind {
  if (!Number.isFinite(varianceUSD)) return 'exact';
  if (varianceUSD < -CASH_VARIANCE_TOLERANCE_USD) return 'shortage';
  if (varianceUSD > CASH_VARIANCE_TOLERANCE_USD) return 'surplus';
  return varianceUSD === 0 ? 'exact' : 'tolerance';
}

/**
 * True when the difference is large enough to be a shortage or a surplus —
 * the flag stored on the shift record and the reason a warning is written.
 */
export function hasCashVariance(varianceUSD: number): boolean {
  const kind = classifyCashVariance(varianceUSD);
  return kind === 'shortage' || kind === 'surplus';
}

/**
 * The line written to the immutable audit ledger when a shift closes.
 *
 * A shift that closed within tolerance reports the variance it actually has:
 * saying "zero variance" for a drawer that was one cent short would put a
 * false statement in the ledger of the tax office.
 */
export function describeCashVariance(varianceUSD: number, explanation?: string): string {
  const kind = classifyCashVariance(varianceUSD);
  if (kind === 'shortage' || kind === 'surplus') {
    return `WARNING: Variance observed (USD: ${varianceUSD >= 0 ? '+' : ''}${varianceUSD}). Reason: ${explanation ?? ''}`;
  }
  if (kind === 'exact') {
    return 'Strict physical count verified with zero variance (0.00).';
  }
  return (
    `Physical count within the ${formatMoney(CASH_VARIANCE_TOLERANCE_USD)} tolerance ` +
    `(variance USD: ${varianceUSD >= 0 ? '+' : ''}${varianceUSD}).`
  );
}

/** The badge the supervisor's approval screen shows for a shift's variance. */
export function cashVarianceLabel(varianceUSD: number): string {
  const kind = classifyCashVariance(varianceUSD);
  switch (kind) {
    case 'shortage':
      return `Shortfall found (${formatMoney(Math.abs(varianceUSD))})`;
    case 'surplus':
      return `Surplus found (+${formatMoney(varianceUSD)})`;
    case 'tolerance':
      return `Count within tolerance (Variance ${formatMoney(varianceUSD)})`;
    default:
      return 'Exact Count (Variance 0.00)';
  }
}
