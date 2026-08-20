import { defineServiceStore } from "../../base/store.js";
export { extractPdfPagesTask } from "./tasks/extract-pdf-pages.js";
export { extractSpreadsheetTask } from "./tasks/extract-spreadsheet.js";
import { extractPdfPagesTask } from "./tasks/extract-pdf-pages.js";
import { extractSpreadsheetTask } from "./tasks/extract-spreadsheet.js";

/**
 * The `extraction` service store (ref task-contract §3.4, ref data-intake-and-edit-data §3).
 *
 * Sessionless, browserless, deterministic. Its one task turns a
 * content-addressed artifact into the cell matrix ref data-intake-and-edit-data §5's validation
 * pipeline consumes — and it is the ONLY place in the tree that knows which
 * spreadsheet format a file is, so nothing downstream branches on an extension.
 */
export const extractionStore = defineServiceStore("extraction", {
  extractSpreadsheet: extractSpreadsheetTask,
  extractPdfPages: extractPdfPagesTask,
});
