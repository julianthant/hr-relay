export const MAX_WORKBOOK_POPULATED_CELLS = 250_000;
export const MAX_WORKBOOK_GRID_CELLS = 500_000;

export function populatedSpreadsheetValue(value: unknown): boolean {
  return value !== null && value !== '';
}

export function workbookSizeIssue(populatedCells: number, gridCells: number): string | undefined {
  const count = populatedCells.toLocaleString('en-US');
  const limit = MAX_WORKBOOK_POPULATED_CELLS.toLocaleString('en-US');
  if (populatedCells > MAX_WORKBOOK_POPULATED_CELLS) return `This workbook has ${count} populated cells. Relay supports up to ${limit} populated cells per workbook. Split the data into smaller files and import them separately.`;
  if (gridCells > MAX_WORKBOOK_GRID_CELLS) return `This workbook has ${count} populated cells (limit ${limit}), but its data spans ${gridCells.toLocaleString('en-US')} cell positions (limit ${MAX_WORKBOOK_GRID_CELLS.toLocaleString('en-US')}). Move distant entries closer together or split the data into smaller files and try again.`;
  return undefined;
}
