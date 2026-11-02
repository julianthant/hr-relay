import { deepFreeze } from "../../rules/validation/immutability.js";
import { i9CheckWorkflow } from "./workflow.js";
import { i9CheckStore } from "./task-registry.js";
import { i9CheckPersonMatchWorkflow } from "./steps/person-match/step.js";
import { i9CheckPersonLookupWorkflow } from "./steps/person-lookup/step.js";
import { i9CheckRosterMatchWorkflow } from "./steps/roster-match/step.js";

export const registration = deepFreeze({
  definition: i9CheckWorkflow,
  exposure: { kind: "child-only" },
  store: i9CheckStore,
  proofs: [
    { definition: i9CheckPersonMatchWorkflow, order: 9 },
    { definition: i9CheckPersonLookupWorkflow, order: 10 },
    { definition: i9CheckRosterMatchWorkflow, order: 11 },
  ],
} as const);
