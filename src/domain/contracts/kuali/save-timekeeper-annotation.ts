/**
 * `kuali/save-timekeeper-annotation` — the COMMIT arm of Phase 2's Kuali
 * transaction proof, and the first `effect:"commit"` contract in this tree.
 *
 * ## Why this is the target
 *
 * Doc 07's Phase-2 rule is "the smallest controlled test-instance or
 * sacrificial test record whose prepare and commit paths are real and whose
 * outcome is independently queryable". The Kuali timekeeper field is exactly
 * that, and it is the one the operator already authorized for a live write
 * round-trip: the 2026-07-23 probe (D78) wrote `PROBE-DELETE-ME` into it on doc
 * 4444, saved, reloaded, confirmed persistence, cleared it, saved, reloaded,
 * confirmed the document was byte-identical again. It is a benign annotation
 * field the legacy flow already fills on drafts, it is reversible by writing
 * the previous value back, and it touches no workflow button.
 *
 * ## Why the completion arm is `save-verify` and can never be a receipt
 *
 * Kuali issues no confirmation number and the save is UI-silent (doc 09 §13
 * OQ1 (a)). The ONLY landing proof is a reload read-back, so `verify` points at
 * `kuali/verify-timekeeper-annotation`, and any verdict other than `present`
 * parks (doc 09 §7 row 6). `output` carries the exact staged state the commit
 * clicked Save on — a CLAIM, not proof; nothing in the kernel promotes it.
 * `proofFromOutput` exists to satisfy the static round-trip the contract
 * factory checks, and to reconstruct node output from a probe-derived proof on
 * the preflight-present / recovery paths (`outputFromProof`).
 *
 * ## Why `recoveryAbsence` is `stabilized`, and where its numbers come from
 *
 * D64/D69 let a stabilized negative settle into a new intent generation only
 * when the target has a trustworthy negative read AND a MEASURED propagation
 * window. Kuali's negative read has always been trustworthy — it is the same
 * deterministic field read the positive uses — and the window was measured on
 * 2026-08-04 by four operator-authorized write/restore cycles on doc 4490,
 * each one a real `Save` and a real reversal:
 *
 * | cycle | click → `submitDocumentV2` response | server state agrees | browser reload agrees |
 * |---|---|---|---|
 * | write   | 2495ms | +277ms | +2971ms |
 * | restore | 3036ms | +283ms | +2475ms |
 * | write   | 2699ms | +269ms | +2418ms |
 * | restore | 2459ms | +270ms | +2320ms |
 *
 * The dominant term is the SAVE ITSELF, not propagation: once Kuali answers,
 * its own document query already returns the new value on the first sample
 * (~270ms, which is mostly that query's own round trip), and a full browser
 * reload agrees within ~3s. Worst observed fence→trustworthy-negative is
 * therefore ≈3.3s. `minSinceFenceMs` is set to **30_000** — about nine times
 * that — and two reads 5s apart must agree, on the same source state. The
 * margin is deliberately large because the measurement is n=4 on one document.
 *
 * This is what the driver's post-click barrier is for: `commit` now waits for
 * the mutation's RESPONSE, not merely its request. Returning at request time is
 * what made a landed write read `absent` at 16:56 on 2026-08-04 — the verifier
 * reloaded while the save was still in flight.
 */
import { z } from "zod";
import { EidSchema, ObservationIdSchema, TaskIdSchema, taskId } from "../../ids.js";
import {
  KualiActionIdSchema,
  KualiDocumentNumberSchema,
  KualiSavedTimekeeperProofSchema,
  KualiTimekeeperNameSchema,
} from "../../ui/kuali-rrss-document.js";
import type { KualiSavedTimekeeperProof } from "../../ui/kuali-rrss-document.js";
import { ContractFieldPathSchema, defineTaskContract } from "../base.js";
import { KualiTimekeeperTargetSchema } from "./read-timekeeper-annotation.js";

/**
 * The commit's own output. `savedState` is the exact document identity + value
 * the click targeted; it is NOT evidence the save landed. Beat ⑥ replaces it
 * with the verifier's reload-read-back proof before anything becomes `done`.
 */
export const KualiSaveTimekeeperOutputSchema = z.strictObject({
  savedState: KualiSavedTimekeeperProofSchema,
});
export type KualiSaveTimekeeperOutput = z.infer<typeof KualiSaveTimekeeperOutputSchema>;

/**
 * The natural business key (doc 09 §5): document identity + the field + the
 * exact value. It never incorporates run position, attempt, or index. Two runs
 * asking for the same annotation on the same document derive the same key, so
 * the second sees the first's committed intent and refuses to double-file; a
 * DIFFERENT value is a different transaction and correctly gets its own key.
 */
export function kualiTimekeeperIdempotencyKey(
  input: z.output<typeof KualiTimekeeperTargetSchema>,
): string {
  return `kuali:${input.documentNumber}|${input.actionId}|timekeeper-name|${input.emplId}|${input.timekeeperName}`;
}

export const KualiSaveTimekeeperAnnotation = defineTaskContract({
  id: taskId("kuali/save-timekeeper-annotation"),
  title: "Save Kuali Timekeeper Annotation",
  effect: "commit",
  input: KualiTimekeeperTargetSchema,
  output: KualiSaveTimekeeperOutputSchema,
  errorCodes: ["kuali-unavailable", "unexpected-page-state", "subject-mismatch", "save-refused"],
  subject: {
    kind: "person",
    expected: { fromInput: ContractFieldPathSchema.parse("emplId"), identity: "eid" },
    observe: ObservationIdSchema.parse("kuali.rrss-document.displayed-eid"),
    match: "normalized-exact-eid",
    requiredAt: "after-prepare-before-fence",
  },
  scenarios: ["kuali-timekeeper-annotation/dry-run-preview"],
  writeSafety: {
    completion: {
      kind: "save-verify",
      verify: { taskId: TaskIdSchema.parse("kuali/verify-timekeeper-annotation"), effect: "read" },
      proofSchema: KualiSavedTimekeeperProofSchema,
      proofFromOutput: (output: z.output<typeof KualiSaveTimekeeperOutputSchema>) => output.savedState,
      proofFromPresentProbe: ({ proof }: { proof: KualiSavedTimekeeperProof }) => proof,
      outputFromProof: (proof: KualiSavedTimekeeperProof) => ({ savedState: proof }),
    },
    idempotency: {
      probe: { taskId: TaskIdSchema.parse("kuali/read-timekeeper-annotation"), effect: "read" },
      key: kualiTimekeeperIdempotencyKey,
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
      kind: "kuali-saved-timekeeper",
      actionId: "0123456789abcdef01234567",
      documentNumber: "4444",
      timekeeperName: KualiTimekeeperNameSchema.parse("PROBE-DELETE-ME"),
      observedEid: EidSchema.parse("10800000"),
      source: "reload-read-back",
    },
  },
});

export {
  KualiActionIdSchema,
  KualiDocumentNumberSchema,
  KualiTimekeeperTargetSchema,
};
