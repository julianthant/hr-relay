import { defineWorkflow } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowRole } from "../../../../workflow-kit/validation/module-role.js";
import { ocrPageWorkflow, OCR_PAGE_STEP } from "../../workflow.js";

export const ocrPageReadingWorkflow = defineWorkflow({
  id: "ocr-page-reading", version: 1, code: "og", label: "OCR page reading", summary: "Proves subscription readings and operator assertions for one original page.",
  icon: "FileScan", category: "documents", input: ocrPageWorkflow.input, canonicalInput: ocrPageWorkflow.canonicalInput,
  inputSubject: ocrPageWorkflow.inputSubject, surface: ocrPageWorkflow.surface, enqueue: ocrPageWorkflow.enqueue,
  actions: ocrPageWorkflow.actions, surfaces: ocrPageWorkflow.surfaces, verdicts: [], details: [],
  identity: ocrPageWorkflow.identity, presentation: ocrPageWorkflow.presentation, scenarios: ocrPageWorkflow.scenarios,
  role: defineWorkflowRole({ kind: "chunk-harness", of: "ocr-page", step: OCR_PAGE_STEP.key }),
  steps: () => ({ steps: ocrPageWorkflow.steps, result: ocrPageWorkflow.result }),
});
