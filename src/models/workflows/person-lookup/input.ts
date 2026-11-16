import { titleCasePersonName } from "../../fields/cell-coercion.js";
import { z } from "zod";
import { CANONICAL_FIELDS } from "../../fields/registry.js";
import { EidSchema } from "../../../rules/identity/ids.js";
import { defineCanonicalInput } from "../../workflow/canonical-input.js";

const name = CANONICAL_FIELDS.fullName.schema;
export const PERSON_LOOKUP_EXAMPLE_EID = "10000001";
const search = {
  mode: z.literal("search").default("search"),
  crmCheck: z.boolean().default(true),
  keepNonHdh: z.boolean().default(false),
  includeCrmDates: z.boolean().default(false),
};
const matchDefaults = {
  crmCheck: z.boolean().default(false),
  includeCrmDates: z.literal(false).default(false),
};
const match = {
  mode: z.literal("match"),
  lastName: z.string().trim().min(1),
  firstName: z.string().trim().min(1),
  dob: z.string().trim().min(1).refine((value) => !/^x$/iu.test(value), "Missing DOB must be omitted").optional(),
  ssn: CANONICAL_FIELDS.ssn.schema.optional(),
  ...matchDefaults,
};
export const PersonLookupInput = z.union([
  z.strictObject({ ...search, name }),
  z.strictObject({ ...search, emplId: EidSchema, name: name.optional() }),
  z.strictObject(match),
]).superRefine(validateOptions);
function validateOptions(input: PersonLookupInputValue, ctx: z.RefinementCtx): void {
  if (input.mode === "match" && input.dob === undefined && input.ssn === undefined) ctx.addIssue({ code: "custom", message: "Match requires a date of birth or SSN" });
  if (input.includeCrmDates && !input.crmCheck) ctx.addIssue({ code: "custom", message: "CRM dates require CRM check" });
}
/** The canonical snapshot stores every defaulted field, so its schema is the ingress field without the default. */
function withoutDefaults<Shape extends Record<string, z.ZodDefault>>(shape: Shape): { [Key in keyof Shape]: ReturnType<Shape[Key]["unwrap"]> } {
  return Object.fromEntries(Object.entries(shape).map(([key, field]) => [key, field.unwrap()])) as { [Key in keyof Shape]: ReturnType<Shape[Key]["unwrap"]> };
}
const trimmedText = () => z.string().min(1).refine(value => value.trim() === value && value.trim().length > 0);
const canonicalSearch = withoutDefaults(search);
export const PersonLookupCanonicalInput = defineCanonicalInput(PersonLookupInput, z.union([
  z.strictObject({ ...canonicalSearch, name }),
  z.strictObject({ ...canonicalSearch, emplId: EidSchema, name: name.optional() }),
  z.strictObject({ mode: match.mode, lastName: trimmedText(), firstName: trimmedText(), dob: z.string().min(1).refine((value) => value.trim() === value && !/^x$/iu.test(value), "Missing DOB must be omitted").optional(), ssn: z.string().regex(/^\d{9}$/u).optional(), ...withoutDefaults(matchDefaults) }),
]).superRefine(validateOptions), [{ name: "Example, Person" }, { emplId: PERSON_LOOKUP_EXAMPLE_EID }, { mode: "match", lastName: "Example", firstName: "Person", dob: "01/15/2000" }]);
export type PersonLookupInputValue = z.output<typeof PersonLookupInput>;

export function personLookupTitle(input: PersonLookupInputValue): string {
  const title = input.mode === "match" ? `${input.lastName}, ${input.firstName}` : "emplId" in input ? input.emplId : input.name;
  return titleCasePersonName(title);
}

export function personLookupSearchText(input: PersonLookupInputValue): string {
  return input.mode === "match" ? `${input.lastName}, ${input.firstName}, ${input.dob === undefined ? "x" : input.dob}, ${input.ssn === undefined ? "x" : "[masked]"}` : personLookupTitle(input);
}
