import { ProtectedInputBindingSchema } from "../protected-input.js";
/**
 * **What the writes will consume** — the block ref write-safety §14.2's decision packet
 * gained when the composition existed to fill it.
 *
 * ## Why it is on the PACKET and not merely in the graph
 *
 * Chunks 4 and 5 both hung their resolved values off the gate as dependencies
 * and both recorded the same open item in the same words: *"the resolved
 * `{template, reasonCode}` is a gate DEPENDENCY here but is not yet rendered
 * INTO ref write-safety §14.2's packet; the composition should carry it there"* and
 * *"'you are finalizing document 4510 against `000412 - Housing/Dining/Hospitality`'
 * belongs on the screen, not merely in the graph."* This is that block.
 *
 * It is not decoration. §14.5 binds an approval to the digest of the exact
 * packet the approver saw, so putting the plan INSIDE the packet makes the
 * approval bind to the *values the writes will consume*: a run whose reconciled
 * separation date moves after approval re-derives a different digest and
 * `verify-identity-approval` refuses with `identity-approval-evidence-moved`.
 * An approval of a person is not an approval of a date, and before this the two
 * were the same click.
 *
 * ## `not-composed` is a required, stated arm
 *
 * The three sub-workflow descriptors are proving harnesses: they read an
 * identity and file at most one write, and none of them holds the whole plan.
 * They declare `{state: "not-composed", reason}` rather than omitting the field,
 * because an optional block is a block a composition can forget to fill while
 * every gate still renders and every guard still passes. A required union makes
 * "this graph does not compose a plan" a sentence somebody wrote.
 *
 * ## Plain field types, on purpose
 *
 * Every value here is already schema-bound by the node that produced it — the
 * termination-type map, the department fold, the employment selection, the date
 * reconciliation. Re-importing those four schemas would tie the gate's packet to
 * the whole composition's import closure for no added strictness, and the packet
 * is a PRESENTATION of decisions, not a second authority over them.
 */
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
      // Read historical packets without carrying their protected bytes forward.
      timekeeperName: z.union([ProtectedInputBindingSchema, z.string().min(1)])
        .transform((value) => typeof value === "string"
          ? ProtectedInputBindingSchema.parse({ kind: "legacy-protected-input", name: "timekeeperName", inputPath: "timekeeperName" })
          : value).pipe(ProtectedInputBindingSchema),
    }),
    /**
     * How the dates were reconciled, with what the form said beside them.
     *
     * Since §4e's 2026-08-14 amendment, `lastDayWorked` and `separationDate` are
     * not only inputs to the UCPath filing — they are STAGED ONTO the Kuali
     * document by the same one-pass save the `document` block describes. They
     * are named here and not repeated there on purpose: the packet is a
     * PRESENTATION of decisions, never a second authority over them (D211), and
     * one value rendered in two places is a value that can disagree with itself.
     * The digest binds them either way, so a reconciled date that moves after
     * approval re-opens the gate.
     */
    dates: z.strictObject({
      kualiLastDayWorked: z.string().min(1),
      lastDayWorked: z.string().min(1),
      lastDayWorkedChanged: z.boolean(),
      kualiSeparationDate: z.string().min(1),
      separationDate: z.string().min(1),
      separationDateChanged: z.boolean(),
      /** Which leave day moved the separation date, or `null` when none did. */
      separationDeterminingLeave: z.enum(["sick", "holiday"]).nullable(),
      /**
       * Pay codes the ported classifier declined to count (§9.1's 2026-08-13
       * answer). They are on the packet because the operator is the person who
       * would recognise a real holiday the rule missed, and the gate is the one
       * moment they are looking.
       */
      unclassifiedPayCodes: z.array(z.string().min(1)),
      /** D307 — `operator` when the Kronos step was omitted and these dates were typed; the digest binds it. */
      source: z.enum(["kronos-timesheet", "operator"]),
    }),
  }),
]);
export type SeparationWritePlan = z.infer<typeof SeparationWritePlanSchema>;

/** The arm a graph that files at most one write declares, with its reason. */
export function noSeparationWritePlan(reason: string): SeparationWritePlan {
  return SeparationWritePlanSchema.parse({ state: "not-composed", reason });
}
