/**
 * `ucpath/verify-termination` — the `save-verify` READ-BACK at doc 09 beat ⑥.
 *
 * It is a separate contract from the idempotency probe even though both return
 * the same verdict shape, because the kernel calls them at different beats for
 * different reasons: the probe runs at ① on its own read lease and may navigate
 * freely; the verifier runs immediately after the click and is the ONLY thing
 * that may turn a submitted wizard into `done`. A contract that pointed its
 * `verify` at the probe would be a verifier that never re-read.
 *
 * ## Every non-`present` verdict parks. That is the whole scenario set.
 *
 * | Scenario | Legacy | Here |
 * |---|---|---|
 * | **S51** submit times out, no banner, no confirmation | throws — "PeopleSoft's outcome is unknown, refusing to report success" | `unknown` ⇒ **park**. Legacy's best line, kept as a kernel state instead of a throw |
 * | **S52** submit confirmed, `T#` unreadable in 15 s | throws before Kuali finalization | `unknown` ⇒ **park**. The write may have landed; only an operator resolves it |
 * | **S50** submit produces an error banner | logged, empty `T#`, **Kuali still written blank** | `absent` ⇒ **park** (never `done`), and no downstream node runs |
 * | **S47** `Create Transaction` reports failure | same silent-risk path | refused in `prepare`, before any fence |
 * | **S53** any other exception | caught, screenshotted, **swallowed** | a structured failure; there is no blanket catch |
 *
 * The one thing this contract may never do is report success from a number
 * alone. `present` requires the `T…` **and** an approval status, because a
 * `Denied` transaction carries a perfectly well-formed number.
 */
import { EidSchema, ObservationIdSchema, taskId } from "../../ids.js";
import {
  UCPATH_SS_SMART_HR_DISPLAYED_NAME,
  UcpathTerminationTargetSchema,
} from "../../ui/ucpath-smart-hr-termination.js";
import { ContractFieldPathSchema, defineTaskContract } from "../base.js";
import { UcpathTerminationVerdictSchema } from "./match-existing-termination.js";

export const UcpathVerifyTermination = defineTaskContract({
  id: taskId("ucpath/verify-termination"),
  title: "Verify Filed UCPath Termination",
  effect: "read",
  input: UcpathTerminationTargetSchema,
  output: UcpathTerminationVerdictSchema,
  errorCodes: ["ucpath-unavailable", "unexpected-page-state", "subject-mismatch"],
  subject: {
    kind: "person",
    expected: { fromInput: ContractFieldPathSchema.parse("expectedName"), identity: "name" },
    observe: ObservationIdSchema.parse(UCPATH_SS_SMART_HR_DISPLAYED_NAME),
    match: "normalized-exact-name",
    requiredAt: "before-subject-read",
  },
  freshness: { defaultMaxAgeMs: 0, defaultOverride: "forbidden" },
  provenance: { default: "live" },
  scenarios: ["separations-ucpath-termination/dry-run-preview"],
  example: {
    state: "present",
    proof: {
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

export { UcpathTerminationTargetSchema };
