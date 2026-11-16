import { z } from "zod";
import { deepFreeze } from "../../../rules/validation/immutability.js";
import { EidSchema } from "../../../rules/identity/ids.js";

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
export const I9CheckRowsSchema = z.strictObject({ rows: z.array(I9CheckRowSchema).min(1) });

export const I9_CHECK_TASK_POLICY = deepFreeze({
  effect: "read", errorCodes: ["I9_CHECK_DATA_INVALID"],
  subject: { kind: "none", reason: "Derives I-9 retention facts from declared observations" },
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" },
  provenance: { default: "derived" }, scenarios: [],
} as const);
