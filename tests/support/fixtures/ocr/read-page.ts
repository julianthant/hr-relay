import assert from "node:assert/strict";
import type { z } from "zod";
import { compileWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import { descriptorRuntimeNodes } from "../../../../src/workflow-kit/workflow.js";
import { evaluateNodeCondition } from "../../../../src/models/workflow/node-condition.js";
import { ExtractFormPage, OCR_EXTRACTION_RESPONSE_HASH } from "../../../../src/models/processing/ocr/extract-form-page.js";
import { ReadOcrPageReading } from "../../../../src/models/workflows/ocr-page/read-page-reading.js";
import { ReadManualOcrReading } from "../../../../src/models/workflows/ocr-page/read-manual-reading.js";
import { OcrPageReadingSchema } from "../../../../src/models/workflows/ocr/page-accounting.js";
import { OcrPageWorkflowInputSchema } from "../../../../src/models/workflows/ocr-page/input.js";
import { ocrPageWorkflow } from "../../../../src/workflows/ocr-page/workflow.js";
import { extractFormPageTask } from "../../../../src/backend/processing/ocr/tasks/extract-form-page.js";
import { readManualOcrReadingTask } from "../../../../src/workflows/ocr-page/tasks/read-manual-reading.js";
import { readOcrPageReadingTask } from "../../../../src/workflows/ocr-page/tasks/read-page-reading.js";
import { ocrTaskContext } from "./task-context.js";
import { submittedPage } from "./source-pages.js";

export async function readOcrPageFixture(input: z.output<typeof OcrPageWorkflowInputSchema>) {
  const nodes = descriptorRuntimeNodes(compileWorkflow(ocrPageWorkflow).descriptor);
  const extract = nodes.find(node => node.id === "extract");
  const manual = nodes.find(node => node.id === "manual-reading");
  const bind = nodes.find(node => node.id === "read-page-reading");
  assert.ok(extract?.kind === "task" && extract.when !== undefined && bind?.kind === "task" && manual?.kind === "task");
  const { ctx, recorded } = ocrTaskContext();
  const requests: unknown[] = [];
  const extraction = evaluateNodeCondition(extract.when, { input, outputs: {} })
    ? await extractFormPageTask.impl.run({ input: ExtractFormPage.input.parse(extract.bind({ input, outputs: {} })),
      ctx: { ...ctx, artifacts: {
        put: async () => { throw new Error("OCR extraction must not write an artifact."); },
        open: async () => { throw new Error("The provider owns reading the supplied source artifact."); },
      }, providers: { "ocr.extract": { capability: "ocr.extract", call: async payload => {
        requests.push(payload);
        return { state: "produced" as const, value: { schemaHash: OCR_EXTRACTION_RESPONSE_HASH, value: submittedPage(input.page) } };
      } } } } }) : undefined;
  const reading = OcrPageReadingSchema.parse(input.reading.kind === "manual"
    ? await readManualOcrReadingTask.impl.run({ input: ReadManualOcrReading.input.parse(manual.bind({ input, outputs: {} })), ctx })
    : await readOcrPageReadingTask.impl.run({ input: ReadOcrPageReading.input.parse(bind.bind({ input,
      outputs: extraction === undefined ? {} : { extract: extraction } })), ctx }));
  return { reading, requests, recorded };
}
