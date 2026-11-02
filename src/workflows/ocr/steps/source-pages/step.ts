import { defineWorkflow } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowRole } from "../../../../workflow-kit/validation/module-role.js";
import { ReadOcrSourcePages } from "../../../../models/workflows/ocr/read-source-pages.js";
import { ocrWorkflow, OCR_SOURCE_PAGES_STEP } from "../../workflow.js";

const sourceStep = ocrWorkflow.steps.find(([step]) => step === OCR_SOURCE_PAGES_STEP);
const source = sourceStep?.[1].find(entry => entry.id === "read-source-pages");
if (sourceStep === undefined || source === undefined) throw new Error("OCR source-page proof requires its authored source group.");

export const ocrSourcePagesWorkflow = defineWorkflow({
  id: "ocr-source-pages", version: 1, code: "os", label: "OCR source pages", summary: "Proves complete source-page rendering and manual source bindings.",
  icon: "FileScan", category: "documents", input: ocrWorkflow.input, canonicalInput: ocrWorkflow.canonicalInput,
  inputSubject: ocrWorkflow.inputSubject, surface: ocrWorkflow.surface, enqueue: ocrWorkflow.enqueue,
  actions: ocrWorkflow.actions, surfaces: ocrWorkflow.surfaces, verdicts: [], details: [],
  identity: ocrWorkflow.identity, presentation: ocrWorkflow.presentation, scenarios: ocrWorkflow.scenarios,
  role: defineWorkflowRole({ kind: "chunk-harness", of: "ocr", step: OCR_SOURCE_PAGES_STEP.key }),
  steps: ({ result }) => ({ steps: [sourceStep], result: result(ReadOcrSourcePages.output, [source],
    ({ outputs }) => ReadOcrSourcePages.output.parse(outputs["read-source-pages"])) }),
});
