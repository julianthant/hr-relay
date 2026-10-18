import { titleCasePersonName } from "../../fields/cell-coercion.js";
import { ERROR_CATALOG, type ErrorCatalogCode } from "../../failures/error-catalog.js";
import { z } from "zod";
import { CANONICAL_FIELDS } from "../../fields/registry.js";
import { EidSchema } from "../../../rules/identity/ids.js";
import { defineCanonicalInput } from "../../workflow/canonical-input.js";

const name = CANONICAL_FIELDS.fullName.schema;
const search = {
  mode: z.literal("search").default("search"),
  crmCheck: z.boolean().default(true),
  keepNonHdh: z.boolean().default(false),
  includeCrmDates: z.boolean().default(false),
};
const match = {
  mode: z.literal("match"),
  lastName: z.string().trim().min(1),
  firstName: z.string().trim().min(1),
  dob: z.string().trim().min(1).refine((value) => !/^x$/iu.test(value), "Missing DOB must be omitted").optional(),
  ssn: CANONICAL_FIELDS.ssn.schema.optional(),
  crmCheck: z.boolean().default(false),
  includeCrmDates: z.literal(false).default(false),
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
const canonicalSearch = { mode: z.literal("search"), crmCheck: z.boolean(), keepNonHdh: z.boolean(), includeCrmDates: z.boolean() };
export const PersonLookupCanonicalInput = defineCanonicalInput(PersonLookupInput, z.union([
  z.strictObject({ ...canonicalSearch, name }),
  z.strictObject({ ...canonicalSearch, emplId: EidSchema, name: name.optional() }),
  z.strictObject({ mode: z.literal("match"), lastName: z.string().min(1).refine(value => value.trim() === value && value.trim().length > 0), firstName: z.string().min(1).refine(value => value.trim() === value && value.trim().length > 0), dob: z.string().min(1).refine((value) => value.trim() === value && !/^x$/iu.test(value), "Missing DOB must be omitted").optional(), ssn: z.string().regex(/^\d{9}$/u).optional(), crmCheck: z.boolean(), includeCrmDates: z.literal(false) }),
]).superRefine(validateOptions), [{ name: "Example, Person" }, { emplId: "10000001" }, { mode: "match", lastName: "Example", firstName: "Person", dob: "01/15/2000" }]);
export type PersonLookupInputValue = z.output<typeof PersonLookupInput>;

export class PersonLookupMatchInputError extends Error {
  constructor(readonly code: Extract<ErrorCatalogCode, "PERSON_LOOKUP_MATCH_INPUT_MISSING_IDENTIFIERS"> = "PERSON_LOOKUP_MATCH_INPUT_MISSING_IDENTIFIERS") { super(ERROR_CATALOG[code].text); this.name = "PersonLookupMatchInputError"; }
}

/** Returns canonical people for the generic start planner; sensitive tuples stay out of display identity. */
export function parsePersonLookupRequest(text: string, options: Readonly<{
  mode?: "search" | "match"; crmCheck?: boolean; includeCrmDates?: boolean;
}> = {}): readonly PersonLookupInputValue[] {
  const mode = options.mode ?? "search";
  const entries = text.split(mode === "match" ? /;/u : /[;\n]/u).map((entry) => entry.trim()).filter(Boolean);
  if (entries.length === 0) throw new Error("Person Lookup input is empty.");
  const people = new Map<string, PersonLookupInputValue>();
  for (const entry of entries) {
    let input: PersonLookupInputValue;
    if (mode === "search") {
      input = PersonLookupInput.parse({ mode, ...(/^10\d{6}$/u.test(entry) ? { emplId: entry } : { name: entry }),
        ...(options.crmCheck === undefined ? {} : { crmCheck: options.crmCheck }),
        ...(options.includeCrmDates === undefined ? {} : { includeCrmDates: options.includeCrmDates }) });
    } else {
      const fields = entry.split(",").map((field) => field.trim());
      if (fields.length < 3) throw new PersonLookupMatchInputError();
      const ssn = fields.pop();
      const dob = fields.pop();
      const legalName = fields.join(", ");
      const parts = legalName.split(",").map((part) => part.trim());
      const lastName = parts.length > 1 ? parts[0] : legalName.split(/\s+/u).at(-1);
      const firstName = parts.length > 1 ? parts.slice(1).join(", ").trim() : legalName.split(/\s+/u).slice(0, -1).join(" ");
      const identifiers = {
        ...(dob === undefined || /^x$/iu.test(dob) || dob === "" ? {} : { dob }),
        ...(ssn === undefined || /^x$/iu.test(ssn) || ssn === "" ? {} : { ssn }),
      };
      if (Object.keys(identifiers).length === 0) throw new PersonLookupMatchInputError();
      input = PersonLookupInput.parse({ mode, lastName, firstName, ...identifiers,
        ...(options.crmCheck === undefined ? {} : { crmCheck: options.crmCheck }),
        ...(options.includeCrmDates === undefined ? {} : { includeCrmDates: options.includeCrmDates }) });
    }
    const identity = input.mode === "match" ? JSON.stringify([input.lastName, input.firstName, input.dob, input.ssn])
      : "emplId" in input ? ["eid", input.emplId].join(":") : `name:${input.name}`;
    const key = identity.toLowerCase().replace(/\s+/gu, " ");
    if (!people.has(key)) people.set(key, input);
  }
  return [...people.values()];
}

export function personLookupTitle(input: PersonLookupInputValue): string {
  const title = input.mode === "match" ? `${input.lastName}, ${input.firstName}` : "emplId" in input ? input.emplId : input.name;
  return titleCasePersonName(title);
}

export function personLookupSearchText(input: PersonLookupInputValue): string {
  return input.mode === "match" ? `${input.lastName}, ${input.firstName}, ${input.dob === undefined ? "x" : input.dob}, ${input.ssn === undefined ? "x" : "[masked]"}` : personLookupTitle(input);
}
