import { initialSheets, missingRequired, type Sheet, type Worksheet } from "../../spreadsheets/design/sheets-v2-model.js";

/** The ticked worksheets (`<spreadsheet id>/<worksheet>`), the version picked per spreadsheet and the library as the run dialog sees it, so a column chosen in a fix row reaches the workbook's other worksheets. */
export interface StatusMockPicks { readonly keys: readonly string[]; readonly versions: Readonly<Record<string, number>>; readonly sheets: readonly Sheet[] }

export const sheetKey = (sheet: Sheet, worksheet: Worksheet) => `${sheet.id}/${worksheet.name}`;
/** The picker's library: the Spreadsheets library plus three more pins, so the empty search lists something (`unpinned` clears every pin). */
const PICKER_PINS = ["hires", "parking", "keys"];
const librarySheets = (unpinned = false) => initialSheets("many").filter(sheet => !sheet.run)
  .map(sheet => unpinned ? { ...sheet, pinned: false } : PICKER_PINS.includes(sheet.id) ? { ...sheet, pinned: true } : sheet)
  .toSorted((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name));
const FRAME_PICKS: Readonly<Record<string, readonly string[]>> = {
  "run-sheets": ["hires/Aug 3 hires", "hires/Aug 10 hires", "roster/Roster"], "run-sheets-open": ["hires/Aug 3 hires", "hires/Aug 10 hires", "roster/Roster"], "run-sheets-add": ["hires/Aug 3 hires", "hires/Aug 10 hires", "roster/Roster"],
  "run-sheets-search": ["hires/Aug 3 hires", "hires/Aug 10 hires", "roster/Roster"], "run-sheets-nopins": ["hires/Aug 3 hires", "roster/Roster"],
  "run-sheets-fix": ["hires/Aug 3 hires", "hires/Aug 10 hires", "hires/Aug 17 hires", "roster/Roster"],
};
/** The spreadsheets a run starts with: the last ones used, or the frame's own. */
export function statusMockDefaultPicks(frame?: string): StatusMockPicks {
  return { keys: (frame && FRAME_PICKS[frame]) || ["roster/Roster", "i9/Sheet1"], versions: {}, sheets: librarySheets(frame === "run-sheets-nopins") };
}
export const ticked = (picks: StatusMockPicks, sheet: Sheet) => sheet.worksheets.filter(worksheet => picks.keys.includes(sheetKey(sheet, worksheet)));
const pickedRows = (picks: StatusMockPicks) => picks.sheets.flatMap(sheet => ticked(picks, sheet).map(worksheet => ({ sheet, worksheet })));
/** Start waits until something is ticked and every ticked worksheet has Employee ID and Name. */
export const statusMockPicksBlocked = (picks: StatusMockPicks): boolean => picks.keys.length === 0 || pickedRows(picks).some(({ sheet, worksheet }) => missingRequired(sheet, worksheet).length > 0);
