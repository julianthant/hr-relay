import { z } from "zod";
import { OcrFormTypeSchema } from "../../ocr/form-registry.js";
import { ItemIdSchema, RunIdSchema } from "../../../rules/identity/ids.js";
import { OcrPageInputSchema } from "./source-manifest.js";
import { OcrRosterEvidenceSchema } from "./review-seed.js";
import { ManualOcrAssertionSchema, OCR_PAGE_EXAMPLE } from "../ocr-page/input.js";

export const OcrInputSchema = z.strictObject({
  sourceRunId: RunIdSchema.optional(),
  approval: z.enum(["review-only", "release"]).default("review-only"),
  document: OcrPageInputSchema.shape.document,
  readingId: ItemIdSchema,
  formType: OcrFormTypeSchema,
  roster: OcrRosterEvidenceSchema.nullable(),
  reading: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("subscription") }),
    z.strictObject({ kind: z.literal("manual"), actorId: z.string().min(1), assertions: z.array(ManualOcrAssertionSchema).min(1) }),
  ]),
});
export const OcrCanonicalInputSchema = OcrInputSchema.extend({ approval: OcrInputSchema.shape.approval.removeDefault() });
export const OCR_INPUT_EXAMPLE = OcrInputSchema.parse({
  document: OCR_PAGE_EXAMPLE.page.document, readingId: OCR_PAGE_EXAMPLE.page.readingId,
  formType: "emergency-contact", roster: null, reading: { kind: "subscription" } });
