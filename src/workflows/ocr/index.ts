import { deepFreeze } from "../../rules/validation/immutability.js";
import { defineStepProof } from "../../workflow-kit/workflow-definition.js";
import { ocrSourcePagesDefinition } from "./steps/source-pages/step.js";
import { ocrWorkflowStore } from "./task-registry.js";
import { ocrWorkflow } from "./workflow.js";

export const registration = deepFreeze({
  definition: ocrWorkflow,
  exposure: { kind: "unregistered" },
  store: ocrWorkflowStore,
  proofs: [defineStepProof(ocrWorkflow, ocrSourcePagesDefinition)],
} as const);
