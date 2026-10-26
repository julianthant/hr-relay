import { authenticateRootRun, authenticateRunPriority } from "./delegation-root-authority.js";
import { z } from "zod";
import type { WorkerResetBinding } from "../../../models/run/worker-control.js";
import type { DependencyRecord } from "../../../rules/workflow/dependencies.js";
import { runClaim, type RunRecord } from "../../../models/run/record.js";
import { RunResultRecordSchema, RunDryRunPreviewResultSchema, terminalEvidenceResult, DelegationTerminalEvidenceSchema, delegationDependencyRecord } from "../../../models/run/result.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { delegationChildInputFingerprint } from "../../../models/workflow/delegation.js";
import { retainedRunProtectedBindings, valueFreeProtectedData } from "../../../models/write-safety/protected-input.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { lifecycleCommandId } from "../../../rules/identity/identifiers.js";
import { DependencyRecordSchema, delegationReadiness, type DelegationManifest, type DelegationReadiness } from "../../../rules/workflow/dependencies.js";
import { DelegationInvocationRequestSchema, DelegationScopeEvidenceSchema, DelegationRetryRequestSchema, DelegationSettlementRequestSchema } from "./delegation-contracts.js";
import type { AuthorityRepositories } from "./authority-database.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../rules/identity/ids.js";
import { CancellationSourceSchema, CanonicalCreateRunRequestSchema, CanonicalRetrySourceRequestSchema } from "./run-store-contracts.js";
import { assertCanonicalRunCommandScope } from "./command-record-row.js";

function authenticateOperatorSource(repositories: AuthorityRepositories, source: NonNullable<ReturnType<AuthorityRepositories["commands"]["get"]>>) {
  if (source.requestedBy !== LOCAL_OPERATOR_ACTOR_ID) throw new Error("delegation-operator-source-unavailable");
  const audit = repositories.commandAudits.findByCommand(source.commandId);
  if (audit === undefined) {
    assertCanonicalRunCommandScope(repositories, source);
    return;
  }
  if (audit.result.state !== "applied" || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(source)) {
    throw new Error("delegation-operator-source-unavailable");
  }
  return audit;
}

export function authenticateOriginalDelegationGroup(repositories: AuthorityRepositories, manifest: DelegationManifest, scopePath = new Set<string>()) {
  if (scopePath.has(manifest.manifestId)) throw new Error("delegation-scope-cycle");
  const nextScopePath = new Set(scopePath).add(manifest.manifestId);
  const parent = repositories.runs.get(manifest.parentRunId);
  const command = repositories.lifecycleJournal.findDelegationInvocation(manifest.manifestId);
  const audit = command === undefined ? undefined : repositories.lifecycleJournal.findAuditByCommand(command.commandId);
  if (parent === undefined || command === undefined || command.operation !== "delegation-invocation" || audit === undefined
    || !("kind" in audit) || audit.kind !== "run-lifecycle" || audit.result.kind !== "run" || audit.result.runId !== parent.envelope.runId
    || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)) throw new Error("delegation-invocation-authority-unavailable");
  const invocation = DelegationInvocationRequestSchema.parse(command.request);
  if (invocation.commandId !== lifecycleCommandId("delegation-invocation", { runId: parent.envelope.runId, attempt: parent.envelope.attempt, nodeId: invocation.nodeId })
    || invocation.runId !== parent.envelope.runId || invocation.attempt !== parent.envelope.attempt
    || invocation.definitionFingerprint !== parent.envelope.contractFingerprint || invocation.edgeId !== manifest.edgeId
    || invocation.manifestId !== manifest.manifestId || invocation.planFingerprint !== manifest.manifestFingerprint
    || invocation.parentInputDigest !== sha256Hex(canonicalJsonStringify(valueFreeProtectedData(parent.input)))
    || invocation.dryRun !== parent.envelope.dryRun || invocation.configSnapshotId !== parent.envelope.configSnapshotId
    || invocation.configFingerprint !== parent.envelope.configFingerprint) throw new Error("delegation-invocation-binding-mismatch");
  if (manifest.inputSchemaHash !== invocation.target.inputSchemaHash || manifest.resultSchemaHash !== invocation.target.resultSchemaHash
    || manifest.cardinality !== invocation.cardinality || manifest.join !== invocation.join
    || canonicalJsonStringify(manifest.policy) !== canonicalJsonStringify(invocation.policy)
    || manifest.children.length !== invocation.children.length) throw new Error("delegation-manifest-binding-mismatch");
  const approvals = readDelegationScopeEvidence(repositories, parent, invocation.scopeEvidence, nextScopePath);
  if (sha256Hex(canonicalJsonStringify(valueFreeProtectedData(approvals))) !== invocation.approvalDigest) throw new Error("delegation-approval-binding-mismatch");
  const children = manifest.children.map((entry, index) => {
    const planned = invocation.children[index], child = repositories.runs.get(entry.childRunId), dependency = repositories.dependencies.get(entry.dependencyId);
    const createId = lifecycleCommandId("delegation-child-create", { invocationCommandId: command.commandId, index });
    const create = repositories.lifecycleJournal.getCommand(createId), created = repositories.lifecycleJournal.findAuditByCommand(createId);
    if (planned === undefined || child === undefined || create === undefined || !("kind" in create) || create.kind !== "run-lifecycle"
      || create.operation !== "create" || created === undefined || !("kind" in created) || created.kind !== "run-lifecycle"
      || created.result.kind !== "run" || created.result.runId !== child.envelope.runId || canonicalJsonStringify(created.request) !== canonicalJsonStringify(create)
      || entry.childItemId !== planned.childItemId || entry.canonicalInputFingerprint !== planned.canonicalInputFingerprint
      || child.envelope.parent?.runId !== parent.envelope.runId || child.envelope.parent.edgeId !== manifest.edgeId
      || child.envelope.parent.tracePrefix !== parent.envelope.traceId || child.envelope.workflow !== invocation.target.workflowId
      || child.envelope.itemId !== planned.childItemId || child.envelope.descriptorVersion !== invocation.target.descriptorVersion
      || child.envelope.contractFingerprint !== invocation.target.contractFingerprint || child.envelope.dryRun !== invocation.dryRun
      || child.envelope.configSnapshotId !== invocation.configSnapshotId || child.envelope.configFingerprint !== invocation.configFingerprint
      || child.input.ingressSchemaHash !== invocation.target.inputSchemaHash || child.input.parsed.schemaHash !== invocation.target.canonicalInputSchemaHash
      || delegationChildInputFingerprint(child.input.parsed.value) !== planned.canonicalInputFingerprint) throw new Error("delegation-child-binding-mismatch");
    const requested = CanonicalCreateRunRequestSchema.parse(create.request);
    authenticateRunPriority(repositories, child, requested.priority, LOCAL_OPERATOR_ACTOR_ID);
    const creationFields = ["workflow", "descriptorVersion", "contractFingerprint", "operationDisplayCapability", "operationDisplaySnapshot",
      "configSnapshotId", "configFingerprint", "requestedInstance", "resolvedInstance", "shape", "dryRun", "browserMode",
      "captureBrowserScreenshots", "recovery", "stepOmissions", "sourceBound", "parent", "retryOf"] as const;
    if (creationFields.some(field => canonicalJsonStringify(requested[field] ?? null) !== canonicalJsonStringify(child.envelope[field] ?? null))
      || requested.appVersion !== child.appVersion || requested.sessionId !== child.sessionId) throw new Error("delegation-child-options-authority-mismatch");
    if (canonicalJsonStringify(valueFreeProtectedData(child.input, retainedRunProtectedBindings(child))) !== canonicalJsonStringify(requested.input)
      || canonicalJsonStringify(child.envelope.resolvedInstance) !== canonicalJsonStringify(requested.resolvedInstance)
      || canonicalJsonStringify(child.envelope.requestedInstance ?? {}) !== canonicalJsonStringify(requested.requestedInstance ?? {})) throw new Error("delegation-child-input-authority-mismatch");
    if (dependency === undefined || dependency.manifestId !== manifest.manifestId || dependency.edgeId !== manifest.edgeId
      || dependency.parentRunId !== parent.envelope.runId || dependency.childRunId !== child.envelope.runId || dependency.childItemId !== child.envelope.itemId
      || canonicalJsonStringify(dependency.policy) !== canonicalJsonStringify(manifest.policy)) throw new Error("delegation-dependency-binding-mismatch");
    return { entry, original: child, dependency };
  });
  return { parent, invocation, children };
}

export function authenticateDelegationGroup(repositories: AuthorityRepositories, manifest: DelegationManifest, scopePath = new Set<string>()) {
  const { parent, invocation, children: original } = authenticateOriginalDelegationGroup(repositories, manifest, scopePath);
  const children = original.map(({ entry, original: child, dependency }) => {
    const effective = resolveDelegationRetry(repositories, manifest, invocation, child, dependency.dependencyId);
    const terminal = childTerminalSettlement(effective.child, repositories);
    if (terminal?.state === "satisfied" && terminal.result.resultSchemaHash !== invocation.target.resultSchemaHash
      && !(effective.child.envelope.dryRun && terminal.result.resultSchemaHash === deriveSchemaHash(RunDryRunPreviewResultSchema, "output")
        && RunDryRunPreviewResultSchema.safeParse(terminal.result.result.value).success)) throw new Error("delegation-child-result-schema-mismatch");
    if (dependency.state !== "active" && terminal?.state !== dependency.state) throw new Error("delegation-dependency-evidence-mismatch");
    if (dependency.version !== 1 + 2 * (effective.history.length - 1) + (dependency.state === "active" ? 0 : 1)) throw new Error("delegation-dependency-version-authority-mismatch");
    if (dependency.state !== "active" && terminal !== undefined) {
      const settlementId = lifecycleCommandId("delegation-settlement", { dependencyId: dependency.dependencyId,
        childRunId: effective.child.envelope.runId, childAttempt: effective.child.envelope.attempt, resultDigest: terminal.result.resultDigest });
      const settled = repositories.lifecycleJournal.getCommand(settlementId), audit = repositories.lifecycleJournal.findAuditByCommand(settlementId);
      if (settled === undefined || !("kind" in settled) || settled.kind !== "run-lifecycle" || settled.operation !== "delegation-settlement"
        || audit === undefined || !("kind" in audit) || audit.kind !== "run-lifecycle" || audit.result.kind !== "run"
        || audit.result.runId !== effective.child.envelope.runId || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(settled)) throw new Error("delegation-settlement-authority-unavailable");
      const proof = DelegationSettlementRequestSchema.parse(settled.request);
      if (proof.expectedVersion !== dependency.version - 1 || proof.dependencyId !== dependency.dependencyId || proof.runId !== effective.child.envelope.runId
        || proof.childAttempt !== effective.child.envelope.attempt || proof.resultDigest !== terminal.result.resultDigest
        || proof.state !== dependency.state || proof.now !== dependency.updatedAt) throw new Error("delegation-settlement-binding-mismatch");
    }
    return { entry, original: child, ...effective, dependency };
  });
  return { parent, invocation, children };
}

export function childTerminalSettlement(child: RunRecord, repositories: AuthorityRepositories): Readonly<{
  state: "satisfied" | "failed" | "cancelled";
  result: z.infer<typeof RunResultRecordSchema>;
}> | undefined {
  if (child.lifecycle.state !== "terminal" || !["done", "failed", "cancelled"].includes(child.lifecycle.outcome)) return undefined;
  const stored = repositories.runResults.get(child.envelope.runId);
  if (stored === undefined) throw new Error("delegation-child-terminal-evidence-unavailable");
  const result = RunResultRecordSchema.parse(stored), evidence = terminalEvidenceResult(result);
  if (result.runId !== child.envelope.runId || result.workflowId !== child.envelope.workflow || result.attempt !== child.envelope.attempt
    || result.descriptorVersion !== child.envelope.descriptorVersion || result.contractFingerprint !== child.envelope.contractFingerprint
    || result.configSnapshotId !== child.envelope.configSnapshotId || result.configFingerprint !== child.envelope.configFingerprint) throw new Error("delegation-child-terminal-evidence-mismatch");
  if (child.lifecycle.outcome === "done") {
    if (child.completion?.kind !== "done" || child.completion.resultDigest !== result.resultDigest || evidence !== undefined) throw new Error("delegation-child-terminal-evidence-mismatch");
    return { state: "satisfied", result };
  }
  if (child.lifecycle.outcome === "failed") {
    if (evidence?.kind !== "failed-evidence" || child.completion?.kind !== "failed"
      || evidence.authorization.failureId !== child.lifecycle.failureId) throw new Error("delegation-child-terminal-evidence-mismatch");
    return { state: "failed", result };
  }
  if (evidence?.kind !== "lifecycle-evidence" || evidence.outcome !== "cancelled") throw new Error("delegation-child-terminal-evidence-mismatch");
  return { state: "cancelled", result };
}

export function readDelegationEvidence(repositories: AuthorityRepositories, parentRunId: string, nodeId: string, scopePath = new Set<string>()) {
  const parent = repositories.runs.get(parentRunId);
  if (parent === undefined) throw new Error("delegation-parent-unavailable");
  const commandId = lifecycleCommandId("delegation-invocation", { runId: parentRunId, attempt: parent.envelope.attempt, nodeId });
  const command = repositories.lifecycleJournal.getCommand(commandId);
  if (command === undefined || !("kind" in command) || command.kind !== "run-lifecycle" || command.operation !== "delegation-invocation") throw new Error("delegation-invocation-authority-unavailable");
  const invocation = DelegationInvocationRequestSchema.parse(command.request);
  const manifest = repositories.delegationManifests.get(invocation.manifestId);
  if (manifest === undefined) throw new Error("delegation-group-incomplete");
  if (manifest.join === "none") {
    authenticateOriginalDelegationGroup(repositories, manifest, scopePath);
    return DelegationTerminalEvidenceSchema.parse({ state: "delegation-resolved", nodeId, parentRunId,
      edgeId: manifest.edgeId, invocationCommandId: invocation.commandId, manifest, children: [] });
  }
  const children = authenticateDelegationGroup(repositories, manifest, scopePath).children.map(({ child }) => {
    const terminal = childTerminalSettlement(child, repositories);
    if (terminal === undefined) throw new Error("delegation-outcome-not-terminal");
    const source = terminal.state === "cancelled" ? delegationCancellationAvailability(repositories, child.envelope.runId) : undefined;
    if (source?.state === "unavailable") throw new Error(`delegation-child-cancellation-${source.reason}-unavailable`);
    return { run: child, result: terminal.result, ...(source === undefined ? {} : { cancellation: source.outcome }) };
  });
  return DelegationTerminalEvidenceSchema.parse({ state: "delegation-resolved", nodeId, parentRunId,
    edgeId: manifest.edgeId, invocationCommandId: invocation.commandId, manifest, children });
}

export function authenticateDescendantHome(repositories: AuthorityRepositories, candidate: RunRecord, homeWorkflow: string): boolean {
  const ancestry: RunRecord[] = [], visited = new Set<string>();
  let child = candidate;
  while (true) {
    if (visited.size >= 16 || visited.has(child.envelope.runId)) throw new Error("delegation-ancestry-cycle-or-depth");
    visited.add(child.envelope.runId); ancestry.push(child);
    if (child.envelope.parent === undefined) break;
    const parent = repositories.runs.get(child.envelope.parent.runId);
    if (parent === undefined) throw new Error("delegation-parent-unavailable");
    child = parent;
  }
  if (child.envelope.workflow !== homeWorkflow) return false;
  if (candidate.envelope.parent === undefined || child.sessionId === undefined) return true;
  authenticateRootRun(repositories, child);
  for (const [index, member] of ancestry.slice(0, -1).entries()) {
    const parent = ancestry[index + 1];
    if (parent === undefined) throw new Error("delegation-parent-unavailable");
    const groups = retainedDelegationManifests(repositories, parent.envelope.runId)
      .map(manifest => ({ manifest, group: authenticateDelegationGroup(repositories, manifest) }))
      .filter(({ group }) => group.children.some(entry => index === 0
        ? entry.child.envelope.runId === member.envelope.runId : entry.history.includes(member.envelope.runId)));
    if (groups.length !== 1 || groups[0] === undefined) throw new Error("delegation-dispatch-membership-unavailable");
    if (parent.cancelRequested === true && groups[0].manifest.policy.cascadeCancel !== "independent") return false;
  }
  return true;
}

export function retainedDelegationManifests(repositories: AuthorityRepositories, parentRunId: string): readonly DelegationManifest[] {
  const manifests = repositories.delegationManifests.listByParentRun(parentRunId);
  const invocations = repositories.lifecycleJournal.listDelegationInvocations(parentRunId)
    .map(command => DelegationInvocationRequestSchema.parse(command.request));
  const dependencies = repositories.dependencies.listByParentRun(parentRunId);
  if (invocations.length !== manifests.length || dependencies.length !== manifests.reduce((count, manifest) => count + manifest.children.length, 0) || invocations.some(invocation => !manifests.some(manifest => manifest.manifestId === invocation.manifestId))
    || dependencies.some(dependency => !manifests.some(manifest => manifest.manifestId === dependency.manifestId
      && manifest.children.some(child => child.dependencyId === dependency.dependencyId)))) throw new Error("delegation-group-incomplete");
  return manifests;
}

export function lifecycleChildEdge(repositories: AuthorityRepositories, parentRunId: string, childRunId: string): DependencyRecord | undefined {
  if (retainedDelegationManifests(repositories, parentRunId).length > 0) return delegationEdgeForChild(repositories, parentRunId, childRunId);
  const parent = repositories.runs.get(parentRunId), child = repositories.runs.get(childRunId);
  if (parent === undefined || child === undefined || child.envelope.parent?.runId !== parentRunId
    || child.envelope.workflow !== parent.envelope.workflow || child.envelope.parent.tracePrefix !== parent.envelope.traceId) throw new Error("ordinary-tree-child-binding-mismatch");
  return undefined;
}

export function readDelegationReadiness(repositories: AuthorityRepositories, runId: string, intent: "join" | "cancel", visited = new Set<string>()): DelegationReadiness {
  if (visited.has(runId)) throw new Error("delegation-ancestry-cycle");
  visited.add(runId);
  const manifests = retainedDelegationManifests(repositories, runId);
  if (manifests.length === 0) {
    for (const child of repositories.runs.listChildren(runId)) {
      lifecycleChildEdge(repositories, runId, child.envelope.runId);
      if (child.lifecycle.state !== "terminal") return { state: "waiting", childRunId: child.envelope.runId };
      const nested = readDelegationReadiness(repositories, child.envelope.runId, intent, visited);
      if (nested.state !== "ready") return nested;
    }
    return { state: "ready" };
  }
  const members = new Set<string>();
  for (const manifest of manifests) {
    const group = authenticateDelegationGroup(repositories, manifest);
    const readiness = delegationReadiness(manifest, group.children, intent);
    for (const child of group.children) for (const runId of child.history) members.add(runId);
    if (readiness.state === "waiting") return readiness;
    if (intent === "join" && manifest.join !== "none") {
      for (const member of group.children) {
        const terminal = childTerminalSettlement(member.child, repositories);
        if (terminal?.state === "satisfied" && member.child.envelope.dryRun
          && terminal.result.resultSchemaHash === deriveSchemaHash(RunDryRunPreviewResultSchema, "output")) {
          RunDryRunPreviewResultSchema.parse(terminal.result.result.value);
          return { state: "blocked", childRunId: member.child.envelope.runId, reason: "child-preview", manifestId: manifest.manifestId, resultDigest: terminal.result.resultDigest };
        }
        if (member.child.lifecycle.state === "terminal" && member.child.lifecycle.outcome === "cancelled"
          && delegationCancellationAvailability(repositories, member.child.envelope.runId).state === "unavailable") {
          return { state: "blocked", childRunId: member.child.envelope.runId, reason: "child-cancellation-unavailable" };
        }
      }
    }
    if (readiness.state !== "ready") return readiness;
    if (intent === "cancel" ? manifest.policy.cascadeCancel === "independent" : manifest.join === "none") continue;
    for (const child of group.children) {
      for (const runId of intent === "cancel" ? child.history : [child.child.envelope.runId]) {
        const nested = readDelegationReadiness(repositories, runId, intent, visited);
        if (nested.state !== "ready") return nested;
      }
    }
  }
  if (repositories.runs.listChildren(runId).some(child => !members.has(child.envelope.runId))) throw new Error("delegation-child-manifest-unavailable");
  return { state: "ready" };
}

export function readDelegationScopeEvidence(repositories: AuthorityRepositories, parent: RunRecord, references: z.infer<typeof DelegationScopeEvidenceSchema>, scopePath = new Set<string>()) {
  return references.map(reference => {
    if (reference.kind === "delegation") {
      const receipt = delegationDependencyRecord(readDelegationEvidence(repositories, parent.envelope.runId, reference.nodeId, scopePath));
      if (canonicalJsonStringify(receipt) !== canonicalJsonStringify(reference.receipt)) throw new Error("delegation-scope-outcome-mismatch");
      return { nodeId: reference.nodeId, delegation: receipt };
    }
    if (reference.kind === "gate") {
      const gate = repositories.gateResults.get(`${parent.envelope.runId}:${reference.nodeId}`);
      if (gate === undefined) throw new Error("delegation-approval-source-unavailable");
      return { nodeId: reference.nodeId, gate };
    }
    const checkpoint = repositories.runCheckpoints.listByAttempt(parent.envelope.workflow, parent.envelope.itemId, reference.nodeId, reference.attempt)
      .find(record => record.runId === reference.runId && record.claimGeneration === reference.claimGeneration);
    if (checkpoint === undefined) throw new Error("delegation-approval-source-unavailable");
    return { nodeId: reference.nodeId, checkpoint };
  });
}

function resolveDelegationRetry(repositories: AuthorityRepositories, manifest: DelegationManifest,
  invocation: z.infer<typeof DelegationInvocationRequestSchema>, original: RunRecord, dependencyId: string) {
  let child = original;
  const history = [original.envelope.runId];
  for (;;) {
    const commandId = lifecycleCommandId("delegation-retry", { dependencyId, previousRunId: child.envelope.runId });
    const command = repositories.lifecycleJournal.getCommand(commandId);
    if (command === undefined) return { child, history, attempt: child === original ? "original" as const : "retry" as const };
    const audit = repositories.lifecycleJournal.findAuditByCommand(commandId);
    if (!("kind" in command) || command.kind !== "run-lifecycle" || command.operation !== "delegation-retry"
      || audit === undefined || !("kind" in audit) || audit.kind !== "run-lifecycle"
      || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)) throw new Error("delegation-retry-authority-unavailable");
    const retry = DelegationRetryRequestSchema.parse(command.request);
    const parent = repositories.runs.get(manifest.parentRunId), next = repositories.runs.get(retry.replacementRunId);
    const terminal = childTerminalSettlement(child, repositories);
    const source = repositories.commands.get(retry.sourceCommandId), sourceAudit = repositories.commandAudits.findByCommand(retry.sourceCommandId);
    const lifecycle = repositories.lifecycleJournal.getCommand(lifecycleCommandId("operator-retry", retry.sourceCommandId));
    const lifecycleAudit = lifecycle === undefined ? undefined : repositories.lifecycleJournal.findAuditByCommand(lifecycle.commandId);
    const lifecycleRequest = lifecycle === undefined || !("kind" in lifecycle) || lifecycle.kind !== "run-lifecycle" ? undefined : CanonicalRetrySourceRequestSchema.parse(lifecycle.request);
    if (parent === undefined || parent.version < retry.parentVersion || terminal === undefined || terminal.state === "satisfied"
      || retry.commandId !== commandId || retry.manifestId !== manifest.manifestId || retry.dependencyId !== dependencyId
      || retry.invocationCommandId !== invocation.commandId || retry.planFingerprint !== manifest.manifestFingerprint
      || canonicalJsonStringify(retry.policy) !== canonicalJsonStringify(manifest.policy)
      || retry.originalRunId !== original.envelope.runId || retry.originalAttempt !== original.envelope.attempt
      || retry.previousRunId !== child.envelope.runId || retry.previousAttempt !== child.envelope.attempt || retry.resultDigest !== terminal.result.resultDigest
      || source?.family !== "run" || source.type !== "retry" || source.target.runId !== child.envelope.runId
      || lifecycleRequest?.expectedVersion !== source.target.expectedVersion || lifecycleRequest.runId !== child.envelope.runId
      || lifecycleRequest.sourceCommandId !== source.commandId || child.version < source.target.expectedVersion || sourceAudit?.result.state !== "applied"
      || canonicalJsonStringify(sourceAudit.request) !== canonicalJsonStringify(source) || !sourceAudit.versionChanges.some(change => change.target.family === "run" && change.target.runId === retry.replacementRunId && change.before === 0 && change.after === 1)
      || lifecycle === undefined || !("kind" in lifecycle) || lifecycle.kind !== "run-lifecycle" || lifecycle.operation !== "retry"
      || lifecycleAudit === undefined || !("kind" in lifecycleAudit) || lifecycleAudit.kind !== "run-lifecycle" || lifecycleAudit.result.kind !== "run"
      || lifecycleAudit.result.runId !== retry.replacementRunId || canonicalJsonStringify(lifecycleAudit.request) !== canonicalJsonStringify(lifecycle)
      || next === undefined || next.envelope.runId === child.envelope.runId || history.includes(next.envelope.runId)
      || next.envelope.attempt !== retry.replacementAttempt || lifecycleRequest.appVersion !== next.appVersion
      || lifecycleRequest.runtimeConfig.configFingerprint !== next.envelope.configFingerprint) throw new Error("delegation-retry-binding-mismatch");
    assertDelegationReplacement(repositories, original, child, next);
    child = next; history.push(next.envelope.runId);
  }
}

export function prepareDelegationRetry(repositories: AuthorityRepositories, run: RunRecord, request: Readonly<{ commandId: string; sourceCommandId?: string }>) {
  const parent = run.envelope.parent === undefined ? undefined : repositories.runs.get(run.envelope.parent.runId);
  const source = request.sourceCommandId === undefined ? undefined : repositories.commands.get(request.sourceCommandId);
  if (parent === undefined
    || source?.family !== "run" || source.type !== "retry" || source.target.runId !== run.envelope.runId || source.target.expectedVersion !== run.version
    || request.commandId !== lifecycleCommandId("operator-retry", source.commandId)) throw new Error("delegation-retry-source-unavailable");
  authenticateOperatorSource(repositories, source);
  const groups = repositories.delegationManifests.listByParentRun(parent.envelope.runId)
    .map(manifest => ({ manifest, ...authenticateDelegationGroup(repositories, manifest) }));
  const selected = groups.flatMap(group => group.children.filter(entry => entry.child.envelope.runId === run.envelope.runId).map(child => ({ group, child })));
  if (selected.length !== 1) throw new Error("delegation-retry-membership-unavailable");
  const selectedChild = selected[0];
  if (parent.cancelRequested === true && selectedChild.group.manifest.policy.cascadeCancel !== "independent") {
    throw new Error("delegation-retry-source-unavailable");
  }
  if (parent.lifecycle.state === "terminal") {
    const independentCancellation = parent.lifecycle.outcome === "cancelled"
      && selectedChild.group.manifest.policy.cascadeCancel === "independent"
      && delegationCancellationAvailability(repositories, parent.envelope.runId).state === "available";
    const result = repositories.runResults.get(parent.envelope.runId);
    const receipt = result?.dependencies.find(entry => entry.state === "delegation-resolved"
      && entry.invocationCommandId === selectedChild.group.invocation.commandId);
    if (!independentCancellation && (parent.lifecycle.outcome !== "done" || parent.completion?.kind !== "done"
      || selectedChild.group.manifest.join !== "none" || result === undefined
      || terminalEvidenceResult(result) !== undefined || result.resultDigest !== parent.completion.resultDigest
      || receipt === undefined || canonicalJsonStringify(receipt) !== canonicalJsonStringify(delegationDependencyRecord(
        readDelegationEvidence(repositories, parent.envelope.runId, selectedChild.group.invocation.nodeId))))) throw new Error("delegation-retry-source-unavailable");
  }
  let resetMember = run;
  const visited = new Set<string>();
  for (;;) {
    if (visited.has(resetMember.envelope.runId)) throw new Error("delegation-ancestry-cycle");
    visited.add(resetMember.envelope.runId);
    if (repositories.workerControls.resetForRun(resetMember.envelope.runId) !== undefined) throw new Error("delegation-retry-reset-reserved");
    if (resetMember.envelope.parent === undefined) break;
    const edge = delegationEdgeForChild(repositories, resetMember.envelope.parent.runId, resetMember.envelope.runId);
    if (edge.policy.cascadeCancel === "independent") break;
    const ancestor = repositories.runs.get(resetMember.envelope.parent.runId);
    if (ancestor === undefined) throw new Error("delegation-parent-unavailable");
    resetMember = ancestor;
  }
  const terminal = childTerminalSettlement(run, repositories);
  if (terminal === undefined || terminal.state === "satisfied" || selectedChild.child.dependency.state !== terminal.state
    || repositories.writeIntents.listByRun(run.envelope.runId).some(intent => intent.status === "attempting" || intent.status === "parked")) throw new Error("delegation-retry-terminal-proof-unavailable");
  return { ...selectedChild, parent, source, terminal };
}

export function authenticateCancellationSource(repositories: AuthorityRepositories, run: RunRecord,
  sourceInput: unknown) {
  const source = CancellationSourceSchema.parse(sourceInput);
  if ("kind" in source) return authenticateResetCancellation(repositories, run, source).command;
  const command = repositories.commands.get(source.commandId);
  if (command?.family !== "run" || command.type !== "cancel" || command.target.runId !== source.rootRunId) throw new Error("delegation-cancellation-source-unavailable");
  const audit = authenticateOperatorSource(repositories, command);
  let current = run;
  const visited = new Set<string>();
  while (current.envelope.runId !== source.rootRunId) {
    if (visited.has(current.envelope.runId) || current.envelope.parent === undefined) throw new Error("delegation-cancellation-ancestry-mismatch");
    visited.add(current.envelope.runId);
    const parentId = current.envelope.parent.runId;
    const groups = repositories.delegationManifests.listByParentRun(parentId).map(manifest => ({ manifest, ...authenticateDelegationGroup(repositories, manifest) }));
    const owning = groups.filter(group => group.children.some(child => child.history.includes(current.envelope.runId)));
    if (owning.length !== 1 || owning[0].manifest.policy.cascadeCancel !== "cascade") throw new Error("delegation-cancellation-policy-mismatch");
    current = owning[0].parent;
  }
  if (audit === undefined) {
    if (current.version !== command.target.expectedVersion) throw new Error("delegation-cancellation-root-version-mismatch");
  } else if (audit.result.state !== "applied" || !audit.versionChanges.some(change => change.target.family === "run" && change.target.runId === source.rootRunId
    && Number(change.before) === Number(command.target.expectedVersion) && change.after === command.target.expectedVersion + 1
    && current.version >= change.after)
    || !audit.result.affectedTargets.some(target => target.family === "run" && target.runId === source.rootRunId)) {
    throw new Error("delegation-cancellation-root-version-mismatch");
  }
  return command;
}

export function delegationCancellationAvailability(repositories: AuthorityRepositories, runId: string) {
  const run = repositories.runs.get(runId);
  if (run?.lifecycle.state !== "terminal" || run.lifecycle.outcome !== "cancelled") throw new Error("delegation-cancellation-run-mismatch");
  const retained = repositories.lifecycleJournal.findCancellation(runId);
  if (retained === undefined) return { state: "unavailable" as const, reason: "source" as const };
  const request = z.object({ cancellationSource: CancellationSourceSchema }).parse(retained.request);
  const source = request.cancellationSource;
  if (repositories.commands.get(source.commandId) === undefined || repositories.commandAudits.findByCommand(source.commandId) === undefined
    || "kind" in source && repositories.workerControls.get(source.commandId) === undefined) return { state: "unavailable" as const, reason: "source" as const };
  const outcome = readDelegationCancellation(repositories, runId);
  return outcome.reason === undefined ? { state: "unavailable" as const, reason: "reason" as const }
    : { state: "available" as const, outcome: { ...outcome, reason: outcome.reason } };
}

export function readDelegationCancellation(repositories: AuthorityRepositories, runId: string) {
  const run = repositories.runs.get(runId), retained = repositories.lifecycleJournal.findCancellation(runId);
  if (run === undefined || retained === undefined) throw new Error("delegation-child-cancellation-source-unavailable");
  const request = z.object({ commandId: z.string(), runId: z.string(), expectedVersion: z.number(),
    cancellationSource: CancellationSourceSchema }).parse(retained.request);
  const source = authenticateCancellationSource(repositories, run, request.cancellationSource);
  const reset = "kind" in request.cancellationSource ? authenticateResetCancellation(repositories, run, request.cancellationSource) : undefined;
  const audit = repositories.lifecycleJournal.findAuditByCommand(retained.commandId), authored = repositories.commandAudits.findByCommand(source.commandId);
  const appliedVersion = audit !== undefined && "kind" in audit && audit.kind === "run-lifecycle" && audit.result.kind === "run" ? audit.result.appliedVersion : undefined;
  const expectedCommandId = reset === undefined ? lifecycleCommandId("operator-cancel", { commandId: source.commandId, runId })
    : lifecycleCommandId(reset.member.state === "claimed" ? "reset-current-cancel" : "reset-cascade-cancel", { commandId: source.commandId, runId });
  if (request.commandId !== expectedCommandId
    || request.runId !== runId || audit === undefined || !("kind" in audit) || audit.kind !== "run-lifecycle"
    || audit.result.kind !== "run" || audit.result.runId !== runId || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(retained)
    || authored?.result.state !== "applied" || canonicalJsonStringify(authored.request) !== canonicalJsonStringify(source)
    || (reset === undefined ? !authored.versionChanges.some(change => change.target.family === "run" && change.target.runId === runId
      && change.before === request.expectedVersion && change.after === appliedVersion)
      : reset.control.phase.state !== "succeeded" || reset.control.auditedAt === undefined
        || request.expectedVersion < reset.member.version || appliedVersion !== request.expectedVersion + 1
        || reset.member.state === "queued" && request.expectedVersion !== reset.member.version)) throw new Error("delegation-child-cancellation-source-mismatch");
  if (reset !== undefined && (reset.control.phase.state !== "succeeded" || reset.control.auditedAt !== authored.completedAt
    || canonicalJsonStringify(reset.control.phase.application ?? null) !== canonicalJsonStringify({ result: authored.result,
      versionChanges: authored.versionChanges, affectedDependencyIds: authored.affectedDependencyIds }))) throw new Error("delegation-reset-cancellation-audit-mismatch");
  return { cancelledBy: reset === undefined ? runId === request.cancellationSource.rootRunId ? "operator" as const : "parent" as const : "kernel" as const, reason: source.reason };
}

export function authenticateResetCancellation(repositories: AuthorityRepositories, run: RunRecord, sourceInput: unknown) {
  const source = CancellationSourceSchema.parse(sourceInput);
  const control = repositories.workerControls.get(source.commandId), command = repositories.commands.get(source.commandId);
  const reset = control?.reset;
  if (!("kind" in source) || command?.family !== "worker-browser" || command.type !== "stop-worker" || control === undefined
    || reset?.work.kind !== "current" || reset.work.current.runId !== source.rootRunId
    || canonicalJsonStringify(command) !== canonicalJsonStringify(control.request)) throw new Error("delegation-reset-cancellation-source-unavailable");
  const member = [reset.work.current, ...reset.work.cascade].find(member => member.runId === run.envelope.runId && member.attempt === run.envelope.attempt);
  if (member === undefined) throw new Error("delegation-reset-cancellation-member-mismatch");
  return { command, reset, control, member };
}

export function delegationEdgeForChild(repositories: AuthorityRepositories, parentRunId: string, childRunId: string) {
  const selected = repositories.delegationManifests.listByParentRun(parentRunId).flatMap(manifest => authenticateDelegationGroup(repositories, manifest).children)
    .filter(child => child.history.some(runId => runId === childRunId));
  if (selected.length !== 1) throw new Error("delegation-child-membership-unavailable");
  return selected[0].dependency;
}

export function resetDependencySnapshot(repositories: AuthorityRepositories, reset: WorkerResetBinding, childRunId: string): DependencyRecord {
  const run = repositories.runs.get(childRunId), member = reset.work.kind === "current" ? reset.work.cascade.find(member => member.runId === childRunId) : undefined;
  if (run?.envelope.parent === undefined || member === undefined || run.envelope.attempt !== member.attempt) throw new Error("worker-reset-cascade-authority-unavailable");
  const dependency = delegationEdgeForChild(repositories, run.envelope.parent.runId, childRunId);
  const manifest = repositories.delegationManifests.get(dependency.manifestId);
  if (manifest === undefined) throw new Error("delegation-manifest-unavailable");
  const selected = authenticateDelegationGroup(repositories, manifest).children.find(child => child.dependency.dependencyId === dependency.dependencyId);
  if (selected === undefined || selected.child.envelope.runId !== childRunId) throw new Error("worker-reset-cascade-changed");
  if (dependency.state === "active") return dependency;
  const terminal = childTerminalSettlement(run, repositories), evidence = terminal === undefined ? undefined : terminalEvidenceResult(terminal.result);
  const cancellationId = lifecycleCommandId("reset-cascade-cancel", { commandId: reset.commandId, runId: childRunId });
  if (dependency.state !== "cancelled" || evidence?.kind !== "lifecycle-evidence" || evidence.commandId !== cancellationId
    || evidence.appliedVersion !== member.version + 1 || run.version !== member.version + 1) throw new Error("worker-reset-cascade-changed");
  const retry = selected.history.length === 1 ? undefined : repositories.lifecycleJournal.getCommand(lifecycleCommandId("delegation-retry", {
    dependencyId: dependency.dependencyId, previousRunId: selected.history[selected.history.length - 2] }));
  if (selected.history.length > 1 && (retry === undefined || !("kind" in retry) || retry.kind !== "run-lifecycle" || retry.operation !== "delegation-retry")) throw new Error("delegation-retry-authority-unavailable");
  const updatedAt = retry !== undefined && "kind" in retry && retry.kind === "run-lifecycle" ? retry.recordedAt : dependency.createdAt;
  return DependencyRecordSchema.parse({ ...dependency, state: "active", version: dependency.version - 1, updatedAt });
}

export function assertResetCancellationAdmission(repositories: AuthorityRepositories, run: RunRecord,
  source: z.infer<typeof CancellationSourceSchema>, request: Readonly<{ commandId: string; expectedVersion: number }>) {
  const { reset, member, control } = authenticateResetCancellation(repositories, run, source);
  const slot = repositories.workerSlots.get(reset.member.workerId), lease = repositories.workerLeases.get(reset.member.workerId);
  const claim = runClaim(run);
  if (!["executing", "uncertain"].includes(control.phase.state) || slot === undefined || slot.retiredAt !== null
    || slot.membershipRevision !== reset.member.membershipRevision || slot.workflow !== reset.member.workflowId
    || lease === undefined || lease.leaseGeneration !== reset.lifetime.leaseGeneration || lease.processId !== reset.lifetime.processId
    || lease.lifecycle.startedAt !== reset.lifetime.startedAt || lease.controlRevision !== reset.reservedControlRevision || lease.controlCommandId !== reset.commandId
    || request.commandId !== lifecycleCommandId(member.state === "claimed" ? "reset-current-cancel" : "reset-cascade-cancel", { commandId: reset.commandId, runId: member.runId })
    || request.expectedVersion !== run.version || (member.state === "queued" ? run.lifecycle.state !== "queued" || run.version !== member.version
      : claim?.workerId !== member.workerId || claim.claimGeneration !== member.claimGeneration || run.version < member.version)) throw new Error("delegation-reset-cancellation-authority-stale");
}

export function assertDelegationReplacement(repositories: AuthorityRepositories, original: RunRecord, previous: RunRecord, next: RunRecord): void {
  authenticateRunPriority(repositories, next, previous.envelope.priority, LOCAL_OPERATOR_ACTOR_ID);
  const fields = ["browserMode", "captureBrowserScreenshots", "operationDisplayCapability", "operationDisplaySnapshot", "stepOmissions"] as const;
  if (fields.some(field => canonicalJsonStringify(next.envelope[field] ?? null) !== canonicalJsonStringify(original.envelope[field] ?? null))
    || next.sessionId !== previous.sessionId || next.envelope.recovery !== undefined || next.envelope.sourceBound !== undefined
    || next.envelope.startAt !== undefined || next.envelope.injected !== undefined || next.envelope.freshnessOverride !== undefined) throw new Error("delegation-retry-options-mismatch");
  if (next.envelope.runId === previous.envelope.runId || next.envelope.retryOf !== previous.envelope.runId
    || next.envelope.attempt <= previous.envelope.attempt || next.envelope.workflow !== original.envelope.workflow
    || next.envelope.shape !== original.envelope.shape
    || next.envelope.itemId !== original.envelope.itemId || next.envelope.contractFingerprint !== original.envelope.contractFingerprint
    || next.envelope.descriptorVersion !== original.envelope.descriptorVersion || next.envelope.dryRun !== original.envelope.dryRun
    || next.envelope.configFingerprint !== original.envelope.configFingerprint || next.envelope.configSnapshotId !== original.envelope.configSnapshotId
    || canonicalJsonStringify(next.envelope.parent) !== canonicalJsonStringify(original.envelope.parent)
    || delegationChildInputFingerprint(next.input.parsed.value) !== delegationChildInputFingerprint(original.input.parsed.value)
    || canonicalJsonStringify(next.envelope.requestedInstance ?? {}) !== canonicalJsonStringify(original.envelope.requestedInstance ?? {})
    || canonicalJsonStringify(next.envelope.resolvedInstance) !== canonicalJsonStringify(original.envelope.resolvedInstance)
    || canonicalJsonStringify(valueFreeProtectedData(next.input, retainedRunProtectedBindings(next))) !== canonicalJsonStringify(valueFreeProtectedData(original.input, retainedRunProtectedBindings(original)))) throw new Error("delegation-retry-binding-mismatch");
}

export function authenticateDelegationDependency(repositories: AuthorityRepositories, dependencyId: string) {
  const dependency = repositories.dependencies.get(dependencyId);
  const manifest = dependency === undefined ? undefined : repositories.delegationManifests.get(dependency.manifestId);
  if (manifest === undefined) throw new Error("delegation-manifest-unavailable");
  const selected = authenticateDelegationGroup(repositories, manifest).children.find(child => child.dependency.dependencyId === dependencyId);
  if (selected === undefined) throw new Error("delegation-child-membership-unavailable");
  return selected;
}
