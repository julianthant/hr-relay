/**
 * D265 §1.2.2 rule 2 — the *Kuali finalization* step's one entry identity: §4e's
 * one save over twelve staged fields, proved by a reload read-back (D128/S59).
 *
 * An entry identity owns a node's IDENTITY — id, contracts, label and the whole
 * write policy — and takes its WIRING (references + binds) from the workflow
 * definition that uses it (`defineStepEntries`, D315). The composition binds
 * the variables from the reconciled folds and the receipt; the harness in this
 * folder binds them from its own ingress (rule 3). `existingComments` is the
 * one pure fold only this step's binds consume, so it lives here.
 */
import { defineStepEntries } from "../../../base/workflow-definition.js";
import { FILING_PRESENCE_NODE, FINALIZE_NODE } from "./node-ids.js";
import { KualiSaveSeparationFinalization } from "../../../domain/contracts/kuali/save-separation-finalization.js";
import { KualiStageSeparationFinalization } from "../../../domain/contracts/kuali/stage-separation-finalization.js";
import { UcpathVerifyTerminationFilingPresent } from "../../../domain/contracts/ucpath/verify-termination-filing-present.js";
import { KUALI_FINALIZATION_STEP } from "./step.js";


const nodes = defineStepEntries(KUALI_FINALIZATION_STEP);

/**
 * Always re-read the durable UCPath filing immediately before finalization.
 * Replaying a checkpoint would make an old observation authorize a new Kuali
 * write after the filing had moved, disappeared, or become denied.
 */
export const filingPresenceNode = nodes.task(
  FILING_PRESENCE_NODE,
  UcpathVerifyTerminationFilingPresent,
  { label: "Verify Current UCPath Filing", replay: "always-rerun" },
);

/** `""` when the control was empty — S56's baseline, which is a real value. */
export function existingComments(comments: { state: "present"; value: string } | { state: "absent" }): string {
  return comments.state === "present" ? comments.value : "";
}

/**
 * `probePolicy: "always"` (§5 item 3's recorded answer): separations files a
 * real, hard-to-reverse termination and this write is what records its
 * transaction number on the source document; a probe is one document read
 * against a page the run is already on.
 *
 * Budget CONFIRMED live 2026-08-14 (§9.12 item 6): probe 3.30 s + prepare
 * 8.06 s = 11.4 s worst legs against 45 000 ms, ~4x headroom.
 */
export const finalizeKualiNode = nodes.transaction(FINALIZE_NODE, {
  label: "Finalize Kuali Document",
  prepare: KualiStageSeparationFinalization,
  commit: KualiSaveSeparationFinalization,
  dryRun: "stop-after-prepare",
  probePolicy: "always",
  probeToFenceMaxMs: 45_000,
});

export { FILING_PRESENCE_NODE, FINALIZE_NODE } from "./node-ids.js";
