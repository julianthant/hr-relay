import { z } from "zod";
import { taskId, EidSchema } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { SearchPersonMatchOutputSchema } from "../../systems/ucpath/search-person-match.js";
import { SearchPersonOrgOutputSchema } from "../../systems/ucpath/search-person-org.js";
import { I9CheckCanonicalInput } from "./input.js";

export const I9IdentitySchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("found"), eid: EidSchema, name: z.string().min(1) }),
  z.strictObject({ status: z.literal("not-found"), candidateCount: z.number().int().nonnegative() }),
  z.strictObject({ status: z.literal("ambiguous"), candidateCount: z.number().int().positive(),
    candidateEids: z.array(EidSchema).min(1),
    reason: z.enum(["multiple-matches", "missing-hire-date", "multiple-hire-date-matches"]) }),
]);
export type I9Identity = z.output<typeof I9IdentitySchema>;
export const I9CheckRowSchema = z.strictObject({
  recordId: z.string().min(1), employeeName: z.string().min(1), ppsEid: z.string(),
  ucpathEmplId: z.string(), hireDate: z.string(), separationDate: z.string(),
  foundInUcpath: z.enum(["Yes", "Not found in UCPath", "Ambiguous in UCPath"]),
  action: z.enum(["", "Keep", "Shred"]), reviewerName: z.string().min(1), notes: z.string(),
});
export type I9CheckRow = z.output<typeof I9CheckRowSchema>;

const policy = {
  effect: "read", errorCodes: ["I9_CHECK_DATA_INVALID"],
  subject: { kind: "none", reason: "Derives I-9 retention facts from declared observations" },
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" },
  provenance: { default: "derived" }, scenarios: [],
} as const;
export const ReadMatchOutcome = defineTaskContract({
  ...policy, id: taskId("workflow:i9-check/read-match-outcome"), title: "Resolve identifier match",
  input: z.strictObject({ match: SearchPersonMatchOutputSchema.optional() }),
  output: z.strictObject({ identity: I9IdentitySchema, shouldLookup: z.boolean() }),
  example: { identity: { status: "not-found", candidateCount: 0 }, shouldLookup: true },
});
export const ReadRetentionRow = defineTaskContract({
  ...policy, id: taskId("workflow:i9-check/read-retention-row"), title: "Match roster and derive retention",
  input: z.strictObject({ input: I9CheckCanonicalInput, initial: I9IdentitySchema, search: SearchPersonOrgOutputSchema.optional() }),
  output: z.strictObject({ identity: I9IdentitySchema, row: I9CheckRowSchema }),
  example: { identity: { status: "not-found", candidateCount: 0 }, row: {
    recordId: "record-1", employeeName: "Example, Person", ppsEid: "", ucpathEmplId: "", hireDate: "",
    separationDate: "", foundInUcpath: "Not found in UCPath", action: "Shred", reviewerName: "Example Reviewer", notes: "",
  } },
});
