/**
 * `ucpath/read-job-summary` — D194's rich read of the Person Organizational
 * Summary detail page, one task per page visit.
 *
 * The output is the WHOLE *Employment Instances* grid plus the page-displayed
 * person identity, the row count, and the render context that says whether the
 * grid is complete (`src/domain/ui/ucpath-job-summary.ts` argues both choices).
 * Consumers project field paths and fold; nothing downstream re-scrapes this
 * page, and nothing downstream is allowed to ask this task for "just the
 * department" — that was Option B and it cannot carry a fixed schema hash.
 *
 * ## The subject binding is the point of the contract
 *
 * The search resolves nothing here: the run already HAS an EID and asks UCPath
 * what that EID's jobs are. So unlike `ucpath/search-person-org` — whose subject
 * is `none` because the search IS the identity resolution — this contract binds
 * a person subject `before-subject-read`: the detail page's own displayed EID
 * must equal the requested one before a single grid cell is trusted. That check
 * already exists inside the Person Org port (`detail.observedEid !== row.emplId`);
 * declaring it here is what makes it a CONTRACT rather than an implementation
 * detail somebody could optimize away.
 *
 * ## Freshness
 *
 * Four hours, matching `search-person-org`, and for the same reason: person/org
 * rows change on an HR action, not continuously, and a same-day replay is
 * re-read before it can feed a write. `defaultOverride: "forbidden"` because
 * doc 09 §14.5 puts identity on the never-overridable list — an approval is an
 * observation, and a stale observation re-opens the gate rather than being
 * waved through.
 */
import { z } from "zod";
import { EidSchema, ObservationIdSchema, taskId } from "../../ids.js";
import {
  UCPATH_JOB_SUMMARY_PAGE_STATE,
  UcpathJobSummarySchema,
} from "../../ui/ucpath-job-summary.js";
import { ContractFieldPathSchema, defineTaskContract } from "../base.js";

export const ReadJobSummaryInputSchema = z.strictObject({ emplId: EidSchema });
export const ReadJobSummaryOutputSchema = UcpathJobSummarySchema;
export type ReadJobSummaryOutput = z.infer<typeof ReadJobSummaryOutputSchema>;

export const UcpathReadJobSummary = defineTaskContract({
  id: taskId("ucpath/read-job-summary"),
  title: "Job Summary",
  effect: "read",
  input: ReadJobSummaryInputSchema,
  output: ReadJobSummaryOutputSchema,
  errorCodes: [
    /** UCPath answered "No matching values were found" for this EID (S18/S19). */
    "employee-not-found",
    /** The detail page displayed a DIFFERENT person than the run asked for. */
    "subject-mismatch",
    "unexpected-page-state",
  ],
  subject: {
    kind: "person",
    expected: { fromInput: ContractFieldPathSchema.parse("emplId"), identity: "eid" },
    observe: ObservationIdSchema.parse("ucpath.person-org.displayed-eid"),
    match: "normalized-exact-eid",
    requiredAt: "before-subject-read",
  },
  freshness: { defaultMaxAgeMs: 4 * 60 * 60 * 1000, defaultOverride: "forbidden" },
  provenance: { default: "live" },
  scenarios: [
    "separations-identity-check/single-active-job",
    "separations-identity-check/already-terminated-single-row",
    "separations-identity-check/already-terminated-multi-row",
    "separations-identity-check/concurrent-active-jobs",
    "separations-identity-check/unreadable-department",
    "separations-identity-check/job-summary-not-found",
  ],
  example: {
    pageStateId: UCPATH_JOB_SUMMARY_PAGE_STATE,
    emplId: "10873698",
    displayedName: "Battistessa, Johnnie",
    jobRows: [{
      rowIndex: 0,
      emplRecord: "0",
      hrStatus: "Active",
      businessUnit: "SDCMP",
      effectiveDate: { state: "present", value: "07/01/2025" },
      positionNumber: { state: "present", value: "40012345" },
      deptId: { state: "present", value: "000414" },
      department: { state: "present", value: "Housing Dining Hospitality" },
      jobCode: { state: "present", value: "004920" },
      jobTitle: { state: "present", value: "Dining Assistant" },
      expectedJobEndDate: { state: "absent", reason: "the grid rendered this cell empty" },
      fte: { state: "present", value: "0.500000" },
      emplClass: { state: "present", value: "Career" },
    }],
    rowCount: 1,
    renderContext: {
      entry: "auto-detail",
      searchResultRows: 0,
      employmentInstances: "already-complete",
    },
    observedAt: "2026-08-12T18:00:00.000Z",
  },
});
