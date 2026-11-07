/** The `save-verify` READ-BACK: re-open the document and compare EVERY written field against the EXACT staged variables; every non-`present` verdict parks. */
import { EidSchema, ObservationIdSchema, taskId } from "../../../rules/identity/ids.js";
import { KUALI_RRSS_DISPLAYED_EID } from "../../ui/kuali-rrss-document.js";
import { KualiFinalizationTargetSchema } from "../../ui/kuali-separation-finalization.js";
import { ContractFieldPathSchema, defineTaskContract } from "../../task/task-contract.js";
import {
  EXAMPLE_KUALI_FINALIZATION_FIELDS,
  KualiFinalizationVerdictSchema,
} from "./match-separation-finalization.js";

export const KualiVerifySeparationFinalization = defineTaskContract({
  id: taskId("kuali/verify-separation-finalization"),
  title: "Verify Saved Kuali Separation Finalization",
  effect: "read",
  input: KualiFinalizationTargetSchema,
  output: KualiFinalizationVerdictSchema,
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
  // Synthetic identity on purpose: a sealed contract example is checked-in
  // data, and no real EID / action id / document number belongs in the tree.
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
