/**
 * The normalization service store (ref task-contract §3.4, ref data-intake-and-edit-data §4.2): reusable
 * contact/address cleanup as typed advice. Geocoder reads reach remote I/O
 * only through the admitted provider clients the executor injects.
 */
import { defineServiceStore } from "../../base/store.js";
import { readContactAdviceTask } from "./tasks/read-contact-advice.js";

export { readContactAdviceTask };

export const normalizationStore = defineServiceStore("normalization", {
  readContactAdvice: readContactAdviceTask,
});
