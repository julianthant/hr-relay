import type { RunRecord } from "../../../models/run/record.js";
import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { authenticateDelegationGroup, retainedDelegationManifests, delegationEdgeForChild } from "../../storage/sqlite/delegation-authority.js";
import { authenticateRootRun } from "../../storage/sqlite/delegation-root-authority.js";
import type { RuntimeConfigClaimToken } from "../../../models/config/runtime-generation.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
/** Configuration authorization is separate from worker ownership fencing. */
export function runRuntimeMatches(repositories:Pick<AuthorityRepositories,"runtimeConfig"|"settingsCurrent">,token:RuntimeConfigClaimToken):boolean {
 return repositories.runtimeConfig.matchesClaim(token);
}

export function delegatedCandidateEligible(repositories: AuthorityRepositories, candidate: RunRecord, homeWorkflow: string,
  resolveDescriptor: ((workflow: string) => AnyWorkflowDescriptor | undefined) | undefined): boolean {
  const ancestry: RunRecord[] = [];
  const visited = new Set<string>();
  let current = candidate;
  for (;;) {
    if (visited.size >= 16 || visited.has(current.envelope.runId)) throw new Error("delegation-ancestry-cycle-or-depth");
    visited.add(current.envelope.runId); ancestry.push(current);
    if (current.envelope.parent === undefined) break;
    const parent = repositories.runs.get(current.envelope.parent.runId);
    if (parent === undefined) throw new Error("delegation-parent-unavailable");
    current = parent;
  }
  if (current.envelope.workflow !== homeWorkflow) return false;
  if (candidate.envelope.parent === undefined) return true;
  authenticateRootRun(repositories, current);
  if (resolveDescriptor === undefined) throw new Error("delegation-dispatch-resolver-unavailable");
  for (const child of ancestry.slice(0, -1)) {
    const parent = ancestry[ancestry.indexOf(child) + 1];
    if (parent === undefined) throw new Error("delegation-parent-unavailable");
    const matches = retainedDelegationManifests(repositories, parent.envelope.runId)
      .map(manifest => ({ manifest, group: authenticateDelegationGroup(repositories, manifest) }))
      .flatMap(({ manifest, group }) => group.children.filter(member => child === candidate ? member.child.envelope.runId === child.envelope.runId : member.history.includes(child.envelope.runId))
        .map(member => ({ manifest, invocation: group.invocation, member })));
    if (matches.length !== 1) throw new Error("delegation-dispatch-membership-unavailable");
    const { manifest, invocation } = matches[0];
    if (parent.cancelRequested === true && manifest.policy.cascadeCancel !== "independent") return false;
    const producer = resolveDescriptor(parent.envelope.workflow), target = resolveDescriptor(child.envelope.workflow);
    const node = producer === undefined ? undefined : descriptorRuntimeNodes(producer).find(node => node.id === invocation.nodeId);
    if (producer === undefined || target === undefined || producer.version !== parent.envelope.descriptorVersion
      || producer.contractFingerprint !== parent.envelope.contractFingerprint || target.version !== child.envelope.descriptorVersion
      || target.contractFingerprint !== child.envelope.contractFingerprint || node?.kind !== "child-run"
      || node.target.id !== target.id || node.edgeId !== manifest.edgeId || node.cardinality !== manifest.cardinality
      || node.join !== manifest.join || canonicalJsonStringify(node.policy) !== canonicalJsonStringify(manifest.policy)
      || deriveSchemaHash(node.target.input, "input") !== invocation.target.inputSchemaHash
      || deriveSchemaHash(node.target.result, "output") !== invocation.target.resultSchemaHash) throw new Error("delegation-dispatch-definition-mismatch");
  }
  for (const run of ancestry) {
    if (repositories.workerControls.resetForRun(run.envelope.runId) !== undefined) return false;
    if (run.envelope.parent === undefined) break;
    const edge = delegationEdgeForChild(repositories, run.envelope.parent.runId, run.envelope.runId);
    if (edge.policy.cascadeCancel === "independent") break;
  }
  return true;
}
