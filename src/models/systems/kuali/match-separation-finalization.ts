/** The IDEMPOTENCY PROBE for the Kuali finalization write: one question — does this document ALREADY carry this finalization — answered as a four-state verdict, never a boolean. */
import { z } from "zod";
import { EidSchema, ObservationIdSchema, taskId } from "../../../rules/identity/ids.js";
import { KUALI_RRSS_DISPLAYED_EID } from "../../ui/kuali-rrss-document.js";
import {
  KualiFinalizationTargetSchema,
  KualiSavedFinalizationProofSchema,
} from "../../ui/kuali-separation-finalization.js";
import { probeVerdictSchema } from "../../../rules/write-safety/write-safety-primitives.js";
import { ContractFieldPathSchema, defineTaskContract } from "../../task/task-contract.js";

export const KualiFinalizationVerdictSchema = probeVerdictSchema(KualiSavedFinalizationProofSchema);
export type KualiFinalizationVerdict = z.infer<typeof KualiFinalizationVerdictSchema>;

/** A synthetic staged-variable set used only as the sealed contract examples' input side; checked-in data, so no real EID, action id, document number or name belongs in it. */
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
  // Declare only task-produced refusals; driver failures retain their own error path.
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
