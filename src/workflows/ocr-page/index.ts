import { deepFreeze } from "../../rules/validation/immutability.js";
import { defineStepProof } from "../../workflow-kit/workflow-definition.js";
import { ocrPageReadingDefinition } from "./steps/read-page/step.js";
import { ocrPageStore } from "./task-registry.js";
import { ocrPageWorkflow } from "./workflow.js";

export const registration = deepFreeze({
  definition: ocrPageWorkflow,
  exposure: { kind: "unregistered" },
  store: ocrPageStore,
  proofs: [defineStepProof(ocrPageWorkflow, ocrPageReadingDefinition)],
} as const);
