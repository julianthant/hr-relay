import { executeRecoveryFindings, executeRecoveryProbe, RecoveryActivityError } from "./recovery-activity.js";
import { UcpathReadTransactionFindings } from "../../../models/systems/ucpath/read-transaction-findings.js";
import { UcpathTerminationTargetSchema } from "../../../models/ui/ucpath-smart-hr-termination.js";
import { RunRecordSchema, type RunRecord } from "../../../models/run/record.js";
import { WorkerSessionClosureUnprovedError } from "../workers/worker-sessions.js";
import { BrowserSessionClosureUnprovedError } from "../../../workflow-kit/session.js";
import { DuoCeremonyReleaseFailedError } from "../gates/duo-ceremony-gate.js";
import { ParkedWriteCheckResultSchema, type ParkedWriteCheckTarget, type ParkedWriteCheckResult } from "../../../rules/commands/commands.js";
import { WorkerControlRefusal } from "../../../models/run/worker-control.js";
import type { ParkedWriteCheckAcknowledgement } from "../../../rules/commands/commands.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";

import { isFailedReadBack } from "../../../rules/write-safety/write-authority-reason.js";
import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { canonicalJsonStringify, JsonValueSchema } from "../../../rules/validation/canonical-json.js";
import type { IdFactory } from "../../../rules/identity/identifiers.js";
import { PositiveIntSchema } from "../../../rules/identity/ids.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { WriteIntentRecordSchema } from "../../../rules/write-safety/write-safety.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-repositories.js";
import {
  rebuildCommitInput,
  requireWriteResolutionBinding,
  type TransactionRuntimeNode,
  type WriteBindingRepositories,
  type WriteResolutionArm,
} from "./write-resolution-binding.js";
import { taskImplFingerprint } from "../../../workflow-kit/fingerprints.js";
import { rejectCommandRequest } from "../../runs/commands/command-refusal.js";
import { lifecycleCommandId, type RunContinuationPort } from "../../runs/lifecycle/run-record-service.js";
import type { WriteResolutionContext, WriteResolutionExecutor } from "../../runs/commands/write-resolution-command.js";
import type { WorkflowDescriptorResolver } from "../../runs/commands/run-command-context.js";
import {
  type ProbeReadDeps,
  type TransactionSessionHost,
  type WriteSequencerHooks,
} from "./write-sequencer.js";
import type { RunConfigFingerprintBinding } from "../workers/worker-sessions.js";

/** Exact retained authority; this read never changes the run, attempt or intent. */
export function requireParkedWriteCheckTarget(repositories: Pick<AuthorityRepositories, "runs" | "writeIntents" | "writeAttempts" | "runCheckpoints" | "gateResults">,
  target: ParkedWriteCheckTarget, descriptor: AnyWorkflowDescriptor | undefined) {
  const run = repositories.runs.get(target.runId), intent = repositories.writeIntents.get(target.writeIntentId);
  const attempt = repositories.writeAttempts.get(target.writeAttemptId);
  if (run === undefined || intent?.status !== "parked" || attempt?.outcome.state !== "parked" || descriptor === undefined
    || run.lifecycle.state !== "parked-write" || run.version !== target.runVersion || run.envelope.workflow !== target.workflowId
    || run.envelope.itemId !== target.itemId || run.envelope.attempt !== target.runAttempt || run.envelope.traceId !== target.traceId
    || run.lifecycle.writeIntentId !== target.writeIntentId || run.lifecycle.intentGeneration !== target.intentGeneration
    || intent.version !== target.intentVersion || intent.generation !== target.intentGeneration || intent.currentAttemptId !== target.writeAttemptId
    || intent.runId !== target.runId || intent.runAttempt !== target.runAttempt || intent.workflowId !== target.workflowId || intent.itemId !== target.itemId
    || intent.bindingProofDigest !== target.bindingProofDigest || intent.idempotencyKeyDigest !== target.occurrenceKeyDigest
    || attempt.writeIntentId !== target.writeIntentId || attempt.generation !== target.intentGeneration || attempt.runId !== target.runId
    || attempt.runAttempt !== target.runAttempt || attempt.bindingProofDigest !== target.bindingProofDigest
    || intent.bindingProof.afterPrepareSpanPath !== `${target.traceId}/${target.nodeId}/prepare`) throw new WorkerControlRefusal("parked-check-authority-changed");
  const { node } = requireWriteResolutionBinding({ arm: "recovery-probe", descriptor, run, intent, repositories });
  if (node.id !== target.nodeId || descriptor.id !== target.workflowId) throw new WorkerControlRefusal("parked-check-node-changed");
  return { run, intent, node, commitInput: rebuildCommitInput(repositories, descriptor, node, run, intent) };
}

/** Registered reads only. A matching target state is not attribution to the original attempt. */
export async function checkParkedWrite(input: Readonly<{
  repositories: AuthorityRepositories; descriptor: AnyWorkflowDescriptor | undefined; target: ParkedWriteCheckTarget;
  commandId: string; requestedBy: string; signal: AbortSignal;
  probe: Omit<ProbeReadDeps, "sessions" | "retainCallback">;
  sessions: Pick<TransactionSessionHost, "withDriver" | "closeAll"> & RunConfigFingerprintBinding;
  configureRun: (run: RunRecord) => Readonly<{ taskDeadlineMs: number }>;
}>): Promise<ParkedWriteCheckAcknowledgement> {
  input.signal.throwIfAborted();
  if (input.requestedBy !== "local-operator") throw new WorkerControlRefusal("PARKED_CHECK_UNAVAILABLE");
  const { run, intent, node, commitInput } = requireParkedWriteCheckTarget(input.repositories, input.target, input.descriptor);
  const probeId = node.commit.uses.writeSafety.idempotency.probe.taskId;
  const supported = (intent.taskId === "ucpath/create-termination" && probeId === "ucpath/match-existing-termination")
    || (intent.taskId === "ucpath/delete-pending-terminations" && probeId === "ucpath/match-pending-terminations")
    || (intent.taskId === "kuali/save-separation-finalization" && probeId === "kuali/match-separation-finalization");
  const findingsTarget = intent.taskId === "ucpath/create-termination" ? UcpathTerminationTargetSchema.parse(commitInput) : undefined;
  const readTaskId = findingsTarget === undefined ? probeId : UcpathReadTransactionFindings.id;
  const readInput = findingsTarget === undefined ? commitInput : { emplId: findingsTarget.emplId, expectedName: findingsTarget.expectedName };
  const task = input.probe.stores.stores.flatMap(store => Object.values(store.tasks)).find(value => value.contract.id === readTaskId);
  const instance = run.envelope.resolvedInstance[intent.system];
  let evidence: ParkedWriteCheckAcknowledgement["evidence"];
  let findingsIdentity: ParkedWriteCheckAcknowledgement["findingsIdentity"];
  let observedTaskId = probeId;
  let state: ParkedWriteCheckResult["state"] = "unavailable";
  let code: ParkedWriteCheckResult["code"] = "PARKED_CHECK_UNAVAILABLE";
  if (supported && intent.bindingProof.kind === "subject-match" && instance !== undefined
    && task?.contract.effect === "read" && task.impl.sessions.length === 1 && task.impl.sessions[0]?.access === "read"
    && task.impl.sessions[0].system === intent.system && task.contract.input.safeParse(readInput).success) {
    try {
      if (input.descriptor === undefined) throw new WorkerControlRefusal("PARKED_CHECK_UNAVAILABLE");
      const activity = { operation: "parked-write-check" as const, repositories: input.repositories,
        run, intent, node, descriptor: input.descriptor, commitInput, signal: input.signal,
        probe: { ...input.probe, sessions: input.sessions }, sessions: input.sessions,
        configureRun: () => input.configureRun(run) };
      if (intent.taskId === "ucpath/create-termination") {
        const implFingerprint = taskImplFingerprint(UcpathReadTransactionFindings);
        const findings = await executeRecoveryFindings(activity);
        evidence = { schemaHash: deriveSchemaHash(UcpathReadTransactionFindings.output, "output"), value: JsonValueSchema.parse(findings.output) };
        findingsIdentity = { activityId: findings.activityId, descriptorVersion: run.envelope.descriptorVersion,
          contractFingerprint: run.envelope.contractFingerprint, claimGeneration: PositiveIntSchema.parse(run.claimGeneration),
          implFingerprint };
        observedTaskId = UcpathReadTransactionFindings.id;
        state = "unknown"; code = "PARKED_CHECK_UNKNOWN";
      } else {
        const verdict = await executeRecoveryProbe(activity);
        input.signal.throwIfAborted();
        evidence = { schemaHash: deriveSchemaHash(task.contract.output, "output"), value: JsonValueSchema.parse(verdict) };
        state = verdict.state === "present" ? "ambiguous" : verdict.state;
        code = verdict.state === "present" ? "PARKED_CHECK_OCCURRENCE_UNPROVED"
          : verdict.state === "absent" ? "PARKED_CHECK_ABSENT" : verdict.state === "ambiguous" ? "PARKED_CHECK_AMBIGUOUS" : "PARKED_CHECK_UNKNOWN";
      }
    } catch (error) {
      if (error instanceof RecoveryActivityError || error instanceof WorkerSessionClosureUnprovedError
        || error instanceof BrowserSessionClosureUnprovedError || error instanceof DuoCeremonyReleaseFailedError) throw error;
      input.signal.throwIfAborted();
      state = "unknown"; code = "PARKED_CHECK_UNKNOWN";
    }
  }
  input.signal.throwIfAborted();
  requireParkedWriteCheckTarget(input.repositories, input.target, input.descriptor);
  const result = ParkedWriteCheckResultSchema.parse({ commandId: input.commandId, requestedBy: input.requestedBy, target: input.target,
    observedAt: input.probe.clock.now().toISOString(), held: true, provenance: evidence === undefined ? "not-observed" : "system-probe", state, code,
    ...(evidence === undefined ? {} : { probeTaskId: observedTaskId }),
    evidenceDigest: sha256Hex(canonicalJsonStringify({ target: input.target, state, code, evidence: evidence ?? null,
      ...(findingsIdentity === undefined ? {} : { findingsIdentity }) })) });
  return { result, ...(evidence === undefined ? {} : { evidence }),
    ...(findingsIdentity === undefined ? {} : { findingsIdentity }) };
}

/* ── the kernel's typed operator resolutions (ref write-safety ) ───────────────── */

export interface WriteResolutionDependencies {
  readonly continuation: RunContinuationPort;
  readonly descriptors: WorkflowDescriptorResolver;
  readonly ids: IdFactory;
  readonly hooks?: WriteSequencerHooks;
}

// Parked-write resolution binds the consumed semantic surface; unrelated source edits cannot expire its release path.
function requireResolutionTarget(
  deps: WriteResolutionDependencies,
  repositories: WriteBindingRepositories,
  context: WriteResolutionContext,
  arm: WriteResolutionArm,
): Readonly<{ descriptor: AnyWorkflowDescriptor; node: TransactionRuntimeNode }> {
  const descriptor = deps.descriptors.resolve(context.run.envelope.workflow);
  if (descriptor === undefined) {
    throw new Error(`workflow ${context.run.envelope.workflow} is not registered; the parked write cannot resolve`);
  }
  const { node } = requireWriteResolutionBinding({
    arm,
    descriptor,
    run: context.run,
    intent: context.intent,
    repositories,
  });
  return Object.freeze({ descriptor, node });
}

function requireResolvableIntent(context: WriteResolutionContext): void {
  if (context.intent.status !== "parked") {
    throw new Error(
      `write intent ${context.intent.writeIntentId} is ${context.intent.status}; `
      + "it has no operator resolution",
    );
  }
}

export function createWriteResolutionExecutor(deps: WriteResolutionDependencies): WriteResolutionExecutor {
  function requestResolution(repositories: AuthorityRepositories, context: WriteResolutionContext, node: TransactionRuntimeNode) {
    const intent = context.intent;
    if (intent.status !== "parked") throw new Error("parked-write-resolution-required");
    const transactionId = context.command.type === "recheck-write" ? context.command.payload.transactionId : undefined;
    const recheck = { nodeId: String(node.id), commandId: context.command.commandId, auditId: context.auditId,
      expectedRunVersion: context.run.version, requestedAt: context.now,
      ...(transactionId === undefined ? {} : { transactionId }) };
    const requested = WriteIntentRecordSchema.parse({ ...intent, recheck, version: intent.version + 1, updatedAt: context.now });
    const run = RunRecordSchema.parse({ ...context.run, envelope: { ...context.run.envelope, startAt: node.id },
      lifecycle: { state: "queued" }, version: context.run.version + 1, updatedAt: context.now });
    return { outcome: { run, intent: requested }, applyAfterAudit: () => {
      const actualIntent = repositories.writeIntents.requestRecheck({ writeIntentId: intent.writeIntentId,
        generation: intent.generation, expectedVersion: intent.version, recheck });
      const actual = deps.continuation.transition({ commandId: lifecycleCommandId("write-recheck", context.command.commandId),
        runId: run.envelope.runId, expectedVersion: context.run.version, lifecycle: { state: "queued" }, startAt: node.id,
        writeResolution: { kind: "recheck", commandId: context.command.commandId, writeIntentId: intent.writeIntentId,
          generation: intent.generation, writeAttemptId: intent.currentAttemptId, bindingProofDigest: intent.bindingProofDigest } });
      if (actual.state !== "applied") throw new Error("parked-write-resolution-continuation-failed");
      deps.hooks?.afterSequencedStep?.("run-transition");
      return { run: actual.run, intent: actualIntent };
    } };
  }

  return Object.freeze({
    recheck(repositories: AuthorityRepositories, context: WriteResolutionContext) {
      if (context.command.type === "fail-read-back") {
        const { command, intent, run } = context;
        if (intent.status !== "parked") throw new Error("parked-write-resolution-required");
        const attempt = repositories.writeAttempts.get(intent.currentAttemptId);
        if (attempt?.outcome.state !== "parked" || !isFailedReadBack(attempt.outcome.authorityReason.code)) {
          rejectCommandRequest(command, "invalid-state", "The parked write has no failed read-back to close.");
        }
        const descriptor = deps.descriptors.resolve(run.envelope.workflow);
        if (descriptor === undefined || descriptor.version !== run.envelope.descriptorVersion
          || descriptor.contractFingerprint !== run.envelope.contractFingerprint) {
          rejectCommandRequest(command, "capability-unavailable", "The workflow for this read-back failure is unavailable.");
        }
        const node = descriptorRuntimeNodes(descriptor).find((candidate): candidate is TransactionRuntimeNode =>
          candidate.kind === "transaction" && candidate.commit.uses.id === intent.taskId
          && intent.bindingProof.afterPrepareSpanPath === `${run.envelope.traceId}/${candidate.id}/prepare`);
        if (node === undefined) rejectCommandRequest(command, "capability-unavailable", "The original write step is unavailable.");
        return requestResolution(repositories, context, node);
      }
      if (context.command.type !== "recheck-write") throw new Error("write-recheck-command-required");
      requireResolvableIntent(context);
      const { node } = requireResolutionTarget(deps, repositories, context, "recheck");
      const completion = node.commit.uses.writeSafety.completion;
      if (context.command.payload.transactionId !== undefined
        && (completion.kind === "receipt" || completion.verify.taskId !== "ucpath/verify-termination")) {
        rejectCommandRequest(context.command, "invalid-value", "This write does not support checking one transaction ID");
      }
      return requestResolution(repositories, context, node);
    },

    resolveAbsent(repositories: AuthorityRepositories, context: WriteResolutionContext) {
      if (context.command.type !== "resolve-write-absent") {
        throw new Error(`resolveAbsent received a ${context.command.type} command`);
      }
      requireResolvableIntent(context);
      if (context.intent.status !== "parked" || context.command.payload.occurrenceKeyDigest !== context.intent.idempotencyKeyDigest) {
        rejectCommandRequest(context.command, "invalid-state", "Resolution must attest the exact new write occurrence");
      }
      const { node } = requireResolutionTarget(deps, repositories, context, "operator-confirmed-absent");
      return requestResolution(repositories, context, node);
    },
  });
}
