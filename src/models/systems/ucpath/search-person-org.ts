/** A discriminated union, not "a candidate or null with a status beside it": resolved, ambiguous and not-found are three outcomes, and ambiguity is one nothing downstream may auto-resolve. */
import { z } from "zod";
import { EidSchema, taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";



export const UcpathCandidateSchema = z.strictObject({
  emplId: EidSchema,
  name: z.string().min(1),
  department: z.string().min(1),
  jobTitle: z.string().min(1),
  employeeStatus: z.enum(["active", "inactive", "terminated", "unknown"]),
  /** Housing/Dining/Hospitality affiliation, which the operator can choose to keep. */
  hdh: z.boolean(),
  hrStatus: z.string(),
  startDate: z.string(),
  effectiveDate: z.string(),
  terminationDate: z.string(),
  terminationReason: z.string(),
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
  id: taskId("ucpath/search-person-org"),
  title: "Searching",
  effect: "read",
  input: SearchPersonOrgInputSchema,
  output: SearchPersonOrgOutputSchema,
  errorCodes: ["BROWSER_SCREENSHOT_CAPTURE_FAILED", "PERSON_LOOKUP_UCPATH_SEARCH_FAILED"],
  // Name search resolves identity; it cannot require an already-known EID.
  subject: { kind: "none", reason: "the person search resolves identity rather than confirming it" },
  freshness: {
    // Person/org rows change on HR action, not continuously; four hours is short
    // enough that a same-day replay is re-read before it can feed a write.
    defaultMaxAgeMs: 4 * 60 * 60 * 1000,
    defaultOverride: "forbidden",
  },
  provenance: { default: "live" },
  scenarios: [
    "person-lookup/s1",
    "person-lookup/s8",
    "person-lookup/s12",
    // Reject drill-back details whose EID differs from the selected row.
    "person-lookup/f1",
  ],
  example: {
    results: [{
      emplId: "10873698",
      name: "Battistessa, Johnnie",
      department: "Housing Dining Hospitality",
      jobTitle: "Dining Assistant",
      employeeStatus: "active",
      hdh: true,
      hrStatus: "Active", startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "",
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
        hrStatus: "Active", startDate: "", effectiveDate: "", terminationDate: "", terminationReason: "",
      },
      candidateEids: ["10873698"],
    },
  },
});
