import { authenticateDelegationGroup, childTerminalSettlement, delegationCancellationAvailability, currentDelegationManifests, readDelegationScopeEvidence } from "./delegation-authority.js";
import { DelegationRetryRequestSchema } from "./delegation-contracts.js";
import { DelegationTerminalEvidenceSchema } from "../../../models/run/result.js";
import { lifecycleCommandId } from "../../../rules/identity/identifiers.js";
import { RunContinuationRefusedError, validateRunContinuation, readContinuationGate, retainedCheckpoint } from "./run-continuation.js";
import type { AuthorityRepositories } from "./authority-database.js";
import type { RunEnvelope } from "../../../models/run/envelope.js";
import type { GateResultRecord } from "../../../models/workflow/gates.js";
import type { TerminalDependencyEvidence } from "../../../models/run/result.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";

export function continuationDelegationGroups(repositories: AuthorityRepositories, envelope: RunEnvelope) {
  const groups = new Map<string, { manifest: ReturnType<typeof currentDelegationManifests>[number]; group: ReturnType<typeof authenticateDelegationGroup> }>();
  for (const source of [...validateRunContinuation(repositories, envelope)].reverse()) {
    if (source.envelope.runId === envelope.runId) continue;
    for (const manifest of currentDelegationManifests(repositories, source.envelope.runId)) {
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

  /** The run and every run whose retained checkpoint it carries; each reference is read back first. */
  writeRunIds(): RunEnvelope["runId"][] {
    const retained = this.envelope.continuation?.checkpoints.map(reference => retainedCheckpoint(this.repositories, this.envelope, reference).runId) ?? [];
    return [...new Set([this.envelope.runId, ...retained])];
  }

  permitsGate(gate: GateResultRecord): boolean {
    const retained = readContinuationGate(this.repositories, this.envelope, String(gate.nodeId));
    return retained !== undefined && canonicalJsonStringify(retained) === canonicalJsonStringify(gate);
  }

  dependency(nodeId: string, edgeId: string, historical = false) {
    const own = currentDelegationManifests(this.repositories, this.envelope.runId)
      .filter(manifest => manifest.edgeId === edgeId)
      .map(manifest => ({ manifest, group: authenticateDelegationGroup(this.repositories, manifest) }))
      .filter(({ group }) => group.invocation.nodeId === nodeId);
    if (own.length > 1) throw new RunContinuationRefusedError("run-continuation-delegation-ambiguous");
    const retained = own.length > 0 ? own : continuationDelegationGroups(this.repositories, this.envelope)
      .filter(({ manifest, group }) => manifest.edgeId === edgeId && group.invocation.nodeId === nodeId);
    if (retained.length > 1) throw new RunContinuationRefusedError("run-continuation-delegation-ambiguous");
    const selected = retained[0];
    if (selected === undefined) return undefined;
    const evidence = this.repositories.dependencies.evidence(selected.manifest.parentRunId, nodeId);
    if (evidence.parentRunId !== selected.manifest.parentRunId || evidence.nodeId !== nodeId || evidence.edgeId !== edgeId
      || canonicalJsonStringify(evidence.manifest) !== canonicalJsonStringify(selected.manifest)) throw new RunContinuationRefusedError("run-continuation-delegation-owner-mismatch");
    if (!historical || selected.manifest.join === "none" || selected.group.children.every(member => member.history.length === 1)) return evidence;
    const parent = selected.group.parent, source = this.repositories.runs.get(this.envelope.runId);
    if (source === undefined) throw new RunContinuationRefusedError("run-continuation-original-child-authority-unavailable");
    const children = selected.group.children.map(member => {
      let run = member.original;
      for (const previousRunId of member.history.slice(0, -1)) {
        const commandId = lifecycleCommandId("delegation-retry", { dependencyId: member.dependency.dependencyId, previousRunId });
        const command = this.repositories.lifecycleJournal.getCommand(commandId);
        if (command === undefined || !("kind" in command) || command.kind !== "run-lifecycle" || command.operation !== "delegation-retry") throw new RunContinuationRefusedError("run-continuation-original-child-authority-unavailable");
        const retry = DelegationRetryRequestSchema.parse(command.request);
        const owner = retry.continuationOwner === undefined ? undefined : this.repositories.runs.get(retry.continuationOwner.runId);
        if (retry.parentVersion !== parent.version || owner === undefined) {
          throw new RunContinuationRefusedError("run-continuation-original-child-authority-unavailable");
        }
        const issue = this.repositories.lifecycleJournal.findContinuationIssue(owner.envelope.runId, retry.continuationOwner?.version);
        if (owner.envelope.runId === source.envelope.runId && retry.continuationOwner?.version === 1
          && issue?.result.kind === "run" && issue.result.appliedVersion === 1
          && (issue.request.operation === "create" || issue.request.operation === "retry" || issue.request.operation === "recover")) {
          const replacement = this.repositories.runs.get(retry.replacementRunId);
          if (replacement === undefined) throw new RunContinuationRefusedError("run-continuation-original-child-authority-unavailable");
          run = replacement;
        } else if (source.lifecycle.state !== "terminal" || !["failed", "interrupted"].includes(source.lifecycle.outcome)
          || owner.envelope.runId === source.envelope.runId
          || !validateRunContinuation(this.repositories, owner.envelope).some(retained => retained.envelope.runId === source.envelope.runId && retained.version === source.version)) {
          throw new RunContinuationRefusedError("run-continuation-original-child-authority-unavailable");
        }
      }
      const terminal = childTerminalSettlement(run, this.repositories);
      if (terminal === undefined) throw new RunContinuationRefusedError("run-continuation-original-child-authority-unavailable");
      const cancellation = terminal.state === "cancelled" ? delegationCancellationAvailability(this.repositories, run.envelope.runId) : undefined;
      if (cancellation?.state === "unavailable") throw new RunContinuationRefusedError("run-continuation-original-child-authority-unavailable");
      return { run, result: terminal.result, ...(cancellation === undefined ? {} : { cancellation: cancellation.outcome }) };
    });
    return DelegationTerminalEvidenceSchema.parse({ ...evidence, children });
  }

  delegation(nodeId: string, edgeId: string) {
    const group = this.retainedDelegation(nodeId, edgeId);
    if (group !== undefined) return this.repositories.dependencies.evidence(group.manifest.parentRunId, nodeId);
    return undefined;
  }

  /** The rows the retained delegation was admitted from, read back through its authenticated invocation. */
  delegationScope(nodeId: string, edgeId: string) {
    const group = this.retainedDelegation(nodeId, edgeId);
    if (group === undefined) throw new RunContinuationRefusedError("run-continuation-delegation-scope-unavailable");
    return readDelegationScopeEvidence(this.repositories, group.group.parent, group.group.invocation.scopeEvidence);
  }

  private retainedDelegation(nodeId: string, edgeId: string) {
    const selected = continuationDelegationGroups(this.repositories, this.envelope)
      .filter(({ manifest, group }) => manifest.edgeId === edgeId && group.invocation.nodeId === nodeId);
    if (selected.length > 1) throw new RunContinuationRefusedError("run-continuation-delegation-ambiguous");
    return selected[0];
  }

  permitsDelegation(evidence: Extract<TerminalDependencyEvidence, { state: "delegation-resolved" }>): boolean {
    const retained = this.delegation(String(evidence.nodeId), String(evidence.edgeId));
    return retained !== undefined && canonicalJsonStringify(retained) === canonicalJsonStringify(evidence);
  }
}
