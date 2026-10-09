
import { defineServiceStore } from "../../../workflow-kit/task-registry.js";
import { readContactAdviceTask } from "./tasks/read-contact-advice.js";

export { readContactAdviceTask };

export const normalizationStore = defineServiceStore("normalization", {
  readContactAdvice: readContactAdviceTask,
});
