/** Quoting alone does not prevent spreadsheet formula execution. Numeric cells stay numeric. */
function spreadsheetCsvCell(value: string | number | boolean): string {
  const raw=String(value);
  // eslint-disable-next-line no-control-regex -- Spreadsheet parsers ignore leading control characters before formulas.
  const text=typeof value === "string" && (/^[\s\u0000-\u001f]*[=+@-]/u.test(raw) || /^[\t\r\n]/u.test(raw)) ? `'${raw}` : raw;
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"','""')}"` : text;
}
export function spreadsheetCsvRow(values: readonly (string | number | boolean)[]): string {
  return values.map(spreadsheetCsvCell).join(",");
}
