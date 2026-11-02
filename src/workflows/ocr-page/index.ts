import { deepFreeze } from "../../rules/validation/immutability.js";
import { ocrPageWorkflow } from "./workflow.js";
import { ocrPageStore } from "./task-registry.js";
import { ocrPageReadingWorkflow } from "./steps/read-page/step.js";

export const registration = deepFreeze({
  definition: ocrPageWorkflow,
  exposure: { kind: "unregistered" },
  store: ocrPageStore,
  proofs: [{ definition: ocrPageReadingWorkflow, order: 1 }],
} as const);
