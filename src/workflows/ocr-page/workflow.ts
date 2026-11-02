import { defineWorkflow } from "../../workflow-kit/workflow-definition.js";
import { defineCanonicalInput } from "../../models/workflow/canonical-input.js";
import { defineWorkflowRole } from "../../workflow-kit/validation/module-role.js";
import { STANDARD_WORKFLOW_ACTIONS } from "../../models/workflow/presentation.js";
import { OcrPageWorkflowInputSchema, OCR_PAGE_EXAMPLE } from "../../models/workflows/ocr-page/input.js";
import { OcrPageReadingSchema } from "../../models/workflows/ocr/page-accounting.js";
import { ocrExtractionId } from "../../models/workflows/ocr/source-manifest.js";
import { ExtractFormPage } from "../../models/processing/ocr/extract-form-page.js";
import { BindOcrReading, ReadManualOcrReading } from "../../models/workflows/ocr-page/bind-reading.js";

export const ocrPageWorkflow = defineWorkflow({
  id: "ocr-page", version: 1, code: "op", label: "OCR Page", summary: "Reads one exact original page and retains its source-bound evidence.",
  icon: "FileScan", category: "documents", input: OcrPageWorkflowInputSchema,
  canonicalInput: defineCanonicalInput(OcrPageWorkflowInputSchema, OcrPageWorkflowInputSchema, [OCR_PAGE_EXAMPLE]),
  inputSubject: "document", surface: { shape: "single" }, enqueue: "reject-active", actions: STANDARD_WORKFLOW_ACTIONS,
  capabilities: { review: false, editData: false }, verdicts: [], details: [], surfaces: {}, role: defineWorkflowRole({ kind: "standalone" }),
  identity: { matchKey: input => ocrExtractionId(input.page) },
  presentation: { title: input => `Page ${input.page.sourcePage}`, subtitle: input => input.page.formType },
  scenarios: ["ocr-page/subscription", "ocr-page/manual", "ocr-page/source-mismatch"],
  steps: ({ task, result }) => {
    const extract = task({ id: "extract", contract: ExtractFormPage, replay: "checkpoint",
      when: { kind: "equals", of: { from: "input", path: "reading.kind" }, value: "subscription" } }, [],
    ({ input }) => ({ formType: input.page.formType, page: input.page.image, sourcePage: input.page.sourcePage }));
    const reading = task({ id: "bind-reading", contract: BindOcrReading, replay: "checkpoint",
      when: { kind: "equals", of: { from: "input", path: "reading.kind" }, value: "subscription" } }, [extract],
      ({ input, outputs }) => ({ request: input, extraction: outputs.extract ?? null }));
    const manual = task({ id: "manual-reading", contract: ReadManualOcrReading, replay: "checkpoint",
      when: { kind: "equals", of: { from: "input", path: "reading.kind" }, value: "manual" } }, [], ({ input }) => input);
    return { steps: [[{ key: "read-page", label: "Read source page", system: "local" }, [extract, reading, manual]]],
      result: result(OcrPageReadingSchema, [reading, manual], ({ outputs }) => {
        const output = outputs["bind-reading"] ?? outputs["manual-reading"];
        if (output === undefined) throw new Error("OCR page has neither a provider reading nor an operator assertion.");
        return output;
      }) };
  },
});
