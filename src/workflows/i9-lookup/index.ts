import { deepFreeze } from "../../rules/validation/immutability.js";
import { i9LookupWorkflow } from "./workflow.js";
import { i9LookupStore } from "./task-registry.js";
import { i9LookupStepWorkflow } from "./steps/lookup/step.js";

export const registration = deepFreeze({
  definition: i9LookupWorkflow,
  exposure: { kind: "child-only" },
  store: i9LookupStore,
  proofs: [{ definition: i9LookupStepWorkflow, order: 9 }],
} as const);
