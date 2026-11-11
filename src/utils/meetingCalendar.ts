import { toLocalDateString } from './date';

/** Six full Monday-first weeks, including adjacent-month days. */
export function meetingCalendarDays(year: number, month: number): string[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => toLocalDateString(new Date(year, month, 1 - offset + index)));
}
