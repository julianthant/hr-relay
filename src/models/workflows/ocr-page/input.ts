import { z } from "zod";
import { AdmittedExtractionSchema } from "../../ocr/extraction.js";
import { OcrPageInputSchema } from "../ocr/source-manifest.js";

export const ManualOcrAssertionSchema = z.strictObject({
  sourcePage: z.number().int().positive(),
  extraction: AdmittedExtractionSchema,
});
export const OcrPageWorkflowInputSchema = z.strictObject({
  page: OcrPageInputSchema,
  reading: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("subscription") }),
    z.strictObject({ kind: z.literal("manual"), actorId: z.string().min(1), extraction: AdmittedExtractionSchema }),
  ]),
});
export const OCR_PAGE_EXAMPLE = OcrPageWorkflowInputSchema.parse({
  page: { formType: "emergency-contact", manifestFingerprint: "a".repeat(64),
    document: { id: "00000000-0000-4000-8000-000000000103", sha256: "b".repeat(64), bytes: 200, mediaType: "application/pdf" },
    sourcePage: 1, image: { id: "00000000-0000-4000-8000-000000000200", sha256: "c".repeat(64), bytes: 100, mediaType: "image/png" },
    readingId: "00000000-0000-4000-8000-000000000101" },
  reading: { kind: "subscription" },
});
