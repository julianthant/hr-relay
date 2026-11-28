import { z } from "zod";
import { AdmittedExtractionSchema, SubmittedAnswerSchema, SubmittedExtractionSchema, admitOcrExtraction } from "../../ocr/extraction.js";
import { OcrFieldPathSchema, type OcrFormType } from "../../ocr/form-registry.js";
import { PDF_PAGE_LIMIT } from "../../processing/extraction/extract-pdf-pages.js";
import { bindCanonicalManualOcrReading } from "../ocr/page-accounting.js";
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

export const OCR_MANUAL_PAGE_EXAMPLE = '{"pageKind":"blank","readAt":"2026-01-01T00:00:00Z","record":null}';
export const OCR_MANUAL_DOCUMENT_EXAMPLE = '{"sourcePage":1,"pageKind":"blank","readAt":"2026-01-01T00:00:00Z","record":null}';

export function parseManualOcrPageValues(value: string) {
  return ManualOcrPageValuesSchema.parse(JSON.parse(value));
}

export function parseManualOcrDocumentValues(lines: readonly string[]) {
  return z.array(z.string()).min(1).max(PDF_PAGE_LIMIT).parse(lines).map((line, index) => {
    const { sourcePage, ...values } = ManualOcrDocumentPageValuesSchema.parse(JSON.parse(line));
    if (sourcePage !== index + 1) throw new Error("Enter one reading for each original page in order.");
    return { sourcePage, values };
  });
}

export function admitManualOcrPageValues(formType: OcrFormType, sourcePage: number, sourceSha256: string,
  actorId: string, values: z.output<typeof ManualOcrPageValuesSchema>) {
  const record = values.record === null ? null : { answers: Object.fromEntries(values.record.answers.map(({ path, answer }) => [path, answer])) };
  const admitted = admitOcrExtraction({ ...values, formType, record, sourcePage, sourceSha256, source: { kind: "operator", actorId } });
  if (!admitted.admitted) throw new Error("The manual reading does not match the declared form and page kind.");
  return admitted.extraction;
}

export function manualOcrPageInput(page: OcrPageInput, actorId: string, values: z.output<typeof ManualOcrPageValuesSchema>) {
  const admitted = admitManualOcrPageValues(page.formType, page.sourcePage, page.image.sha256, actorId, values);
  const { extraction } = bindCanonicalManualOcrReading(page, actorId, admitted);
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
