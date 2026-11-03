import { z } from "zod";
import { defineCanonicalInput } from "../../workflow/canonical-input.js";
import { DateOnlySchema } from "../../../rules/identity/ids.js";
import { OcrInputSchema, OCR_INPUT_EXAMPLE } from "../ocr/input.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { deepFreeze } from "../../../rules/validation/immutability.js";
import { OcrSourceUploadSchema } from "../../ocr/review.js";

const documentFields = OcrInputSchema.pick({ document: true, readingId: true, reading: true }).extend({ fileName: OcrSourceUploadSchema.shape.fileName });
const documents = <Schema extends z.ZodType<{ document: { sha256: string } }>>(schema: Schema) => z.array(schema).min(1)
  .refine(values => new Set(values.map(value => value.document.sha256)).size === values.length, "Attach each PDF once");
const fields = { asOf: DateOnlySchema, reviewerName: z.string().min(1).refine(value => value.trim() === value) };
export const I9CheckStartInput = z.strictObject({ ...fields,
  documents: documents(documentFields.extend({ reading: documentFields.shape.reading.default({ kind: "subscription" }) })),
});
export const I9_CHECK_START_EXAMPLE = I9CheckStartInput.parse({
  documents: [{ document: OCR_INPUT_EXAMPLE.document, readingId: OCR_INPUT_EXAMPLE.readingId, fileName: "source.pdf" }],
  asOf: "2026-11-01", reviewerName: "Example Reviewer",
});
export const I9CheckStartCanonicalInput = defineCanonicalInput(I9CheckStartInput,
  z.strictObject({ ...fields, documents: documents(documentFields) }), [I9_CHECK_START_EXAMPLE]);
export type I9CheckStartInputValue = z.output<typeof I9CheckStartInput>;
export const I9_CHECK_REFERENCE = deepFreeze({ typeId: "action-history", fields: ["eid", "ppsEid", "separationDate", "roster.action"] } as const);
export function i9CheckStartMatchKey(input: I9CheckStartInputValue): string {
  return sha256Hex(canonicalJsonStringify(input.documents.map(document => [document.document.sha256, document.readingId]).toSorted((left, right) => left[0].localeCompare(right[0]))));
}
