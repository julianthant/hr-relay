import { deepFreeze } from "../../rules/validation/immutability.js";
import { defineStepProof } from "../../workflow-kit/workflow-definition.js";
import { onbaseSourcePageDefinition } from "./steps/source-page/step.js";
import { onbaseImportDocumentDefinition } from "./steps/import-document/step.js";
import { onbaseWorkflowStore } from "./task-registry.js";
import { onbaseWorkflow } from "./workflow.js";

export const registration = deepFreeze({
  definition: onbaseWorkflow, exposure: { kind: "child-only" }, store: onbaseWorkflowStore,
  proofs: [defineStepProof(onbaseWorkflow, onbaseSourcePageDefinition), defineStepProof(onbaseWorkflow, onbaseImportDocumentDefinition)],
} as const);
