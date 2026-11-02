import { deepFreeze } from "../../rules/validation/immutability.js";
import { ocrWorkflow } from "./workflow.js";
import { ocrWorkflowStore } from "./task-registry.js";
import { ocrSourcePagesWorkflow } from "./steps/source-pages/step.js";

export const registration = deepFreeze({
  definition: ocrWorkflow,
  exposure: { kind: "unregistered" },
  store: ocrWorkflowStore,
  proofs: [{ definition: ocrSourcePagesWorkflow, order: 0 }],
} as const);
