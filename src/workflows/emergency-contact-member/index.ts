import { deepFreeze } from "../../rules/validation/immutability.js";
import { defineStepProof } from "../../workflow-kit/workflow-definition.js";
import { emergencyContactMemberWorkflow } from "./workflow.js";
import { emergencyContactMemberStore } from "./task-registry.js";
import { contactPlanDefinition } from "./steps/contact-plan/step.js";
import { contactPreviewDefinition } from "./steps/contact-preview/step.js";
import { onbaseFilingDefinition } from "./steps/onbase-filing/step.js";
import { emergencyContactMemberReferenceCheckDefinition } from "./steps/reference-check/step.js";
export const registration = deepFreeze({
  definition: emergencyContactMemberWorkflow,
  store: emergencyContactMemberStore,
  proofs: [
    defineStepProof(emergencyContactMemberWorkflow, contactPlanDefinition),
    defineStepProof(emergencyContactMemberWorkflow, contactPreviewDefinition),
    defineStepProof(emergencyContactMemberWorkflow, onbaseFilingDefinition),
    defineStepProof(emergencyContactMemberWorkflow, emergencyContactMemberReferenceCheckDefinition),
  ],
} as const);
