import { z } from "zod";
import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { ExtractPdfPagesOutputSchema } from "../../processing/extraction/extract-pdf-pages.js";
import { OcrInputSchema, OCR_INPUT_EXAMPLE } from "./input.js";
import { OcrSourceManifestHeadSchema, buildOcrSourceManifest, ocrPageInputs } from "./source-manifest.js";
import { bindCanonicalManualOcrReading } from "./page-accounting.js";
import { OCR_PAGE_EXAMPLE } from "../ocr-page/input.js";

export const OCR_SOURCE_MANIFEST_EXAMPLE = buildOcrSourceManifest(OCR_INPUT_EXAMPLE.document, { pageCount: 1,
  pages: [{ sourcePage: 1, image: OCR_PAGE_EXAMPLE.page.image }] });

/** Every original page paired with its reading, derived from the rendered pages; throws when manual assertions do not cover every page once. */
export function ocrPageWorkInputs(request: Pick<z.infer<typeof OcrInputSchema>, "document" | "readingId" | "formType" | "reading">, rendered: z.infer<typeof ExtractPdfPagesOutputSchema>) {
  const manifest = buildOcrSourceManifest(request.document, rendered);
  const pages = ocrPageInputs(manifest, request.readingId, request.formType);
  const reading = request.reading;
  if (reading.kind === "manual" && (reading.assertions.length !== pages.length
    || new Set(reading.assertions.map(assertion => assertion.sourcePage)).size !== pages.length)) {
    throw new Error("Manual OCR requires one assertion for every original page.");
  }
  return { manifest, pages: pages.map(page => {
    if (reading.kind === "subscription") return { page, reading };
    const assertion = reading.assertions.find(assertion => assertion.sourcePage === page.sourcePage);
    if (assertion === undefined) throw new Error("Manual OCR assertion is missing an original page.");
    bindCanonicalManualOcrReading(page, reading.actorId, assertion.extraction);
    return { page, reading: { kind: "manual" as const, actorId: reading.actorId, extraction: assertion.extraction } };
  }) };
}

// The page lists stay out of this output: one observed origin per page leaf would exceed a timeline event for a long scan.
export const ReadOcrSourcePages = defineTaskContract({
  id: taskId("workflow:ocr/read-source-pages"), title: "Bind original pages", effect: "read",
  input: z.strictObject({ request: OcrInputSchema, rendered: ExtractPdfPagesOutputSchema }),
  output: z.strictObject({ manifest: OcrSourceManifestHeadSchema }),
  errorCodes: ["INCONSISTENT_INPUTS"], subject: { kind: "none", reason: "binds local source artifacts without resolving a person" },
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, provenance: { default: "derived" }, scenarios: [],
  example: { manifest: { document: OCR_SOURCE_MANIFEST_EXAMPLE.document, pageCount: OCR_SOURCE_MANIFEST_EXAMPLE.pageCount,
    fingerprint: OCR_SOURCE_MANIFEST_EXAMPLE.fingerprint } },
});
