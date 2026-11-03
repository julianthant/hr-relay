import { z } from "zod";
import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { AdmittedExtractionSchema, admitOcrExtraction } from "../../ocr/extraction.js";
import { OcrPageReadingSchema, bindOcrPageReading } from "../ocr/page-accounting.js";
import { OcrPageWorkflowInputSchema, OCR_PAGE_EXAMPLE } from "./input.js";

const providerExample = admitOcrExtraction({ formType: "emergency-contact",
  source: { kind: "provider", providerId: "chatgpt-subscription", modelId: "example-model" },
  readAt: "2026-11-01T10:00:00.000Z", sourceSha256: OCR_PAGE_EXAMPLE.page.image.sha256,
  sourcePage: 1, pageKind: "blank", record: null });
if (!providerExample.admitted) throw new Error("OCR page contract example is not admitted.");

export const ReadOcrPageReading = defineTaskContract({
  id: taskId("workflow:ocr-page/read-page-reading"), title: "Retain page reading", effect: "read",
  input: z.strictObject({ request: OcrPageWorkflowInputSchema, extraction: AdmittedExtractionSchema.nullable() }),
  output: OcrPageReadingSchema, errorCodes: ["INCONSISTENT_INPUTS", "OCR_PUBLICATION_REFUSED"],
  subject: { kind: "none", reason: "source binding grants no person or write authority" },
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, provenance: { default: "derived" }, scenarios: [],
  example: bindOcrPageReading(OCR_PAGE_EXAMPLE.page, providerExample.extraction),
});
