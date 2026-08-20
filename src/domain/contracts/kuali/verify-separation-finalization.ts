/**
 * `kuali/verify-separation-finalization` — the `save-verify` READ-BACK at
 * ref write-safety beat ⑥, and the answer to the behavior review's open question:
 * *"after a Kuali finalization save, what is the cheapest way to prove it
 * landed?"* (**S59**).
 *
 * The answer is: re-open the document and compare EVERY written field against
 * the EXACT staged variables (§4e beat 4). Not the transaction number alone —
 * a save that carried the number and dropped the department is a document that
 * looks finalized and is not — and not the page's own echo, which is what the
 * in-memory form model would return whether or not anything persisted.
 *
 * "EVERY written field" is **twelve** since §4e's 2026-08-14 amendment, which
 * added legacy's step-13 `Last Day Worked` / `Separation Date` write-backs to
 * the staged set. That changes nothing about this contract's shape: the two
 * dates are staged from the reconciled variables like the other ten, and are
 * compared here against those exact variables.
 *
 * ## Every non-`present` verdict parks. That is the whole scenario set.
 *
 * | Scenario | Legacy | Here |
 * |---|---|---|
 * | **S59** `Save` clicked, Kuali persists nothing | reported as SUCCESS — there is no read-back at all | `absent` ⇒ **park**, naming every field that disagreed |
 * | Save landed partially (one control dropped) | invisible; legacy never re-reads | `absent` ⇒ **park**. A partial finalization is not a finalization |
 * | The reload itself fails | n/a | `unknown` ⇒ **park**. A failed check is never an absence |
 * | **S60** UCPath filed, Kuali finalization fails | `failed` with an error string; the distinction lives in the operator's head | a parked write with a named intent — §4c |
 *
 * It is a separate contract from the idempotency probe even though both return
 * the same verdict shape, because ref write-safety §2.1 gives them different jobs at
 * different beats: the probe runs at ① on its own read lease and may navigate
 * freely; this runs on the RETAINED transaction page immediately after the
 * click, and its reload is the only thing that can turn a UI-silent Kuali save
 * into `done`. Splitting them keeps a wrong wiring impossible to hide — a
 * contract that pointed its `verify` at the probe would be a verifier that
 * never reloaded.
 */
import { EidSchema, ObservationIdSchema, taskId } from "../../ids.js";
import { KUALI_RRSS_DISPLAYED_EID } from "../../ui/kuali-rrss-document.js";
import { KualiFinalizationTargetSchema } from "../../ui/kuali-separation-finalization.js";
import { ContractFieldPathSchema, defineTaskContract } from "../base.js";
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
