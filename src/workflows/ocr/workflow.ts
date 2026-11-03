import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import { OcrCanonicalInput, OcrInputSchema } from "../../models/workflows/ocr/input.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { defineWorkflow } from "../../workflow-kit/workflow-definition.js";
import { ocrSourcePagesDefinition } from "./steps/source-pages/step.js";
import { OCR_ROSTER_TYPE_ID } from "../../models/workflows/ocr/roster.js";
export const ocrWorkflow = defineWorkflow({
  id: "ocr",
  requiredWorkbookTypeIds: [OCR_ROSTER_TYPE_ID],
  version: 1,
  code: "oc",
  label: "OCR",
  summary: "Reads every original page, groups records and retains identity lookup outcomes for review.",
  icon: "FileScan",
  category: "documents",
  input: OcrInputSchema,
  canonicalInput: OcrCanonicalInput,
  inputSubject: "document",
  surface: { shape: "single" },
  enqueue: "reject-active",
  actions: STANDARD_WORKFLOW_ACTIONS,
  capabilities: { review: true, editData: false },
  verdicts: [],
  details: [],
  surfaces: {},
  role: defineWorkflowRole({ kind: "composition" }),
  identity: { matchKey: input => `${input.document.sha256}:${input.formType}:${input.readingId}` },
  presentation: { title: input => input.formType, subtitle: () => "OCR document review" },
  scenarios: ["ocr/multi-page", "ocr/manual", "ocr/page-failure", "ocr/unresolved-identity"],
  steps: ocrSourcePagesDefinition.build,
});
