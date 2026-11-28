import { z } from "zod";
import { OcrFormTypeSchema } from "../../ocr/form-registry.js";
import { ItemIdSchema, RunIdSchema } from "../../../rules/identity/ids.js";
import { OcrPageInputSchema } from "./source-manifest.js";
import { OcrWorkbookRosterEvidenceSchema } from "./roster.js";
import { ManualOcrAssertionSchema, ManualOcrDraftAssertionSchema, OCR_PAGE_EXAMPLE } from "../ocr-page/input.js";
import { defineCanonicalInput } from "../../workflow/canonical-input.js";
import { OcrSourceUploadSchema } from "../../ocr/review.js";
import { PDF_PAGE_LIMIT } from "../../processing/extraction/extract-pdf-pages.js";

const Subscription = z.strictObject({ kind: z.literal("subscription") });
const Manual = z.strictObject({ kind: z.literal("manual"), actorId: z.string().min(1), assertions: z.array(ManualOcrAssertionSchema).min(1) });
export const OcrParentInputSchema = z.strictObject({
  sourceRunId: RunIdSchema.optional(),
  approval: z.enum(["review-only", "release"]).default("review-only"),
  document: OcrPageInputSchema.shape.document,
  fileName: OcrSourceUploadSchema.shape.fileName.optional(),
  readingId: ItemIdSchema,
  formType: OcrFormTypeSchema,
  roster: OcrWorkbookRosterEvidenceSchema.nullable(),
  rosterChoice: z.enum(["not-required", "required"]).default("not-required"),
  extractWithOcr: z.boolean().optional(),
  reading: z.discriminatedUnion("kind", [Subscription, Manual]),
});
export const OcrInputSchema = OcrParentInputSchema.extend({
  assertedPageCount: z.number().int().min(1).max(PDF_PAGE_LIMIT).optional(),
  reading: z.discriminatedUnion("kind", [
    Subscription,
    Manual.extend({ assertions: z.array(z.union([ManualOcrAssertionSchema, ManualOcrDraftAssertionSchema])).min(1) }),
  ]),
});
export const OcrCanonicalInputSchema = OcrInputSchema.extend({ approval: OcrInputSchema.shape.approval.removeDefault(), rosterChoice: OcrInputSchema.shape.rosterChoice.removeDefault() });
export const OCR_INPUT_EXAMPLE = OcrParentInputSchema.parse({
  document: OCR_PAGE_EXAMPLE.page.document, readingId: OCR_PAGE_EXAMPLE.page.readingId,
  formType: "emergency-contact", roster: null, reading: { kind: "subscription" } });
export const OcrCanonicalInput = defineCanonicalInput(OcrInputSchema, OcrCanonicalInputSchema, [OCR_INPUT_EXAMPLE]);

export const usesOcrProvider = (input: Pick<z.output<typeof OcrInputSchema>, "reading" | "extractWithOcr">): boolean =>
  input.extractWithOcr !== false && input.reading.kind === "subscription";
