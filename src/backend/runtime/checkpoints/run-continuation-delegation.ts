import { authenticateDelegationGroup, retainedDelegationManifests } from "../../storage/sqlite/delegation-authority.js";
import { RunContinuationRefusedError, validateRunContinuation, readContinuationGate } from "./run-continuation.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import type { RunEnvelope } from "../../../models/run/envelope.js";
import type { GateResultRecord } from "../../../models/workflow/gates.js";
import type { TerminalDependencyEvidence } from "../../../models/run/result.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";

export function continuationDelegationGroups(repositories: AuthorityRepositories, envelope: RunEnvelope) {
  const groups = new Map<string, { manifest: ReturnType<typeof retainedDelegationManifests>[number]; group: ReturnType<typeof authenticateDelegationGroup> }>();
  for (const source of [...validateRunContinuation(repositories, envelope)].reverse()) {
    if (source.envelope.runId === envelope.runId) continue;
    for (const manifest of retainedDelegationManifests(repositories, source.envelope.runId)) {
      const group = authenticateDelegationGroup(repositories, manifest);
      const key = `${group.invocation.nodeId}/${manifest.edgeId}`;
      const previous = groups.get(key);
      if (previous !== undefined && previous.manifest.manifestId !== manifest.manifestId) throw new RunContinuationRefusedError("run-continuation-delegation-ambiguous");
      groups.set(key, { manifest, group });
    }
  }
  return [...groups.values()];
}

export class AuthenticatedRunContinuation {
  private constructor(private readonly repositories: AuthorityRepositories, private readonly envelope: RunEnvelope) {}

  static authenticate(repositories: AuthorityRepositories, envelope: RunEnvelope) {
    validateRunContinuation(repositories, envelope);
    return new AuthenticatedRunContinuation(repositories, envelope);
  }

  permitsGate(gate: GateResultRecord): boolean {
    const retained = readContinuationGate(this.repositories, this.envelope, String(gate.nodeId));
    return retained !== undefined && canonicalJsonStringify(retained) === canonicalJsonStringify(gate);
  }

  delegation(nodeId: string, edgeId: string) {
    const selected = continuationDelegationGroups(this.repositories, this.envelope)
      .filter(({ manifest, group }) => manifest.edgeId === edgeId && group.invocation.nodeId === nodeId);
    if (selected.length > 1) throw new RunContinuationRefusedError("run-continuation-delegation-ambiguous");
    const group = selected[0];
    if (group !== undefined) return this.repositories.dependencies.evidence(group.manifest.parentRunId, nodeId);
    return undefined;
  }

  permitsDelegation(evidence: Extract<TerminalDependencyEvidence, { state: "delegation-resolved" }>): boolean {
    const retained = this.delegation(String(evidence.nodeId), String(evidence.edgeId));
    return retained !== undefined && canonicalJsonStringify(retained) === canonicalJsonStringify(evidence);
  }
}
