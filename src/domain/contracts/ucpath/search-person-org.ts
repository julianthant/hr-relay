/**
 * `ucpath/search-person-org` — doc 01 §9.1's contract, consumed verbatim by
 * doc 02 §8's person-lookup graph.
 *
 * The selection is a discriminated union, not "a candidate or null with a
 * status beside it". Resolved, ambiguous, and not-found are three different
 * outcomes with three different downstream consequences, and a shape that lets
 * `selected: null` coexist with `status: "resolved"` is a shape where a caller
 * can act on a person nobody chose.
 *
 * `not-found` is a genuinely valid expected state — a search that returns no
 * rows really did succeed — so it is an outcome, not a throw. Ambiguity is
 * likewise an outcome, and one nothing downstream may auto-resolve.
 */
import { z } from "zod";
import { EidSchema, TaskIdSchema } from "../../ids.js";
import { defineTaskContract } from "../base.js";

export const UcpathCandidateSchema = z.strictObject({
  emplId: EidSchema,
  name: z.string().min(1),
  department: z.string().min(1),
  jobTitle: z.string().min(1),
  employeeStatus: z.enum(["active", "inactive", "terminated", "unknown"]),
  /** Housing/Dining/Hospitality affiliation, which the operator can choose to keep. */
  hdh: z.boolean(),
});
export type UcpathCandidate = z.infer<typeof UcpathCandidateSchema>;

export const UcpathPersonSelectionSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("resolved"),
    selected: UcpathCandidateSchema,
    candidateEids: z.array(EidSchema).min(1),
  }),
  z.strictObject({
    status: z.literal("ambiguous"),
    selected: z.null(),
    candidateEids: z.array(EidSchema).min(2),
    searchName: z.string().min(1),
  }),
  z.strictObject({
    status: z.literal("not-found"),
    selected: z.null(),
    candidateEids: z.array(EidSchema).max(0),
    searchName: z.string().min(1),
  }),
]);
export type UcpathPersonSelection = z.infer<typeof UcpathPersonSelectionSchema>;

export const SearchPersonOrgInputSchema = z.union([
  z.strictObject({ kind: z.literal("by-eid"), emplId: EidSchema }),
  z.strictObject({ kind: z.literal("by-name"), name: z.string().min(1), keepNonHdh: z.boolean() }),
]);

export const SearchPersonOrgOutputSchema = z.strictObject({
  results: z.array(UcpathCandidateSchema),
  selection: UcpathPersonSelectionSchema,
});
export type SearchPersonOrgOutput = z.infer<typeof SearchPersonOrgOutputSchema>;

export const SearchPersonOrg = defineTaskContract({
  id: TaskIdSchema.parse("ucpath/search-person-org"),
  title: "Searching",
  effect: "read",
  input: SearchPersonOrgInputSchema,
  output: SearchPersonOrgOutputSchema,
  errorCodes: ["search-unavailable", "unexpected-page-state"],
  // The search IS the identity-resolution step, so there is no prior subject to
  // bind against: the by-name arm has no EID to expect, and requiring one would
  // force every caller to already know the answer.
  subject: { kind: "none", reason: "the person search resolves identity rather than confirming it" },
  freshness: {
    // Person/org rows change on HR action, not continuously; four hours is short
    // enough that a same-day replay is re-read before it can feed a write.
    defaultMaxAgeMs: 4 * 60 * 60 * 1000,
    defaultOverride: "forbidden",
  },
  provenance: { default: "live" },
  scenarios: [
    "person-lookup/search-by-eid",
    "person-lookup/search-ambiguous-name",
    "person-lookup/search-not-found",
  ],
  example: {
    results: [{
      emplId: "10873698",
      name: "Battistessa, Johnnie",
      department: "Housing Dining Hospitality",
      jobTitle: "Dining Assistant",
      employeeStatus: "active",
      hdh: true,
    }],
    selection: {
      status: "resolved",
      selected: {
        emplId: "10873698",
        name: "Battistessa, Johnnie",
        department: "Housing Dining Hospitality",
        jobTitle: "Dining Assistant",
        employeeStatus: "active",
        hdh: true,
      },
      candidateEids: ["10873698"],
    },
  },
});
