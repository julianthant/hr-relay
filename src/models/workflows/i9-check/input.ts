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
const personFields = {
  name: text, firstName: text.optional(), lastName: text.optional(),
  dob: DateOnlySchema.optional(), ssn: CANONICAL_FIELDS.ssn.schema.optional(),
  hireDate: DateOnlySchema.optional(), sourcePages: z.array(z.number().int().positive()).min(1),
};
function useMatch(person: { firstName?: string; lastName?: string; dob?: string; ssn?: string }): boolean {
  return person.firstName !== undefined && person.lastName !== undefined && (person.dob !== undefined || person.ssn !== undefined);
}
export const I9CheckPersonSchema = z.strictObject({ ...personFields, useMatch: z.boolean() })
  .refine(person => person.useMatch === useMatch(person), "Search mode contradicts the supplied identifiers");
const fields = {
  ocrRunId: RunIdSchema, recordId: text,
  roster: z.strictObject({ rows: z.array(I9RosterRowSchema), seed: I9RosterSeedSchema.optional() }),
  asOf: DateOnlySchema, reviewerName: text,
};
export const I9CheckInput = z.strictObject({ ...fields,
  person: z.strictObject({ ...personFields, useMatch: z.boolean().default(false) })
    .overwrite(person => ({ ...person, useMatch: useMatch(person) })),
});
export const I9CheckCanonicalInput = defineCanonicalInput(I9CheckInput, z.strictObject({ ...fields, person: I9CheckPersonSchema }), [{
  ocrRunId: "00000000-0000-4000-8000-000000000001", recordId: "record-1",
  person: { name: "Example, Person", sourcePages: [1] }, roster: { rows: [] },
  asOf: "2026-11-01", reviewerName: "Example Reviewer",
}]);
export type I9CheckInputValue = z.output<typeof I9CheckInput>;
export function i9CheckMatchKey(input: Pick<I9CheckInputValue, "ocrRunId" | "recordId">): string {
  return `${input.ocrRunId}:${input.recordId}`;
}
