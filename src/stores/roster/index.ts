/**
 * The roster service store (ref task-contract §3.4, ref data-intake-and-edit-data §4): spreadsheet matching
 * over the operator-defined column mapping onto canonical fields. Pure local
 * computation — `sessions: []`, no providers, no network reach.
 */
import { defineServiceStore } from "../../base/store.js";
import { matchSpreadsheetTask } from "./tasks/match-spreadsheet.js";

export { matchSpreadsheetTask };

export const rosterStore = defineServiceStore("roster", {
  matchSpreadsheet: matchSpreadsheetTask,
});
