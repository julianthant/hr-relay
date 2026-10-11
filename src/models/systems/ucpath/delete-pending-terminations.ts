/** Deletion is a separate fenced write with its own key, probe and read-back. */
import { z } from "zod";
import { EidSchema, FingerprintSchema, TaskIdSchema, ObservationIdSchema, taskId } from "../../../rules/identity/ids.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import {
  UCPATH_SMART_HR_IN_PROGRESS_NAME,
  UcpathPendingSweepSettlementProofSchema,
  UcpathPendingSweepTargetSchema,
} from "../../ui/ucpath-smart-hr-termination.js";
import type { UcpathPendingSweepSettlementProof } from "../../ui/ucpath-smart-hr-termination.js";
import type { UcpathPendingTransactionSet } from "../../ui/ucpath-smart-hr-termination.js";
import { ContractFieldPathSchema, defineTaskContract } from "../../task/task-contract.js";

/** The commit's own output: the post-click scan the commit ran for ITSELF — a claim, with the independently authorized exact selected/protected set and its digest retained. */
export const UcpathDeletePendingTerminationsOutputSchema = z.strictObject({
  cleared: UcpathPendingSweepSettlementProofSchema,
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
export function ucpathPersonSweepIdempotencyKey(
  input: z.output<typeof UcpathPendingSweepTargetSchema>,
): string {
  return ["ucpath:pending-terminations-clear", input.emplId].join("|");
}

/** Canonical digest of every load-bearing row fact; observation time is not part of the set identity, so observing the same set twice reuses one key. */
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
      proofSchema: UcpathPendingSweepSettlementProofSchema,
      proofFromOutput: (
        output: z.output<typeof UcpathDeletePendingTerminationsOutputSchema>,
      ) => output.cleared,
      proofFromPresentProbe: ({ proof }: { proof: UcpathPendingSweepSettlementProof }) => proof,
      outputFromProof: (proof: UcpathPendingSweepSettlementProof) => ({ cleared: proof }),
    },
    idempotency: {
      probe: { taskId: TaskIdSchema.parse("ucpath/match-pending-terminations"), effect: "read" },
      key: ucpathPendingSweepIdempotencyKey,
      retiredKeys: [{
        key: ucpathPersonSweepIdempotencyKey,
        reason:
          "a person-only sweep key did not identify a stable transaction set; its immutable "
          + "intent cannot authorize or suppress an exact-set deletion",
      }],
      recoveryAbsence: {
        kind: "operator-only",
        reason:
          "no propagation window has been measured for a UCPath in-progress-grid delete, and a guessed "
          + "`minSinceFenceMs` on a control that DELETES rows is worse than one on a control that adds "
          + "them. A post-fence absence parks for a human.",
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
      version: 2,
      selectedTransactionIds: "none",
      protectedTransactionIds: "T002204014",
      setDigest: "0".repeat(64),
    },
  },
});
