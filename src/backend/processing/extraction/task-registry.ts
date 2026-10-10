import { defineServiceStore } from "../../../workflow-kit/task-registry.js";
export { extractPdfPagesTask } from "./tasks/extract-pdf-pages.js";
export { extractSpreadsheetTask } from "./tasks/extract-spreadsheet.js";
import { extractPdfPagesTask } from "./tasks/extract-pdf-pages.js";
import { extractSpreadsheetTask } from "./tasks/extract-spreadsheet.js";


export const extractionStore = defineServiceStore("extraction", {
  extractSpreadsheet: extractSpreadsheetTask,
  extractPdfPages: extractPdfPagesTask,
});
