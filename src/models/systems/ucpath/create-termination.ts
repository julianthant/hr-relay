/** The COMMIT arm: the `Save and Submit` click ALONE, because staging leaves no durable footprint, keyed on the person and the effective date and nothing else. */
import { z } from "zod";
import { EidSchema, ObservationIdSchema, TaskIdSchema, taskId } from "../../../rules/identity/ids.js";
import {
  UCPATH_SMART_HR_DISPLAYED_PERSON_NAME,
  UcpathTerminationProofSchema,
  UcpathTerminationTargetSchema,
} from "../../ui/ucpath-smart-hr-termination.js";
import type { UcpathTerminationProof } from "../../ui/ucpath-smart-hr-termination.js";
import { ContractFieldPathSchema, defineTaskContract } from "../../task/task-contract.js";

/** The commit's own output: the receipt PAIR the commit read back for itself — a CLAIM, not proof, and the PAIR matters because a `Denied` transaction carries a well-formed `T…`. */
export const UcpathCreateTerminationOutputSchema = z.strictObject({
  receipt: UcpathTerminationProofSchema,
});
export type UcpathCreateTerminationOutput = z.infer<typeof UcpathCreateTerminationOutputSchema>;

/** The natural business key: the person and the effective date, and nothing else. */
export function ucpathTerminationIdempotencyKey(
  input: z.output<typeof UcpathTerminationTargetSchema>,
): string {
  return ["ucpath:termination", input.emplId, input.effectiveDate].join("|");
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
