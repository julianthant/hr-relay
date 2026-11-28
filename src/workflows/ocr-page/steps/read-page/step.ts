import { ExtractFormPage } from "../../../../models/processing/ocr/extract-form-page.js";
import type { StepManualDeclaration } from "../../../../models/workflow/step-omission.js";
import { manualOcrPageInput, OcrPageWorkflowInputSchema, parseManualOcrPageValues } from "../../../../models/workflows/ocr-page/input.js";
import { ReadManualOcrReading } from "../../../../models/workflows/ocr-page/read-manual-reading.js";
import { ReadOcrPageReading } from "../../../../models/workflows/ocr-page/read-page-reading.js";
import { OcrPageReadingSchema } from "../../../../models/workflows/ocr/page-accounting.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, inheritStepProof } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
import { JsonValueSchema } from "../../../../rules/validation/canonical-json.js";

function pageValues(value: unknown) {
  if (typeof value !== "string") throw new Error("Enter an original-page reading.");
  return parseManualOcrPageValues(value);
}

const MANUAL_PAGE: StepManualDeclaration = {
  off: "values",
  form: { fields: [{ key: "reading", label: "Page reading", kind: "text", format: "ocr-page-reading", withheld: true,
    help: "Enter JSON with pageKind, readAt (ISO time) and record. Use an answers list of path and answer pairs, or null for a non-form page." }] },
  produces: {}, skips: ["extract", "read-page-reading"], keeps: ["manual-reading"],
  refine: ({ reading }, submission) => {
    try {
      const values = pageValues(reading);
      if (submission !== undefined) manualOcrPageInput(OcrPageWorkflowInputSchema.parse(submission).page, "local-operator", values);
      return [];
    } catch {
      return [{ field: "reading", message: "Enter a valid reading of the original page." }];
    }
  },
  bindInput: (input, { reading }) => JsonValueSchema.parse(manualOcrPageInput(
    OcrPageWorkflowInputSchema.parse(input).page, "local-operator", pageValues(reading))),
  withholdsBoundInput: input => OcrPageWorkflowInputSchema.safeParse(input).data?.reading.kind === "manual",
};
export const OCR_PAGE_STEP = Object.freeze({ ...defineWorkflowStep({ key: "read-page", label: "Read source page" }), system: "local" as const,
  description: "Read the exact original page through the declared subscription or manual reading and retain page-bound observations or assertions without approving a person's identity.",
  review: {
    pages: [
      {
        id: "source-page",
        title: "Original source page",
        mode: "Read only",
        nodeIds: ["extract", "read-page-reading", "manual-reading"],
        lines: [
          { id: "subscription", kind: "read", text: "For a subscription reading, read the exact original page through the connected OCR account.", nodeIds: ["extract"] },
          { id: "bind-reading", kind: "check", text: "Check the reading against the exact original page and form type.", nodeIds: ["read-page-reading"] },
          { id: "manual", kind: "read", text: "For a manual reading, use the operator’s reading of this exact original page.", nodeIds: ["manual-reading"] }
        ],
        fields: [
          { id: "page", label: "PDF page", inputField: "page.sourcePage", example: "1",
            source: { origin: "Original PDF", detail: "The exact original page assigned by the document reading.", chain: [] } },
          { id: "form", label: "Form", inputField: "page.formType", example: "Emergency Contact",
            source: { origin: "Document reading", detail: "The form requested by the parent; a reading does not approve the person's identity.", chain: [] } },
        ]
      }
    ],
    branchLabels: []
  } as const,
});

export function buildStep(author: WorkflowAuthor<typeof OcrPageWorkflowInputSchema>) {
  const { group, task, result } = author;
  const extract = task({
    id: "extract", contract: ExtractFormPage, replay: "checkpoint",
    when: { kind: "equals", of: { from: "input", path: "reading.kind" }, value: "subscription" }
  }, [],
    ({ input }) => ({ formType: input.page.formType, page: input.page.image, sourcePage: input.page.sourcePage }));
  const reading = task({
    id: "read-page-reading", contract: ReadOcrPageReading, replay: "checkpoint",
    when: { kind: "equals", of: { from: "input", path: "reading.kind" }, value: "subscription" }
  }, [extract],
    ({ input, outputs }) => ({ request: input, extraction: outputs.extract ?? null }));
  const manual = task({
    id: "manual-reading", contract: ReadManualOcrReading, replay: "checkpoint",
    when: { kind: "equals", of: { from: "input", path: "reading.kind" }, value: "manual" }
  }, [], ({ input }) => input);
  return {
    steps: [[group(OCR_PAGE_STEP, { manual: MANUAL_PAGE }), [extract, reading, manual]]] as const,
    result: result(OcrPageReadingSchema, [reading, manual], ({ outputs }) => {
      const output = outputs["read-page-reading"] ?? outputs["manual-reading"];
      if (output === undefined) throw new Error("OCR page has neither a provider reading nor an operator assertion.");
      return output;
    })
  };
}

export const ocrPageReadingDefinition = defineStep({
  group: OCR_PAGE_STEP, build: buildStep,
  proof: {
    id: "ocr-page-reading", order: 20,
    build: (parent: WorkflowDefinition<typeof OcrPageWorkflowInputSchema, typeof OcrPageReadingSchema>) => ({
      ...inheritStepProof(parent), code: "og", label: "OCR page reading", summary: "Proves subscription readings and operator assertions for one original page.",
      steps: () => ({ steps: parent.steps, result: parent.result }),
    }),
  },
});
