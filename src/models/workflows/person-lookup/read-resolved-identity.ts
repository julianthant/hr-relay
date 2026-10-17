import { z } from "zod";
import { EidSchema, taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { SearchPersonOrgOutputSchema, UcpathCandidateSchema } from "../../systems/ucpath/search-person-org.js";
import { SearchPersonMatchOutputSchema } from "../../systems/ucpath/search-person-match.js";
import { CrmDiscoveredRecordSchema, CrmDiscoveryOutputSchema } from "../../systems/crm/search-onboarding-records.js";
import { PersonLookupInput } from "./input.js";

export const ResolvedIdentitySchema = z.strictObject({
  shouldCheckCrm: z.boolean(),
  ucpathFound: z.boolean(),
  crmErrorCode: z.string().nullable(),
  state: z.enum(["resolved", "crm-only", "multiple-matches", "not-found"]),
  crmIdentity: z.strictObject({ emplId: EidSchema, name: z.string().nullable(), department: z.string().nullable(), firstDayOfService: z.string().nullable() }).nullable(),
  unselectedCrmRecords: z.array(CrmDiscoveredRecordSchema).nullable(),
  selected: UcpathCandidateSchema.nullable(), crmRecord: CrmDiscoveredRecordSchema.nullable(),
  candidateEids: z.array(EidSchema), recoveryEid: EidSchema.nullable(),
  crmState: z.enum(["Found", "Not found", "Not checked", "Check failed"]),
  method: z.enum(["ucpath", "eid-match", "date-match", "crm-only", "multiple-matches", "no-match", "match"]),
});
export type ResolvedIdentity = z.output<typeof ResolvedIdentitySchema>;
export const ReadResolvedIdentity = defineTaskContract({
  id: taskId("workflow:person-lookup/read-resolved-identity"), title: "Identity cross-check", effect: "read",
  input: z.strictObject({ input: PersonLookupInput, person: SearchPersonOrgOutputSchema.optional(), match: SearchPersonMatchOutputSchema.optional(), crm: CrmDiscoveryOutputSchema.optional() }),
  output: ResolvedIdentitySchema, errorCodes: ["PERSON_LOOKUP_MULTIPLE_MATCHES"],
  subject: { kind: "none", reason: "pure resolution of exact system observations" },
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, provenance: { default: "derived" }, scenarios: [],
  example: { unselectedCrmRecords: null, shouldCheckCrm: false, ucpathFound: false, crmErrorCode: null, state: "not-found", crmIdentity: null, selected: null, crmRecord: null, candidateEids: [], recoveryEid: null, crmState: "Not checked", method: "no-match" },
});
