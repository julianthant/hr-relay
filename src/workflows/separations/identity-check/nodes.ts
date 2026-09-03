/**
 * D265 §1.2.2 rule 2 — the *Identity check* step's node fragments: UCPath's
 * own search for the name the Kuali form claims, the reduction to ONE subject,
 * the evidence packet, the conditional name-only gate and the shared identity
 * authority check.
 *
 * A fragment owns a node's IDENTITY — id, contract, label, replay, or the
 * gate's status key and result schema — and takes its WIRING (`dependsOn` +
 * `bind`) from the graph that applies it (see `src/base/flow.ts`, "node
 * fragments"). The composition wires these from the Kuali reads upstream; the
 * three write harnesses (`./descriptor.ts`, `../ucpath-transaction/`,
 * `../kuali-finalization/`) wire them from their own ingress and bind the
 * comparison to `noSeparationWritePlan` because they file one step's worth of
 * writes and have no whole plan to show (rule 3: a harness IMPORTS these
 * fragments rather than restating them).
 */
import { defineWorkflowStepNodeFactory } from "../../../base/flow.js";
import { NAME_SEARCH_NODE, SUBJECT_NODE, COMPARISON_NODE, GATE_NODE, APPROVAL_NODE } from "./node-ids.js";
import { SeparationsMatchIdentity } from "../../../domain/contracts/separations/match-identity.js";
import { SeparationsMatchSeparationSubject } from "../../../domain/contracts/separations/match-separation-subject.js";
import { SeparationsVerifyIdentityApproval } from "../../../domain/contracts/separations/verify-identity-approval.js";
import { SearchPersonOrg } from "../../../domain/contracts/ucpath/search-person-org.js";
import { IdentityApprovalResultSchema } from "../../../domain/separations/identity-approval.js";
import { IDENTITY_CHECK_STEP } from "./step.js";


const nodes = defineWorkflowStepNodeFactory(IDENTITY_CHECK_STEP);

/**
 * Every graph that applies this node binds `keepNonHdh: true` and runs it
 * UNCONDITIONALLY — chunk 3's two sharpest choices. Legacy searches only when
 * its name tier came back `different`, so the alternative candidate
 * `T002173685` turned on exists only on the runs a Levenshtein threshold
 * happened to select; and an HDH filter would hide exactly the career
 * employee a common name matched. The HDH filter exists so person-lookup can
 * pick a preferred candidate; here the point is to SHOW the operator every
 * person this name resolves to.
 */
export const nameSearchNode = nodes.task(NAME_SEARCH_NODE, SearchPersonOrg, {
  label: "Name Search",
  replay: "checkpoint",
});

export const subjectNode = nodes.task(SUBJECT_NODE, SeparationsMatchSeparationSubject, {
  label: "Separation Subject",
  replay: "checkpoint",
});

export const comparisonNode = nodes.task(COMPARISON_NODE, SeparationsMatchIdentity, {
  label: "Identity Comparison",
  replay: "checkpoint",
});

/**
 * When the declared source is `name-resolved`, `resolvedBy: "operator"` and
 * nothing else can resolve it (ref write-safety §14.4). Not a retry, not a bump,
 * not a cascade from a parent, not AI (charter
 * §23 / D60), and not a generic "Done" — the kernel's ONLY path into
 * `gate_results` is the typed `resolve-gate` command, which parses this exact
 * schema and CASes the run version. A supplied-EID packet makes the condition
 * false; the executor records no gate result or operator decision.
 */
export const identityApprovalGate = nodes.operatorGate(GATE_NODE, {
  label: "Identity Approval",
  statusKey: "awaitingIdentityApproval",
  result: IdentityApprovalResultSchema,
  when: { kind: "equals", of: { from: "node", nodeId: COMPARISON_NODE, path: "packet.emplIdSource" }, value: "name-resolved" },
});

/**
 * `always-rerun`, deliberately: this node's whole job is to compare a stored
 * gate result against re-derived evidence, and a replayed checkpoint would be
 * the previous comparison's ANSWER standing in for the comparison.
 */
export const approvalNode = nodes.task(APPROVAL_NODE, SeparationsVerifyIdentityApproval, {
  label: "Approval Check",
  replay: "always-rerun",
});

export { NAME_SEARCH_NODE, SUBJECT_NODE, COMPARISON_NODE, GATE_NODE, APPROVAL_NODE } from "./node-ids.js";
