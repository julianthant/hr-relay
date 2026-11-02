import { deepFreeze } from "../../rules/validation/immutability.js";
import { defineStepProof } from "../../workflow-kit/workflow-definition.js";
import { i9LookupStepDefinition } from "./steps/lookup/step.js";
import { i9LookupStore } from "./task-registry.js";
import { i9LookupWorkflow } from "./workflow.js";

export const registration = deepFreeze({
  definition: i9LookupWorkflow,
  exposure: { kind: "child-only" },
  store: i9LookupStore,
  proofs: [defineStepProof(i9LookupWorkflow, i9LookupStepDefinition)],
} as const);
