import { z } from "zod";
import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { ExtractPdfPagesOutputSchema } from "../../processing/extraction/extract-pdf-pages.js";
import { OcrInputSchema, OCR_INPUT_EXAMPLE } from "./input.js";
import { OcrSourceManifestSchema, buildOcrSourceManifest, ocrPageInputs } from "./source-manifest.js";
import { OcrPageWorkflowInputSchema, OCR_PAGE_EXAMPLE } from "../ocr-page/input.js";

export const PreparedOcrPagesSchema = z.strictObject({ manifest: OcrSourceManifestSchema, pages: z.array(OcrPageWorkflowInputSchema).min(1) });
const exampleManifest = buildOcrSourceManifest(OCR_INPUT_EXAMPLE.document, { pageCount: 1,
  pages: [{ sourcePage: 1, image: OCR_PAGE_EXAMPLE.page.image }] });
export const ReadOcrSourcePages = defineTaskContract({
  id: taskId("workflow:ocr/read-source-pages"), title: "Bind original pages", effect: "read",
  input: z.strictObject({ request: OcrInputSchema, rendered: ExtractPdfPagesOutputSchema }), output: PreparedOcrPagesSchema,
  errorCodes: ["INCONSISTENT_INPUTS"], subject: { kind: "none", reason: "binds local source artifacts without resolving a person" },
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, provenance: { default: "derived" }, scenarios: [],
  example: { manifest: exampleManifest, pages: ocrPageInputs(exampleManifest, OCR_INPUT_EXAMPLE.readingId)
    .map(page => ({ page, reading: { kind: "subscription" as const } })) },
});
