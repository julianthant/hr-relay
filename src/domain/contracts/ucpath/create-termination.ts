/**
 * `ucpath/create-termination` — the COMMIT arm, and the second
 * `effect:"commit"` contract in this tree.
 *
 * **The commit is the `Save and Submit` click ALONE** (`#HR_TBH_WRK_TBH_SAVE`).
 * Everything else the wizard does is staging, and the 2026-08-13 live check
 * proved staging leaves no durable footprint of any kind. That is what makes
 * this the smallest possible irreversible step.
 *
 * ## The permanent key is EID + effective date
 *
 * Ref write-safety §5 wants the NATURAL business key, and this one is exactly the
 * question a duplicate would answer yes to: "is this person already being
 * terminated effective this date?" It never incorporates run position, attempt,
 * template, or reason code — a second run that picked a different reason code
 * for the same person on the same date is the SAME external transaction, and
 * giving it its own key would authorize the duplicate this key exists to stop.
 *
 * ## Why `recoveryAbsence` is `operator-only`
 *
 * D64/D69 admit a stabilized negative ONLY with a MEASURED propagation window,
 * and no such window has been measured for UCPath: the controlled real commit
 * has not been performed (§4f2 — it waits on an operator-named canary), so
 * nothing in this repository has ever watched a Smart HR submit propagate to
 * the SS Smart HR search page. Inventing `minSinceFenceMs` is the exact
 * unverified constant D128 forbids, and the stakes here are a real termination
 * rather than a benign annotation. A post-fence absence therefore parks for a
 * human, and the follow-up is named: measure the window on the canary.
 *
 * ## The output is a claim, never proof
 *
 * `receipt` is what the commit read back for ITSELF after the click. It is not
 * evidence the kernel promotes: beat ⑥'s independent `ucpath/verify-termination`
 * re-read is what may settle the run `done`.
 */
import { z } from "zod";
import { EidSchema, ObservationIdSchema, TaskIdSchema, taskId } from "../../ids.js";
import {
  UCPATH_SMART_HR_DISPLAYED_PERSON_NAME,
  UcpathTerminationProofSchema,
  UcpathTerminationTargetSchema,
} from "../../ui/ucpath-smart-hr-termination.js";
import type { UcpathTerminationProof } from "../../ui/ucpath-smart-hr-termination.js";
import { ContractFieldPathSchema, defineTaskContract } from "../base.js";

/**
 * The commit's own output: the receipt PAIR the commit read back for itself
 * after the click, off the SS Smart HR transaction detail page.
 *
 * It is a CLAIM, not proof, and nothing in the kernel promotes it — beat ⑥'s
 * independent `ucpath/verify-termination` re-read is what may say `done`. It
 * exists because the submit itself renders no receipt: UCPath puts the `T…` on
 * a different page entirely, so a commit that returned only "I clicked" could
 * not distinguish S51 (outcome unknown) from a landed transaction, and legacy
 * performs the same post-submit read for the same reason.
 *
 * The PAIR is deliberate. A `Denied` transaction carries a perfectly
 * well-formed `T…` (live `T002204014`), so a receipt schema with a number and
 * no status would let a refused write look like a successful one.
 */
export const UcpathCreateTerminationOutputSchema = z.strictObject({
  receipt: UcpathTerminationProofSchema,
});
export type UcpathCreateTerminationOutput = z.infer<typeof UcpathCreateTerminationOutputSchema>;

/**
 * The natural business key (ref write-safety §5): the person and the effective date, and
 * nothing else. Legacy's own existence check asks the same question — an
 * EID + exact effdt + `"Terminat"` action match — which is the one part of its
 * duplicate control the behavior review rates `sound`.
 */
export function ucpathTerminationIdempotencyKey(
  input: z.output<typeof UcpathTerminationTargetSchema>,
): string {
  return `ucpath:termination|${input.emplId}|${input.effectiveDate}`;
}

export const UcpathCreateTermination = defineTaskContract({
  id: taskId("ucpath/create-termination"),
  title: "Submit UCPath Termination",
  effect: "commit",
  input: UcpathTerminationTargetSchema,
  output: UcpathCreateTerminationOutputSchema,
  errorCodes: ["ucpath-unavailable", "unexpected-page-state", "subject-mismatch", "submit-refused"],
  subject: {
    kind: "person",
    expected: { fromInput: ContractFieldPathSchema.parse("expectedName"), identity: "name" },
    observe: ObservationIdSchema.parse(UCPATH_SMART_HR_DISPLAYED_PERSON_NAME),
    match: "normalized-exact-name",
    requiredAt: "after-prepare-before-fence",
  },
  scenarios: ["separations-ucpath-termination/dry-run-preview"],
  writeSafety: {
    completion: {
      kind: "save-verify",
      verify: { taskId: TaskIdSchema.parse("ucpath/verify-termination"), effect: "read" },
      proofSchema: UcpathTerminationProofSchema,
      proofFromOutput: (output: z.output<typeof UcpathCreateTerminationOutputSchema>) => output.receipt,
      proofFromPresentProbe: ({ proof }: { proof: UcpathTerminationProof }) => proof,
      outputFromProof: (proof: UcpathTerminationProof) => ({ receipt: proof }),
    },
    idempotency: {
      probe: { taskId: TaskIdSchema.parse("ucpath/match-existing-termination"), effect: "read" },
      key: ucpathTerminationIdempotencyKey,
      recoveryAbsence: {
        kind: "operator-only",
        reason:
          "no propagation window has been measured for a UCPath Smart HR submit reaching the SS Smart "
          + "HR search page: the controlled real commit is still open, waiting on the operator-named "
          + "canary (separations.md §4f2). A guessed `minSinceFenceMs` on a real termination is exactly "
          + "the unverified constant D128 forbids, so a post-fence absence parks for a human.",
      },
    },
  },
  example: {
    receipt: {
      kind: "ucpath-termination",
      emplId: EidSchema.parse("10800000"),
      effectiveDate: "06/11/2026",
      transactionId: "T002209631",
      approvalStatus: "Pending",
      displayedName: "Deterministic Person",
      source: "ss-smart-hr-detail-read",
    },
  },
});
