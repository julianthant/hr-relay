/**
 * `workflow:separations/read-separation-plan` — everything the composed graph needs
 * from the separation document ALONE, as a real node.
 *
 * It sits between the Kuali read and every other read, because the two things
 * it produces are preconditions of them: the employee name the UCPath candidate
 * search runs on, and the timecard window the New Kronos read is applied over.
 * Its refusals cost nothing here and would cost two browser sessions one node
 * later.
 *
 * It is a task rather than a `derive` for `match-termination-type`'s reason: a
 * fold that can REFUSE needs somewhere to put the refusal, and a task has a
 * durable `FailureRecord.code` while a `derive` has only a thrown string. S7's
 * future-date refusal in particular is a run outcome an operator queries on.
 */
import { z } from "zod";
import { taskId } from "../../ids.js";
import {
  SEPARATION_PLAN_REFUSAL_CODES,
  SeparationPlanSchema,
} from "../../separations/separation-dates.js";
import {
  KualiDateFieldSchema,
  KualiTextFieldSchema,
} from "../../ui/kuali-separation-document.js";
import { IsoInstantSchema } from "../../ids.js";
import { defineTaskContract } from "../base.js";

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
    /**
     * The instant the document read observed the page — S7's reference. Using
     * the read's own instant rather than a clock keeps the fold pure and makes
     * the refusal say what is true: *as of the moment this run read the form*.
     */
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
