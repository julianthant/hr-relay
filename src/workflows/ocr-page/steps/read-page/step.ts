import { ExtractFormPage } from "../../../../models/processing/ocr/extract-form-page.js";
import { OcrPageWorkflowInputSchema } from "../../../../models/workflows/ocr-page/input.js";
import { ReadManualOcrReading } from "../../../../models/workflows/ocr-page/read-manual-reading.js";
import { ReadOcrPageReading } from "../../../../models/workflows/ocr-page/read-page-reading.js";
import { OcrPageReadingSchema } from "../../../../models/workflows/ocr/page-accounting.js";
import type { WorkflowAuthor, WorkflowDefinition } from "../../../../workflow-kit/workflow-definition.js";
import { defineStep, inheritStepProof } from "../../../../workflow-kit/workflow-definition.js";
import { defineWorkflowStep } from "../../../../workflow-kit/workflow.js";
export const OCR_PAGE_STEP = Object.freeze({ ...defineWorkflowStep({ key: "read-page", label: "Read source page" }), system: "local" as const,
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
        fields: []
      }
    ],
    branchLabels: []
  } as const,
});

export function buildStep(author: WorkflowAuthor<typeof OcrPageWorkflowInputSchema>) {
  const { task, result } = author;
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
    steps: [[OCR_PAGE_STEP, [extract, reading, manual]]] as const,
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
