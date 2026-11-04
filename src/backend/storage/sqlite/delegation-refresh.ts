import { z } from "zod";
import { RunContinuationRefusedError } from "./run-continuation.js";
import { PositiveIntSchema } from "../../../rules/identity/ids.js";
import type { AuthorityRepositories } from "./authority-database.js";
import { DelegationRefreshRequestSchema, DelegationRetryRequestSchema } from "./delegation-contracts.js";
import { RunRecordSchema, type RunRecord } from "../../../models/run/record.js";
import { terminalEvidenceResult } from "../../../models/run/result.js";
import { RunLifecycleCommandRecordSchema } from "../../../rules/commands/commands.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { lifecycleCommandId } from "../../../rules/identity/identifiers.js";
import { assertWorkflowDelegationRefreshAuthorization } from "../../../workflow-kit/workflow.js";

type RefreshEvidenceRepositories = Readonly<{
  lifecycleJournal: Pick<AuthorityRepositories["lifecycleJournal"], "getCommand" | "findAuditByCommand" | "listDelegationRefreshes">;
  delegationManifests: Pick<AuthorityRepositories["delegationManifests"], "get">;
  runResults: Pick<AuthorityRepositories["runResults"], "getSettlement">;
}>;

type RefreshRequest = z.infer<typeof DelegationRefreshRequestSchema>;
type RetryRequest = z.infer<typeof DelegationRetryRequestSchema>;

function refreshCommand(repositories: RefreshEvidenceRepositories, commandId: string) {
  const command = repositories.lifecycleJournal.getCommand(commandId);
  const audit = repositories.lifecycleJournal.findAuditByCommand(commandId);
  if (command === undefined || !("kind" in command) || command.kind !== "run-lifecycle" || command.operation !== "delegation-refresh"
    || audit === undefined || !("kind" in audit) || audit.kind !== "run-lifecycle" || audit.result.kind !== "run"
    || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)) throw new Error("delegation-refresh-authority-unavailable");
  const request = DelegationRefreshRequestSchema.parse(command.request);
  if (request.commandId !== commandId || command.requestFingerprint !== sha256Hex(`hrauto:run-lifecycle-command:v1\0delegation-refresh\0${canonicalJsonStringify(request)}`)
    || audit.result.runId !== request.runId || audit.result.appliedVersion !== request.expectedVersion + 1) throw new Error("delegation-refresh-binding-mismatch");
  return { request, version: audit.result.appliedVersion };
}

function retryCommand(repositories: RefreshEvidenceRepositories, commandId: string, parent: RunRecord) {
  const command = repositories.lifecycleJournal.getCommand(commandId);
  const audit = repositories.lifecycleJournal.findAuditByCommand(commandId);
  if (command === undefined || !("kind" in command) || command.kind !== "run-lifecycle" || command.operation !== "delegation-retry"
    || audit === undefined || !("kind" in audit) || audit.kind !== "run-lifecycle" || audit.result.kind !== "run"
    || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(command)) throw new Error("delegation-refresh-retry-unavailable");
  const retry = DelegationRetryRequestSchema.parse(command.request);
  const manifest = repositories.delegationManifests.get(retry.manifestId);
  if (retry.commandId !== commandId || manifest?.parentRunId !== parent.envelope.runId || manifest.join === "none"
    || retry.continuationOwner !== undefined || audit.result.runId !== retry.replacementRunId) throw new Error("delegation-refresh-retry-mismatch");
  return retry;
}

export function authenticateDelegationRefresh(repositories: RefreshEvidenceRepositories, run: RunRecord) {
  const refresh = run.delegationRefresh;
  if (refresh === undefined) return;
  const root = refreshCommand(repositories, refresh.commandId);
  if (root.request.phase !== "admit" || root.request.runId !== run.envelope.runId || root.request.nodeId !== refresh.nodeId
    || root.request.definitionFingerprint !== run.envelope.contractFingerprint || root.request.claimGeneration > run.claimGeneration
    || root.version > run.version || refresh.retryCommandIds[0] !== root.request.retryCommandId
    || refresh.commandId !== lifecycleCommandId("delegation-refresh-admit",root.request.retryCommandId)) throw new Error("delegation-refresh-root-mismatch");
  const previous = root.request.previous;
  if (previous.kind === "terminal") {
    if (previous.appliedVersion > root.request.expectedVersion) throw new Error("delegation-refresh-previous-version-mismatch");
    const terminal = repositories.runResults.getSettlement(run.envelope.runId,previous.appliedVersion);
    if (terminal?.run.completion?.kind !== "done" || terminal.run.envelope.contractFingerprint !== root.request.definitionFingerprint) throw new Error("delegation-refresh-previous-result-unavailable");
  } else if (previous.kind === "refresh") {
    const predecessor = refreshCommand(repositories,previous.commandId);
    if (predecessor.version >= root.version) throw new Error("delegation-refresh-previous-version-mismatch");
    authenticateDelegationRevisionRefresh(repositories,run,{ refreshCommandId: previous.commandId, settlementCommandId: previous.settlementCommandId },root.request.expectedVersion);
  } else {
    const parked = repositories.lifecycleJournal.getCommand(previous.parkCommandId);
    const audit = repositories.lifecycleJournal.findAuditByCommand(previous.parkCommandId);
    if (parked === undefined || !("kind" in parked) || parked.kind !== "run-lifecycle" || parked.operation !== "worker-transition"
      || audit === undefined || !("kind" in audit) || audit.kind !== "run-lifecycle" || audit.result.kind !== "run"
      || audit.result.runId !== run.envelope.runId || audit.result.appliedVersion > root.request.expectedVersion
      || canonicalJsonStringify(audit.request) !== canonicalJsonStringify(parked)) throw new Error("delegation-refresh-previous-gate-unavailable");
    const request = z.object({ runId: z.string(), lifecycle: z.object({ state: z.literal("parked-gate"), gateId: z.string() }) }).parse(parked.request);
    if (request.runId !== run.envelope.runId || request.lifecycle.gateId !== previous.gateId) throw new Error("delegation-refresh-previous-gate-mismatch");
  }
  const commands = repositories.lifecycleJournal.listDelegationRefreshes(run.envelope.runId)
    .map(command => refreshCommand(repositories,command.commandId)).filter(command => command.version <= run.version);
  const extensions = commands.filter(command => command.request.phase === "extend" && command.request.rootCommandId === refresh.commandId)
    .sort((left,right) => left.version-right.version);
  const accepted = [root.request.retryCommandId];
  let previousVersion = root.version;
  for (const extension of extensions) {
    const request = extension.request;
    if (request.phase !== "extend" || request.expectedVersion < previousVersion || request.runId !== run.envelope.runId
      || request.definitionFingerprint !== root.request.definitionFingerprint || request.claimGeneration !== root.request.claimGeneration
      || request.commandId !== lifecycleCommandId("delegation-refresh-extend", { rootCommandId: refresh.commandId, retryCommandId: request.retryCommandId })) throw new Error("delegation-refresh-extension-mismatch");
    accepted.push(request.retryCommandId);
    previousVersion = extension.version;
  }
  if (canonicalJsonStringify(accepted) !== canonicalJsonStringify(refresh.retryCommandIds)) throw new Error("delegation-refresh-cohort-mismatch");
  for (const commandId of accepted) retryCommand(repositories, commandId, run);
  const settlements = commands.filter(command => command.request.phase === "settle" && command.request.rootCommandId === refresh.commandId);
  if (settlements.length !== (refresh.phase === "settled" ? 1 : 0)) throw new Error("delegation-refresh-cohort-settlement-mismatch");
  if (refresh.phase === "settled") {
    const settled = refreshCommand(repositories, lifecycleCommandId("delegation-refresh-settle", { rootCommandId: refresh.commandId, retryCommandIds: refresh.retryCommandIds }));
    if (settled.request.phase !== "settle" || settled.request.rootCommandId !== refresh.commandId || settled.request.runId !== run.envelope.runId
      || canonicalJsonStringify(settled.request.retryCommandIds) !== canonicalJsonStringify(refresh.retryCommandIds)
      || settled.version > run.version || settled.version <= previousVersion) throw new Error("delegation-refresh-settlement-mismatch");
    if (canonicalJsonStringify(settled.request.children.map(child => child.retryCommandId)) !== canonicalJsonStringify(refresh.retryCommandIds)) throw new Error("delegation-refresh-cohort-mismatch");
    for (const child of settled.request.children) {
      const retry = retryCommand(repositories, child.retryCommandId, run);
      const terminal = repositories.runResults.getSettlement(child.runId, child.appliedVersion);
      if (retry.replacementRunId !== child.runId || retry.replacementAttempt !== child.attempt
        || terminal?.result.resultDigest !== child.resultDigest) throw new Error("delegation-refresh-child-settlement-mismatch");
    }
  }
}

export function authenticateDelegationRevisionRefresh(repositories: RefreshEvidenceRepositories, parent: RunRecord,
  revision: Readonly<{ refreshCommandId: string; settlementCommandId: string }>, appliedVersion: number) {
  const settled = refreshCommand(repositories,revision.settlementCommandId);
  if (settled.request.phase !== "settle" || settled.request.rootCommandId !== revision.refreshCommandId
    || settled.request.runId !== parent.envelope.runId || settled.version > appliedVersion) throw new Error("delegation-revision-refresh-unavailable");
  const root = refreshCommand(repositories,revision.refreshCommandId);
  if (root.request.phase !== "admit") throw new Error("delegation-revision-refresh-unavailable");
  authenticateDelegationRefresh(repositories,RunRecordSchema.parse({ ...parent,
    delegationRefresh: { commandId: revision.refreshCommandId, nodeId: root.request.nodeId,
      phase: "settled", retryCommandIds: settled.request.retryCommandIds } }));
}

export function assertDelegationRefreshEligible(repositories: AuthorityRepositories, parent: RunRecord, authorization: object | undefined) {
  assertWorkflowDelegationRefreshAuthorization(authorization, parent);
  authenticateDelegationRefresh(repositories, parent);
  if (repositories.ocrReviews.snapshots(parent.envelope.runId).length !== 0 || parent.cancelRequested === true
    || repositories.workerControls.resetForRun(parent.envelope.runId) !== undefined
    || repositories.writeIntents.listByRun(parent.envelope.runId).length !== 0
    || repositories.gateResults.listByRun(parent.envelope.runId).length !== 0) throw new RunContinuationRefusedError("delegation-refresh-owner-ineligible");
  if (parent.lifecycle.state === "queued" && parent.delegationRefresh !== undefined) return;
  if (parent.lifecycle.state === "terminal" && parent.lifecycle.outcome === "done" && parent.completion?.kind === "done") {
    const result = repositories.runResults.get(parent.envelope.runId);
    if (result !== undefined && result.resultDigest === parent.completion.resultDigest && terminalEvidenceResult(result) === undefined) return;
  }
  const lifecycle = parent.lifecycle;
  if (lifecycle.state === "parked-gate" && repositories.gateResults.listByRun(parent.envelope.runId).every(gate => gate.gateId !== lifecycle.gateId)) return;
  throw new RunContinuationRefusedError("delegation-refresh-owner-ineligible");
}

function applyRefresh(repositories: AuthorityRepositories, parent: RunRecord, request: RefreshRequest, now: string, next: RunRecord, write: (run: RunRecord) => void) {
  const command = RunLifecycleCommandRecordSchema.parse({ kind: "run-lifecycle", operation: "delegation-refresh", commandId: request.commandId, request,
    requestFingerprint: sha256Hex(`hrauto:run-lifecycle-command:v1\0delegation-refresh\0${canonicalJsonStringify(request)}`),
    fence: { kind: "version", expectedVersion: parent.version }, recordedAt: now });
  if (repositories.lifecycleJournal.getCommand(command.commandId) !== undefined) throw new Error("delegation-refresh-command-exists");
  repositories.lifecycleJournal.insertCommand(command);
  write(next);
  repositories.lifecycleJournal.insertAudit({ kind: "run-lifecycle", auditId: command.commandId, request: command,
    result: { kind: "run", runId: next.envelope.runId, appliedVersion: next.version }, completedAt: now });
  return next;
}

export function admitDelegationRefresh(repositories: AuthorityRepositories, retry: RetryRequest, authorization: object, now: string, write: (run: RunRecord) => void) {
  const manifest = repositories.delegationManifests.get(retry.manifestId);
  const parent = manifest === undefined ? undefined : repositories.runs.get(manifest.parentRunId);
  if (parent === undefined || parent.version !== retry.parentVersion) throw new Error("delegation-refresh-owner-stale");
  assertDelegationRefreshEligible(repositories, parent, authorization);
  retryCommand(repositories, retry.commandId, parent);
  const pending = parent.delegationRefresh?.phase === "waiting" ? parent.delegationRefresh : undefined;
  const nodeId = repositories.lifecycleJournal.getCommand(retry.invocationCommandId);
  if (nodeId === undefined || !("kind" in nodeId) || nodeId.kind !== "run-lifecycle") throw new Error("delegation-refresh-invocation-unavailable");
  const invocation = z.object({ nodeId: z.string() }).parse(nodeId.request);
  const base = { runId: parent.envelope.runId, expectedVersion: parent.version,
    definitionFingerprint: parent.envelope.contractFingerprint, claimGeneration: parent.claimGeneration };
  let request: RefreshRequest;
  if (pending !== undefined) {
    request = DelegationRefreshRequestSchema.parse({ ...base, phase: "extend", commandId: lifecycleCommandId("delegation-refresh-extend", { rootCommandId: pending.commandId, retryCommandId: retry.commandId }),
      rootCommandId: pending.commandId, retryCommandId: retry.commandId, nodeId: invocation.nodeId });
  } else {
    const previous = parent.lifecycle.state === "terminal" && parent.completion !== undefined ? { kind: "terminal", appliedVersion: parent.completion.expectedVersion + 1 }
      : parent.lifecycle.state === "parked-gate" ? { kind: "gate", gateId: parent.lifecycle.gateId,
        parkCommandId: repositories.lifecycleJournal.findGatePark(parent.envelope.runId, parent.lifecycle.gateId, parent.version)?.commandId }
        : parent.delegationRefresh?.phase === "settled" ? { kind: "refresh", commandId: parent.delegationRefresh.commandId,
          settlementCommandId: lifecycleCommandId("delegation-refresh-settle", { rootCommandId: parent.delegationRefresh.commandId, retryCommandIds: parent.delegationRefresh.retryCommandIds }) } : undefined;
    request = DelegationRefreshRequestSchema.parse({ ...base, phase: "admit", commandId: lifecycleCommandId("delegation-refresh-admit", retry.commandId),
      retryCommandId: retry.commandId, nodeId: invocation.nodeId, previous });
  }
  const { completion: _completion, ...withoutCompletion } = parent;
  const next = RunRecordSchema.parse({ ...withoutCompletion, lifecycle: { state: "queued" }, version: parent.version + 1, updatedAt: now,
    delegationRefresh: { commandId: pending?.commandId ?? request.commandId, nodeId: pending?.nodeId ?? invocation.nodeId, phase: "waiting",
      retryCommandIds: [...pending?.retryCommandIds ?? [], retry.commandId] } });
  return applyRefresh(repositories, parent, request, now, next, write);
}

export function settleDelegationRefresh(repositories: AuthorityRepositories, parentRunId: string, now: string, write: (run: RunRecord) => void) {
  const parent = repositories.runs.get(parentRunId), refresh = parent?.delegationRefresh;
  if (parent === undefined || refresh?.phase !== "waiting" || parent.lifecycle.state !== "queued") return;
  authenticateDelegationRefresh(repositories, parent);
  const children: Extract<RefreshRequest, { phase: "settle" }>["children"] = [];
  for (const retryCommandId of refresh.retryCommandIds) {
    const retry = retryCommand(repositories, retryCommandId, parent);
    const child = repositories.runs.get(retry.replacementRunId);
    if (child?.lifecycle.state !== "terminal") return;
    const result = repositories.runResults.get(child.envelope.runId);
    if (result === undefined) throw new Error("delegation-refresh-child-result-unavailable");
    const evidence = terminalEvidenceResult(result);
    const appliedVersion = child.completion === undefined ? evidence?.kind === "lifecycle-evidence" ? evidence.appliedVersion : undefined : child.completion.expectedVersion + 1;
    children.push({ retryCommandId, runId: child.envelope.runId, attempt: child.envelope.attempt, resultDigest: result.resultDigest, appliedVersion: PositiveIntSchema.parse(appliedVersion) });
  }
  const request = DelegationRefreshRequestSchema.parse({ phase: "settle", commandId: lifecycleCommandId("delegation-refresh-settle", { rootCommandId: refresh.commandId, retryCommandIds: refresh.retryCommandIds }),
    runId: parentRunId, expectedVersion: parent.version, definitionFingerprint: parent.envelope.contractFingerprint, claimGeneration: parent.claimGeneration,
    rootCommandId: refresh.commandId, retryCommandIds: refresh.retryCommandIds, children });
  return applyRefresh(repositories, parent, request, now, RunRecordSchema.parse({ ...parent, version: parent.version + 1, updatedAt: now,
    delegationRefresh: { ...refresh, phase: "settled" } }), write);
}
