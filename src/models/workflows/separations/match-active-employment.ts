/** Ambiguous employment refuses before the gate; the operator cannot resolve it there. */
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
