import { defineStepProof } from "../../workflow-kit/workflow-definition.js";
import { emergencyContactReadDocumentDefinition } from "./steps/read-document/step.js";
import { emergencyContactMembersDefinition } from "./steps/members/step.js";
import { deepFreeze } from "../../rules/validation/immutability.js";
import { emergencyContactWorkflow } from "./workflow.js";
import { emergencyContactStore } from "./task-registry.js";
export const registration = deepFreeze({
  definition: emergencyContactWorkflow,
  store: emergencyContactStore,
  proofs: [
    defineStepProof(emergencyContactWorkflow, emergencyContactReadDocumentDefinition),
    defineStepProof(emergencyContactWorkflow, emergencyContactMembersDefinition),
  ],
} as const);
