/** Bind the displayed subject before trusting employment-grid cells. */
import { z } from "zod";
import { EidSchema, ObservationIdSchema, taskId } from "../../../rules/identity/ids.js";
import {
  UCPATH_JOB_SUMMARY_PAGE_STATE,
  UcpathJobSummarySchema,
} from "../../ui/ucpath-job-summary.js";
import { ContractFieldPathSchema, defineTaskContract } from "../../task/task-contract.js";

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
    /** UCPath reported no matching values for this EID. */
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
