/**
 * `ucpath/delete-pending-terminations` — the COMMIT arm of ref write-safety §5's
 * date-agnostic pending sweep, and this tree's third `effect:"commit"`
 * contract.
 *
 * ## Why the sweep is a transaction of its own
 *
 * Legacy's `deletePendingTransaction` deletes every in-progress `Terminat*` row
 * for the EID before it files, and the behavior review's note on **S30/S31** is
 * the whole argument: it is `sound` in intent and *it is the first mutation the
 * run performs*. A delete is an external write. So it gets what every external
 * write in this tree gets — its own fence, its own permanent key, its own probe
 * and its own read-back — instead of hiding inside the termination's prepare,
 * where a crash between the delete and the submit would leave a run that had
 * mutated UCPath while claiming to have staged nothing.
 *
 * It is composed BEFORE the termination, which is also why the two keys are
 * independent: sweeping is not "part of" filing, it is a precondition of it.
 *
 * ## The permanent key is the person alone
 *
 * That is the point of the date-agnostic probe: the transaction is "this
 * person has no in-progress termination rows", which no date qualifies. Two
 * runs sweeping the same person derive the same key, so the second sees the
 * first's committed intent and does not click again.
 *
 * ## `recoveryAbsence` is `operator-only`, for the same reason as its sibling
 *
 * No propagation window has been measured for a UCPath delete reaching the
 * grid, and a guessed constant on a control that DELETES rows is worse than one
 * on a control that adds them.
 */
import { z } from "zod";
import { EidSchema, TaskIdSchema, ObservationIdSchema, taskId } from "../../ids.js";
import {
  UCPATH_SMART_HR_IN_PROGRESS_NAME,
  UcpathPendingSweepProofSchema,
  UcpathPendingSweepTargetSchema,
} from "../../ui/ucpath-smart-hr-termination.js";
import type { UcpathPendingSweepProof } from "../../ui/ucpath-smart-hr-termination.js";
import { ContractFieldPathSchema, defineTaskContract } from "../base.js";

/**
 * The commit's own output: the post-click scan the commit ran for ITSELF. A
 * claim, like every commit output here; beat ⑥'s independent re-read is what
 * settles it. It says what was SEEN and never what was intended — see
 * `UcpathPendingSweepProofSchema` for why the deleted ids are deliberately not
 * in it.
 */
export const UcpathDeletePendingTerminationsOutputSchema = z.strictObject({
  cleared: UcpathPendingSweepProofSchema,
});
export type UcpathDeletePendingTerminationsOutput =
  z.infer<typeof UcpathDeletePendingTerminationsOutputSchema>;

export function ucpathPendingSweepIdempotencyKey(
  input: z.output<typeof UcpathPendingSweepTargetSchema>,
): string {
  return `ucpath:pending-terminations-clear|${input.emplId}`;
}

export const UcpathDeletePendingTerminations = defineTaskContract({
  id: taskId("ucpath/delete-pending-terminations"),
  title: "Clear Pending UCPath Terminations",
  effect: "commit",
  input: UcpathPendingSweepTargetSchema,
  output: UcpathDeletePendingTerminationsOutputSchema,
  errorCodes: ["ucpath-unavailable", "unexpected-page-state", "subject-mismatch", "delete-refused"],
  subject: {
    kind: "person",
    expected: { fromInput: ContractFieldPathSchema.parse("expectedName"), identity: "name" },
    observe: ObservationIdSchema.parse(UCPATH_SMART_HR_IN_PROGRESS_NAME),
    match: "normalized-exact-name",
    requiredAt: "after-prepare-before-fence",
  },
  scenarios: ["separations-ucpath-termination/pending-sweep-nothing-to-do"],
  writeSafety: {
    completion: {
      kind: "save-verify",
      verify: {
        taskId: TaskIdSchema.parse("ucpath/verify-pending-terminations-cleared"),
        effect: "read",
      },
      proofSchema: UcpathPendingSweepProofSchema,
      proofFromOutput: (
        output: z.output<typeof UcpathDeletePendingTerminationsOutputSchema>,
      ) => output.cleared,
      proofFromPresentProbe: ({ proof }: { proof: UcpathPendingSweepProof }) => proof,
      outputFromProof: (proof: UcpathPendingSweepProof) => ({ cleared: proof }),
    },
    idempotency: {
      probe: { taskId: TaskIdSchema.parse("ucpath/match-pending-terminations"), effect: "read" },
      key: ucpathPendingSweepIdempotencyKey,
      recoveryAbsence: {
        kind: "operator-only",
        reason:
          "no propagation window has been measured for a UCPath in-progress-grid delete, and a guessed "
          + "`minSinceFenceMs` on a control that DELETES rows is worse than one on a control that adds "
          + "them. A post-fence absence parks for a human (D128).",
      },
    },
  },
  example: {
    cleared: {
      kind: "ucpath-pending-terminations-clear",
      emplId: EidSchema.parse("10800000"),
      scannedRowCount: 3,
      observedAt: "2026-08-13T10:18:00.000Z",
      source: "ss-smart-hr-detail-read",
    },
  },
});
