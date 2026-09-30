/**
 * `ucpath/search-person-org` — ref task-contract §9.1's contract, consumed verbatim by
 * ref workflow-model §8's person-lookup graph.
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
import { EidSchema, taskId } from "../../ids.js";
import { defineTaskContract } from "../base.js";
import type { TaskOperationDeclaration } from "../../workflow/operation-display.js";
import {
  UCPATH_PERSON_ORG_EID_INPUT,
  UCPATH_PERSON_ORG_RESULTS_GRID,
  UCPATH_PERSON_ORG_SEARCH_BUTTON,
  UCPATH_PERSON_ORG_SEARCH_SCREEN,
} from "../../ui/ucpath-person-org.js";

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
  id: taskId("ucpath/search-person-org"),
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
  operation: {
    version: 1,
    id: "person-org-search",
    system: "ucpath",
    session: { kind: "browser", id: "ucpath-worker", system: "ucpath" },
    page: { screen: UCPATH_PERSON_ORG_SEARCH_SCREEN, form: "person-org-search" },
    values: [
      { id: "search-kind", source: { kind: "contract-input", path: "kind" } },
      { id: "empl-id", presentation: "local-operator", source: { kind: "contract-input", path: "emplId", availability: "offered" } },
      { id: "name", source: { kind: "contract-input", path: "name", availability: "offered" } },
      { id: "selection-status", presentation: "local-operator", source: { kind: "contract-output", path: "selection.status" } },
    ],
    templates: [{
      id: "search-summary",
      variables: [{ id: "kind", slot: "search-kind" }],
      segments: [{ kind: "literal", value: "Search mode" }, { kind: "variable", variable: "kind" }],
      join: { separator: ": ", trim: "outer" },
    }],
    transforms: [{
      id: "selection-summary",
      input: z.strictObject({ status: z.string().min(1) }),
      output: z.strictObject({ text: z.string().min(1) }),
      example: { status: "resolved" },
      derive: (input) => {
        const { status } = z.strictObject({ status: z.string().min(1) }).parse(input);
        return { text: `Selection ${status}` };
      },
    }],
    actions: [{
      id: "open-search",
      kind: "open-page",
    }, {
      id: "choose-search-mode",
      kind: "branch",
      outcomes: [{
        id: "by-eid",
        label: "Search by EID",
        when: { kind: "equals", variable: "search-kind", value: "by-eid" },
        continuation: "fill-eid",
      }, {
        id: "by-name",
        label: "Search by name",
        when: { kind: "equals", variable: "search-kind", value: "by-name" },
        continuation: "run-search",
      }],
    }, {
      id: "fill-eid",
      kind: "fill-field",
      target: UCPATH_PERSON_ORG_EID_INPUT,
      valueSlot: "empl-id",
    }, {
      id: "run-search",
      kind: "click",
      target: UCPATH_PERSON_ORG_SEARCH_BUTTON,
      children: [{
        id: "read-selection",
        kind: "read-field",
        target: UCPATH_PERSON_ORG_RESULTS_GRID,
        valueSlot: "selection-status",
      }, {
        id: "summarize-selection",
        kind: "compute",
        transform: "selection-summary",
      }],
    }],
  } satisfies TaskOperationDeclaration,
  scenarios: [
    "person-lookup/happy-by-eid",
    "person-lookup/ambiguous-name",
    "person-lookup/not-found",
    // The drill-back subject check is this contract's own behaviour: a detail
    // page displaying a different EID never becomes a candidate. It mirrors
    // `person-lookup/crm-subject-mismatch` on the two CRM read contracts.
    "person-lookup/ucpath-drill-subject-mismatch",
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
