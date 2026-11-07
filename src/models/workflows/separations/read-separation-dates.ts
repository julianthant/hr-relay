/** The values a real termination is filed on, as a real node: it refuses rather than filing on a date nobody read. */
import { z } from "zod";
import { taskId } from "../../../rules/identity/ids.js";
import {
  RECONCILED_DATE_REFUSAL_CODES,
  ReconciledSeparationDatesSchema,
  SeparationPlanSchema,
  TimecardWindowSchema,
} from "../../../rules/separations/separation-dates.js";
import { TimecardDateSchema } from "../../../rules/kronos/separation-timecard.js";
import { KualiTimekeeperNameSchema } from "../../ui/kuali-document-identity.js";
import { defineTaskContract } from "../../task/task-contract.js";

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
    /** Null means the card had no physical punch. */
    lastPunchDate: TimecardDateSchema.nullable(),
    sickDates: z.array(TimecardDateSchema),
    holidayDates: z.array(TimecardDateSchema),
        /* Surface uncounted pay codes for operator review. */
    unclassifiedPayCodes: z.array(z.string().min(1)),
    /** Retain the window the grid was proved to display. */
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
