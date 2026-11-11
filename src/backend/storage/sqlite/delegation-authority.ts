import { assertDelegationRefreshEligible, authenticateDelegationRefresh, authenticateDelegationRevisionRefresh } from "./delegation-refresh.js";
import { readRunCheckpoint, RunContinuationRefusedError, captureRunContinuation, validateRunContinuation } from "./run-continuation.js";
import { authorizeWorkflowDelegationRefresh, workflowDelegationAccounting, descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { deriveIdempotencyKeyDigest, IdempotencyKeySchema } from "../../../rules/write-safety/write-safety.js";
import { BrowserSystemIdSchema } from "../../../rules/identity/ids.js";
import { authenticateRootRun, authenticateRunPriority } from "./delegation-root-authority.js";
import { z } from "zod";
import type { RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import type { DependencyRecord } from "../../../rules/workflow/dependencies.js";
import { runClaim, type RunRecord } from "../../../models/run/record.js";
import { ChildTerminalDependencySchema, RunResultRecordSchema, readRunPreviewResult, terminalEvidenceResult, DelegationTerminalDependencySchema, DelegationTerminalEvidenceSchema, delegationDependencyRecord } from "../../../models/run/result.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { delegationChildInputFingerprint, delegationPlanFingerprint } from "../../../models/workflow/delegation.js";
import { retainedRunProtectedBindings, valueFreeProtectedData } from "../../../models/write-safety/protected-input.js";
import { canonicalJsonStringify, type JsonValue } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { delegationInvocationCommandId } from "../../../rules/commands/lifecycle-command-id.js";
import { lifecycleCommandId } from "../../../rules/identity/identifiers.js";
import { delegationReadiness, type DelegationManifest, type DelegationReadiness } from "../../../rules/workflow/dependencies.js";
import { DelegationAdmissionRequestSchema, DelegationInvocationRequestSchema, DelegationScopeEvidenceSchema, DelegationRetryRequestSchema, DelegationSettlementRequestSchema } from "./delegation-contracts.js";
import type { AuthorityRepositories } from "./authority-database.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../rules/identity/ids.js";
import type { QueueParent } from "../../../models/dashboard/queue-parent.js";
import { CancellationSourceSchema, CanonicalCreateRunRequestSchema, CanonicalRetrySourceRequestSchema, CanonicalRecoverRunRequestSchema, CanonicalRequeueRequestSchema, CanonicalPauseRequestSchema, CanonicalWorkerTransitionRequestSchema } from "./run-store-contracts.js";
import { assertCanonicalRunCommandScope } from "./command-record-row.js";

function authenticateOperatorSource(repositories: AuthorityRepositories, source: NonNullable<ReturnType<AuthorityRepositories["commands"]["get"]>>,
  audit = repositories.commandAudits.findByCommand(source.commandId)) {
  if (source.requestedBy !== LOCAL_OPERATOR_ACTOR_ID) throw new Error("delegation-operator-source-unavailable");
  if (audit === undefined) {
    assertCanonicalRunCommandScope(repositories, source);
    return;
  }
  if (audit.result.state !== "applied" || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(source)) {
    throw new Error("delegation-operator-source-unavailable");
  }
  return audit;
}

type OriginalDelegationMember = { entry: DelegationManifest["children"][number]; original: RunRecord; dependency: DependencyRecord };
type OriginalDelegationProof = { parent: RunRecord; invocation: z.infer<typeof DelegationInvocationRequestSchema>; children: OriginalDelegationMember[] };
type DelegationGroupProof = { parent: RunRecord; invocation: OriginalDelegationProof["invocation"];
  children: (OriginalDelegationMember & ReturnType<typeof resolveDelegationRetry> & {
    terminal: (Exclude<ReturnType<typeof readChildTerminalSettlement>, undefined> & { run: RunRecord }) | undefined;
  })[] };
type MemoizedProofs<Proof> = Map<string, { manifest: string; proof: Proof }>;
/** Proofs already authenticated against one repositories object, each bound to the exact manifest it was authenticated for. */
export type DelegationAuthenticationMemo = { originals: MemoizedProofs<OriginalDelegationProof>; groups: MemoizedProofs<DelegationGroupProof> };

export const newDelegationAuthenticationMemo = (): DelegationAuthenticationMemo => ({ originals: new Map(), groups: new Map() });

function memoizedProof<Proof>(proofs: MemoizedProofs<Proof>, manifest: DelegationManifest): Proof | undefined {
  const cached = proofs.get(manifest.manifestId);
  return cached !== undefined && cached.manifest === canonicalJsonStringify(manifest) ? cached.proof : undefined;
}

export function authenticateOriginalDelegationGroup(repositories: AuthorityRepositories, manifest: DelegationManifest, scopePath = new Set<string>()): OriginalDelegationProof {
  return authenticateOriginalGroup(repositories,manifest,scopePath,newDelegationAuthenticationMemo());
}

export function authenticateDelegationGroup(repositories: AuthorityRepositories, manifest: DelegationManifest, scopePath = new Set<string>(),
  memo = newDelegationAuthenticationMemo()): DelegationGroupProof {
  return authenticateGroup(repositories,manifest,scopePath,memo);
}

function authenticateOriginalGroup(repositories: AuthorityRepositories, manifest: DelegationManifest, scopePath: Set<string>, memo: DelegationAuthenticationMemo): OriginalDelegationProof {
  if (scopePath.has(manifest.manifestId)) throw new Error("delegation-scope-cycle");
  const cached = memoizedProof(memo.originals, manifest);
  if (cached !== undefined) return cached;
  const nextScopePath = new Set(scopePath).add(manifest.manifestId);
  const parent = repositories.runs.get(manifest.parentRunId);
  const command = repositories.lifecycleJournal.findDelegationInvocation(manifest.manifestId);
  const audit = command === undefined ? undefined : repositories.lifecycleJournal.findAuditByCommand(command.commandId);
  if (parent === undefined || command === undefined || command.operation !== "delegation-invocation" || audit === undefined
    || !("kind" in audit) || audit.kind !== "run-lifecycle" || audit.result.kind !== "run" || audit.result.runId !== parent.envelope.runId
    || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)) throw new Error("delegation-invocation-authority-unavailable");
  const invocation = DelegationInvocationRequestSchema.parse(command.request);
  const expectedCommandId = delegationInvocationCommandId(invocation);
  if ((invocation.revision === undefined) !== (manifest.revision === undefined)) throw new Error("delegation-revision-binding-mismatch");
  if (invocation.revision !== undefined && manifest.revision !== undefined) {
    const previousManifest = repositories.delegationManifests.get(manifest.revision.previousManifestId);
    if (previousManifest === undefined) throw new Error("delegation-revision-predecessor-unavailable");
    const previous = authenticateOriginalGroup(repositories,previousManifest,nextScopePath,memo);
    if (previous.parent.envelope.runId !== parent.envelope.runId || previous.invocation.nodeId !== invocation.nodeId
      || previous.invocation.commandId !== invocation.revision.previousInvocationCommandId
      || manifest.revision.previousInvocationCommandId !== invocation.revision.previousInvocationCommandId || previous.invocation.edgeId !== invocation.edgeId
      || previous.invocation.cardinality !== invocation.cardinality || previous.invocation.join !== invocation.join
      || canonicalJsonStringify(previous.invocation.policy) !== canonicalJsonStringify(invocation.policy)
      || invocation.revision.refreshCommandId !== manifest.revision.refreshCommandId
      || invocation.revision.settlementCommandId !== manifest.revision.settlementCommandId) throw new Error("delegation-revision-binding-mismatch");
    authenticateDelegationRevisionRefresh(repositories,parent,invocation.revision,audit.result.appliedVersion);
  }
  if (invocation.commandId !== expectedCommandId
    || invocation.runId !== parent.envelope.runId || invocation.attempt !== parent.envelope.attempt
    || invocation.planFingerprint !== delegationPlanFingerprint({ ...invocation, workflowId: invocation.target.workflowId })
    || invocation.definitionFingerprint !== parent.envelope.contractFingerprint || invocation.edgeId !== manifest.edgeId
    || invocation.manifestId !== manifest.manifestId || invocation.planFingerprint !== manifest.manifestFingerprint
    || invocation.parentInputDigest !== sha256Hex(canonicalJsonStringify(valueFreeProtectedData(parent.input)))
    || invocation.dryRun !== parent.envelope.dryRun || invocation.configSnapshotId !== parent.envelope.configSnapshotId
    || invocation.configFingerprint !== parent.envelope.configFingerprint) throw new Error("delegation-invocation-binding-mismatch");
  if (manifest.inputSchemaHash !== invocation.target.inputSchemaHash || manifest.resultSchemaHash !== invocation.target.resultSchemaHash
    || manifest.cardinality !== invocation.cardinality || manifest.join !== invocation.join
    || canonicalJsonStringify(manifest.policy) !== canonicalJsonStringify(invocation.policy)
    || manifest.children.length !== invocation.children.length) throw new Error("delegation-manifest-binding-mismatch");
  const approvals = readScopeEvidence(repositories, parent, invocation.scopeEvidence, nextScopePath, memo);
  if (sha256Hex(canonicalJsonStringify(valueFreeProtectedData(approvals))) !== invocation.approvalDigest) throw new Error("delegation-approval-binding-mismatch");
  const children = manifest.children.map((entry, index) => {
    const planned = invocation.children[index], child = repositories.runs.get(entry.childRunId), dependency = repositories.dependencies.get(entry.dependencyId);
    if (canonicalJsonStringify(entry.reuse ?? null) !== canonicalJsonStringify(planned?.reuse ?? null)) throw new Error("delegation-reuse-binding-mismatch");
    if (entry.reuse !== undefined) {
      if (manifest.revision === undefined || entry.reuse.manifestId !== manifest.revision.previousManifestId
        || planned?.sourceRecordIds === undefined || child === undefined || dependency === undefined) throw new Error("delegation-reuse-source-unavailable");
      const previousManifest = repositories.delegationManifests.get(entry.reuse.manifestId);
      if (previousManifest === undefined) throw new Error("delegation-reuse-source-unavailable");
      const previous = authenticateGroup(repositories,previousManifest,nextScopePath,memo);
      const sourceIndex = previous.children.findIndex(member => member.dependency.dependencyId === entry.reuse?.dependencyId);
      const source = previous.children[sourceIndex], sourcePlan = previous.invocation.children[sourceIndex];
      const terminal = repositories.runResults.getSettlement(entry.reuse.runId,entry.reuse.appliedVersion);
      if (source === undefined || sourcePlan === undefined || !source.history.includes(child.envelope.runId) || terminal?.run.completion?.kind !== "done"
        || terminal.run.envelope.runId !== child.envelope.runId || terminal.result.resultSchemaHash !== invocation.target.resultSchemaHash
        || readRunPreviewResult(terminal.result) !== undefined || entry.reuse.runId !== entry.childRunId
        || canonicalJsonStringify(sourcePlan.sourceRecordIds ?? null) !== canonicalJsonStringify(planned.sourceRecordIds)
        || sourcePlan.canonicalInputFingerprint !== planned.canonicalInputFingerprint || entry.canonicalInputFingerprint !== planned.canonicalInputFingerprint
        || delegationChildInputFingerprint(child.input.parsed.value) !== planned.canonicalInputFingerprint
        || canonicalJsonStringify(previous.invocation.target) !== canonicalJsonStringify(invocation.target)
        || previous.invocation.configSnapshotId !== invocation.configSnapshotId || previous.invocation.configFingerprint !== invocation.configFingerprint
        || dependency.manifestId !== manifest.manifestId || dependency.parentRunId !== parent.envelope.runId || dependency.edgeId !== manifest.edgeId
        || dependency.childRunId !== child.envelope.runId || dependency.childItemId !== child.envelope.itemId || entry.childItemId !== child.envelope.itemId
        || canonicalJsonStringify(dependency.policy) !== canonicalJsonStringify(manifest.policy)) throw new Error("delegation-reuse-binding-mismatch");
      return { entry, original: child, dependency };
    }
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
    if (manifest.revision !== undefined && requested.recovery !== "restart-from-start") throw new Error("delegation-revision-fresh-read-required");
    authenticateRunPriority(repositories, child, requested.priority, LOCAL_OPERATOR_ACTOR_ID);
    const creationFields = ["workflow", "descriptorVersion", "contractFingerprint",
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
  const proof = { parent, invocation, children };
  memo.originals.set(manifest.manifestId,{ manifest: canonicalJsonStringify(manifest), proof });
  return proof;
}

function authenticateGroup(repositories: AuthorityRepositories, manifest: DelegationManifest, scopePath: Set<string>, memo: DelegationAuthenticationMemo): DelegationGroupProof {
  if (scopePath.has(manifest.manifestId)) throw new Error("delegation-scope-cycle");
  const cached = memoizedProof(memo.groups, manifest);
  if (cached !== undefined) return cached;
  const { parent, invocation, children: original } = authenticateOriginalGroup(repositories, manifest, scopePath,memo);
  const children = original.map(({ entry, original: child, dependency }) => {
    const effective = resolveDelegationRetry(repositories, manifest, invocation, child, dependency.dependencyId);
    const retained = dependency.state === "active" ? undefined : dependency.settlement === undefined
      ? repositories.runResults.getInitialSettlement(effective.child.envelope.runId)
      : repositories.runResults.getSettlement(effective.child.envelope.runId, dependency.settlement.appliedVersion);
    const settledRun = retained?.run ?? effective.child;
    if (dependency.settlement !== undefined && (retained === undefined || settledRun.delegationRefresh?.commandId !== dependency.settlement.commandId)) throw new Error("delegation-dependency-settlement-unavailable");
    authenticateDelegationRefresh(repositories, settledRun);
    const terminal = readChildTerminalSettlement(settledRun, () => retained?.result ?? repositories.runResults.get(effective.child.envelope.runId));
    if (terminal?.state === "satisfied" && terminal.result.resultSchemaHash !== invocation.target.resultSchemaHash
      && terminal.kind !== "preview") throw new Error("delegation-child-result-schema-mismatch");
    if (dependency.state !== "active" && terminal?.state !== dependency.state) throw new Error("delegation-dependency-evidence-mismatch");
    if (dependency.version !== 1 + 2 * (effective.history.length - 1) + (dependency.state === "active" ? 0 : 1)) throw new Error("delegation-dependency-version-authority-mismatch");
    if (dependency.state !== "active" && terminal !== undefined) {
      const settlementId = lifecycleCommandId("delegation-settlement", { dependencyId: dependency.dependencyId,
        childRunId: effective.child.envelope.runId, childAttempt: effective.child.envelope.attempt, resultDigest: terminal.result.resultDigest, ...(dependency.settlement === undefined ? {} : { settlement: dependency.settlement }) });
      const settled = repositories.lifecycleJournal.getCommand(settlementId), audit = repositories.lifecycleJournal.findAuditByCommand(settlementId);
      if (settled === undefined || !("kind" in settled) || settled.kind !== "run-lifecycle" || settled.operation !== "delegation-settlement"
        || audit === undefined || !("kind" in audit) || audit.kind !== "run-lifecycle" || audit.result.kind !== "run"
        || audit.result.runId !== effective.child.envelope.runId || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(settled)) throw new Error("delegation-settlement-authority-unavailable");
      const proof = DelegationSettlementRequestSchema.parse(settled.request);
      if (proof.expectedVersion !== dependency.version - 1 || proof.dependencyId !== dependency.dependencyId || proof.runId !== effective.child.envelope.runId
        || proof.childAttempt !== effective.child.envelope.attempt || proof.resultDigest !== terminal.result.resultDigest
        || proof.state !== dependency.state || proof.now !== dependency.updatedAt
        || canonicalJsonStringify(proof.settlement ?? null) !== canonicalJsonStringify(dependency.settlement ?? null)) throw new Error("delegation-settlement-binding-mismatch");
    }
    return { entry, original: child, ...effective, dependency, terminal: terminal === undefined ? undefined : { ...terminal, run: settledRun } };
  });
  const proof = { parent, invocation, children };
  memo.groups.set(manifest.manifestId,{ manifest: canonicalJsonStringify(manifest), proof });
  return proof;
}

export function childTerminalSettlement(child: RunRecord, repositories: AuthorityRepositories) {
  return readChildTerminalSettlement(child,() => repositories.runResults.get(child.envelope.runId));
}

function readChildTerminalSettlement(child: RunRecord, readResult: () => z.infer<typeof RunResultRecordSchema> | undefined):
  | Readonly<{ state: "satisfied"; kind: "ordinary" | "preview"; result: z.infer<typeof RunResultRecordSchema> }>
  | Readonly<{ state: "failed" | "cancelled"; kind: "terminal-evidence"; result: z.infer<typeof RunResultRecordSchema> }>
  | undefined {
  if (child.lifecycle.state !== "terminal" || !["done", "failed", "cancelled"].includes(child.lifecycle.outcome)) return undefined;
  const stored = readResult();
  if (stored === undefined) throw new Error("delegation-child-terminal-evidence-unavailable");
  const result = RunResultRecordSchema.parse(stored), evidence = terminalEvidenceResult(result);
  if (result.runId !== child.envelope.runId || result.workflowId !== child.envelope.workflow || result.attempt !== child.envelope.attempt
    || result.descriptorVersion !== child.envelope.descriptorVersion || result.contractFingerprint !== child.envelope.contractFingerprint
    || result.configSnapshotId !== child.envelope.configSnapshotId || result.configFingerprint !== child.envelope.configFingerprint) throw new Error("delegation-child-terminal-evidence-mismatch");
  if (child.lifecycle.outcome === "done") {
    if (child.completion?.kind !== "done" || child.completion.resultDigest !== result.resultDigest || evidence !== undefined) throw new Error("delegation-child-terminal-evidence-mismatch");
    const preview = readRunPreviewResult(result);
    if (preview !== undefined && !child.envelope.dryRun) throw new Error("delegation-child-result-schema-mismatch");
    return { state: "satisfied", kind: preview === undefined ? "ordinary" : "preview", result };
  }
  if (child.lifecycle.outcome === "failed") {
    if (evidence?.kind !== "failed-evidence" || child.completion?.kind !== "failed"
      || evidence.authorization.failureId !== child.lifecycle.failureId) throw new Error("delegation-child-terminal-evidence-mismatch");
    return { state: "failed", kind: "terminal-evidence", result };
  }
  if (evidence?.kind !== "lifecycle-evidence" || evidence.outcome !== "cancelled") throw new Error("delegation-child-terminal-evidence-mismatch");
  return { state: "cancelled", kind: "terminal-evidence", result };
}

export function readDelegationEvidence(repositories: AuthorityRepositories, parentRunId: string, nodeId: string, scopePath = new Set<string>()) {
  const parent = repositories.runs.get(parentRunId);
  if (parent === undefined) throw new Error("delegation-parent-unavailable");
  const selected = currentDelegationManifests(repositories,parentRunId).filter(manifest =>
    repositories.lifecycleJournal.findDelegationInvocation(manifest.manifestId)?.request !== undefined
      && DelegationInvocationRequestSchema.parse(repositories.lifecycleJournal.findDelegationInvocation(manifest.manifestId)?.request).nodeId === nodeId);
  if (selected.length !== 1 || selected[0] === undefined) throw new Error("delegation-invocation-authority-unavailable");
  const commandId = repositories.lifecycleJournal.findDelegationInvocation(selected[0].manifestId)?.commandId;
  if (commandId === undefined) throw new Error("delegation-invocation-authority-unavailable");
  const evidence = readDelegationInvocationEvidence(repositories, commandId, scopePath);
  if (evidence.parentRunId !== parentRunId || evidence.nodeId !== nodeId) throw new Error("delegation-invocation-binding-mismatch");
  return evidence;
}

export function readDelegationInvocationEvidence(repositories: AuthorityRepositories, commandId: string, scopePath = new Set<string>(), cited?: z.infer<typeof DelegationTerminalDependencySchema> | z.infer<typeof ChildTerminalDependencySchema>) {
  return readInvocationEvidence(repositories, commandId, scopePath, cited, newDelegationAuthenticationMemo());
}

function readInvocationEvidence(repositories: AuthorityRepositories, commandId: string, scopePath: Set<string>,
  cited: z.infer<typeof DelegationTerminalDependencySchema> | z.infer<typeof ChildTerminalDependencySchema> | undefined, memo: DelegationAuthenticationMemo) {
  const childCitation = cited?.state === "child-resolved" ? ChildTerminalDependencySchema.parse(cited) : undefined;
  let citation = cited === undefined || childCitation !== undefined ? undefined : DelegationTerminalDependencySchema.parse(cited);
  const command = repositories.lifecycleJournal.getCommand(commandId);
  if (command === undefined || !("kind" in command) || command.kind !== "run-lifecycle" || command.operation !== "delegation-invocation") throw new Error("delegation-invocation-authority-unavailable");
  const invocation = DelegationInvocationRequestSchema.parse(command.request);
  if (command.commandId !== commandId || invocation.commandId !== commandId) throw new Error("delegation-invocation-binding-mismatch");
  const parentRunId = invocation.runId, nodeId = invocation.nodeId;
  const manifest = repositories.delegationManifests.get(invocation.manifestId);
  if (manifest === undefined) throw new Error("delegation-group-incomplete");
  if (childCitation !== undefined) {
    const child = manifest.children[0];
    if (manifest.revision !== undefined || manifest.cardinality !== "one" || manifest.join !== "one" || manifest.children.length !== 1 || child === undefined) throw new Error("delegation-cited-receipt-mismatch");
    citation = DelegationTerminalDependencySchema.parse({ state: "delegation-resolved", nodeId, parentRunId, edgeId: manifest.edgeId,
      invocationCommandId: commandId, manifest, members: [{ ...childCitation.child, dependencyId: child.dependencyId, lifecycle: "done" }],
      ...(childCitation.operationSources === undefined ? {} : { operationSources: childCitation.operationSources }),
      ...(childCitation.operationLineage === undefined ? {} : { operationLineage: childCitation.operationLineage }),
    });
  }
  if (manifest.join === "none") {
    authenticateOriginalGroup(repositories, manifest, scopePath, memo);
    const evidence = DelegationTerminalEvidenceSchema.parse({ state: "delegation-resolved", nodeId, parentRunId,
      edgeId: manifest.edgeId, invocationCommandId: invocation.commandId, manifest, children: [] });
    if (citation !== undefined && canonicalJsonStringify(delegationDependencyRecord(evidence)) !== canonicalJsonStringify(citation)) throw new Error("delegation-cited-receipt-mismatch");
    return evidence;
  }
  const children = authenticateGroup(repositories, manifest, scopePath, memo).children.map((member, index) => {
    const reference = citation?.members[index];
    if (citation !== undefined && (reference === undefined || !member.history.includes(reference.runId))) throw new Error("delegation-cited-member-unavailable");
    const retained = reference === undefined ? undefined : reference.settlement === undefined
      ? repositories.runResults.getInitialSettlement(reference.runId)
      : repositories.runResults.getSettlement(reference.runId,reference.settlement.appliedVersion);
    if (reference !== undefined && (retained === undefined || reference.settlement !== undefined
      && retained.run.delegationRefresh?.commandId !== reference.settlement.commandId)) throw new Error("delegation-cited-settlement-unavailable");
    const child = retained?.run ?? member.terminal?.run ?? member.child;
    const terminal = retained === undefined ? member.terminal ?? childTerminalSettlement(child,repositories)
      : readChildTerminalSettlement(child,() => retained.result);
    if (terminal === undefined) throw new Error("delegation-outcome-not-terminal");
    const source = terminal.state === "cancelled" ? delegationCancellationAvailability(repositories, child.envelope.runId) : undefined;
    if (source?.state === "unavailable") throw new Error(`delegation-child-cancellation-${source.reason}-unavailable`);
    return { run: child, result: terminal.result, ...(source === undefined ? {} : { cancellation: source.outcome }) };
  });
  const evidence = DelegationTerminalEvidenceSchema.parse({ state: "delegation-resolved", nodeId, parentRunId,
    edgeId: manifest.edgeId, invocationCommandId: invocation.commandId, manifest, children });
  if (citation !== undefined && canonicalJsonStringify(delegationDependencyRecord(evidence)) !== canonicalJsonStringify(citation)) throw new Error("delegation-cited-receipt-mismatch");
  return evidence;
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
  if (candidate.envelope.parent === undefined) return true;
  authenticateRootRun(repositories, child);
  for (const [index, member] of ancestry.slice(0, -1).entries()) {
    const parent = ancestry[index + 1];
    if (parent === undefined) throw new Error("delegation-parent-unavailable");
    const selected = delegationGroupForChild(repositories,parent.envelope.runId,member.envelope.runId);
    if (index === 0 && !selected.group.children.some(entry => entry.child.envelope.runId === member.envelope.runId)) throw new Error("delegation-dispatch-membership-unavailable");
    if (parent.cancelRequested === true && selected.manifest.policy.cascadeCancel !== "independent") return false;
  }
  return true;
}

export function retainedDelegationManifests(repositories: AuthorityRepositories, parentRunId: string): readonly DelegationManifest[] {
  const manifests = repositories.delegationManifests.listByParentRun(parentRunId);
  const invocations = repositories.lifecycleJournal.listDelegationInvocations(parentRunId)
    .map(command => DelegationInvocationRequestSchema.parse(command.request));
  const dependencies = repositories.dependencies.listByParentRun(parentRunId);
  if (manifests.some(manifest => !invocations.some(invocation => invocation.manifestId === manifest.manifestId))) throw new Error("delegation-invocation-authority-unavailable");
  if (invocations.length !== manifests.length || dependencies.length !== manifests.reduce((count, manifest) => count + manifest.children.length, 0) || invocations.some(invocation => !manifests.some(manifest => manifest.manifestId === invocation.manifestId))
    || dependencies.some(dependency => !manifests.some(manifest => manifest.manifestId === dependency.manifestId
      && manifest.children.some(child => child.dependencyId === dependency.dependencyId)))) throw new Error("delegation-group-incomplete");
  return manifests;
}

export function currentDelegationManifests(repositories: AuthorityRepositories, parentRunId: string, throughVersion = Number.POSITIVE_INFINITY): readonly DelegationManifest[] {
  const retained = retainedDelegationManifests(repositories,parentRunId).filter(manifest => {
    const command = repositories.lifecycleJournal.findDelegationInvocation(manifest.manifestId);
    const audit = command === undefined ? undefined : repositories.lifecycleJournal.findAuditByCommand(command.commandId);
    if (audit === undefined || !("kind" in audit) || audit.kind !== "run-lifecycle" || audit.result.kind !== "run") throw new Error("delegation-invocation-authority-unavailable");
    return audit.result.appliedVersion <= throughVersion;
  });
  const groups = new Map<string,DelegationManifest[]>();
  for (const manifest of retained) {
    const command = repositories.lifecycleJournal.findDelegationInvocation(manifest.manifestId);
    if (command === undefined) throw new Error("delegation-invocation-authority-unavailable");
    const invocation = DelegationInvocationRequestSchema.parse(command.request);
    const entries = groups.get(invocation.nodeId) ?? [];
    entries.push(manifest); groups.set(invocation.nodeId,entries);
  }
  return [...groups.values()].map(manifests => {
    const referenced = new Set(manifests.flatMap(manifest => manifest.revision === undefined ? [] : [manifest.revision.previousManifestId]));
    const heads = manifests.filter(manifest => !referenced.has(manifest.manifestId));
    if (heads.length !== 1 || heads[0] === undefined) throw new Error("delegation-revision-chain-unavailable");
    const visited = new Set<string>(), byId = new Map(manifests.map(manifest => [String(manifest.manifestId),manifest]));
    let current: DelegationManifest | undefined = heads[0];
    while (current !== undefined) {
      if (visited.has(current.manifestId)) throw new Error("delegation-revision-cycle");
      visited.add(current.manifestId);
      if (current.revision === undefined) break;
      const previousId: string = current.revision.previousManifestId;
      current = byId.get(previousId);
      if (current === undefined) throw new Error("delegation-revision-predecessor-unavailable");
    }
    if (visited.size !== manifests.length) throw new Error("delegation-revision-chain-unavailable");
    return heads[0];
  });
}

export function selectDelegationGroupForChild<Group extends { manifest: DelegationManifest; group: { children: readonly { history: readonly string[] }[] } }>(
  groups: readonly Group[], currentIds: ReadonlySet<string>, childRunId: string): Group | undefined {
  const matches = groups.filter(({ group }) => group.children.some(member => member.history.includes(childRunId)));
  const current = matches.filter(({ manifest }) => currentIds.has(manifest.manifestId));
  const selected = current.length === 0 ? matches.filter(candidate => !matches.some(other => other.manifest.revision?.previousManifestId === candidate.manifest.manifestId)) : current;
  if (selected.length > 1) throw new Error("delegation-child-membership-unavailable");
  return selected[0];
}

export function delegationGroupForChild(repositories: AuthorityRepositories, parentRunId: string, childRunId: string) {
  const currentManifests = currentDelegationManifests(repositories,parentRunId), currentIds = new Set(currentManifests.map(manifest => String(manifest.manifestId)));
  const authenticate = (manifests: readonly DelegationManifest[]) => manifests.map(manifest => ({ manifest, group: repositories.dependencies.authenticateGroup(manifest) }));
  const current = selectDelegationGroupForChild(authenticate(currentManifests),currentIds,childRunId);
  const selected = current ?? selectDelegationGroupForChild(authenticate(retainedDelegationManifests(repositories,parentRunId).filter(manifest => !currentIds.has(manifest.manifestId))),currentIds,childRunId);
  if (selected === undefined) throw new Error("delegation-child-membership-unavailable");
  return selected;
}

export function readDelegationWait(repositories: AuthorityRepositories, parent: RunRecord, descriptor: AnyWorkflowDescriptor) {
  return readReleasedDelegation(repositories, parent, descriptor);
}

function readReleasedDelegation(repositories: AuthorityRepositories, parent: RunRecord, descriptor?: AnyWorkflowDescriptor) {
  if (parent.lifecycle.state !== "queued" || Number(parent.claimGeneration) === 0) return undefined;
  const retained = repositories.lifecycleJournal.listDelegationAdmissions(parent.envelope.runId, parent.claimGeneration);
  const first = retained[0];
  if (first === undefined) return undefined;
  const held = DelegationAdmissionRequestSchema.parse(first.request);
  const admissions = retained.map(command => ({ command, request: DelegationAdmissionRequestSchema.parse(command.request) }))
    .filter(({ request }) => request.expectedVersion === held.expectedVersion);
  const admitted = admissions.map(({ command, request }) => {
    const audit = repositories.lifecycleJournal.findAuditByCommand(command.commandId);
    if (command.operation !== "delegation-admission" || audit === undefined || !("kind" in audit) || audit.kind !== "run-lifecycle"
      || audit.result.kind !== "run" || audit.result.runId !== parent.envelope.runId
      || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)
      || request.runId !== parent.envelope.runId || canonicalJsonStringify(request.claim) !== canonicalJsonStringify(held.claim)
      || Number(request.claim.claimGeneration) !== Number(parent.claimGeneration)
      || command.commandId !== lifecycleCommandId("delegation-admission", { invocationCommandId: request.invocationCommandId,
        claimGeneration: request.claim.claimGeneration, version: request.expectedVersion })) throw new Error("delegation-admission-authority-unavailable");
    if (parent.version < audit.result.appliedVersion || request.expectedVersion > parent.version) throw new Error("delegation-admission-binding-mismatch");
    return { command, request, appliedVersion: audit.result.appliedVersion };
  });
  if (admitted.every(entry => entry.appliedVersion === held.expectedVersion)) return undefined;
  if (admitted.some(entry => entry.appliedVersion !== held.expectedVersion + 1)) throw new Error("delegation-admission-binding-mismatch");
  const transition = repositories.lifecycleJournal.findDelegationOwner(parent.envelope.runId, parent.claimGeneration, held.expectedVersion);
  const transitioned = transition === undefined ? undefined : repositories.lifecycleJournal.findAuditByCommand(transition.commandId);
  if (transition === undefined || transition.operation !== "worker-transition" || transitioned === undefined || !("kind" in transitioned)
    || transitioned.kind !== "run-lifecycle" || transitioned.result.kind !== "run" || transitioned.result.runId !== parent.envelope.runId
    || transitioned.result.appliedVersion > held.expectedVersion
    || canonicalJsonStringify(transitioned.request) !== canonicalJsonStringify(transition)) throw new Error("delegation-owner-authority-unavailable");
  const running = CanonicalWorkerTransitionRequestSchema.parse(transition.request);
  if (running.runId !== parent.envelope.runId || canonicalJsonStringify(running.claim) !== canonicalJsonStringify(held.claim)
    || running.lifecycle.state !== "running" || running.lifecycle.currentNodeId === undefined
    || running.lifecycle.workerId !== held.claim.workerId) throw new Error("delegation-owner-binding-mismatch");
  const nodeId = running.lifecycle.currentNodeId;
  if (descriptor !== undefined && (descriptor.id !== parent.envelope.workflow || descriptor.version !== parent.envelope.descriptorVersion
    || descriptor.contractFingerprint !== parent.envelope.contractFingerprint)) throw new Error("delegation-admission-binding-mismatch");
  const nodes = descriptor === undefined ? undefined : descriptorRuntimeNodes(descriptor), owner = nodes?.find(node => node.id === nodeId);
  if (nodes !== undefined && owner?.kind !== "child-run" && owner?.kind !== "parallel") throw new Error("delegation-owner-binding-mismatch");
  const leaves = owner?.kind === "child-run" ? [owner] : owner?.kind === "parallel"
    ? owner.branches.flatMap(branch => branch.nodes).flatMap(id => nodes?.filter(node => node.id === id && node.kind === "child-run") ?? []) : undefined;
  const manifests: DelegationManifest[] = [], admittedNodes = new Set<string>();
  for (const { request } of admitted) {
    const invocationCommand = repositories.lifecycleJournal.getCommand(request.invocationCommandId);
    if (invocationCommand === undefined || !("kind" in invocationCommand) || invocationCommand.kind !== "run-lifecycle"
      || invocationCommand.operation !== "delegation-invocation") throw new Error("delegation-invocation-authority-unavailable");
    const invocation = DelegationInvocationRequestSchema.parse(invocationCommand.request);
    const manifest = repositories.delegationManifests.get(invocation.manifestId);
    if (manifest === undefined || invocation.runId !== parent.envelope.runId || admittedNodes.has(invocation.nodeId)) throw new Error("delegation-owner-membership-mismatch");
    admittedNodes.add(invocation.nodeId);
    const leaf = leaves?.find(node => node.id === invocation.nodeId);
    if (leaves !== undefined && leaf?.kind !== "child-run") throw new Error("delegation-owner-membership-mismatch");
    if (leaf?.kind === "child-run" && (invocation.edgeId !== leaf.edgeId || invocation.target.workflowId !== leaf.target.id
      || manifest.cardinality !== leaf.cardinality || manifest.join !== leaf.join
      || canonicalJsonStringify(manifest.policy) !== canonicalJsonStringify(leaf.policy)
      || manifest.inputSchemaHash !== deriveSchemaHash(leaf.target.input, "input")
      || manifest.resultSchemaHash !== deriveSchemaHash(leaf.target.result, "output"))) throw new Error("delegation-manifest-binding-mismatch");
    repositories.dependencies.authenticateGroup(manifest);
    const scope = readDelegationScopeEvidence(repositories, parent, request.scopeEvidence);
    if (sha256Hex(canonicalJsonStringify(valueFreeProtectedData(scope))) !== request.observedScopeDigest) throw new Error("delegation-approval-binding-mismatch");
    manifests.push(manifest);
  }
  for (const leaf of leaves ?? []) {
    if (admittedNodes.has(leaf.id)) continue;
    if (leaf.kind !== "child-run") throw new Error("delegation-owner-membership-mismatch");
    const evidence = repositories.dependencies.continuedEvidence(parent.envelope.runId, leaf.id, leaf.edgeId);
    if (evidence === undefined || evidence.manifest.cardinality !== leaf.cardinality || evidence.manifest.join !== leaf.join
      || canonicalJsonStringify(evidence.manifest.policy) !== canonicalJsonStringify(leaf.policy)
      || evidence.manifest.inputSchemaHash !== deriveSchemaHash(leaf.target.input, "input")
      || evidence.manifest.resultSchemaHash !== deriveSchemaHash(leaf.target.result, "output")) throw new Error("delegation-owner-membership-mismatch");
  }
  const releases = admitted.flatMap(({ command }) => {
    const releaseId = lifecycleCommandId("delegation-release", command.commandId);
    const release = repositories.lifecycleJournal.getCommand(releaseId), released = repositories.lifecycleJournal.findAuditByCommand(releaseId);
    if (release === undefined && released === undefined) return [];
    if (release === undefined || !("kind" in release) || release.kind !== "run-lifecycle" || release.operation !== "requeue"
      || released === undefined || !("kind" in released) || released.kind !== "run-lifecycle" || released.result.kind !== "run"
      || released.result.runId !== parent.envelope.runId || released.result.appliedVersion !== held.expectedVersion + 1
      || canonicalJsonStringify(released.request) !== canonicalJsonStringify(release)) throw new Error("delegation-parent-release-unproved");
    const requeue = CanonicalRequeueRequestSchema.parse(release.request);
    if (requeue.cause !== "recovery" || requeue.runId !== parent.envelope.runId || requeue.expectedVersion !== held.expectedVersion
      || canonicalJsonStringify(requeue.claim) !== canonicalJsonStringify(held.claim)) throw new Error("delegation-parent-release-unproved");
    return [command.commandId];
  });
  const anchor = releases[0];
  if (releases.length !== 1 || anchor === undefined) throw new Error("delegation-parent-release-unproved");
  return { nodeId, admissionCommandId: anchor, claim: held.claim, manifests };
}

export function readDelegationWaitState(repositories: AuthorityRepositories, runId: string) {
  const parent = repositories.runs.get(runId);
  if (parent === undefined) throw new Error("delegation-parent-unavailable");
  const wait = readReleasedDelegation(repositories, parent);
  const continued = wait === undefined && parent.lifecycle.state === "queued" && parent.envelope.continuation !== undefined
    ? repositories.dependencies.groups(runId).filter(({ manifest, group }) => manifest.join !== "none"
      && group.children.some(member => member.attempt === "retry" || member.child.lifecycle.state !== "terminal")) : [];
  if (parent.delegationRefresh !== undefined) authenticateDelegationRefresh(repositories,parent);
  const nodeId = wait?.nodeId ?? continued[0]?.group.invocation.nodeId ?? (parent.lifecycle.state === "queued" ? parent.delegationRefresh?.nodeId : undefined);
  if (nodeId === undefined) return null;
  const readiness = readDelegationReadiness(repositories, runId, parent.cancelRequested === true ? "cancel" : "join");
  return { nodeId, state: readiness.state === "blocked" ? "blocked" as const : "running" as const };
}

export function captureDelegationResume(repositories: AuthorityRepositories, runId: string) {
  return manualRetryEvidence(repositories, repositories.dependencies.groups(runId));
}

function manualRetryEvidence(repositories: AuthorityRepositories, groups: ReturnType<AuthorityRepositories["dependencies"]["groups"]>) {
  const evidence = [];
  for (const { manifest, group } of groups) {
    if (manifest.join === "none" || manifest.policy.afterChildRetry !== "manual-parent-resume") continue;
    for (const member of group.children) {
      if (member.attempt !== "retry") continue;
      const terminal = childTerminalSettlement(member.child, repositories);
      if (terminal === undefined || member.dependency.state === "active") return undefined;
      evidence.push({ dependencyId: member.dependency.dependencyId, childRunId: member.child.envelope.runId,
        childAttempt: member.child.envelope.attempt, resultDigest: terminal.result.resultDigest });
    }
  }
  return evidence;
}

export function delegationResumeCommandId(sourceCommandId: string, evidence: NonNullable<ReturnType<typeof captureDelegationResume>>) {
  return lifecycleCommandId("operator-resume", evidence.length === 0 ? sourceCommandId : { commandId: sourceCommandId, delegationResumed: evidence });
}

export function authenticateDelegationResume(repositories: AuthorityRepositories, request: { commandId: string; runId: string; expectedVersion: number },
  evidence: NonNullable<ReturnType<typeof captureDelegationResume>>) {
  const sources = repositories.commands.listRunResumes(request.runId, request.expectedVersion)
    .filter(source => delegationResumeCommandId(source.commandId, evidence) === request.commandId);
  if (sources.length > 1) throw new Error("delegation-resume-authority-ambiguous");
  const source = sources[0];
  if (source === undefined) return false;
  const audit = authenticateOperatorSource(repositories, source);
  if (source.family !== "run" || source.type !== "resume" || source.target.runId !== request.runId || source.target.expectedVersion !== request.expectedVersion
    || audit !== undefined && !audit.versionChanges.some(change => change.target.family === "run" && change.target.runId === request.runId
      && change.before === request.expectedVersion && change.after === request.expectedVersion + 1)) throw new Error("delegation-resume-binding-mismatch");
  return true;
}

export function readManualDelegationResume(repositories: AuthorityRepositories, parent: RunRecord) {
  const evidence = captureDelegationResume(repositories, parent.envelope.runId);
  if (evidence === undefined || evidence.length === 0) return;
  return readAppliedDelegationResume(repositories, parent, evidence);
}

export function authenticateDelegationRetryPause(repositories: AuthorityRepositories, descriptor: AnyWorkflowDescriptor,
  parent: RunRecord, admissionVersion: number): boolean {
  const pause = parent.pause;
  if (parent.lifecycle.state !== "running" || pause?.state !== "requested" || parent.version <= admissionVersion) return false;
  const authorization = authorizeWorkflowDelegationRefresh(descriptor, parent);
  const plan = authorization === undefined ? undefined : workflowDelegationAccounting(authorization, parent);
  if (plan === undefined) return false;
  const command = repositories.lifecycleJournal.getCommand(pause.commandId);
  const audit = repositories.lifecycleJournal.findAuditByCommand(pause.commandId);
  if (command === undefined || !("kind" in command) || command.kind !== "run-lifecycle" || command.operation !== "pause"
    || audit === undefined || !("kind" in audit) || audit.kind !== "run-lifecycle"
    || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command))
    throw new RunContinuationRefusedError("delegation-retry-pause-authority-unavailable");
  const request = CanonicalPauseRequestSchema.parse(command.request);
  if (request.runId !== parent.envelope.runId || request.expectedVersion < admissionVersion
    || audit.result.kind !== "run" || audit.result.runId !== parent.envelope.runId
    || audit.result.appliedVersion !== request.expectedVersion + 1 || audit.result.appliedVersion > parent.version)
    throw new RunContinuationRefusedError("delegation-retry-pause-binding-mismatch");
  return repositories.dependencies.groups(parent.envelope.runId).some(({ group }) => group.invocation.nodeId === plan.joinNodeId
    && group.children.some(member => member.attempt === "retry" && member.history.slice(0, -1).some(previousRunId => {
      const holdId = lifecycleCommandId("delegation-manual-pause", lifecycleCommandId("delegation-retry", {
        dependencyId: member.dependency.dependencyId, previousRunId,
      }));
      return pause.commandId === holdId || retryHoldKeptPause(repositories, parent, holdId, admissionVersion);
    })));
}

// A Retry hold over an already requested pause keeps that pause and is journaled without a version change.
function retryHoldKeptPause(repositories: AuthorityRepositories, parent: RunRecord, holdId: string, admissionVersion: number): boolean {
  const command = repositories.lifecycleJournal.getCommand(holdId);
  if (command === undefined) return false;
  const audit = repositories.lifecycleJournal.findAuditByCommand(holdId);
  if (!("kind" in command) || command.kind !== "run-lifecycle" || command.operation !== "pause"
    || audit === undefined || !("kind" in audit) || audit.kind !== "run-lifecycle"
    || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command))
    throw new RunContinuationRefusedError("delegation-retry-pause-authority-unavailable");
  const request = CanonicalPauseRequestSchema.parse(command.request);
  return request.runId === parent.envelope.runId && request.expectedVersion >= admissionVersion
    && audit.result.kind === "run" && audit.result.runId === parent.envelope.runId
    && audit.result.appliedVersion === request.expectedVersion && audit.result.appliedVersion <= parent.version;
}

function readAppliedDelegationResume(repositories: AuthorityRepositories, parent: RunRecord,
  evidence: NonNullable<ReturnType<typeof captureDelegationResume>>) {
  const issue = repositories.lifecycleJournal.findRunResume(parent.envelope.runId, parent.version);
  if (issue === undefined || issue.result.kind !== "run") return;
  const request = CanonicalPauseRequestSchema.parse(issue.request.request);
  if (request.runId !== parent.envelope.runId || issue.result.runId !== parent.envelope.runId
    || issue.result.appliedVersion !== request.expectedVersion + 1 || issue.result.appliedVersion > parent.version
    || !authenticateDelegationResume(repositories, request, evidence)) return;
  const sources = repositories.commands.listRunResumes(request.runId, request.expectedVersion)
    .filter(source => delegationResumeCommandId(source.commandId, evidence) === request.commandId);
  const source = sources.length === 1 ? sources[0] : undefined;
  if (source === undefined || authenticateOperatorSource(repositories, source) === undefined)
    throw new RunContinuationRefusedError("delegation-resume-source-audit-unavailable");
  return { commandId: request.commandId, evidence };
}

export function delegationAccountingExecution(repositories: AuthorityRepositories, descriptor: AnyWorkflowDescriptor, parent: RunRecord) {
  const retainedGroups = repositories.dependencies.groups(parent.envelope.runId);
  if (!retainedGroups.some(({ group }) => group.children.some(member => member.attempt === "retry"))) return;
  const authorization = authorizeWorkflowDelegationRefresh(descriptor, parent);
  const plan = authorization === undefined ? undefined : workflowDelegationAccounting(authorization, parent);
  if (plan === undefined) return;
  const groups = retainedGroups.filter(({ group }) => group.invocation.nodeId === plan.joinNodeId);
  if (!groups.some(({ group }) => group.children.some(member => member.attempt === "retry"))) return;
  if (groups.length !== 1 || parent.envelope.startAt !== undefined || parent.envelope.injected !== undefined
    || (parent.envelope.stepOmissions?.length ?? 0) > 0) throw new RunContinuationRefusedError("delegation-accounting-scope-unavailable");
  const retainedScope = groups.flatMap(({ group }) => readDelegationScopeEvidence(repositories, parent, group.invocation.scopeEvidence));
  const snapshot = () => {
    const current = repositories.runs.get(parent.envelope.runId);
    const captured = runClaim(parent), held = current === undefined ? undefined : runClaim(current);
    if (current === undefined || captured === undefined || held === undefined
      || held.workerId !== captured.workerId || held.claimGeneration !== captured.claimGeneration
      || canonicalJsonStringify(current.envelope) !== canonicalJsonStringify(parent.envelope)
      || canonicalJsonStringify(current.input) !== canonicalJsonStringify(parent.input))
      throw new RunContinuationRefusedError("delegation-accounting-owner-changed");
    const resumed = readManualDelegationResume(repositories, current);
    if (resumed === undefined) throw new RunContinuationRefusedError("delegation-accounting-resume-unavailable");
    const evidence = readDelegationEvidence(repositories, current.envelope.runId, plan.joinNodeId);
    if (evidence.state !== "delegation-resolved") throw new RunContinuationRefusedError("delegation-accounting-members-unsettled");
    return canonicalJsonStringify({ resumed, evidence });
  };
  const original = snapshot();
  return { plan, assertCurrent() {
    if (snapshot() !== original) throw new RunContinuationRefusedError("delegation-accounting-members-changed");
  }, assertRetained(record: RunCheckpointRecord) {
    const retained = retainedScope.find(entry => entry.nodeId === record.nodeId);
    if (retained === undefined || !("checkpoint" in retained) || retained.checkpoint === undefined)
      throw new RunContinuationRefusedError("delegation-accounting-upstream-checkpoint-unavailable");
    if (canonicalJsonStringify(record.output) !== canonicalJsonStringify(retained.checkpoint.output))
      throw new RunContinuationRefusedError("delegation-accounting-upstream-checkpoint-changed");
  } };
}

export function assertDelegationRetryUnwritten(repositories: AuthorityRepositories, run: RunRecord, descriptor: AnyWorkflowDescriptor): void {
  const refusal = delegationRetryWriteRefusal(repositories, run, descriptor);
  if (refusal !== undefined) throw new RunContinuationRefusedError(refusal);
}

export function delegationRetryWriteRefusal(repositories: AuthorityRepositories, run: RunRecord, descriptor: AnyWorkflowDescriptor): string | undefined {
  if (run.lifecycle.state !== "terminal" || run.lifecycle.outcome !== "failed"
    || run.envelope.contractFingerprint !== descriptor.contractFingerprint) return "delegation-accounting-child-ineligible";
  const attempts = [...repositories.runs.listByItem({ workflow: run.envelope.workflow, itemId: run.envelope.itemId }),
    ...validateRunContinuation(repositories, run.envelope)];
  const intents = attempts.flatMap(attempt => repositories.writeIntents.listByRun(attempt.envelope.runId));
  if (intents.some(intent => intent.status !== "retryable")) return "delegation-accounting-save-already-issued";
  const transactions = descriptorRuntimeNodes(descriptor).filter(node => node.kind === "transaction");
  if (repositories.runCheckpoints.listByItem(run.envelope.workflow, run.envelope.itemId)
    .some(checkpoint => transactions.some(node => node.id === checkpoint.nodeId))) return "delegation-accounting-write-checkpoint-present";
  for (const node of transactions) {
    const outputs: Record<string, JsonValue> = {};
    for (const id of node.dependsOn) {
      const record = readRunCheckpoint(repositories, run.envelope, id, true);
      if (record !== undefined) outputs[id] = record.output.value;
    }
    if (node.dependsOn.some(id => !Object.hasOwn(outputs, id))) continue;
    const mapped = node.commit.uses.input.parse(node.commit.bind({ input: run.input.parsed.value, outputs,
      protectedInputBindings: retainedRunProtectedBindings(run) }));
    const system = BrowserSystemIdSchema.parse(node.commit.uses.id.split("/")[0]);
    const key = IdempotencyKeySchema.parse(Reflect.apply(node.commit.uses.writeSafety.idempotency.key, undefined, [mapped]));
    if (repositories.writeIntents.listByBusinessKey(system, deriveIdempotencyKeyDigest(system, key))
      .some(intent => intent.status !== "retryable")) return "delegation-accounting-natural-key-settled-or-unknown";
  }
}

export function lifecycleChildEdge(repositories: AuthorityRepositories, parentRunId: string, childRunId: string): DependencyRecord | undefined {
  if (retainedDelegationManifests(repositories, parentRunId).length > 0) return delegationEdgeForChild(repositories, parentRunId, childRunId);
  const parent = repositories.runs.get(parentRunId), child = repositories.runs.get(childRunId);
  if (parent === undefined || child === undefined) throw new Error("ordinary-tree-child-binding-mismatch");
  assertOrdinaryChild(parent.envelope, child.envelope);
  return undefined;
}

function assertOrdinaryChild(parent: RunRecord["envelope"], child: RunRecord["envelope"]) {
  if (child.parent?.runId !== parent.runId || child.workflow !== parent.workflow
    || child.parent.tracePrefix !== parent.traceId) throw new Error("ordinary-tree-child-binding-mismatch");
}

/** Includes every physical sibling for each requested parent. */
export function readQueueParents(repositories: AuthorityRepositories, envelopes: readonly RunRecord["envelope"][]) {
  const result = new Map<string, QueueParent | null>();
  const parents = new Set(envelopes.flatMap(envelope => envelope.parent === undefined ? [] : [envelope.parent.runId]));
  for (const parentId of parents) {
    const parent = repositories.runs.get(parentId);
    if (parent === undefined) throw new Error("delegation-parent-unavailable");
    const manifests = retainedDelegationManifests(repositories, parentId);
    const children = repositories.runs.listChildren(parentId);
    if (manifests.length === 0) {
      for (const child of children) {
        assertOrdinaryChild(parent.envelope, child.envelope);
        result.set(child.envelope.runId, { runId: parentId, visibility: child.envelope.shape === "operation-member" ? "inline" : "linked" });
      }
      continue;
    }
    const edges = new Map<string, DependencyRecord>();
    for (const manifest of manifests) for (const member of repositories.dependencies.authenticateGroup(manifest).children) {
      for (const runId of member.history) edges.set(runId, member.dependency);
    }
    for (const child of children) {
      const edge = edges.get(child.envelope.runId);
      if (edge === undefined || child.envelope.parent?.runId !== parentId || child.envelope.parent.edgeId !== edge.edgeId
        || child.envelope.parent.tracePrefix !== parent.envelope.traceId) throw new Error("delegation-child-membership-unavailable");
      result.set(child.envelope.runId, { runId: parentId, visibility: edge.policy.visibility });
    }
  }
  for (const envelope of envelopes) {
    if (envelope.parent === undefined) result.set(envelope.runId, null);
    else if (result.get(envelope.runId)?.runId !== envelope.parent.runId) throw new Error("queue-parent-source-unavailable");
  }
  return result;
}

export function readDelegationReadiness(repositories: AuthorityRepositories, runId: string, intent: "join" | "cancel", visited = new Set<string>()): DelegationReadiness {
  if (visited.has(runId)) throw new Error("delegation-ancestry-cycle");
  const path = new Set(visited).add(runId);
  let result: DelegationReadiness = { state: "ready" };
  const collect = (candidate: DelegationReadiness) => {
    if (candidate.state === "blocked" && result.state !== "blocked" || candidate.state === "waiting" && result.state === "ready") result = candidate;
  };
  const groups = repositories.dependencies.groups(runId,intent === "cancel" ? "retained" : "current");
  if (groups.length === 0) {
    for (const child of repositories.runs.listChildren(runId)) {
      lifecycleChildEdge(repositories, runId, child.envelope.runId);
      if (child.lifecycle.state !== "terminal") collect({ state: "waiting", childRunId: child.envelope.runId });
      collect(readDelegationReadiness(repositories, child.envelope.runId, intent, path));
    }
    return result;
  }
  const members = new Set<string>();
  const resumeEvidence = manualRetryEvidence(repositories, groups);
  let manualResumed = false;
  if (resumeEvidence !== undefined && resumeEvidence.length > 0) {
    const parent = repositories.runs.get(runId);
    if (parent === undefined) throw new Error("delegation-resume-binding-mismatch");
    manualResumed = readAppliedDelegationResume(repositories, parent, resumeEvidence) !== undefined;
  }
  for (const { manifest, group } of groups) {
    const readiness = delegationReadiness(manifest, group.children.map(member => ({ ...member, resumed: manualResumed })), intent);
    for (const child of group.children) for (const runId of child.history) members.add(runId);
    collect(readiness);
    if (intent === "join" && manifest.join !== "none") {
      for (const member of group.children) {
        if (member.child.lifecycle.state === "terminal" && member.child.lifecycle.outcome === "cancelled"
          && delegationCancellationAvailability(repositories, member.child.envelope.runId).state === "unavailable") {
          collect({ state: "blocked", childRunId: member.child.envelope.runId, reason: "child-cancellation-unavailable" });
        }
      }
    }
    if (intent === "cancel" ? manifest.policy.cascadeCancel === "independent" : manifest.join === "none") continue;
    for (const child of group.children) {
      for (const runId of intent === "cancel" ? child.history : [child.child.envelope.runId]) {
        collect(readDelegationReadiness(repositories, runId, intent, path));
      }
    }
  }
  for (const child of repositories.runs.listChildren(runId)) if (!members.has(child.envelope.runId)) delegationGroupForChild(repositories,runId,child.envelope.runId);
  return result;
}

export function readDelegationScopeEvidence(repositories: AuthorityRepositories, parent: RunRecord, references: z.infer<typeof DelegationScopeEvidenceSchema>, scopePath = new Set<string>()) {
  return readScopeEvidence(repositories, parent, references, scopePath, newDelegationAuthenticationMemo());
}

/** One memo per top-level authentication, so a group cited by several scope references is authenticated once. */
function readScopeEvidence(repositories: AuthorityRepositories, parent: RunRecord, references: z.infer<typeof DelegationScopeEvidenceSchema>,
  scopePath: Set<string>, memo: DelegationAuthenticationMemo) {
  return references.map(reference => {
    if (reference.kind === "delegation") {
      if (reference.receipt.parentRunId !== parent.envelope.runId || reference.receipt.nodeId !== reference.nodeId) throw new Error("delegation-scope-outcome-mismatch");
      const receipt = delegationDependencyRecord(readInvocationEvidence(repositories, reference.receipt.invocationCommandId, scopePath, reference.receipt, memo));
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
    if (history.length > 32) throw new Error("delegation-retry-history-limit");
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
    const source = repositories.commands.get(retry.sourceCommandId);
    const sourceAudit = repositories.commandAudits.findByCommand(retry.sourceCommandId);
    if (source !== undefined) authenticateOperatorSource(repositories, source, sourceAudit);
    const continued = retry.continuationOwner === undefined ? undefined
      : authenticateContinuationRetryOwner(repositories, child, retry.continuationOwner, retry.sourceCommandId);
    const expectedOperation = continued !== undefined || source?.family === "run" && source.type === "recover-run" ? "recover" : "retry";
    const lifecycleId = continued === undefined ? lifecycleCommandId(expectedOperation === "recover" ? "operator-recover-run" : "operator-retry", retry.sourceCommandId)
      : lifecycleCommandId("continuation-child-retry", { ownerRunId: continued.current.envelope.runId, previousRunId: child.envelope.runId });
    const lifecycle = repositories.lifecycleJournal.getCommand(lifecycleId);
    const lifecycleAudit = lifecycle === undefined ? undefined : repositories.lifecycleJournal.findAuditByCommand(lifecycle.commandId);
    const lifecycleRequest = lifecycle === undefined || !("kind" in lifecycle) || lifecycle.kind !== "run-lifecycle" ? undefined : (expectedOperation === "recover" ? CanonicalRecoverRunRequestSchema : CanonicalRetrySourceRequestSchema).parse(lifecycle.request);
    if (parent === undefined || parent.version < retry.parentVersion || terminal === undefined || terminal.state === "satisfied"
      || retry.commandId !== commandId || retry.manifestId !== manifest.manifestId || retry.dependencyId !== dependencyId
      || retry.invocationCommandId !== invocation.commandId || retry.planFingerprint !== manifest.manifestFingerprint
      || canonicalJsonStringify(retry.policy) !== canonicalJsonStringify(manifest.policy)
      || retry.originalRunId !== original.envelope.runId || retry.originalAttempt !== original.envelope.attempt
      || retry.previousRunId !== child.envelope.runId || retry.previousAttempt !== child.envelope.attempt || retry.resultDigest !== terminal.result.resultDigest
      || source === undefined || (sourceAudit !== undefined && (sourceAudit.result.state !== "applied" || canonicalJsonStringify(sourceAudit.request) !== canonicalJsonStringify(source)))
      || lifecycleRequest?.runId !== child.envelope.runId || lifecycleRequest.expectedVersion > child.version
      || lifecycleRequest.sourceCommandId !== source.commandId
      || canonicalJsonStringify(lifecycleRequest.continuationOwner ?? null) !== canonicalJsonStringify(retry.continuationOwner ?? null)
      || (continued === undefined && (source.family !== "run" || source.type !== (expectedOperation === "recover" ? "recover-run" : "retry") || source.target.runId !== child.envelope.runId
        || lifecycleRequest.expectedVersion !== source.target.expectedVersion))
      || sourceAudit !== undefined && !sourceAudit.versionChanges.some(change => change.target.family === "run" && change.target.runId === retry.replacementRunId && change.before === 0 && (change.after === 1 || repositories.lifecycleJournal.findDelegationParentHold(retry.replacementRunId,retry.sourceCommandId,change.after) !== undefined))
      || lifecycle === undefined || !("kind" in lifecycle) || lifecycle.kind !== "run-lifecycle" || lifecycle.operation !== expectedOperation
      || lifecycleAudit === undefined || !("kind" in lifecycleAudit) || lifecycleAudit.kind !== "run-lifecycle" || lifecycleAudit.result.kind !== "run"
      || lifecycleAudit.result.runId !== retry.replacementRunId || canonicalJsonStringify(lifecycleAudit.request) !== canonicalJsonStringify(lifecycle)
      || next === undefined || next.envelope.runId === child.envelope.runId || history.includes(next.envelope.runId)
      || next.envelope.attempt !== retry.replacementAttempt || lifecycleRequest.appVersion !== next.appVersion
      || lifecycleRequest.runtimeConfig.configFingerprint !== next.envelope.configFingerprint) throw new Error("delegation-retry-binding-mismatch");
    assertDelegationReplacement(repositories, original, child, next);
    child = next; history.push(next.envelope.runId);
  }
}

function authenticateContinuationRetryOwner(repositories: AuthorityRepositories,
  run: RunRecord, owner: NonNullable<z.infer<typeof DelegationRetryRequestSchema>["continuationOwner"]>, sourceCommandId: string, visited = new Set<string>()) {
  if (visited.size >= 16 || visited.has(owner.runId)) throw new Error("delegation-continuation-owner-cycle-or-depth");
  visited.add(owner.runId);
  const current = repositories.runs.get(owner.runId);
  if (current === undefined || current.version < owner.version || current.envelope.attempt !== owner.attempt
    || current.envelope.workflow !== repositories.runs.get(run.envelope.parent?.runId ?? "")?.envelope.workflow
    || !validateRunContinuation(repositories, current.envelope).some(source => source.envelope.runId === run.envelope.parent?.runId)) {
    throw new Error("delegation-continuation-owner-unavailable");
  }
  const issue = repositories.lifecycleJournal.findContinuationIssue(owner.runId, owner.version);
  const source = repositories.commands.get(sourceCommandId);
  if (issue?.result.kind !== "run" || issue.result.appliedVersion !== owner.version || source === undefined) throw new Error("delegation-continuation-source-unavailable");
  if (issue.request.operation === "retry" || issue.request.operation === "recover") {
    const retry = (issue.request.operation === "recover" ? CanonicalRecoverRunRequestSchema : CanonicalRetrySourceRequestSchema).parse(issue.request.request);
    if (retry.continuationOwner !== undefined) {
      const previous = repositories.runs.get(retry.runId);
      if (previous === undefined || retry.sourceCommandId !== sourceCommandId) throw new Error("delegation-continuation-source-unavailable");
      authenticateContinuationRetryOwner(repositories, previous, retry.continuationOwner, sourceCommandId, visited);
    } else if (retry.sourceCommandId !== sourceCommandId || source.family !== "run" || source.type !== (issue.request.operation === "recover" ? "recover-run" : "retry")
      || source.target.runId !== retry.runId || source.target.expectedVersion !== retry.expectedVersion
      || current.envelope.retryOf !== retry.runId) throw new Error("delegation-continuation-source-mismatch");
  } else if (issue.request.operation === "create") {
    const create = CanonicalCreateRunRequestSchema.parse(issue.request.request);
    if (source.family !== "start" || source.type !== "start-run" || current.envelope.sourceBound?.confirmationCommandId !== sourceCommandId
      || create.commandId !== lifecycleCommandId("operator-create", { commandId: sourceCommandId, entry: 0 })
      || canonicalJsonStringify(create.continuation) !== canonicalJsonStringify(issue.result.continuation)) throw new Error("delegation-continuation-source-mismatch");
  } else throw new Error("delegation-continuation-source-unavailable");
  authenticateOperatorSource(repositories, source);
  return { current, source };
}

export function prepareDelegationRetry(repositories: AuthorityRepositories, run: RunRecord, request: Readonly<{ commandId: string; sourceCommandId?: string; continuationOwner?: z.infer<typeof DelegationRetryRequestSchema>["continuationOwner"]; refreshAuthorization?: object }>) {
  const parent = run.envelope.parent === undefined ? undefined : repositories.runs.get(run.envelope.parent.runId);
  const source = request.sourceCommandId === undefined ? undefined : repositories.commands.get(request.sourceCommandId);
  const continued = request.continuationOwner === undefined || request.sourceCommandId === undefined ? undefined
    : authenticateContinuationRetryOwner(repositories, run, request.continuationOwner, request.sourceCommandId);
  if (parent === undefined || source === undefined
    || (continued === undefined && (source.family !== "run" || (source.type !== "retry" && source.type !== "recover-run") || source.target.runId !== run.envelope.runId || source.target.expectedVersion !== run.version
    || request.commandId !== lifecycleCommandId(source.type === "recover-run" ? "operator-recover-run" : "operator-retry", source.commandId)))
    || continued !== undefined && request.commandId !== lifecycleCommandId("continuation-child-retry", { ownerRunId: continued.current.envelope.runId, previousRunId: run.envelope.runId })) throw new Error("delegation-retry-source-unavailable");
  authenticateOperatorSource(repositories, source);
  const groups = currentDelegationManifests(repositories,parent.envelope.runId)
    .map(manifest => ({ manifest, ...authenticateDelegationGroup(repositories, manifest) }));
  const selected = groups.flatMap(group => group.children.filter(entry => entry.child.envelope.runId === run.envelope.runId).map(child => ({ group, child })));
  if (selected.length !== 1) throw new Error("delegation-retry-membership-unavailable");
  const selectedChild = selected[0];
  const accounting = request.refreshAuthorization === undefined ? undefined : workflowDelegationAccounting(request.refreshAuthorization, parent);
  const accountingMember = accounting !== undefined && accounting.joinNodeId === selectedChild.group.invocation.nodeId;
  if (accountingMember && continued === undefined) {
    if (source.type !== "retry") throw new RunContinuationRefusedError("delegation-accounting-recovery-requires-member-retry");
    assertDelegationRetryUnwritten(repositories, run, accounting.target);
    if (parent.cancelRequested === true || parent.lifecycle.state === "terminal" && repositories.evidenceReceipts.findByRun(parent.envelope.runId) === undefined)
      throw new RunContinuationRefusedError("delegation-accounting-parent-receipt-unavailable");
  }
  if (parent.cancelRequested === true && selectedChild.group.manifest.policy.cascadeCancel !== "independent") {
    throw new Error("delegation-retry-source-unavailable");
  }
  if (continued !== undefined && (parent.lifecycle.state !== "terminal" || !["failed", "interrupted"].includes(parent.lifecycle.outcome))) throw new Error("delegation-continuation-parent-ineligible");
  if (!accountingMember && parent.delegationRefresh?.phase === "settled" && parent.lifecycle.state !== "terminal" && parent.lifecycle.state !== "parked-gate" && parent.lifecycle.state !== "queued") throw new RunContinuationRefusedError("delegation-refresh-execution-in-progress");
  const refresh = request.refreshAuthorization !== undefined && continued === undefined && selectedChild.group.manifest.join !== "none"
    && (!accountingMember || parent.lifecycle.state === "terminal" || parent.lifecycle.state === "parked-gate"
      || parent.lifecycle.state === "queued" && parent.delegationRefresh !== undefined);
  if (refresh) assertDelegationRefreshEligible(repositories, parent, request.refreshAuthorization);
  if (parent.lifecycle.state === "terminal" && continued === undefined && !refresh) {
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
  const terminal = childTerminalSettlement(run, repositories);
  if (terminal === undefined || terminal.state === "satisfied" || selectedChild.child.dependency.state !== terminal.state
    || repositories.writeIntents.listByRun(run.envelope.runId).some(intent => intent.status === "attempting" || intent.status === "parked")) throw new Error("delegation-retry-terminal-proof-unavailable");
  return { ...selectedChild, parent, source, terminal, ...(refresh ? { refreshAuthorization: request.refreshAuthorization } : {}),
    ...(accountingMember ? { accountingAuthorization: request.refreshAuthorization } : {}) };
}

export function authenticateCancellationSource(repositories: AuthorityRepositories, run: RunRecord,
  sourceInput: unknown) {
  const source = CancellationSourceSchema.parse(sourceInput);
  const command = repositories.commands.get(source.commandId);
  if (command?.family !== "run" || command.type !== "cancel" || command.target.runId !== source.rootRunId) throw new Error("delegation-cancellation-source-unavailable");
  const audit = authenticateOperatorSource(repositories, command);
  let current = run;
  const visited = new Set<string>();
  while (current.envelope.runId !== source.rootRunId) {
    if (visited.has(current.envelope.runId) || current.envelope.parent === undefined) throw new Error("delegation-cancellation-ancestry-mismatch");
    visited.add(current.envelope.runId);
    const parentId = current.envelope.parent.runId;
    const owning = delegationGroupForChild(repositories,parentId,current.envelope.runId);
    if (owning.manifest.policy.cascadeCancel !== "cascade") throw new Error("delegation-cancellation-policy-mismatch");
    current = owning.group.parent;
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
  if (repositories.commands.get(source.commandId) === undefined || repositories.commandAudits.findByCommand(source.commandId) === undefined) return { state: "unavailable" as const, reason: "source" as const };
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
  const audit = repositories.lifecycleJournal.findAuditByCommand(retained.commandId), authored = repositories.commandAudits.findByCommand(source.commandId);
  const appliedVersion = audit !== undefined && "kind" in audit && audit.kind === "run-lifecycle" && audit.result.kind === "run" ? audit.result.appliedVersion : undefined;
  if (request.commandId !== lifecycleCommandId("operator-cancel", { commandId: source.commandId, runId })
    || request.runId !== runId || audit === undefined || !("kind" in audit) || audit.kind !== "run-lifecycle"
    || audit.result.kind !== "run" || audit.result.runId !== runId || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(retained)
    || authored?.result.state !== "applied" || canonicalJsonStringify(authored.request) !== canonicalJsonStringify(source)
    || !authored.versionChanges.some(change => change.target.family === "run" && change.target.runId === runId
      && change.before === request.expectedVersion && change.after === appliedVersion)) throw new Error("delegation-child-cancellation-source-mismatch");
  return { cancelledBy: runId === request.cancellationSource.rootRunId ? "operator" as const : "parent" as const, reason: source.reason };
}

export function delegationEdgeForChild(repositories: AuthorityRepositories, parentRunId: string, childRunId: string) {
  const selected = delegationGroupForChild(repositories,parentRunId,childRunId).group.children.find(member => member.history.some(runId => runId === childRunId));
  if (selected === undefined) throw new Error("delegation-child-membership-unavailable");
  return selected.dependency;
}

export function assertDelegationReplacement(repositories: AuthorityRepositories, original: RunRecord, previous: RunRecord, next: RunRecord): void {
  validateRunContinuation(repositories, next.envelope);
  const origin = repositories.lifecycleJournal.findRunOrigin(next.envelope.runId);
  const issuance = origin === undefined ? undefined : repositories.lifecycleJournal.findAuditByCommand(origin.commandId);
  if (issuance === undefined || !("kind" in issuance) || issuance.kind !== "run-lifecycle" || issuance.result.kind !== "run"
    || canonicalJsonStringify(issuance.result.continuation) !== canonicalJsonStringify(captureRunContinuation(repositories, previous))) {
    throw new Error("delegation-retry-continuation-binding-mismatch");
  }
  authenticateRunPriority(repositories, next, previous.envelope.priority, LOCAL_OPERATOR_ACTOR_ID);
  const fields = ["browserMode", "captureBrowserScreenshots", "stepOmissions"] as const;
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
