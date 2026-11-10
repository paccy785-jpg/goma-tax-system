/**
 * Calendar-day helpers that follow the counter's local clock.
 *
 * `new Date().toISOString().split('T')[0]` returns the *UTC* day. The Goma tax
 * office sits on UTC+2, so between 00:00 and 02:00 local time every "today"
 * derived that way is a day behind the date printed on a receipt, certificate
 * or assessment notice — and an assessment that is not yet overdue gets
 * flagged as overdue. These helpers read the local calendar day instead.
 */

/** Local calendar day of `date` as YYYY-MM-DD. */
export function toLocalDateString(date: Date = new Date()): string {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Today's calendar day at this workstation, as YYYY-MM-DD. */
export function todayDateString(): string {
  return toLocalDateString(new Date());
}

/**
 * The fiscal exercise currently open — the local calendar year.
 *
 * Screens that assess a year used to pin it as a literal (`const EXERCICE =
 * 2026`). That is correct for exactly one year: from January the calculations
 * keep billing the old exercise, and the register silently files new leases and
 * declarations against a closed year.
 */
export function currentExercise(): number {
  return new Date().getFullYear();
}

/**
 * Shift a YYYY-MM-DD string by whole days without crossing a timezone boundary.
 * Returns the input unchanged when it is not a plain calendar date.
 */
export function shiftDateString(dateStr: string, days: number): string {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr).trim());
  if (!parts) return dateStr;
  const parsed = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  if (isNaN(parsed.getTime())) return dateStr;
  parsed.setDate(parsed.getDate() + days);
  return toLocalDateString(parsed);
}

/**
 * Local calendar day of an ISO timestamp. `paidAt`/`createdAt` are stored as
 * UTC instants, so slicing the string off keeps the UTC day rather than the
 * day the officer actually served the taxpayer.
 */
export function localDateFromIsoTimestamp(iso: string): string {
  if (!iso) return '';
  const parsed = new Date(iso);
  if (isNaN(parsed.getTime())) return String(iso).split('T')[0];
  return toLocalDateString(parsed);
}

/**
 * Whole calendar days from `fromDateStr` to `toDateStr` (0 when they match).
 * Counts calendar days rather than elapsed hours, so "days overdue" does not
 * read a day short for the first two hours of the day after the due date.
 */
export function daysBetweenDates(fromDateStr: string, toDateStr: string): number {
  const parse = (value: string) => {
    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
    if (!parts) return NaN;
    return Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
  };
  const from = parse(fromDateStr);
  const to = parse(toDateStr);
  if (isNaN(from) || isNaN(to)) return 0;
  return Math.round((to - from) / 86400000);
}
