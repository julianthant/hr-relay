/**
 * `kuali/verify-timekeeper-annotation` — the `save-verify` READ-BACK doc 09
 * §10 lists as a genuine addition ("`kuali/read-saved-document` … does NOT
 * exist today … must be built and live-verified before Kuali submit tasks can
 * instantiate a passing `completion`").
 *
 * It is a separate contract from the idempotency probe even though both return
 * the same verdict shape, because doc 09 §2.1 gives them different jobs and the
 * kernel calls them at different beats: the probe runs at ① on its own read
 * lease and may navigate freely; the verifier runs at ⑥ on the RETAINED
 * transaction page, immediately after the click, and is the ONLY thing that can
 * turn a UI-silent Kuali save into `done`.
 *
 * Splitting them also keeps a wrong wiring impossible to hide: a contract that
 * pointed its `verify` at the probe would be a verifier that never reloaded.
 */
import { EidSchema, ObservationIdSchema, taskId } from "../../ids.js";
import { ContractFieldPathSchema, defineTaskContract } from "../base.js";
import {
  KualiTimekeeperTargetSchema,
  KualiTimekeeperVerdictSchema,
} from "./read-timekeeper-annotation.js";

export const KualiVerifyTimekeeperAnnotation = defineTaskContract({
  id: taskId("kuali/verify-timekeeper-annotation"),
  title: "Verify Saved Kuali Timekeeper Annotation",
  effect: "read",
  input: KualiTimekeeperTargetSchema,
  output: KualiTimekeeperVerdictSchema,
  errorCodes: ["kuali-unavailable", "unexpected-page-state", "subject-mismatch"],
  subject: {
    kind: "person",
    expected: { fromInput: ContractFieldPathSchema.parse("emplId"), identity: "eid" },
    observe: ObservationIdSchema.parse("kuali.rrss-document.displayed-eid"),
    match: "normalized-exact-eid",
    requiredAt: "before-subject-read",
  },
  freshness: { defaultMaxAgeMs: 0, defaultOverride: "forbidden" },
  provenance: { default: "live" },
  scenarios: ["kuali-timekeeper-annotation/dry-run-preview"],
  // Synthetic identity on purpose: a sealed contract example is checked-in
  // data, and no real EID / action id / document number belongs in the tree.
  example: {
    state: "present",
    proof: {
      kind: "kuali-saved-timekeeper",
      actionId: "0123456789abcdef01234567",
      documentNumber: "4444",
      timekeeperName: "PROBE-DELETE-ME",
      observedEid: EidSchema.parse("10800000"),
      source: "reload-read-back",
    },
  },
});
