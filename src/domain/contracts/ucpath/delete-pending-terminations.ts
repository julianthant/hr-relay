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
 * ## The permanent key is the exact eligible/protected transaction set
 *
 * A person-only key let an earlier empty no-op suppress a later nonempty set,
 * even though those are different deletion authorities. The v2 key binds the
 * EID plus a canonical digest of every stable transaction row and partition.
 * Re-observing the same set reuses the intent without a browser or click;
 * observing a different set derives a distinct key. Immutable v1 person-only
 * intents are detected and refused, never reinterpreted as v2 authority.
 *
 * ## `recoveryAbsence` is `operator-only`, for the same reason as its sibling
 *
 * No propagation window has been measured for a UCPath delete reaching the
 * grid, and a guessed constant on a control that DELETES rows is worse than one
 * on a control that adds them.
 */
import { z } from "zod";
import { EidSchema, FingerprintSchema, TaskIdSchema, ObservationIdSchema, taskId } from "../../ids.js";
import { sha256Hex } from "../../sha256.js";
import {
  UCPATH_SMART_HR_IN_PROGRESS_NAME,
  UcpathPendingSweepProofSchema,
  UcpathPendingSweepTargetSchema,
} from "../../ui/ucpath-smart-hr-termination.js";
import type { UcpathPendingSweepProof } from "../../ui/ucpath-smart-hr-termination.js";
import type { UcpathPendingTransactionSet } from "../../ui/ucpath-smart-hr-termination.js";
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
  return [
    "ucpath:pending-terminations-clear:v2",
    input.emplId,
    ucpathPendingTransactionSetDigest(input.observedSet),
  ].join("|");
}

/** The immutable person-only key used before the exact-set contract. */
export function legacyUcpathPendingSweepIdempotencyKey(
  input: z.output<typeof UcpathPendingSweepTargetSchema>,
): string {
  return ["ucpath:pending-terminations-clear", input.emplId].join("|");
}

/**
 * Canonical digest of every load-bearing row fact. Observation time is not
 * part of the set identity: observing the same set twice must reuse one key.
 */
export function ucpathPendingTransactionSetDigest(
  set: UcpathPendingTransactionSet,
): string {
  const facts = (row: UcpathPendingTransactionSet["eligible"][number]) => [
    row.transactionId,
    row.emplId,
    row.action,
    row.approvalStatus,
    row.startDate,
    row.displayedName,
  ];
  return FingerprintSchema.parse(sha256Hex(JSON.stringify({
    schema: "hrauto:ucpath-pending-termination-set:v2",
    emplId: set.emplId,
    eligible: set.eligible.map(facts),
    protected: set.protected.map(facts),
  })));
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
      retiredKeys: [{
        key: legacyUcpathPendingSweepIdempotencyKey,
        reason:
          "the pre-D310 person-only sweep key did not identify a stable transaction set; its immutable "
          + "intent cannot authorize or suppress an exact-set deletion",
      }],
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
      clearedTransactionIds: [],
      protectedTransactionIds: [],
      setDigest: "d".repeat(64),
      scannedRowCount: 3,
      observedAt: "2026-08-13T10:18:00.000Z",
      source: "ss-smart-hr-detail-read",
    },
  },
});
