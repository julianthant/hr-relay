import { defineCanonicalInput } from "../../models/workflow/canonical-input.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import { OCR_PAGE_EXAMPLE, OcrPageWorkflowInputSchema } from "../../models/workflows/ocr-page/input.js";
import { ocrExtractionId } from "../../models/workflows/ocr/source-manifest.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { defineWorkflow } from "../../workflow-kit/workflow-definition.js";
import { ocrPageReadingDefinition } from "./steps/read-page/step.js";

export const ocrPageWorkflow = defineWorkflow({
  id: "ocr-page",
  requiredWorkbookFields: [],
  version: 1,
  code: "op",
  label: "OCR Page",
  summary: "Reads one exact original page and retains its source-bound evidence.",
  icon: "FileScan",
  category: "documents",
  input: OcrPageWorkflowInputSchema,
  canonicalInput: defineCanonicalInput(OcrPageWorkflowInputSchema, OcrPageWorkflowInputSchema, [OCR_PAGE_EXAMPLE]),
  inputSubject: "document",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  capabilities: { review: false, editData: false },
  verdicts: [],
  details: [],
  surfaces: {},
  role: defineWorkflowRole({ kind: "composition" }),
  identity: { matchKey: input => ocrExtractionId(input.page) },
  presentation: { title: input => `Page ${input.page.sourcePage}`, subtitle: input => input.page.formType },
  scenarios: ["ocr-page/subscription", "ocr-page/manual", "ocr-page/source-mismatch"],
  steps: ocrPageReadingDefinition.build,
});
