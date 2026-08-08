/**
 * The roster service store (doc 01 §3.4, doc 06 §4): spreadsheet matching
 * over the operator-defined column mapping onto canonical fields. Pure local
 * computation — `sessions: []`, no providers, no network reach.
 */
import { defineServiceStore } from "../../base/store.js";
import { matchSpreadsheetTask } from "./tasks/match-spreadsheet.js";

export { matchSpreadsheetTask };

export const rosterStore = defineServiceStore("roster", {
  matchSpreadsheet: matchSpreadsheetTask,
});
