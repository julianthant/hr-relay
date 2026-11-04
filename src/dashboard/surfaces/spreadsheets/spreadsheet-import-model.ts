export function spreadsheetImportError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const sizePrefix = 'SPREADSHEET_SIZE_UNSUPPORTED: ';
  if (message.startsWith(sizePrefix)) return message.slice(sizePrefix.length);
  if (message.startsWith('SPREADSHEET_TOO_LARGE:')) return 'This file is larger than 20 MB. Split it into smaller files and import them separately.';
  if (message.startsWith('SPREADSHEET_FORMAT_UNSUPPORTED:')) return 'Choose an XLSX or CSV file. Save other spreadsheet formats as XLSX or CSV first.';
  return 'This file could not be imported. Open it in Excel, save a new XLSX or CSV copy, and try again.';
}
