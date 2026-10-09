/** The COMMIT arm of the finalization: the ONE `Save` click, whose completion arm is `save-verify` because Kuali's save signal is worthless in both directions. */
import { z } from "zod";
import { EidSchema, ObservationIdSchema, TaskIdSchema, taskId } from "../../../rules/identity/ids.js";
import { KUALI_RRSS_DISPLAYED_EID } from "../../ui/kuali-rrss-document.js";
import {
  KualiFinalizationTargetSchema,
  KualiSavedFinalizationProofSchema,
} from "../../ui/kuali-separation-finalization.js";
import type { KualiSavedFinalizationProof } from "../../ui/kuali-separation-finalization.js";
import { ContractFieldPathSchema, defineTaskContract } from "../../task/task-contract.js";
import { EXAMPLE_KUALI_FINALIZATION_FIELDS } from "./match-separation-finalization.js";

/** The commit's own output: the exact document identity and field set the click targeted — not evidence the save landed. */
export const KualiSaveSeparationFinalizationOutputSchema = z.strictObject({
  savedState: KualiSavedFinalizationProofSchema,
});
export type KualiSaveSeparationFinalizationOutput = z.infer<
  typeof KualiSaveSeparationFinalizationOutputSchema
>;

export function kualiFinalizationIdempotencyKey(
  input: z.output<typeof KualiFinalizationTargetSchema>,
): string {
  return `kuali:${input.documentNumber}|finalization|${input.variables.transactionNumber}`;
}

export const KualiSaveSeparationFinalization = defineTaskContract({
  id: taskId("kuali/save-separation-finalization"),
  title: "Save Kuali Separation Finalization",
  effect: "commit",
  input: KualiFinalizationTargetSchema,
  output: KualiSaveSeparationFinalizationOutputSchema,
  errorCodes: ["save-refused"],
  subject: {
    kind: "person",
    expected: { fromInput: ContractFieldPathSchema.parse("emplId"), identity: "eid" },
    observe: ObservationIdSchema.parse(KUALI_RRSS_DISPLAYED_EID),
    match: "normalized-exact-eid",
    requiredAt: "after-prepare-before-fence",
  },
  scenarios: ["separations-kuali-finalization/save-verify-read-back"],
  writeSafety: {
    completion: {
      kind: "save-verify",
      verify: {
        taskId: TaskIdSchema.parse("kuali/verify-separation-finalization"),
        effect: "read",
      },
      proofSchema: KualiSavedFinalizationProofSchema,
      proofFromOutput: (output: z.output<typeof KualiSaveSeparationFinalizationOutputSchema>) =>
        output.savedState,
      proofFromPresentProbe: ({ proof }: { proof: KualiSavedFinalizationProof }) => proof,
      outputFromProof: (proof: KualiSavedFinalizationProof) => ({ savedState: proof }),
    },
    idempotency: {
      probe: {
        taskId: TaskIdSchema.parse("kuali/match-separation-finalization"),
        effect: "read",
      },
      key: kualiFinalizationIdempotencyKey,
      recoveryAbsence: {
        kind: "stabilized",
        minSinceFenceMs: 30_000,
        consistentReads: 2,
        minBetweenReadsMs: 5_000,
        requireSameSourceState: true,
      },
    },
  },
  example: {
    savedState: {
      kind: "kuali-saved-finalization",
      actionId: "0123456789abcdef01234567",
      documentNumber: "4444",
      observedEid: EidSchema.parse("10800000"),
      fields: EXAMPLE_KUALI_FINALIZATION_FIELDS,
      source: "reload-read-back",
    },
  },
});

export { KualiFinalizationTargetSchema };
