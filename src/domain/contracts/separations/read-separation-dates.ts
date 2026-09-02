/**
 * `workflow:separations/read-separation-dates` — the values a real termination is
 * filed on, as a real node.
 *
 * §4e's staged-variables model wants every write to consume a VARIABLE that was
 * decided once, never re-derived at fill time. These are the most load-bearing
 * variables in the workflow: the last day worked becomes the UCPath *Override
 * Last Date Worked* field, and the separation date + 1 becomes the termination's
 * effective date — which is also half its permanent key.
 *
 * It is a task rather than a `derive` because it refuses: a card that opened
 * with no punch establishes no worked day, and §4b's answer is that no path
 * through this workflow files a termination on a date nobody read. A `derive`
 * has nowhere to put that.
 */
import { z } from "zod";
import { taskId } from "../../ids.js";
import {
  RECONCILED_DATE_REFUSAL_CODES,
  ReconciledSeparationDatesSchema,
  SeparationPlanSchema,
  TimecardWindowSchema,
} from "../../separations/separation-dates.js";
import { TimecardDateSchema } from "../../kronos/separation-timecard.js";
import { KualiTimekeeperNameSchema } from "../../ui/kuali-document-identity.js";
import { defineTaskContract } from "../base.js";

export const ReadSeparationDatesOutputSchema = ReconciledSeparationDatesSchema;
export type ReconcileDatesOutput = z.infer<typeof ReadSeparationDatesOutputSchema>;

export const SeparationsReadSeparationDates = defineTaskContract({
  id: taskId("workflow:separations/read-separation-dates"),
  title: "Reconcile Separation Dates",
  effect: "read",
  input: z.strictObject({
    /** What the separation document carried, validated before the timecard ran. */
    plan: SeparationPlanSchema,
    /** The operator whose initials sign the Kuali audit lines. */
    timekeeperName: KualiTimekeeperNameSchema,
    /** The card's last physical punch, or `null` when it carried none (S38). */
    lastPunchDate: TimecardDateSchema.nullable(),
    sickDates: z.array(TimecardDateSchema),
    holidayDates: z.array(TimecardDateSchema),
    /**
     * Pay codes the ported classifier declined to count (§9.1's 2026-08-13
     * answer). Carried through so a day the rule did not count is visible at
     * the gate; nothing here consumes them.
     */
    unclassifiedPayCodes: z.array(z.string().min(1)),
    /** The window the grid was PROVED to be showing when it was read (S40). */
    observedWindow: TimecardWindowSchema,
  }),
  output: ReadSeparationDatesOutputSchema,
  errorCodes: RECONCILED_DATE_REFUSAL_CODES,
  subject: {
    kind: "none",
    reason: "a pure fold over the separation document and the timecard this run already read",
  },
  freshness: { defaultMaxAgeMs: Number.POSITIVE_INFINITY, defaultOverride: "forbidden" },
  provenance: { default: "derived" },
  scenarios: ["separations/date-reconciliation"],
  example: {
    lastDayWorked: "06/12/2026",
    separationDate: "06/19/2026",
    terminationEffectiveDate: "06/20/2026",
    kualiLastDayWorked: "06/12/2026",
    kualiSeparationDate: "06/12/2026",
    lastDayWorkedChanged: false,
    separationDateChanged: true,
    latestSickDate: null,
    firstHolidayDate: "06/19/2026",
    latestHolidayDate: "06/19/2026",
    separationDeterminingLeave: "holiday",
    unclassifiedPayCodes: ["Independence Day Observed", "Juneteenth Observed"],
    terminationComments: "Termination eff 06/20/2026. Last Day Worked 06/12/2026. "
      + "Holiday Pay on 06/19/2026. Kuali form #4510.",
    dateChangeComments: "Updated Separation Date from 06/12/2026 to 06/19/2026 "
      + "per Kronos timesheet. -JZ",
    source: "kronos-timesheet",
  },
});
