import { ERROR_CATALOG, type ErrorCatalogCode } from "../../failures/error-catalog.js";
import { z } from "zod";
import { EidSchema, taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { CANONICAL_FIELDS } from "../../fields/registry.js";

export const UcpathMatchHitSchema = z.strictObject({ emplId: EidSchema, name: z.string().min(1) });
export const SearchPersonMatchOutputSchema = z.strictObject({
  hits: z.array(UcpathMatchHitSchema), confirmed: z.array(UcpathMatchHitSchema),
  dropped: z.array(z.strictObject({ ...UcpathMatchHitSchema.shape, reason: z.string().min(1) })),
});
export const SearchPersonMatch = defineTaskContract({
  id: taskId("ucpath/search-person-match"), title: "Search for person", effect: "read",
  input: z.strictObject({ lastName: z.string().min(1), firstName: z.string().min(1), dob: z.string().optional(), ssn: CANONICAL_FIELDS.ssn.schema.optional() })
    .refine((input) => input.dob !== undefined || input.ssn !== undefined, "Match requires a date of birth or SSN"),
  output: SearchPersonMatchOutputSchema, errorCodes: ["BROWSER_SCREENSHOT_CAPTURE_FAILED", "PERSON_LOOKUP_UCPATH_SEARCH_FAILED"],
  subject: { kind: "none", reason: "Match resolves identity through HR Tasks and Person Org confirmation" },
  freshness: { defaultMaxAgeMs: 1.44e7, defaultOverride: "forbidden" }, provenance: { default: "live" },
  scenarios: ["person-lookup/m1", "person-lookup/m1b", "person-lookup/m2", "person-lookup/m3"],
  example: { hits: [], confirmed: [], dropped: [] },
});

export class PersonLookupUcpathSearchError extends Error {
  constructor(cause: unknown, readonly code: Extract<ErrorCatalogCode, "PERSON_LOOKUP_UCPATH_SEARCH_FAILED"> = "PERSON_LOOKUP_UCPATH_SEARCH_FAILED") { super(ERROR_CATALOG[code].text, { cause }); this.name = "PersonLookupUcpathSearchError"; }
}
