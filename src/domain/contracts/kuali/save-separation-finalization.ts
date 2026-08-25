/**
 * `kuali/save-separation-finalization` — the COMMIT arm of chunk 5, and the
 * third `effect:"commit"` contract in this tree.
 *
 * **The commit is the ONE `Save` click.** Everything the finalization writes is
 * already staged by then (§4e), so this is the smallest possible irreversible
 * step: one click on one button that Kuali serializes as one
 * `submitDocumentV2`.
 *
 * ## The completion arm can only ever be `save-verify`
 *
 * Kuali issues no confirmation number and its save signal is worthless in BOTH
 * directions. **S59** is legacy's version of the hazard — `clickSave` is a
 * click, a swallowed `networkidle` wait, a 2 s sleep and an unconditional
 * success log, with zero read-back, so even a hung save prints "Kuali form
 * saved". **D128** is this repository's own proof of the same thing on this
 * exact system: HTTP `200`, a rendered `Form saved`, and nothing persisted.
 *
 * So the ONLY landing proof is a reload read-back, `verify` points at
 * `kuali/verify-separation-finalization`, and any verdict other than `present`
 * parks (ref write-safety §7 row 6). `output` carries the field set the click targeted —
 * a CLAIM, not proof; nothing in the kernel promotes it. `proofFromOutput`
 * exists to satisfy the static round-trip the contract factory checks and to
 * reconstruct node output from a probe-derived proof on the preflight-present
 * and recovery paths.
 *
 * ## The permanent key is the DOCUMENT and the TRANSACTION NUMBER
 *
 * §5 item 1C: `<documentNumber>|finalization|<transactionNumber>`. That is the
 * natural business question a duplicate would answer yes to — "is this document
 * already finalized against this UCPath transaction?" — and it deliberately
 * omits two things:
 *
 *  - **The action id.** It names a workflow STEP, not a document (D129). The
 *    same document reached through a different step is the SAME external
 *    transaction, so keying on it would mint a second key and authorize exactly
 *    the duplicate this key exists to stop.
 *  - **The field values.** Unlike the timekeeper annotation — where the VALUE
 *    is the transaction — the transaction here is "this document records that
 *    termination". A second run that composed a slightly different comments
 *    string is not a second finalization, and giving it its own key would let
 *    it save over a landed one unfenced.
 *
 * ## Why `recoveryAbsence` is `stabilized`, and where its numbers come from
 *
 * **Ratified as D207 (ref write-safety §4.2), which this is the first reuse under.** A
 * measured window transfers with the MECHANISM when the reusing contract names
 * the same write request, the same negative read, and an absence that is safe in
 * the direction it can be wrong; and the transfer is **provisional until this
 * write's own controlled-commit proof confirms it** (doc 03c §Phase summary step 5 —
 * chunk 5c). The composed separations workflow may not rely on the stabilized
 * arm in production before that confirmation lands.
 *
 * D64/D69 admit a stabilized negative ONLY with a MEASURED propagation window,
 * and Kuali's was measured — on this exact form, through this exact mutation.
 * On 2026-08-04 four operator-authorized write/restore cycles on real document
 * 4490 recorded the save answering in ~2.5–3.0 s, Kuali's own document query
 * agreeing on the first sample ~270 ms later, and a full browser reload agreeing
 * within ~3 s: worst observed fence→trustworthy-negative ≈ 3.3 s (the measured
 * proof is retained in ref write-safety's Phase-2 as-built record).
 *
 * What transfers is the MECHANISM, not the field: `submitDocumentV2` serializes
 * the whole current-step section in one request either way, and the negative
 * read is the same deterministic reload of the same document. `minSinceFenceMs`
 * is kept at the same deliberately large **30 s** — about nine times the worst
 * observation — with two reads 5 s apart on the same source state. And the arm
 * is safe in the direction it can be wrong: settling a negative here re-fences
 * and re-saves the IDENTICAL staged field set, which is why this is not the
 * `operator-only` case chunk 4's UCPath termination is, where the retry would
 * be a second real termination.
 */
import { z } from "zod";
import { EidSchema, ObservationIdSchema, TaskIdSchema, taskId } from "../../ids.js";
import { KUALI_RRSS_DISPLAYED_EID } from "../../ui/kuali-rrss-document.js";
import {
  KualiFinalizationTargetSchema,
  KualiSavedFinalizationProofSchema,
} from "../../ui/kuali-separation-finalization.js";
import type { KualiSavedFinalizationProof } from "../../ui/kuali-separation-finalization.js";
import { ContractFieldPathSchema, defineTaskContract } from "../base.js";
import { EXAMPLE_KUALI_FINALIZATION_FIELDS } from "./match-separation-finalization.js";

/**
 * The commit's own output: the exact document identity and field set the click
 * targeted. It is NOT evidence the save landed — beat ⑥ replaces it with the
 * verifier's reload-read-back proof before anything becomes `done`.
 */
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
