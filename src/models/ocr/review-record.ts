import { z } from "zod";
import { AdmittedRecordSchema } from "./extraction.js";
import { CommandIdSchema, EidSchema, IsoInstantSchema, PositiveIntSchema, StableRecordIdSchema } from "../../rules/identity/ids.js";

export const OcrOperatorPagesSchema = z.array(z.strictObject({
  pageKind: z.enum(["oath", "emergency-contact", "i9-section1", "i9-section2"]), sourcePage: PositiveIntSchema,
})).min(1).max(2);

export const OcrReviewRecordSchema = z.strictObject({
  recordId: StableRecordIdSchema,
  fields: AdmittedRecordSchema,
  assertedEid: EidSchema.nullable(),
  discarded: z.boolean(),
  provenance: z.strictObject({ kind: z.literal("operator-added"), commandId: CommandIdSchema, createdAt: IsoInstantSchema, pages: OcrOperatorPagesSchema }).optional(),
});
export type OcrReviewRecord = z.output<typeof OcrReviewRecordSchema>;

export function ocrRecordSourcePages(sources: readonly { recordId: string; sourcePage: number }[], record: z.output<typeof OcrReviewRecordSchema>) {
  if (record.provenance !== undefined) return [...new Set(record.provenance.pages.map(page => page.sourcePage))];
  const source = sources.find(source => source.recordId === record.recordId);
  if (source === undefined) throw new Error("ocr-review-record-source-missing");
  return [source.sourcePage];
}
