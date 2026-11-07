
import { defineServiceStore } from "../../../workflow-kit/task-registry.js";
import { matchSpreadsheetTask } from "./tasks/match-spreadsheet.js";

export { matchSpreadsheetTask };

export const rosterStore = defineServiceStore("roster", {
  matchSpreadsheet: matchSpreadsheetTask,
});
