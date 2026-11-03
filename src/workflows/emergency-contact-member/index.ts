import { deepFreeze } from "../../rules/validation/immutability.js";
import { defineStepProof } from "../../workflow-kit/workflow-definition.js";
import { emergencyContactMemberWorkflow } from "./workflow.js";
import { emergencyContactMemberStore } from "./task-registry.js";
import { contactPlanDefinition } from "./steps/contact-plan/step.js";
import { contactPreviewDefinition } from "./steps/contact-preview/step.js";
export const registration = deepFreeze({ definition: emergencyContactMemberWorkflow, exposure: { kind: "child-only" },
  store: emergencyContactMemberStore, proofs: [defineStepProof(emergencyContactMemberWorkflow, contactPlanDefinition),
    defineStepProof(emergencyContactMemberWorkflow, contactPreviewDefinition)] } as const);
