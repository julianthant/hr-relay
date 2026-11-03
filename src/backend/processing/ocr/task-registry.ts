import { defineServiceStore } from "../../../workflow-kit/task-registry.js";
export { extractFormPageTask } from "./tasks/extract-form-page.js";
import { extractFormPageTask } from "./tasks/extract-form-page.js";
import { readApprovedOcrRecordsTask } from "./tasks/read-approved-records.js";


export const ocrStore = defineServiceStore("ocr", {
  extractFormPage: extractFormPageTask,
  readApprovedRecords: readApprovedOcrRecordsTask,
});
