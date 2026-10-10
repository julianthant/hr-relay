import { ProtectedInputBindingSchema } from "../../models/write-safety/protected-input.js";
/** What the writes will consume: inside the decision packet, so an approval binds to the exact values a digest covers, and a date that moves after approval re-opens the gate. */
import { z } from "zod";

export const SeparationWritePlanSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("not-composed"),
    /** Why this graph has no plan to show — a sentence, never an omission. */
    reason: z.string().min(1),
  }),
  z.strictObject({
    state: z.literal("planned"),
    /** What the UCPath Smart HR termination will be filed as. */
    termination: z.strictObject({
      /** The Kuali *Type of Termination*, verbatim — the map's input. */
      terminationType: z.string().min(1),
      classification: z.enum(["voluntary", "involuntary"]),
      template: z.string().min(1),
      reasonCode: z.string().min(1),
      /** The employment row it is filed against. */
      emplRecord: z.string().min(1),
      effectiveDate: z.string().min(1),
      lastDateWorked: z.string().min(1),
      /** The Initiator Comments text, exactly as it will be typed. */
      initiatorComments: z.string().min(1),
    }),
    /** What the Kuali RRSS document will be finalized with. */
    document: z.strictObject({
      documentNumber: z.string().min(1),
      /** The `Department*` option's visible text — what the operator will see saved. */
      department: z.string().min(1),
      departmentCode: z.string().min(1),
      /** What UCPath called the same department; the operator compares the two. */
      ucpathDepartment: z.string().min(1),
      payrollTitleCode: z.string().min(1),
      payrollTitle: z.string().min(1),
      terminationEffectiveDate: z.string().min(1),
      timekeeperName: ProtectedInputBindingSchema,
    }),
        /* How the dates were reconciled, with what the form said beside them; the packet is a PRESENTATION of decisions, never a second authority over them. */
    dates: z.strictObject({
      kualiLastDayWorked: z.string().min(1),
      lastDayWorked: z.string().min(1),
      lastDayWorkedChanged: z.boolean(),
      kualiSeparationDate: z.string().min(1),
      separationDate: z.string().min(1),
      separationDateChanged: z.boolean(),
      /** Which leave day moved the separation date, or `null` when none did. */
      separationDeterminingLeave: z.enum(["sick", "holiday"]).nullable(),
            /* Surface uncounted pay codes so the operator can recognize missed holidays. */
      unclassifiedPayCodes: z.array(z.string().min(1)),
      /** `operator` when the Kronos step was omitted and these dates were typed; the digest binds it. */
      source: z.enum(["kronos-timesheet", "operator"]),
    }),
  }),
]);
export type SeparationWritePlan = z.infer<typeof SeparationWritePlanSchema>;

/** The arm a graph that files at most one write declares, with its reason. */
export function noSeparationWritePlan(reason: string): SeparationWritePlan {
  return SeparationWritePlanSchema.parse({ state: "not-composed", reason });
}
