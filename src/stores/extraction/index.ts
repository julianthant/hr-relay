import { defineServiceStore } from "../../base/store.js";
export { extractSpreadsheetTask } from "./tasks/extract-spreadsheet.js";
import { extractSpreadsheetTask } from "./tasks/extract-spreadsheet.js";

/**
 * The `extraction` service store (doc 01 §3.4, doc 06 §3).
 *
 * Sessionless, browserless, deterministic. Its one task turns a
 * content-addressed artifact into the cell matrix doc 06 §5's validation
 * pipeline consumes — and it is the ONLY place in the tree that knows which
 * spreadsheet format a file is, so nothing downstream branches on an extension.
 */
export const extractionStore = defineServiceStore("extraction", {
  extractSpreadsheet: extractSpreadsheetTask,
});
