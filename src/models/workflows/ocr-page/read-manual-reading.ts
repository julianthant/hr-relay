import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { OcrPageReadingSchema, bindManualOcrPageReading } from "../ocr/page-accounting.js";
import { OcrPageWorkflowInputSchema, OCR_PAGE_EXAMPLE } from "./input.js";

export const ReadManualOcrReading = defineTaskContract({
  id: taskId("workflow:ocr-page/read-manual-reading"), title: "Read operator assertion", effect: "read",
  input: OcrPageWorkflowInputSchema, output: OcrPageReadingSchema, errorCodes: ["INCONSISTENT_INPUTS"],
  subject: { kind: "none", reason: "reads an operator assertion without observing or verifying the asserted person" },
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, provenance: { default: "live" }, scenarios: [],
  example: bindManualOcrPageReading(OCR_PAGE_EXAMPLE.page, "example-operator", { formType: "emergency-contact",
    source: { kind: "operator", actorId: "example-operator" }, readAt: "2026-11-01T10:00:00.000Z",
    sourceSha256: OCR_PAGE_EXAMPLE.page.image.sha256, sourcePage: 1, pageKind: "blank", record: null }),
});
