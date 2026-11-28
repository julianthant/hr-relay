import { z } from "zod";
import { AdmittedExtractionSchema, SubmittedExtractionSchema } from "../../ocr/extraction.js";
import { bindManualOcrPageReading } from "../ocr/page-accounting.js";
import { OcrPageInputSchema, type OcrPageInput } from "../ocr/source-manifest.js";

export const ManualOcrPageValuesSchema = SubmittedExtractionSchema.pick({ pageKind: true, readAt: true, record: true });
const SourcePageSchema = OcrPageInputSchema.shape.sourcePage;
export const ManualOcrDocumentPageValuesSchema = ManualOcrPageValuesSchema.extend({ sourcePage: SourcePageSchema });
export const ManualOcrAssertionSchema = z.union([
  z.strictObject({ sourcePage: SourcePageSchema, extraction: AdmittedExtractionSchema }),
  z.strictObject({ sourcePage: SourcePageSchema, values: ManualOcrPageValuesSchema }),
]);

export function manualOcrPageInput(page: OcrPageInput, actorId: string, values: z.output<typeof ManualOcrPageValuesSchema>) {
  const { extraction } = bindManualOcrPageReading(page, actorId, { ...values, formType: page.formType,
    sourcePage: page.sourcePage, sourceSha256: page.image.sha256, source: { kind: "operator", actorId } });
  return { page, reading: { kind: "manual" as const, actorId, extraction } };
}
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
