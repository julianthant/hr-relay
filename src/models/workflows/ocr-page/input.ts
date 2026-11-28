import { z } from "zod";
import { AdmittedExtractionSchema, SubmittedAnswerSchema, SubmittedExtractionSchema } from "../../ocr/extraction.js";
import { OcrFieldPathSchema } from "../../ocr/form-registry.js";
import { bindManualOcrPageReading } from "../ocr/page-accounting.js";
import { OcrPageInputSchema, type OcrPageInput } from "../ocr/source-manifest.js";

const ManualAnswersSchema = z.array(z.strictObject({ path: OcrFieldPathSchema, answer: SubmittedAnswerSchema }))
  .refine(answers => new Set(answers.map(({ path }) => path)).size === answers.length, "Each field can appear once.");
export const ManualOcrPageValuesSchema = SubmittedExtractionSchema.pick({ pageKind: true, readAt: true }).extend({
  record: z.strictObject({ answers: ManualAnswersSchema }).nullable(),
});
const SourcePageSchema = OcrPageInputSchema.shape.sourcePage;
export const ManualOcrDocumentPageValuesSchema = ManualOcrPageValuesSchema.extend({ sourcePage: SourcePageSchema });
export const ManualOcrAssertionSchema = z.strictObject({ sourcePage: SourcePageSchema, extraction: AdmittedExtractionSchema });
export const ManualOcrDraftAssertionSchema = z.strictObject({ sourcePage: SourcePageSchema, values: ManualOcrPageValuesSchema });

export function manualOcrPageInput(page: OcrPageInput, actorId: string, values: z.output<typeof ManualOcrPageValuesSchema>) {
  const record = values.record === null ? null : { answers: Object.fromEntries(values.record.answers.map(({ path, answer }) => [path, answer])) };
  const { extraction } = bindManualOcrPageReading(page, actorId, { ...values, formType: page.formType,
    record, sourcePage: page.sourcePage, sourceSha256: page.image.sha256, source: { kind: "operator", actorId } });
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
