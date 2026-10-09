import type { EditableWorkbook } from './spreadsheet-editor-model.js';

export type WorkbookHistory = Readonly<{
  undo: readonly EditableWorkbook[];
  redo: readonly EditableWorkbook[];
  group?: string;
}>;
export const EMPTY_WORKBOOK_HISTORY: WorkbookHistory = { undo: [], redo: [] };
const HISTORY_LIMIT = 50;

/** Immutable sheets share unchanged rows/cells; history never clones workbook bytes. */
export function recordWorkbookEdit(history: WorkbookHistory, before: EditableWorkbook, after: EditableWorkbook, group?: string): WorkbookHistory {
  if (before === after) return history;
  if (before.libraryId !== after.libraryId || before.name !== after.name) throw new Error('SPREADSHEET_HISTORY_IDENTITY_MISMATCH');
  return { undo: group !== undefined && group === history.group ? history.undo : [...history.undo, before].slice(-HISTORY_LIMIT), redo: [], group };
}
export function stepWorkbookHistory(history: WorkbookHistory, document: EditableWorkbook, direction: 'undo' | 'redo') {
  const source = history[direction];
  const next = source.at(-1);
  if (!next) return { history, document };
  if (next.libraryId !== document.libraryId || next.name !== document.name) throw new Error('SPREADSHEET_HISTORY_IDENTITY_MISMATCH');
  return { document: next, history: direction === 'undo'
    ? { undo: source.slice(0, -1), redo: [...history.redo, document].slice(-HISTORY_LIMIT) }
    : { undo: [...history.undo, document].slice(-HISTORY_LIMIT), redo: source.slice(0, -1) } };
}
