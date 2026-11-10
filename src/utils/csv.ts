/**
 * Safe CSV serialisation shared by every export in the system.
 *
 * Two hazards are handled here that the ad-hoc builders missed:
 *
 *  1. Formula injection. Excel / Google Sheets evaluate a cell that begins with
 *     `=`, `+`, `-`, `@`, a tab or a carriage return as a formula. A taxpayer
 *     whose name is `=HYPERLINK(...)`, or a note that starts with `+`, therefore
 *     became live code when an officer opened the exported file. Such a value is
 *     prefixed with an apostrophe so the spreadsheet shows it literally.
 *  2. Quoting. Embedded quotes are doubled and the whole cell is quoted, so a
 *     value containing a comma or newline never breaks the column layout.
 */

/** Format one value as a safe, quoted CSV cell. */
export function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  // A leading minus sign is a formula hazard, but a plain negative number is
  // not: guarding it turned every refund, variance and credit balance into a
  // text cell, so the spreadsheet stopped summing the column it had just
  // summed. Only a plain signed decimal is exempt — "+1" and "-1+cmd|…" keep
  // the guard, because they are not plain numbers.
  const isPlainNumber = /^-?\d+(\.\d+)?$/.test(raw);
  const guarded = !isPlainNumber && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/** Build a CSV document from a matrix of values. CRLF keeps Excel happy. */
export function buildCsv(rows: unknown[][], delimiter: string = ','): string {
  return rows.map((row) => row.map(csvCell).join(delimiter)).join('\r\n');
}
