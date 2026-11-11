/**
 * The payroll cycle and its payday.
 *
 * These used to be literals in the payroll screen — "October 2026",
 * "Oct 31, 2026", "2026-10-31" — pinned in the seed and never editable. They
 * went into the past and stayed there: the screen announced a payroll cycle
 * that had already gone by, and a salary advance was created with a repayment
 * date that was already overdue the moment it was filed.
 */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/** The payroll cycle the office is in: the current month. */
export function currentCycleLabel(now: Date = new Date()): string {
  return `${MONTH_NAMES[now.getMonth()]} ${now.getFullYear()}`;
}

/** Keep past disbursements as history; a new cycle starts with unpaid salaries. */
export function rollPayrollCycle<T extends { status: 'ready' | 'paid'; paidAt?: string; paymentMethod?: string; reference?: string }, A>(
  state: { cycle: string; employees: T[]; advances: A[]; history?: { cycle: string; employees: T[] }[] },
  now: Date = new Date()
) {
  const cycle = currentCycleLabel(now);
  if (state.cycle === cycle) return { ...state, advances: state.advances || [] };
  return {
    ...state, cycle, advances: state.advances || [],
    history: [...(state.history || []), { cycle: state.cycle, employees: state.employees.map((e) => ({ ...e })) }],
    employees: state.employees.map((e) => {
      const { paidAt, paymentMethod, reference, ...identity } = e;
      return { ...identity, status: 'ready' } as T;
    }),
  };
}

/**
 * The next payday: the last day of the month, once today has reached it.
 *
 * Payroll is monthly and runs at the end of the month.
 */
export function nextPayday(now: Date = new Date()): Date {
  const thisMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return thisMonthEnd.getTime() < now.getTime()
    ? new Date(now.getFullYear(), now.getMonth() + 2, 0)
    : thisMonthEnd;
}

/**
 * The repayment date a new salary advance defaults to: a month from today.
 *
 * It has to be in the future: an advance filed with a due date that has
 * already passed is overdue the moment it exists.
 */
export function defaultAdvanceDueDate(today: string): string {
  const [y, m, d] = today.split('-').map((n) => Number(n));
  const due = new Date(y, m - 1, d + 30);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${due.getFullYear()}-${pad(due.getMonth() + 1)}-${pad(due.getDate())}`;
}
