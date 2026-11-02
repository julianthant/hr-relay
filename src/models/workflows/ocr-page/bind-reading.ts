import { z } from "zod";
import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { AdmittedExtractionSchema, admitOcrExtraction } from "../../ocr/extraction.js";
import { OcrPageReadingSchema, bindOcrPageReading, bindManualOcrPageReading } from "../ocr/page-accounting.js";
import { OcrPageWorkflowInputSchema, OCR_PAGE_EXAMPLE } from "./input.js";

const providerExample = admitOcrExtraction({ formType: "emergency-contact",
  source: { kind: "provider", providerId: "chatgpt-subscription", modelId: "example-model" },
  readAt: "2026-11-01T10:00:00.000Z", sourceSha256: OCR_PAGE_EXAMPLE.page.image.sha256,
  sourcePage: 1, pageKind: "blank", record: null });
if (!providerExample.admitted) throw new Error("OCR page contract example is not admitted.");

export const BindOcrReading = defineTaskContract({
  id: taskId("workflow:ocr-page/bind-reading"), title: "Retain page reading", effect: "read",
  input: z.strictObject({ request: OcrPageWorkflowInputSchema, extraction: AdmittedExtractionSchema.nullable() }),
  output: OcrPageReadingSchema, errorCodes: ["INCONSISTENT_INPUTS"],
  subject: { kind: "none", reason: "source binding grants no person or write authority" },
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, provenance: { default: "derived" }, scenarios: [],
  example: bindOcrPageReading(OCR_PAGE_EXAMPLE.page, providerExample.extraction),
});

export const ReadManualOcrReading = defineTaskContract({
  id: taskId("workflow:ocr-page/read-manual-reading"), title: "Read operator assertion", effect: "read",
  input: OcrPageWorkflowInputSchema, output: OcrPageReadingSchema, errorCodes: ["INCONSISTENT_INPUTS"],
  subject: { kind: "none", reason: "reads an operator assertion without observing or verifying the asserted person" },
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, provenance: { default: "live" }, scenarios: [],
  example: bindManualOcrPageReading(OCR_PAGE_EXAMPLE.page, "example-operator", { formType: "emergency-contact",
    source: { kind: "operator", actorId: "example-operator" }, readAt: "2026-11-01T10:00:00.000Z",
    sourceSha256: OCR_PAGE_EXAMPLE.page.image.sha256, sourcePage: 1, pageKind: "blank", record: null }),
});
