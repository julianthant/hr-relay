import { deepFreeze } from "../../rules/validation/immutability.js";
import { defineStepProof } from "../../workflow-kit/workflow-definition.js";
import { i9CheckPersonLookupDefinition } from "./steps/person-lookup/step.js";
import { i9CheckPersonMatchDefinition } from "./steps/person-match/step.js";
import { i9CheckRosterMatchDefinition } from "./steps/roster-match/step.js";
import { i9CheckStore } from "./task-registry.js";
import { i9CheckWorkflow } from "./workflow.js";

export const registration = deepFreeze({
  definition: i9CheckWorkflow,
  store: i9CheckStore,
  proofs: [
    defineStepProof(i9CheckWorkflow, i9CheckPersonMatchDefinition),
    defineStepProof(i9CheckWorkflow, i9CheckPersonLookupDefinition),
    defineStepProof(i9CheckWorkflow, i9CheckRosterMatchDefinition),
  ],
} as const);
