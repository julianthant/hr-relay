/**
 * `kuali/match-separation-finalization` — doc 09 §5's IDEMPOTENCY PROBE for the
 * Kuali finalization write (chunk 5).
 *
 * It answers exactly one question: does this document ALREADY carry this
 * finalization? The answer is a four-state `ProbeVerdict`, never a boolean.
 *
 *  - `present`   — the reloaded document shows every one of the twelve staged
 *                  fields, exactly ⇒ typed proof.
 *  - `absent`    — the document was read and disagrees on at least one field ⇒
 *                  typed evidence naming every disagreement. That is the COMMON
 *                  case, not an edge: §9.3's live doc 4502 is blank in five of
 *                  these controls and sits on the `- - -` sentinel in a sixth.
 *  - `unknown`   — the read itself failed ⇒ park. A failed check is never an
 *                  absence.
 *
 * `ambiguous` has no producer here and never will: a document number names one
 * document, and one document carries one value per control. The arm exists on
 * `probeVerdictSchema` for probes that scan a GRID (chunk 4's
 * `ucpath/match-existing-termination` can genuinely see two rows); a page-read
 * probe cannot reach it, and nothing in this store fabricates one.
 *
 * ## Probe policy: `"always"` (§5 item 3)
 *
 * Separations files a real, hard-to-reverse termination and the Kuali
 * finalization is what records its transaction number on the source document; a
 * probe is one page read against a page the run is already on. The declaration
 * itself lives on the commit contract, which is where doc 09 requires it.
 *
 * ## Why it is a separate contract from the verifier
 *
 * Same shape, different job and different beat (doc 09 §2.1): the probe runs at
 * ① on its own read lease and may navigate freely; the verifier runs at ⑥ on
 * the RETAINED transaction page immediately after the click. A contract that
 * pointed its `verify` at the probe would be a verifier that never reloaded.
 */
import { z } from "zod";
import { EidSchema, ObservationIdSchema, taskId } from "../../ids.js";
import { KUALI_RRSS_DISPLAYED_EID } from "../../ui/kuali-rrss-document.js";
import {
  KualiFinalizationTargetSchema,
  KualiSavedFinalizationProofSchema,
} from "../../ui/kuali-separation-finalization.js";
import { probeVerdictSchema } from "../../write-safety-primitives.js";
import { ContractFieldPathSchema, defineTaskContract } from "../base.js";

export const KualiFinalizationVerdictSchema = probeVerdictSchema(KualiSavedFinalizationProofSchema);
export type KualiFinalizationVerdict = z.infer<typeof KualiFinalizationVerdictSchema>;

/**
 * A synthetic staged-variable set, used only as the sealed contract examples'
 * input side. It is checked-in data, so no real EID, action id, document number
 * or person's name belongs in it.
 */
export const EXAMPLE_KUALI_FINALIZATION_FIELDS = Object.freeze({
  department: "000412 - Housing/Dining/Hospitality",
  payrollTitleCode: "004921",
  payrollTitle: "STDT 2",
  requestAcknowledged: true,
  timekeeperName: "Deterministic Timekeeper",
  lastDayWorked: "06/09/2026",
  separationDate: "06/10/2026",
  terminationEffectiveDate: "06/11/2026",
  submittedTerminationTemplate: true,
  transactionNumber: "T002209631",
  finalPay: "does-not-need-final-pay-student",
  timekeeperComments: "Termination effective date set from the reconciled separation date.",
} as const);

export const KualiMatchSeparationFinalization = defineTaskContract({
  id: taskId("kuali/match-separation-finalization"),
  title: "Probe Kuali Separation Finalization",
  effect: "read",
  input: KualiFinalizationTargetSchema,
  output: KualiFinalizationVerdictSchema,
  // Only codes this task PRODUCES: `subject-mismatch` when the reloaded
  // document displays another person, `unexpected-page-state` when it is
  // another document. A driver throw is already `unknown` by then, and a
  // declared code with no producer is a dead union member.
  errorCodes: ["unexpected-page-state", "subject-mismatch"],
  subject: {
    kind: "person",
    expected: { fromInput: ContractFieldPathSchema.parse("emplId"), identity: "eid" },
    observe: ObservationIdSchema.parse(KUALI_RRSS_DISPLAYED_EID),
    match: "normalized-exact-eid",
    requiredAt: "before-subject-read",
  },
  freshness: { defaultMaxAgeMs: 0, defaultOverride: "forbidden" },
  provenance: { default: "live" },
  scenarios: ["separations-kuali-finalization/save-verify-read-back"],
  example: {
    state: "present",
    proof: {
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
