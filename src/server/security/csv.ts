/**
 * RFC 4180 CSV with spreadsheet formula-injection protection (CWE-1236): cells beginning with
 * = + - @ TAB or CR are prefixed with a single quote so spreadsheet apps treat them as text.
 */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (FORMULA_PREFIX.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvRow(values: unknown[]): string {
  return `${values.map(csvCell).join(",")}\r\n`;
}
