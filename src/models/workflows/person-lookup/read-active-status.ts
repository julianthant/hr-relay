import { CrmDiscoveryOutputSchema } from "../../systems/crm/search-onboarding-records.js";
import { z } from "zod";
import { taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { PersonLookupInput } from "./input.js";
import { ResolvedIdentitySchema } from "./read-resolved-identity.js";
import { SearchPersonOrgOutputSchema } from "../../systems/ucpath/search-person-org.js";
import { SearchPersonMatchOutputSchema } from "../../systems/ucpath/search-person-match.js";

export const PersonLookupDetailSchema = z.strictObject({
  search: z.string(), name: z.string().nullable(), eid: z.string().nullable(), department: z.string().nullable(),
  hrStatus: z.string().nullable(), ucpath: z.enum(["Found", "Not found"]), crm: z.enum(["Found", "Not found", "Not checked", "Check failed"]),
  startDate: z.string().nullable(), endDate: z.string().nullable(), terminationReason: z.string().nullable(),
  foundInUcpath: z.boolean().nullable(), matchedEid: z.string().nullable(), matchedName: z.string().nullable(),
});
export const ActiveStatusOutcomeSchema = z.strictObject({
  ucpathSelection: z.enum(["resolved", "ambiguous", "not-found"]),
  datesEid: z.string().nullable(),
  state: z.enum(["active", "inactive", "crm-only", "multiple-matches", "not-found", "undetermined", "found", "not-found-in-ucpath"]),
  reason: z.string(), code: z.string().nullable(), hdh: z.boolean().nullable(), candidateEids: z.array(z.string()), details: PersonLookupDetailSchema,
});
export type ActiveStatusOutcome = z.output<typeof ActiveStatusOutcomeSchema>;
export const ReadActiveStatus = defineTaskContract({
  id: taskId("workflow:person-lookup/read-active-status"), title: "Read employment status", effect: "read",
  input: z.strictObject({ input: PersonLookupInput, identity: ResolvedIdentitySchema, verifiedCrm: CrmDiscoveryOutputSchema.optional(), recovered: SearchPersonOrgOutputSchema.optional(), match: SearchPersonMatchOutputSchema.optional() }),
  output: ActiveStatusOutcomeSchema, errorCodes: ["person-lookup-employment-status-undetermined", "inconsistent-inputs"],
  subject: { kind: "none", reason: "pure fold of this run's UCPath and CRM facts" },
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, provenance: { default: "derived" }, scenarios: [],
  example: { ucpathSelection: "not-found", datesEid: null, state: "not-found", reason: "Person not found.", code: "person-lookup-not-found", hdh: null, candidateEids: [], details: {
    search: "Example, Person", name: null, eid: null, department: null, hrStatus: null, ucpath: "Not found", crm: "Not found",
    startDate: null, endDate: null, terminationReason: null, foundInUcpath: null, matchedEid: null, matchedName: null,
  } },
});
