import { RunRecordSchema, type RunRecord } from "../../../models/run/record.js";
import { WorkerSessionClosureUnprovedError } from "../workers/worker-sessions.js";
import { BrowserSessionClosureUnprovedError } from "../../../workflow-kit/session.js";
import { DuoCeremonyReleaseFailedError } from "../gates/duo-ceremony-gate.js";
import { ParkedWriteCheckResultSchema, type ParkedWriteCheckTarget, type ParkedWriteCheckResult } from "../../../rules/commands/commands.js";
import { WorkerControlRefusal, type WorkerEffectAcknowledgement } from "../../../models/run/worker-control.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { valueFreeProtectedData, retainedRunProtectedBindings, hasProtectedTransactionInput } from "../../../models/write-safety/protected-input.js";
import { isFreshOccurrenceProof } from "../gates/repeat-proof.js";

import { z } from "zod";
import type { AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { canonicalJsonStringify, JsonValueSchema } from "../../../rules/validation/canonical-json.js";
import type { JsonValue } from "../../../rules/validation/canonical-json.js";
import type { Clock } from "../../../rules/time/clock.js";
import type { AnyCommitTaskContract } from "../../../models/task/task-contract.js";
import type { IdFactory } from "../../../rules/identity/identifiers.js";
import {
  ActorIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  WriteIntentIdSchema,
} from "../../../rules/identity/ids.js";
import type { Fingerprint, TaskId } from "../../../rules/identity/ids.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { idempotencyKeyDigestReference } from "../../../rules/redaction/redaction.js";
import {
  ParkedWriteResolutionBindingSchema,
  WriteIntentRecordSchema,
  evaluateNegativeSettlement,
  deriveWriteAuthorityReason,
  NegativeSettlementPolicySchema,
  RecoveryProbeVerdictSchema,
  type WriteIntentRecord,
  type WriteAuthorityReason,
} from "../../../rules/write-safety/write-safety.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import {
  rebuildCommitInput,
  requireWriteResolutionBinding,
  type TransactionRuntimeNode,
  type WriteBindingRepositories,
  type WriteResolutionArm,
} from "./write-resolution-binding.js";
import {
  BUILD_MANIFEST,
  resolveTaskImplFingerprint,
} from "../../../workflow-kit/validation/build-manifest.js";
import { rejectCommandRequest } from "../../runs/commands/command-kernel.js";
import type {
  WriteResolutionContext,
  WriteResolutionExecutor,
  WorkflowDescriptorResolver,
} from "../../runs/commands/command-kernel.js";
import {
  buildCommittedSettlement,
  executeIdempotencyProbe,
  executeSequencedWriteCommit,
  type ProbeReadDeps,
  type RuntimeProbeVerdict,
  type TransactionSessionHost,
  type WriteSequencerAuthority,
  type WriteSequencerHooks,
} from "./write-sequencer.js";
import type { RunConfigFingerprintBinding } from "../workers/worker-sessions.js";
import type { WriteIntentParkCode } from "../../storage/sqlite/write-commit-contracts.js";
import type { TaskStoreRegistry } from "../../../workflow-kit/task-registry.js";
import type { TaskLogger } from "../../../workflow-kit/task.js";
import type { MonotonicDeadlineScheduler } from "../scheduling/deadline-scheduler.js";

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
}>): Promise<Extract<WorkerEffectAcknowledgement, { kind: "parked-write-check" }>> {
  input.signal.throwIfAborted();
  if (input.requestedBy !== "local-operator") throw new WorkerControlRefusal("PARKED_CHECK_UNAVAILABLE");
  const { run, intent, node, commitInput } = requireParkedWriteCheckTarget(input.repositories, input.target, input.descriptor);
  const probeId = node.commit.uses.writeSafety.idempotency.probe.taskId;
  const supported = (intent.taskId === "ucpath/create-termination" && probeId === "ucpath/match-existing-termination")
    || (intent.taskId === "ucpath/delete-pending-terminations" && probeId === "ucpath/match-pending-terminations")
    || (intent.taskId === "kuali/save-separation-finalization" && probeId === "kuali/match-separation-finalization");
  const task = input.probe.stores.stores.flatMap(store => Object.values(store.tasks)).find(value => value.contract.id === probeId);
  const instance = run.envelope.resolvedInstance[intent.system];
  let evidence: Extract<WorkerEffectAcknowledgement, { kind: "parked-write-check" }>["evidence"];
  let state: ParkedWriteCheckResult["state"] = "unavailable";
  let code: ParkedWriteCheckResult["code"] = "PARKED_CHECK_UNAVAILABLE";
  if (supported && run.envelope.workflow === "separations" && intent.bindingProof.kind === "subject-match" && instance !== undefined
    && task?.contract.effect === "read" && task.impl.sessions.length === 1 && task.impl.sessions[0]?.access === "read"
    && task.impl.sessions[0].system === intent.system && task.contract.input.safeParse(commitInput).success) {
    await input.sessions.closeAll("parked");
    const resources = input.configureRun(run);
    input.sessions.bindRunConfigFingerprint(FingerprintSchema.parse(run.envelope.configFingerprint), run.envelope.browserMode);
    let callbackSettlement: Promise<unknown> | undefined;
    try {
      try {
        const verdict = await executeIdempotencyProbe({ ...input.probe, taskDeadlineMs: resources.taskDeadlineMs, sessions: input.sessions,
          retainCallback: settlement => { callbackSettlement = settlement; } }, { commitContract: node.commit.uses,
          commitInput, instance, signal: input.signal });
        input.signal.throwIfAborted();
        evidence = { schemaHash: deriveSchemaHash(task.contract.output, "output"), value: JsonValueSchema.parse(verdict) };
        state = verdict.state === "present" ? "ambiguous" : verdict.state;
        code = verdict.state === "present" ? "PARKED_CHECK_OCCURRENCE_UNPROVED"
          : verdict.state === "absent" ? "PARKED_CHECK_ABSENT" : verdict.state === "ambiguous" ? "PARKED_CHECK_AMBIGUOUS" : "PARKED_CHECK_UNKNOWN";
      } catch (error) {
        if (error instanceof WorkerSessionClosureUnprovedError || error instanceof BrowserSessionClosureUnprovedError || error instanceof DuoCeremonyReleaseFailedError) throw error;
        input.signal.throwIfAborted();
        state = "unknown"; code = "PARKED_CHECK_UNKNOWN";
      }
    } finally {
      try { await input.sessions.closeAll("parked"); }
      finally {
        await callbackSettlement;
        input.sessions.releaseRunConfigFingerprint();
      }
    }
  }
  input.signal.throwIfAborted();
  requireParkedWriteCheckTarget(input.repositories, input.target, input.descriptor);
  const result = ParkedWriteCheckResultSchema.parse({ commandId: input.commandId, requestedBy: input.requestedBy, target: input.target,
    observedAt: input.probe.clock.now().toISOString(), held: true, provenance: evidence === undefined ? "not-observed" : "system-probe", state, code,
    ...(evidence === undefined ? {} : { probeTaskId: probeId }),
    evidenceDigest: sha256Hex(canonicalJsonStringify({ target: input.target, state, code, evidence: evidence ?? null })) });
  return { kind: "parked-write-check", result, ...(evidence === undefined ? {} : { evidence }) };
}

/* ── the typed recovery decision ─────────────────────────────────────────── */

export const WriteRecoveryDecisionSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("backfilled"),
    writeIntentId: WriteIntentIdSchema,
    generation: z.number().int().positive(),
  }),
  z.strictObject({
    state: z.literal("safe-to-retry"),
    writeIntentId: WriteIntentIdSchema,
    generation: z.number().int().positive(),
  }),
  z.strictObject({
    state: z.literal("wait"),
    writeIntentId: WriteIntentIdSchema,
    generation: z.number().int().positive(),
    notBefore: IsoInstantSchema,
    observationsNeeded: z.number().int().positive(),
  }),
  z.strictObject({
    state: z.literal("parked"),
    writeIntentId: WriteIntentIdSchema,
    generation: z.number().int().positive(),
    code: z.enum(["unknown", "ambiguous", "present-proof-invalid", "binding-invalid", "operator-required"]),
    message: z.string().min(1),
  }),
]);
export type WriteRecoveryDecision = z.infer<typeof WriteRecoveryDecisionSchema>;

import { lifecycleCommandId, type RunContinuationPort } from "../../runs/lifecycle/run-record-service.js";

export type WriteRecoveryAuthority = Omit<WriteSequencerAuthority, "authority" | "withAuthorityTransaction"> & {
  readonly authority: AuthorityRepositories;
  withAuthorityTransaction<Result>(work: (repositories: AuthorityRepositories) => Result): Result;
};

export interface WriteRecoveryDependencies {
  readonly continuation: RunContinuationPort;
  readonly stores: TaskStoreRegistry;
  readonly authority: WriteRecoveryAuthority;
  // Recovery outside a worker claim window binds the target run's retained config fingerprint itself.
  readonly sessions: Pick<TransactionSessionHost, "withDriver"> & RunConfigFingerprintBinding;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly scheduler: MonotonicDeadlineScheduler;
  readonly taskDeadlineMs: number;
  readonly operator: unknown;
  readonly log: TaskLogger;
  readonly resolveImplFingerprint?: (taskId: TaskId) => Fingerprint;
  readonly hooks?: WriteSequencerHooks;
}

export interface WriteRecoveryInput {
  readonly descriptor: AnyWorkflowDescriptor;
  readonly writeIntentId: string;
  // Pre-settlement absence observations are held in this recovery episode, never synthesized.
  readonly priorVerdicts?: readonly unknown[];
  readonly signal: AbortSignal;
}

export interface WriteRecoveryService {
  recover(input: WriteRecoveryInput): Promise<WriteRecoveryDecision>;
}

type AttemptingIntent = Extract<WriteIntentRecord, { status: "attempting" }>;

/* ── the recovery service ────────────────────────────────────────────────── */

export function createWriteRecoveryService(deps: WriteRecoveryDependencies): WriteRecoveryService {
  const operator = ActorIdSchema.parse(deps.operator);
  const resolveImplFingerprint = deps.resolveImplFingerprint
    ?? ((taskId: TaskId) => resolveTaskImplFingerprint(BUILD_MANIFEST, taskId));
  const instant = () => IsoInstantSchema.parse(deps.clock.now().toISOString());
  const probeDeps: ProbeReadDeps = {
    stores: deps.stores,
    sessions: deps.sessions,
    clock: deps.clock,
    scheduler: deps.scheduler,
    taskDeadlineMs: deps.taskDeadlineMs,
    log: deps.log,
  };

  function park(
    intent: AttemptingIntent,
    code: WriteIntentParkCode,
    message: string,
    authorityReason: WriteAuthorityReason,
  ): WriteRecoveryDecision {
    deps.authority.withAuthorityTransaction((repositories) => {
      repositories.writeIntents.parkAttempt({
        writeIntentId: intent.writeIntentId,
        generation: intent.generation,
        expectedVersion: intent.version,
        code,
        message,
        authorityReason,
        now: instant(),
      });
    });
    return WriteRecoveryDecisionSchema.parse({
      state: "parked",
      writeIntentId: intent.writeIntentId,
      generation: intent.generation,
      code,
      message,
    });
  }

  async function recover(input: WriteRecoveryInput): Promise<WriteRecoveryDecision> {
    const intent = deps.authority.authority.writeIntents.get(input.writeIntentId);
    if (intent === undefined) throw new Error(`write intent ${input.writeIntentId} does not exist`);
    if (intent.status !== "attempting") {
      throw new Error(
        `write intent ${input.writeIntentId} is ${intent.status}; §4 recovery owns only unfinished `
        + "attempting intents — parked intents take the typed operator resolutions",
      );
    }
    const run = deps.authority.authority.runs.get(intent.runId);
    if (run === undefined) {
      throw new Error(`write intent ${input.writeIntentId} names run ${intent.runId}, which does not exist`);
    }
    const protectedReason: typeof deriveWriteAuthorityReason = (code, kind, detail) => {
      const bindings = retainedRunProtectedBindings(run);
      if (bindings.length === 0) return deriveWriteAuthorityReason(code, kind, detail);
      const parsed: unknown = kind === "exception" || kind === "session" ? "protected detail withheld" : JSON.parse(detail);
      return deriveWriteAuthorityReason(code, kind, canonicalJsonStringify({ protectedBindings: bindings,
        evidence: valueFreeProtectedData(parsed, bindings) }));
    };

    const { node } = requireWriteResolutionBinding({
      arm: "recovery-probe",
      descriptor: input.descriptor,
      run,
      intent,
      repositories: deps.authority.authority,
    });
    const commitContract: AnyCommitTaskContract = node.commit.uses;
    const commitInput = rebuildCommitInput(
      deps.authority.authority,
      input.descriptor,
      node,
      run,
      intent,
    );
    const instanceSelection = run.envelope.resolvedInstance[intent.system];
    if (instanceSelection === undefined) {
      throw new Error(`run ${intent.runId} resolved no ${intent.system} instance; recovery cannot probe`);
    }


    // Bind outside the catch so fingerprint precondition failures cannot become probe verdicts.
    const runConfigFingerprint = FingerprintSchema.parse(run.envelope.configFingerprint);
    deps.sessions.bindRunConfigFingerprint(runConfigFingerprint);

    /* the probe runs FIRST — before any startAt/resume logic (ref write-safety ) */
    let verdict: RuntimeProbeVerdict;
    try {
      verdict = await executeIdempotencyProbe(probeDeps, {
        commitContract,
        commitInput,
        instance: instanceSelection,
        signal: input.signal,
      });
    } catch (error) {
      // A throwing probe is `unknown`, never `absent`.
      void error;
      return park(
        intent,
        "unknown",
        `recovery probe threw for ${idempotencyKeyDigestReference(intent.idempotencyKeyDigest, hasProtectedTransactionInput(run))}; `
          + "the target state is unknown and only a typed resolution may release it",
        protectedReason(
          "recovery-probe-exception",
          "exception",
          error instanceof Error ? `${error.name}:${error.message}` : `non-error:${String(error)}`,
        ),
      );
    } finally {
      deps.sessions.releaseRunConfigFingerprint();
    }

    if (intent.occurrence !== undefined && verdict.state !== "present") {
      return park(intent, "unknown", "Generic business-key evidence cannot identify the new write occurrence",
        protectedReason("recovery-probe-unknown", "probe", canonicalJsonStringify(verdict)));
    }
    if (verdict.state === "present") {
      const completion = commitContract.writeSafety.completion;
      let proofValue: JsonValue;
      let outputValue: JsonValue;
      try {
        const proofRaw: unknown = Reflect.apply(completion.proofFromPresentProbe, undefined, [verdict]);
        const proof = completion.proofSchema.parse(proofRaw);
        const outputRaw: unknown = Reflect.apply(completion.outputFromProof, undefined, [proof]);
        proofValue = JsonValueSchema.parse(proof);
        outputValue = JsonValueSchema.parse(commitContract.output.parse(outputRaw));
      } catch (error) {
        return park(
          intent,
          "present-proof-invalid",
          `recovery probe found ${idempotencyKeyDigestReference(intent.idempotencyKeyDigest, hasProtectedTransactionInput(run))} present, but its `
          + "proof does not satisfy the declared completion schema; a present we cannot validate is indeterminate, not done",
          protectedReason(
            "recovery-present-proof-schema-failure",
            "exception",
            error instanceof Error ? `${error.name}:${error.message}` : `non-error:${String(error)}`,
          ),
        );
      }
      if (!isFreshOccurrenceProof(intent, run.envelope, {
        schemaHash: deriveSchemaHash(completion.proofSchema, "output"), value: proofValue,
      })) {
        return park(intent, "unknown", "Earlier receipt cannot settle the new write occurrence",
          protectedReason("recovery-probe-unknown", "proof", canonicalJsonStringify(proofValue)));
      }
      if (run.lifecycle.state !== "parked-write") {
        throw new Error(
          `run ${intent.runId} is ${run.lifecycle.state}; positive-recovery backfill requires the `
          + "sweep's parked-write routing first — an unclaimable non-parked run stays unclaimable",
        );
      }
      const settlement = buildCommittedSettlement({
        descriptor: input.descriptor,
        nodeId: String(node.id),
        run,
        intent,
        commitContract,
        operator,
        implFingerprint: resolveImplFingerprint(commitContract.id),
        proofSource: "recovery-probe",
        proofValue,
        outputValue,
        confirmedAt: instant(),
        ids: deps.ids,
      });
      executeSequencedWriteCommit(
        deps.authority,
        {
          run: { runId: run.envelope.runId, expectedVersion: run.version },
          checkpoint: settlement.checkpoint,
          commit: settlement.commit,
        },
        { kind: "resume-queued", startAt: String(node.id), port: deps.continuation,
          commandId: lifecycleCommandId("positive-recovery", { writeIntentId: intent.writeIntentId, generation: intent.generation }) },
        deps.hooks,
      );
      return WriteRecoveryDecisionSchema.parse({
        state: "backfilled",
        writeIntentId: intent.writeIntentId,
        generation: intent.generation,
      });
    }

    if (verdict.state === "ambiguous") {
      return park(intent, "ambiguous",
        `recovery probe found ${String(verdict.matches)} matches for ${idempotencyKeyDigestReference(intent.idempotencyKeyDigest, hasProtectedTransactionInput(run))}; `
        + "verify in the target system, then use the typed resolutions",
      protectedReason("recovery-probe-ambiguous", "probe", canonicalJsonStringify(verdict)));
    }
    if (verdict.state === "unknown") {
      return park(intent, "unknown",
        `recovery probe is indeterminate for ${idempotencyKeyDigestReference(intent.idempotencyKeyDigest, hasProtectedTransactionInput(run))}; `
        + "verify in the target system, then use the typed resolutions",
      protectedReason("recovery-probe-unknown", "probe", canonicalJsonStringify(verdict)));
    }

    // One absence observation is diagnostic; retry authority requires the declared stabilized evidence.
    const policy = NegativeSettlementPolicySchema.parse(commitContract.writeSafety.idempotency.recoveryAbsence);
    const priorVerdicts = (input.priorVerdicts ?? []).map((prior) => RecoveryProbeVerdictSchema.parse(prior));
    const observation = RecoveryProbeVerdictSchema.parse({ state: "absent", evidence: verdict.evidence });
    const evaluation = evaluateNegativeSettlement({
      writeIntentId: intent.writeIntentId,
      generation: intent.generation,
      idempotencyKeyDigest: intent.idempotencyKeyDigest,
      authoritativeSource: verdict.evidence.source,
      authoritativeSourceState: verdict.evidence.sourceState,
      queryDigest: verdict.evidence.queryDigest,
      fencedAt: intent.fencedAt,
      policy,
      verdicts: [...priorVerdicts, observation],
    }, deps.clock);

    if (evaluation.state === "safe-to-retry") {
      deps.authority.withAuthorityTransaction((repositories) => {
        repositories.writeIntents.settleRetryable({
          writeIntentId: intent.writeIntentId,
          generation: intent.generation,
          expectedVersion: intent.version,
          settlement: evaluation,
          now: instant(),
        });
        const current = repositories.runs.get(run.envelope.runId);
        if (current === undefined) throw new Error(`run ${run.envelope.runId} disappeared during settlement`);
        if (current.lifecycle.state !== "parked-write") {
          throw new Error(
            `run ${run.envelope.runId} is ${current.lifecycle.state}; a safe-to-retry settlement resumes only `
            + "a parked-write run",
          );
        }
        const resumed = deps.continuation.transition({
          commandId: lifecycleCommandId("recovery-absent", { writeIntentId: intent.writeIntentId, generation: intent.generation }),
          lifecycle: { state: "queued" }, writeResolution: {kind:"recovery",writeIntentId:intent.writeIntentId,generation:intent.generation,writeAttemptId:intent.currentAttemptId,bindingProofDigest:intent.bindingProofDigest,decision:"absent"},
          runId: run.envelope.runId,
          expectedVersion: current.version,
          startAt: node.id,
        });
        if (resumed.state !== "applied") {
          throw new Error(`resuming run ${run.envelope.runId} after retry settlement failed: ${resumed.state}`);
        }
      });
      return WriteRecoveryDecisionSchema.parse({
        state: "safe-to-retry",
        writeIntentId: intent.writeIntentId,
        generation: intent.generation,
      });
    }
    if (evaluation.state === "wait") {

      return WriteRecoveryDecisionSchema.parse({
        state: "wait",
        writeIntentId: intent.writeIntentId,
        generation: intent.generation,
        notBefore: evaluation.notBefore,
        observationsNeeded: evaluation.observationsNeeded,
      });
    }
    const code: WriteIntentParkCode = evaluation.code === "operator-only"
      ? "operator-required"
      : evaluation.code === "ambiguous"
        ? "ambiguous"
        : "unknown";
    return park(
      intent,
      code,
      `negative settlement parked ${idempotencyKeyDigestReference(intent.idempotencyKeyDigest, hasProtectedTransactionInput(run))} `
        + `(${evaluation.code}); only the declared settlement policy or a typed operator resolution may release it`,
      protectedReason(
        `negative-settlement-${evaluation.code}`,
        "settlement",
        canonicalJsonStringify(evaluation),
      ),
    );
  }

  return Object.freeze({ recover });
}

/* ── the kernel's typed operator resolutions (ref write-safety ) ───────────────── */

export interface WriteResolutionDependencies {
  readonly continuation: RunContinuationPort;
  readonly descriptors: WorkflowDescriptorResolver;
  // Use the kernel's AuthorityDatabase connection so resolution composes inside its transaction as a savepoint.
  readonly authority: WriteRecoveryAuthority & {
    commitResolvedParkedWrite(input: unknown): unknown;
    settleResolvedParkedAbsence(input: unknown): WriteIntentRecord;
  };
  readonly ids: IdFactory;
  readonly resolveImplFingerprint?: (taskId: TaskId) => Fingerprint;
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

function resolutionBinding(context: WriteResolutionContext,decision:"present"|"absent") {
  const intent=context.intent;
  if(intent.status !== "parked") throw new Error("parked-write-resolution-required");
  return ParkedWriteResolutionBindingSchema.parse({commandId:context.command.commandId,auditId:context.auditId,
    writeIntentId:intent.writeIntentId,writeAttemptId:intent.currentAttemptId,generation:intent.generation,
    bindingProofDigest:intent.bindingProofDigest,idempotencyKeyDigest:intent.idempotencyKeyDigest,
    runId:intent.runId,runAttempt:intent.runAttempt,expectedRunVersion:context.run.version,decision,resolvedAt:context.now});
}
function plannedResolutionRun(context: WriteResolutionContext,startAt:string) {
  return RunRecordSchema.parse({...context.run,envelope:{...context.run.envelope,startAt},lifecycle:{state:"queued"},
    version:context.run.version+1,updatedAt:context.now});
}

export function createWriteResolutionExecutor(deps: WriteResolutionDependencies): WriteResolutionExecutor {
  const resolveImplFingerprint = deps.resolveImplFingerprint
    ?? ((taskId: TaskId) => resolveTaskImplFingerprint(BUILD_MANIFEST, taskId));

  return Object.freeze({
    resolvePresent(repositories: AuthorityRepositories, context: WriteResolutionContext) {
      if (context.command.type !== "resolve-write-present") {
        throw new Error(`resolvePresent received a ${context.command.type} command`);
      }
      requireResolvableIntent(context);
      if (context.intent.status !== "parked" || context.command.payload.occurrenceKeyDigest !== context.intent.idempotencyKeyDigest) {
        rejectCommandRequest(context.command, "invalid-state", "Resolution must attest the exact new write occurrence");
      }
      const { descriptor, node } = requireResolutionTarget(
        deps,
        repositories,
        context,
        "operator-confirmed-present",
      );
      const commitContract = node.commit.uses;
      const completion = commitContract.writeSafety.completion;
      const proofSchemaHash = deriveSchemaHash(completion.proofSchema, "output");
      const payload = context.command.payload;

      if (payload.proof.schemaHash !== proofSchemaHash) {
        rejectCommandRequest(
          context.command,
          "schema-mismatch",
          `confirmed-present proof is bound to schema ${payload.proof.schemaHash.slice(0, 12)}…, but `
          + `${commitContract.id} requires ${proofSchemaHash.slice(0, 12)}…; the resolution changes nothing. `
          + "Reload the run — this build serves the schema the proof form composes against.",
        );
      }
      const parsedProof = completion.proofSchema.safeParse(payload.proof.value);
      if (!parsedProof.success) {
        rejectCommandRequest(
          context.command,
          "schema-mismatch",
          `confirmed-present proof does not parse through ${commitContract.id}'s completion proof schema: `
          + `${parsedProof.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ")}`,
        );
      }
      if (!isFreshOccurrenceProof(context.intent, context.run.envelope, payload.proof)) {
        rejectCommandRequest(context.command, "invalid-value", "Earlier receipt cannot settle the new write occurrence");
      }
      const proof: unknown = parsedProof.data;
      const outputRaw: unknown = Reflect.apply(completion.outputFromProof, undefined, [proof]);
      const outputValue = JsonValueSchema.parse(commitContract.output.parse(outputRaw));

      const intent = context.intent;
      if (intent.status !== "parked") throw new Error("parked-write-resolution-required");
      const resolution = resolutionBinding(context,"present");
      const settlement = buildCommittedSettlement({
        descriptor,
        nodeId: String(node.id),
        run: context.run,
        intent,
        commitContract,
        operator: ActorIdSchema.parse(context.command.requestedBy),
        implFingerprint: resolveImplFingerprint(commitContract.id),
        proofSource: "operator-attestation",
        proofValue: JsonValueSchema.parse(proof),
        outputValue,
        confirmedAt: context.now,
        ids: deps.ids,
      });
      const {parkedCode:_code,message:_message,authorityReason:_reason,status:_status,...base}=intent;
      const settled = WriteIntentRecordSchema.parse({...base,status:"committed",completionProof:payload.proof,
        confirmedAt:context.now,updatedAt:context.now,version:intent.version+1,resolution});
      const run = plannedResolutionRun(context,String(node.id));
      return {outcome:{run,intent:settled},applyAfterAudit:()=>{
        deps.authority.commitResolvedParkedWrite({commit:settlement.commit,checkpoint:settlement.checkpoint,
          expectedIntentVersion:intent.version,resolution});
        deps.hooks?.afterSequencedStep?.("commit-write-attempt");
        const actual=deps.continuation.transition({commandId:lifecycleCommandId("operator-present",context.command.commandId),
          runId:run.envelope.runId,expectedVersion:context.run.version,lifecycle:{state:"queued"},startAt:node.id,
          writeResolution:{kind:"operator",binding:resolution}});
        if(actual.state !== "applied") throw new Error("parked-write-resolution-continuation-failed");
        deps.hooks?.afterSequencedStep?.("run-transition");
        return {run:actual.run,intent:WriteIntentRecordSchema.parse(deps.authority.authority.writeIntents.get(intent.writeIntentId))};
      }};

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
      const intent=context.intent;
      if(intent.status !== "parked") throw new Error("parked-write-resolution-required");
      const resolution=resolutionBinding(context,"absent");
      const settlement={state:"operator-confirmed-absent" as const,writeIntentId:intent.writeIntentId,generation:intent.generation,
        operator:ActorIdSchema.parse(context.command.requestedBy),confirmedAt:context.now,evidenceNote:context.command.payload.evidenceNote};
      const {parkedCode:_code,message:_message,authorityReason:_reason,status:_status,...base}=intent;
      const settled=WriteIntentRecordSchema.parse({...base,status:"retryable",settlement,resolvedAt:context.now,
        updatedAt:context.now,version:intent.version+1,resolution});
      const run=plannedResolutionRun(context,String(node.id));
      return {outcome:{run,intent:settled},applyAfterAudit:()=>{
        const actualIntent=deps.authority.settleResolvedParkedAbsence({writeIntentId:intent.writeIntentId,generation:intent.generation,
          expectedIntentVersion:intent.version,settlement,resolution});
        deps.hooks?.afterSequencedStep?.("commit-write-attempt");
        const actual=deps.continuation.transition({commandId:lifecycleCommandId("operator-absent",context.command.commandId),
          runId:run.envelope.runId,expectedVersion:context.run.version,lifecycle:{state:"queued"},startAt:node.id,
          writeResolution:{kind:"operator",binding:resolution}});
        if(actual.state !== "applied") throw new Error("parked-write-resolution-continuation-failed");
        deps.hooks?.afterSequencedStep?.("run-transition");
        return {run:actual.run,intent:actualIntent};
      }};

    },
  });
}
