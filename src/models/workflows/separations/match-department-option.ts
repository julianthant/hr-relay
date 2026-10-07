/**
 * `workflow:separations/match-department-option` — **S55's upstream half**, as a
 * real node.
 *
 * The resolution is pure (`src/domain/separations/department-option.ts`); this
 * contract is what makes an unresolvable department a **run outcome** with a
 * closed durable code rather than a thrown derivation — the same argument
 * `match-termination-type` makes one control over, for the same reason: a
 * `derive` has nowhere to put "this run refuses, and here is why".
 *
 * It is a fold over facts the run already holds, so it is sessionless and
 * carries no freshness budget of its own — ref workflow-model §5.5 ages the reads that feed
 * it.
 */
import { z } from "zod";
import { taskId } from "../../../rules/identity/ids.js";
import { DEPARTMENT_OPTION_REFUSAL_CODES } from "../../../rules/separations/department-option.js";
import { KualiDepartmentOptionSchema } from "../../ui/kuali-separation-finalization.js";
import { UcpathJobCellSchema } from "../../ui/ucpath-job-summary.js";
import { defineTaskContract } from "../../task/task-contract.js";

export const MatchDepartmentOptionOutputSchema = z.strictObject({
  /** The Kuali option's visible text, VERBATIM — what the prepare will select. */
  option: KualiDepartmentOptionSchema,
  departmentCode: z.string().regex(/^\d+$/u),
  optionDescription: z.string().min(1),
  /** What UCPath called the same department; carried for the human, never matched on. */
  ucpathDepartment: z.string().min(1),
  observedOptionCount: z.number().int().positive(),
});
export type MatchDepartmentOptionOutput = z.infer<typeof MatchDepartmentOptionOutputSchema>;

export const SeparationsMatchDepartmentOption = defineTaskContract({
  id: taskId("workflow:separations/match-department-option"),
  title: "Match Department Option",
  effect: "read",
  input: z.strictObject({
    /** The read's own cell arms, so an unreadable Dept ID arrives as `absent`, not `""`. */
    deptId: UcpathJobCellSchema,
    department: UcpathJobCellSchema,
    /** The COMPLETE option list this document's own control carried (§3.2). */
    observedOptions: z.array(z.string().min(1)).min(1),
    documentNumber: z.string().min(1),
  }),
  output: MatchDepartmentOptionOutputSchema,
  errorCodes: DEPARTMENT_OPTION_REFUSAL_CODES,
  subject: {
    kind: "none",
    reason: "a pure fold over the job summary and the separation document this run already read",
  },
  freshness: { defaultMaxAgeMs: Number.POSITIVE_INFINITY, defaultOverride: "forbidden" },
  provenance: { default: "derived" },
  scenarios: ["separations-kuali-finalization/department-option-refusals"],
  example: {
    option: "000412 - Housing/Dining/Hospitality",
    departmentCode: "000412",
    optionDescription: "Housing/Dining/Hospitality",
    ucpathDepartment: "HOUSING/DINING/HOSPITALITY",
    observedOptionCount: 6,
  },
});
