/**
 * D265 §1.2.2 rule 2 — the *Kuali extraction* step's node fragments: what the
 * composition (`../descriptor.ts`) and this folder's harness each apply to
 * their own graph, wired from their own upstreams.
 *
 * A fragment owns a node's IDENTITY — id, contract, label, replay — and takes
 * its WIRING (`dependsOn` + `bind`) from the graph that applies it (see
 * `src/base/flow.ts`, "node fragments"). The rationale for each node's replay
 * policy lives here, beside the policy; the rationale for what feeds a node
 * lives beside the bind that feeds it.
 */
import { defineTaskNode } from "../../../base/flow.js";
import { defineWorkflowStepNodes } from "../../../base/workflow.js";
import { KualiReadSeparationDocument } from "../../../domain/contracts/kuali/read-separation-document.js";
import { KualiSearchSeparationAction } from "../../../domain/contracts/kuali/search-separation-action.js";
import { SeparationsMatchTerminationType } from "../../../domain/contracts/separations/match-termination-type.js";
import { SeparationsReadSeparationPlan } from "../../../domain/contracts/separations/read-separation-plan.js";
import { KUALI_EXTRACTION_STEP } from "./step.js";

export const ACTION_NODE = "resolve-action";
export const DOCUMENT_NODE = "document";
export const PLAN_NODE = "plan";
export const TERMINATION_TYPE_NODE = "termination-type";

/**
 * D261's head node. It turns the one number a human knows into the address
 * Kuali actually answers to, by filtering the Action List's own search box
 * and reading the matched row's `href` — no click into a document, nothing
 * staged, nothing written.
 *
 * `replay: "checkpoint"` for `document`'s reason, one node later: the node's
 * product is a VALUE, so restoring it into a fresh browser leaves nothing
 * broken, and the gate releases every session on the way in. The value CAN go
 * stale between the checkpoint and a post-gate finalization — an action id
 * names a workflow step — and that is exactly the case `openDocument` refuses
 * loudly on, by proving the document number off the page's own heading. A
 * freshness bound here would replace a precise refusal with a timer, and §5A
 * already ruled that out for this graph.
 */
export const actionNode = defineTaskNode(ACTION_NODE, KualiSearchSeparationAction, {
  label: "Kuali Action",
  replay: "checkpoint",
});

/**
 * Chunk 2's argument verbatim: this node's product is its VALUE, not browser
 * state, so restoring the checkpoint into a fresh browser leaves nothing
 * broken. Nothing downstream stands on the page it opened — the consumers are
 * pure folds — and in the composition every read upstream of the gate is
 * replayed into a browser that has never seen these pages, because the gate
 * parks and the executor releases every session on the way in. Chunk 1's rule
 * ("a node whose real product is BROWSER state may not be `replay:
 * "checkpoint"`") is the same rule read the other way.
 */
export const documentNode = defineTaskNode(DOCUMENT_NODE, KualiReadSeparationDocument, {
  label: "Separation Document",
  replay: "checkpoint",
});

export const planNode = defineTaskNode(PLAN_NODE, SeparationsReadSeparationPlan, {
  label: "Separation Plan",
  replay: "checkpoint",
});

export const terminationTypeNode = defineTaskNode(TERMINATION_TYPE_NODE, SeparationsMatchTerminationType, {
  label: "Termination Type",
  replay: "checkpoint",
});

/** The step's timeline category — key and label from `step.ts`, nodes from the fragments above. */
export const KUALI_EXTRACTION_STEP_NODES = defineWorkflowStepNodes(KUALI_EXTRACTION_STEP, [
  actionNode,
  documentNode,
  planNode,
  terminationTypeNode,
]);
