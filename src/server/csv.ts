/** Escape a CSV cell and neutralise spreadsheet formula injection. */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  // A plain number such as -5.00 is data, not a formula, so leave it as a number. Anything else
  // starting with a formula character (=SUM(…), -2+3, +cmd, @x, tab, CR) is prefixed with ' so a
  // spreadsheet shows it as text instead of running it.
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
