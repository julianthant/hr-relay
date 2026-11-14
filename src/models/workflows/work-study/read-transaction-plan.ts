import { z } from "zod";
import { EidSchema, taskId } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { UcpathPayPathPositionSchema, UcpathPayPathReadSchema } from "../../ui/ucpath-paypath.js";
import { WorkStudyInput } from "./input.js";

const UsDateSchema = z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/u, "date must be MM/DD/YYYY");

/** The PayPath work-study transaction this run would file; the Save binds exactly these values. */
export const WorkStudyPlanSchema = z.strictObject({
  emplId: EidSchema,
  name: z.string().trim().min(1),
  effectiveDate: UsDateSchema,
  positionChangeReason: z.literal("JRL"),
  positionPool: z.literal("F"),
  comments: z.string().min(1),
  current: UcpathPayPathPositionSchema,
});
export type WorkStudyPlan = z.infer<typeof WorkStudyPlanSchema>;

export const WorkStudyReadTransactionPlan = defineTaskContract({
  id: taskId("workflow:work-study/read-transaction-plan"), title: "Plan work-study transaction", effect: "read",
  input: z.strictObject({ input: WorkStudyInput, read: UcpathPayPathReadSchema }),
  output: WorkStudyPlanSchema, errorCodes: ["INCONSISTENT_INPUTS"],
  subject: { kind: "none", reason: "pure fold of this run's input and its PayPath read" },
  freshness: { defaultMaxAgeMs: Infinity, defaultOverride: "forbidden" }, provenance: { default: "derived" },
  scenarios: ["work-study/planned-transaction"],
  example: {
    emplId: "10000001", name: "Lee, Jordan", effectiveDate: "08/03/2026", positionChangeReason: "JRL", positionPool: "F",
    comments: "Updated pool id to F per work study award 08/03/2026",
    current: { effectiveDate: "07/01/2026", positionChangeReason: "", positionPool: "", positionNumber: "40012345" },
  },
});
