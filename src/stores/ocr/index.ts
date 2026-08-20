import { defineServiceStore } from "../../base/store.js";
export { extractFormPageTask } from "./tasks/extract-form-page.js";
import { extractFormPageTask } from "./tasks/extract-form-page.js";

/**
 * The `ocr` service store (ref task-contract §3.4, ref data-intake-and-edit-data §4.3).
 *
 * Sessionless and browserless. Its one task is route 1 of D151 — the provider
 * pipeline — and it is a PEER of the `cli ocr` routes, not a privileged
 * path: same generated instruction in, same admission gate out.
 */
export const ocrStore = defineServiceStore("ocr", {
  extractFormPage: extractFormPageTask,
});
