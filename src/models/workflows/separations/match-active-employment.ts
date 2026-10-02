/**
 * `workflow:separations/match-active-employment` — S23/S24 as a real node: which
 * employment row this separation is filed against.
 *
 * A UCPath termination needs ONE `Empl Record`, and the Kuali finalization needs
 * ONE payroll title code and title. A grid this fold cannot reduce to one row is
 * a run that cannot compute what it is about to write, so it refuses — before
 * the gate, for the same reason chunk 4's `termination-type` and chunk 5's
 * `department-option` do: a refusal the operator cannot act on should not cost
 * them a decision first.
 *
 * The Dept ID and Department cells travel onward as CELLS.
 * `match-department-option` already owns their refusal, and one fact with two
 * durable codes is worse than one.
 */
import { z } from "zod";
import { taskId } from "../../../rules/identity/ids.js";
import {
  EMPLOYMENT_SELECTION_REFUSAL_CODES,
  SelectedEmploymentSchema,
} from "../../../rules/separations/employment-selection.js";
import { UcpathJobSummarySchema } from "../../ui/ucpath-job-summary.js";
import { defineTaskContract } from "../../task/task-contract.js";

export const MatchActiveEmploymentOutputSchema = SelectedEmploymentSchema;
export type SelectEmploymentOutput = z.infer<typeof MatchActiveEmploymentOutputSchema>;

export const SeparationsMatchActiveEmployment = defineTaskContract({
  id: taskId("workflow:separations/match-active-employment"),
  title: "Select Employment",
  effect: "read",
  input: z.strictObject({
    documentNumber: z.string().min(1),
    /** The whole job-summary read, projected downstream and never re-scraped. */
    jobSummary: UcpathJobSummarySchema,
  }),
  output: MatchActiveEmploymentOutputSchema,
  errorCodes: EMPLOYMENT_SELECTION_REFUSAL_CODES,
  subject: {
    kind: "none",
    reason: "a pure fold over the UCPath job summary this run already read",
  },
  freshness: { defaultMaxAgeMs: Number.POSITIVE_INFINITY, defaultOverride: "forbidden" },
  provenance: { default: "derived" },
  scenarios: ["separations/employment-refusals"],
  example: {
    rowIndex: 0,
    emplRecord: "0",
    hrStatus: "Active",
    businessUnit: "SDCMP",
    deptId: { state: "present", value: "000412" },
    department: { state: "present", value: "HOUSING/DINING/HOSPITALITY" },
    payrollTitleCode: "004921",
    payrollTitle: "STDT 2",
    effectiveDate: { state: "present", value: "07/01/2025" },
    rowCount: 1,
  },
});
