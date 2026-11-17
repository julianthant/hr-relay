import { deepFreeze } from "../../rules/validation/immutability.js";
import { defineStepProof } from "../../workflow-kit/workflow-definition.js";
import { workStudyReferenceCheckDefinition } from "./steps/reference-check/step.js";
import { workStudyTransactionDefinition } from "./steps/transaction/step.js";
import { workStudyUcpathAuthDefinition } from "./steps/ucpath-auth/step.js";
import { workStudyStore } from "./task-registry.js";
import { workStudyWorkflow } from "./workflow.js";

export const registration = deepFreeze({
  definition: workStudyWorkflow,
  store: workStudyStore,
  proofs: [defineStepProof(workStudyWorkflow, workStudyUcpathAuthDefinition), defineStepProof(workStudyWorkflow, workStudyTransactionDefinition),
    defineStepProof(workStudyWorkflow, workStudyReferenceCheckDefinition)],
} as const);
