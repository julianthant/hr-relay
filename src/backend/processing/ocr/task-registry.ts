import { defineServiceStore } from "../../../workflow-kit/task-registry.js";
export { extractFormPageTask } from "./tasks/extract-form-page.js";
import { extractFormPageTask } from "./tasks/extract-form-page.js";


export const ocrStore = defineServiceStore("ocr", {
  extractFormPage: extractFormPageTask,
});
