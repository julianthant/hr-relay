import { deepFreeze } from "../../rules/validation/immutability.js";
import { defineStepProof } from "../../workflow-kit/workflow-definition.js";
import { i9CheckStartDocumentsDefinition } from "./steps/documents/step.js";
import { i9CheckStartRosterReferenceDefinition } from "./steps/roster-reference/step.js";
import { i9CheckStartRetentionDefinition } from "./steps/retention/step.js";
import { i9CheckStartStore } from "./task-registry.js";
import { i9CheckStartWorkflow } from "./workflow.js";

export const registration = deepFreeze({
  definition: i9CheckStartWorkflow, exposure: { kind: "public", order: 3 }, store: i9CheckStartStore,
  proofs: [defineStepProof(i9CheckStartWorkflow, i9CheckStartDocumentsDefinition),
    defineStepProof(i9CheckStartWorkflow, i9CheckStartRosterReferenceDefinition), defineStepProof(i9CheckStartWorkflow, i9CheckStartRetentionDefinition)],
} as const);
