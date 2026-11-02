import { z } from "zod";
import { DateOnlySchema, EidSchema, RunIdSchema } from "../../../rules/identity/ids.js";
import { defineCanonicalInput } from "../../workflow/canonical-input.js";
import { CANONICAL_FIELDS } from "../../fields/registry.js";

const text = z.string().min(1).refine(value => value.trim() === value);
export const I9RosterRowSchema = z.strictObject({
  eid: EidSchema, ppsEid: z.string().regex(/^\d{1,9}$/u),
  separationDate: DateOnlySchema.nullable(), action: z.string(),
});
export const I9RosterSeedSchema = z.strictObject({
  ppsEid: z.string().regex(/^\d{1,9}$/u).optional(),
  separationDate: DateOnlySchema.optional(),
});
export const I9CheckInput = z.strictObject({
  ocrRunId: RunIdSchema, recordId: text,
  person: z.strictObject({
    name: text, firstName: text.optional(), lastName: text.optional(),
    dob: DateOnlySchema.optional(), ssn: CANONICAL_FIELDS.ssn.schema.optional(),
    hireDate: DateOnlySchema.optional(), sourcePages: z.array(z.number().int().positive()).min(1),
  }),
  roster: z.strictObject({ rows: z.array(I9RosterRowSchema), seed: I9RosterSeedSchema.optional() }),
  asOf: DateOnlySchema, reviewerName: text,
});
export const I9CheckCanonicalInput = defineCanonicalInput(I9CheckInput, I9CheckInput, [{
  ocrRunId: "00000000-0000-4000-8000-000000000001", recordId: "record-1",
  person: { name: "Example, Person", sourcePages: [1] }, roster: { rows: [] },
  asOf: "2026-11-01", reviewerName: "Example Reviewer",
}]);
export type I9CheckInputValue = z.output<typeof I9CheckInput>;
