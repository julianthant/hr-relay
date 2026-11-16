import { z } from "zod";
import { AdmittedExtractionSchema } from "./extraction.js";
import { OcrPageReadingSchema } from "../workflows/ocr/page-accounting.js";

export const StoredOcrExtractionSchema = z.union([
  OcrPageReadingSchema.safeExtend({ binding: z.literal("source-bound") }),
  z.strictObject({ binding: z.literal("unbound-source"), extractionId: z.string().min(1),
    extraction: AdmittedExtractionSchema }).superRefine((record, context) => {
    const extraction = record.extraction;
    if (record.extractionId !== `${extraction.sourceSha256}#${String(extraction.sourcePage)}#${extraction.formType}`) {
      context.addIssue({ code: "custom", message: "Unbound OCR evidence must retain its original artifact identity" });
    }
  }),
]);
export type StoredOcrExtraction = z.infer<typeof StoredOcrExtractionSchema>;
