import { readApprovedOcrSnapshotTask } from "./tasks/read-approved-snapshot.js";
import { readApprovedOcrRecordTask } from "./tasks/read-approved-record.js";
import { defineServiceStore } from "../../../workflow-kit/task-registry.js";
export { extractFormPageTask } from "./tasks/extract-form-page.js";
import { extractFormPageTask } from "./tasks/extract-form-page.js";


export const ocrStore = defineServiceStore("ocr", {
  extractFormPage: extractFormPageTask,
  readApprovedSnapshot: readApprovedOcrSnapshotTask, readApprovedRecord: readApprovedOcrRecordTask,
});
