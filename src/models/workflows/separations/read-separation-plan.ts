/** Everything the composed graph needs from the separation document ALONE; its refusals cost nothing here and would cost two browser sessions one node later. */
import { z } from "zod";
import { taskId } from "../../../rules/identity/ids.js";
import {
  SEPARATION_PLAN_REFUSAL_CODES,
  SeparationPlanSchema,
} from "../../../rules/separations/separation-dates.js";
import {
  KualiDateFieldSchema,
  KualiTextFieldSchema,
} from "../../ui/kuali-separation-document.js";
import { IsoInstantSchema } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";

export const ReadSeparationPlanOutputSchema = SeparationPlanSchema;
export type PlanSeparationOutput = z.infer<typeof ReadSeparationPlanOutputSchema>;

export const SeparationsReadSeparationPlan = defineTaskContract({
  id: taskId("workflow:separations/read-separation-plan"),
  title: "Separation Plan",
  effect: "read",
  input: z.strictObject({
    documentNumber: z.string().min(1),
    /** The form's employee name, with its absent arm — a blank one refuses. */
    employeeName: KualiTextFieldSchema,
    lastDayWorked: KualiDateFieldSchema,
    separationDate: KualiDateFieldSchema,
        /* The instant the document read observed the page — the read's own instant rather than a clock keeps the fold pure. */
    observedAt: IsoInstantSchema,
  }),
  output: ReadSeparationPlanOutputSchema,
  errorCodes: SEPARATION_PLAN_REFUSAL_CODES,
  subject: {
    kind: "none",
    reason: "a pure fold over the separation document this run already read",
  },
  freshness: { defaultMaxAgeMs: Number.POSITIVE_INFINITY, defaultOverride: "forbidden" },
  provenance: { default: "derived" },
  scenarios: ["separations/plan-refusals"],
  example: {
    documentNumber: "4510",
    employeeName: "Kou, Nathan",
    kualiLastDayWorked: "06/12/2026",
    kualiSeparationDate: "06/12/2026",
    asOfDate: "08/14/2026",
    timecardWindow: { start: "05/12/2026", end: "07/12/2026" },
  },
});
