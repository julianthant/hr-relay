/**
 * D265 §1.2.2 rule 2 — the *Kuali finalization* step's one node fragment: §4e's
 * one save over twelve staged fields, proved by a reload read-back (D128/S59).
 *
 * A fragment owns a node's IDENTITY — id, contracts, label and the whole write
 * policy — and takes its WIRING (`dependsOn` + the binds) from the graph that
 * applies it (see `src/base/flow.ts`, "node fragments"). The composition binds
 * the variables from the reconciled folds and the receipt; the harness in this
 * folder binds them from its own ingress (rule 3). `existingComments` is the
 * one pure fold only this step's binds consume, so it lives here.
 */
import { defineTransactionNode } from "../../../base/flow.js";
import { defineWorkflowStepNodes } from "../../../base/workflow.js";
import { KualiSaveSeparationFinalization } from "../../../domain/contracts/kuali/save-separation-finalization.js";
import { KualiStageSeparationFinalization } from "../../../domain/contracts/kuali/stage-separation-finalization.js";
import { KUALI_FINALIZATION_STEP } from "./step.js";

export const FINALIZE_NODE = "finalize-kuali";

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
export const finalizeKualiNode = defineTransactionNode(KUALI_FINALIZATION_STEP, FINALIZE_NODE, {
  label: "Finalize Kuali Document",
  prepare: KualiStageSeparationFinalization,
  commit: KualiSaveSeparationFinalization,
  dryRun: "stop-after-prepare",
  probePolicy: "always",
  probeToFenceMaxMs: 45_000,
});

/** The step's timeline category — key and label from `step.ts`, nodes from the fragment above. */
export const KUALI_FINALIZATION_STEP_NODES = defineWorkflowStepNodes(KUALI_FINALIZATION_STEP, [finalizeKualiNode]);
