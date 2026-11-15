import { OcrApprovalReadResultSchema } from "../../../models/processing/ocr/approved-snapshot.js";
import { authenticateDelegationRetryPause, delegationAccountingExecution } from "../../storage/sqlite/delegation-authority.js";
import type { EvidenceSchemaReader } from "../../../models/storage/evidence-schema-admission.js";
import { AuthenticatedRunContinuation } from "../../storage/sqlite/run-continuation-delegation.js";
import { readRunCheckpoint, originalCheckpoint, RunContinuationRefusedError, readContinuationGate, validateRunContinuation } from "../../storage/sqlite/run-continuation.js";
import { RunClaimTokenSchema, type RunClaimToken } from "../../../models/run/worker.js";
import { DryRunSampleSchema, type DryRunBinding } from "../../../models/workflow/dry-run.js";
import { parseCanonicalInputSnapshot } from "../../../models/workflow/canonical-input.js";
import { commitGeneratedCheckpoint, generatedUpdateId, pendingGeneratedUpdateIds, projectGeneratedUpdates } from "../../logs/generated-artifact-projection.js";
import { timelineCheckpointReference } from "../../../models/events/timeline.js";
import { localDatePart } from "../../../rules/time/clock.js";
import { retainedRunProtectedBindings } from "../../../models/write-safety/protected-input.js";
import type { GateSourceRuntime } from "../gates/gate-source-runtime.js";
import { shouldRetryTaskFailure } from "../policies/task-retry.js";

import { z } from "zod";
import { CURRENT_DIAGNOSTIC_SAFETY_VERSION } from "../../../models/trust/failure.js";
import type { ContentAddressedArtifactWriter } from "../../../workflow-kit/artifacts.js";
import type { RunDiagnosticCapture } from "../../../workflow-kit/diagnostics.js";
import { browserLoginFailure } from "../../systems/browser-shared/login-contract.js";
import { TaskError, taskErrorCause, wrapUnhandledTaskError } from "../../../workflow-kit/errors.js";
import type { ProviderClient } from "../../../workflow-kit/providers.js";
import type { AnyTask, TaskLogger } from "../../../workflow-kit/task.js";
import type { TaskStoreRegistry } from "../../../workflow-kit/task-registry.js";
import { descriptorRuntimeNodes, runtimeNodeLabel, workflowDryRunSupport, workflowPreviewDependencyIds, workflowTerminalResultExecution, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { JsonValueSchema, canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { observationLeafPaths, resolveObservationOrigin } from "../../../models/events/data-observation-origin.js";
import type { JsonValue } from "../../../rules/validation/canonical-json.js";
import { TransactionDryRunPreviewSchema, TransactionOutcomeSchema, type TransactionDryRunPreview } from "../../../rules/write-safety/write-safety-primitives.js";
import type { Clock } from "../../../rules/time/clock.js";
import type { AnyReadTaskContract } from "../../../models/task/task-contract.js";
import type { GateResultRecord } from "../../../models/workflow/gates.js";
import type { IdFactory } from "../../../rules/identity/identifiers.js";
import type { NoteTimelineWriter } from "../../storage/events/note-timeline-writer.js";
import { drainBrowserActionNotes } from "../../logs/browser-action-drain.js";
import { withBrowserActionNotes, type BrowserAction } from "../../systems/browser-shared/action-notes.js";
import type { TaskId } from "../../../rules/identity/ids.js";
import { GateIdSchema, IsoInstantSchema, ProviderCapabilityIdSchema, TaskIdSchema } from "../../../rules/identity/ids.js";
import type { Fingerprint, IsoInstant, NodeId, ProviderCapabilityId } from "../../../rules/identity/ids.js";
import { RunLifecycleSchema, RunRecordSchema, runClaim, type RunLifecycle, type RunRecord } from "../../../models/run/record.js";
import { pendingInterruptOf } from "../../../rules/runs/run-interrupt.js";
import type { RunResultRecord, TerminalDependencyEvidence } from "../../../models/run/result.js";
import type { SessionNeed } from "../../../models/sessions/session.js";
import { FailureRecordSchema, type FailureRecord } from "../../../models/trust/failure.js";
import { taskImplFingerprint } from "../../../workflow-kit/fingerprints.js";
import { auditCheckpointFreshness, CheckpointExpectationSchema, loadCheckpoint, RunCheckpointRecordSchema, type CheckpointPatch, type ReplayedCheckpoint, type RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import { applyCheckpointPatches } from "../checkpoints/checkpoint-patch.js";
import { deriveArtifactProjectionRows } from "../../../models/workflow/artifact-projection.js";
import { projectTransactionOutcome, type RuntimeFlowNode, type RuntimeScope } from "../../../models/workflow/graph.js";
import { evaluateNodeCondition } from "../../../models/workflow/node-condition.js";
import { deriveSchemaHash, schemaBoundValueSchema } from "../../../models/validation/schema-bound-value.js";
import { planStepOmissions } from "../../../models/workflow/step-omission.js";
import { jsonLeafPaths } from "../../runs/provenance/task-provenance.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import { WriteIntentParkCodeSchema, type WriteIntentParkCode } from "../../storage/sqlite/write-commit-contracts.js";
import type { MonotonicDeadlineScheduler } from "../scheduling/deadline-scheduler.js";
import { createProviderClient, type ProviderAdapterRegistry, type ProviderClientDependencies, type ProviderRequestIdFactory } from "../../processing/providers/provider-client.js";
import { buildEntryValidationFailureRecord, buildNodeFailureRecord, followingFailureCause, type FailureEvidenceCause } from "./run-failure.js";
import { buildRunPreviewResult, buildRunResult } from "../../runs/lifecycle/run-result.js";
import { ExecutorSpanEventSchema, runSpanPath, taskSpanPath, type SpanEmitter } from "../../logs/span-emitter.js";
import { redactObservedDataPoints } from "../../logs/observed-data.js";
import { createTaskProvenanceCollector } from "../../runs/provenance/task-provenance.js";
import { RunResultRecordSchema, AnyRunPreviewStepSchema, delegationEvidenceOutput, resolveDelegationEvidenceOutput, type RunPreviewStep, terminalGateDependencyRecord } from "../../../models/run/result.js";
import { buildTerminalAuthorization } from "../../runs/lifecycle/terminal-authorization.js";
import { lifecycleCommandId, requireLifecycleApplied, RunLifecycleRefusedError, type RunMutationOutcome, type WorkerRunLifecyclePort } from "../../runs/lifecycle/run-record-service.js";
import { WorkerSessionClosureUnprovedError, type WorkerSessionManager } from "../workers/worker-sessions.js";
import { DelegationPendingSchema } from "./durable-child-executor.js";

/* ── injected seams ──────────────────────────────────────────────────────── */

/** The authority surface a run execution needs; `AuthorityDatabase` satisfies it. */
export interface RunExecutionAuthority {
  readonly evidenceSchemaHash?: EvidenceSchemaReader;
  readonly authority: Pick<AuthorityRepositories, "runCheckpoints" | "gateResults" | "artifactOutbox" | "timelineEvents" | "runResults">
    & { readonly runs: Pick<AuthorityRepositories["runs"], "get"> }
    & Partial<Pick<AuthorityRepositories, "configSnapshots">>;
  afterAuthorityCommit(publish: () => void): void;
  // Injected diagnostic capture requires row authority and failure identity, never an orphan bundle.
  withAuthorityTransaction?<Result>(work: (repositories: AuthorityRepositories) => Result): Result;
}

type TransactionRuntimeNode = Extract<RuntimeFlowNode, { kind: "transaction" }>;
type ChildRunRuntimeNode = Extract<RuntimeFlowNode, { kind: "child-run" }>;
type TaskRuntimeNode = Extract<RuntimeFlowNode, { kind: "task" }>;


export interface WriteSequencerContext {
  readonly descriptor: AnyWorkflowDescriptor;
  readonly node: TransactionRuntimeNode;
  readonly run: RunRecord;
  readonly claim: RunClaimToken;
  readonly scope: RuntimeScope;
  readonly dryRun: boolean;
  readonly captureLog?: Pick<TaskLogger, "warn">;
  readonly previewBinding?: DryRunBinding;
  readonly signal: AbortSignal;
  /** Synchronous in-memory handoff after beat ⑦; consumers publish after the sequencer returns. */
  readonly onDurableCommit?: (proof: Readonly<{ writeIntentId: string; confirmedAt: string; proofDigest: string }>) => void;
  readonly onSavedEffectVerified?: (proof: Readonly<{ proofDigest: string }>) => void;
  readonly onDiagnosticDeliveryFailure?: () => void;
}

export interface WriteSequencer {
  executeTransaction(context: WriteSequencerContext): Promise<unknown>;
  // The sequencer owns probe, preparation, subject proof, fence and commit as one capability boundary.
  executeDryRun(context: WriteSequencerContext): Promise<unknown>;
}


export class WriteParkedError extends Error {
  readonly writeIntentId: string;
  readonly intentGeneration: number;
  readonly parkCode: WriteIntentParkCode;

  constructor(input: Readonly<{
    writeIntentId: string;
    intentGeneration: number;
    parkCode: WriteIntentParkCode;
    message: string;
    cause?: unknown;
  }>) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = "WriteParkedError";
    this.writeIntentId = input.writeIntentId;
    this.intentGeneration = input.intentGeneration;
    this.parkCode = input.parkCode;
  }
}

/** Ref workflow-model's delegation seam: atomic fan-out enqueue, park, and typed join. */
export interface ChildRunContext {
  readonly descriptor: AnyWorkflowDescriptor;
  readonly node: ChildRunRuntimeNode;
  readonly run: RunRecord;
  readonly claim: RunClaimToken;
  readonly scope: RuntimeScope;
  readonly signal: AbortSignal;
}

export interface ChildRunBatchContext extends Omit<ChildRunContext, "node" | "scope"> {
  readonly owner: Extract<RuntimeFlowNode, { kind: "child-run" | "parallel" }>;
  readonly leaves: readonly Pick<ChildRunContext, "node" | "scope">[];
}

export interface ChildRunExecutor {
  executeChildRuns(context: ChildRunBatchContext): Promise<unknown>;
}


export interface RunArtifactProjector {
  projectOutbox(outboxIds: readonly string[]): Promise<Readonly<{ projected: number }>>;
}


export interface RunProviderWiring {
  readonly adapters: ProviderAdapterRegistry;
  /** `AuthorityRepositories["configSnapshots"]` satisfies this. */
  readonly configSnapshots: Readonly<{ get(snapshotId: string): unknown }>;
  readonly idFactory: ProviderRequestIdFactory;
}

/** The per-node slice of `RunProviderWiring` plus the run's exact stored snapshot. */
type ProviderInvocationContext = Readonly<{
  wiring: RunProviderWiring;
  storedSnapshot: unknown;
}>;

/** What `executeTaskNode` proved present before invocation may attach it to ctx. */
type TaskCapabilityWiring = Readonly<{
  providers?: ProviderInvocationContext;
  artifacts?: ContentAddressedArtifactWriter;
}>;


function admittedClientFor(
  capability: ProviderCapabilityId,
  dependencies: ProviderClientDependencies,
): ProviderClient<ProviderCapabilityId> {
  switch (capability) {
    case "ocr.extract": return createProviderClient(capability, dependencies);
    case "ocr.review": return createProviderClient(capability, dependencies);
    case "geocode.census": return createProviderClient(capability, dependencies);
    case "geocode.nominatim": return createProviderClient(capability, dependencies);
    case "workbooks.library": return createProviderClient(capability, dependencies);
    case "ocr.approved-snapshot": return createProviderClient(capability, dependencies);
  }
}

export interface RunExecutorDependencies {
  readonly debugEvents?: Pick<ReturnType<typeof import("../../logs/debug-events.js").createDebugEventWriter>, "emit">;
  readonly publishCheckpoint?: (repositories: AuthorityRepositories, checkpoint: RunCheckpointRecord) => void;
  readonly lifecycle: WorkerRunLifecyclePort;
  readonly descriptor: AnyWorkflowDescriptor;
  readonly stores: TaskStoreRegistry;
  readonly authority: RunExecutionAuthority;
  readonly sessions: WorkerSessionManager;
  readonly emitter: SpanEmitter;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly scheduler: MonotonicDeadlineScheduler;
  /** Immutable per-invocation task bound (ref execution-and-sessions ); no default, no opt-out. */
  readonly taskDeadlineMs: number;
  readonly log: TaskLogger;
  /** Optional production sink for task messages and browser actions. */
  readonly taskNotes?: Pick<NoteTimelineWriter, "emitRunLog" | "emitRunAction">;
  readonly retainCallback?: (identity: Readonly<{ runId: string; claimGeneration: number; attempt: number }>, operation: Promise<unknown>) => void;
  readonly writeSequencer?: WriteSequencer;
  readonly childRuns?: ChildRunExecutor;
  /** Registered workflow/external source ports for non-operator gates. */
  readonly gateSources?: GateSourceRuntime;
  /** Ref operator-trust. Absent means no automatic bundle, never a silent empty one. */
  readonly diagnostics?: RunDiagnosticCapture;

  readonly providers?: RunProviderWiring;

  readonly artifacts?: ContentAddressedArtifactWriter;
  // Absent artifact projection fails tasks declaring durable artifacts instead of silently losing output.
  readonly artifactProjector?: RunArtifactProjector;
}

export interface ClaimedRunInput {
  readonly run: unknown;
  readonly claim: unknown;
  readonly signal: AbortSignal;
}

export const RunExecutionOutcomeSchema = z.discriminatedUnion("state", [
  DelegationPendingSchema.extend({ state: z.literal("yielded-delegation") }),
  z.strictObject({ state: z.literal("done"), runId: z.string().min(1) }),
  z.strictObject({ state: z.literal("failed"), runId: z.string().min(1), failureId: z.string().min(1) }),
  z.strictObject({ state: z.literal("parked-gate"), runId: z.string().min(1), gateId: z.string().min(1) }),
  // Post-fence parking is already durable; the interpreter must not overwrite it with ordinary failure.
  z.strictObject({
    state: z.literal("parked-write"),
    runId: z.string().min(1),
    writeIntentId: z.string().min(1),
    intentGeneration: z.number().int().positive(),
    code: WriteIntentParkCodeSchema,
  }),
  z.strictObject({ state: z.literal("abandoned"), runId: z.string().min(1), reason: z.string().min(1) }),
]);
export type RunExecutionOutcome = z.infer<typeof RunExecutionOutcomeSchema>;

/** The claim is gone — cancelled, swept, or re-owned. Not a failure to settle. */
class RunAbandonedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunAbandonedError";
  }
}

class RunPauseRequestedError extends RunAbandonedError {}

/** The worker's abort of the current step for a pause or stop request it read from the run. */
export class RunControlAbortError extends Error {
  constructor() {
    super("worker-run-control-current-work");
    this.name = "RunControlAbortError";
  }
}

class RunTerminalAdmissionLostError extends RunLifecycleRefusedError {
  constructor(outcome: RunMutationOutcome, readonly admissionVersion: number) { super(outcome); }
}

/* ── small helpers ───────────────────────────────────────────────────────── */

const RunnableTaskSchema = z.custom<(args: {
  input: unknown;
  ctx: Readonly<Record<string, unknown>>;
}) => Promise<unknown>>((value) => typeof value === "function", "task implementation requires run");


function requireStoredCheckpoint(stored: RunCheckpointRecord | undefined, nodeId: string): RunCheckpointRecord {
  if (stored === undefined) {
    throw new Error(`node "${nodeId}" checkpoint load reported found, but the repository returned no stored row`);
  }
  return stored;
}

// Bound inputs compare in their JSON form: an optional field bound to undefined is absent.
function boundInputIdentity(value: unknown): string {
  return canonicalJsonStringify(JSON.parse(JSON.stringify(value)));
}

function labelOf(node: TaskRuntimeNode): string {
  return node.label ?? node.uses.title;
}

function observeRaceLoser(error: unknown): void {
  void error;
}

// Race non-cooperative tasks against abort so cancellation cannot hold the worker indefinitely.
async function raceAbortable<Result>(
  operation: Promise<Result>,
  signal: AbortSignal,
  label: string,
  retain?: (operation: Promise<unknown>) => void,
): Promise<Result> {
  retain?.(operation);
  // Observe the race loser to prevent a late rejection becoming unhandled.
  operation.catch(observeRaceLoser);
  if (signal.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error(`${label} was aborted before it started`);
  }
  let removeAbort = (): void => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    const listener = (): void => {
      reject(signal.reason instanceof Error ? signal.reason : new Error(`${label} was aborted`));
    };
    signal.addEventListener("abort", listener, { once: true });
    removeAbort = (): void => signal.removeEventListener("abort", listener);
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    removeAbort();
  }
}

function taskIndexOf(stores: TaskStoreRegistry): ReadonlyMap<string, AnyTask> {
  const index = new Map<string, AnyTask>();
  for (const store of stores.stores) {
    for (const task of Object.values(store.tasks)) index.set(task.contract.id, task);
  }
  return index;
}

type PlanEntry =
  | Readonly<{ mode: "execute" }>
  | Readonly<{ mode: "replay"; record: RunCheckpointRecord; deferred?: true; patches?: readonly CheckpointPatch[] }>
  | Readonly<{ mode: "skipped-condition" }>

  | Readonly<{ mode: "asserted"; replay?: RunCheckpointRecord }>

  | Readonly<{ mode: "omitted" }>
  | Readonly<{ mode: "replay-child"; evidence: Extract<TerminalDependencyEvidence, { state: "delegation-resolved" }> }>
  | Readonly<{ mode: "replay-gate"; record: GateResultRecord }>;

/* ── the interpreter ─────────────────────────────────────────────────────── */

export async function executeClaimedRun(
  deps: RunExecutorDependencies,
  input: ClaimedRunInput,
): Promise<RunExecutionOutcome> {
  const initial = RunRecordSchema.parse(input.run);
  const claim = RunClaimTokenSchema.parse(input.claim);
  const { descriptor, clock } = deps;
  const envelope = initial.envelope;
  const runId = envelope.runId;
  if (envelope.workflow !== descriptor.id
    || envelope.descriptorVersion !== descriptor.version
    || envelope.contractFingerprint !== descriptor.contractFingerprint) {
    throw new Error(
      `run ${runId} is bound to ${envelope.workflow} v${String(envelope.descriptorVersion)} `
      + `/ ${envelope.contractFingerprint}, not descriptor ${descriptor.id} `
      + `v${String(descriptor.version)} / ${descriptor.contractFingerprint}; the worker is miswired`,
    );
  }
  if (initial.lifecycle.state !== "claimed") {
    throw new Error(`run ${runId} is ${initial.lifecycle.state}; the executor starts from a fresh claim`);
  }
  const claimedAt = initial.lifecycle.claimedAt;
  z.number().int().positive().parse(deps.taskDeadlineMs);

  const nodes = descriptorRuntimeNodes(descriptor);
  const omissionPlan = planStepOmissions(
    {
      nodes: nodes.map((node) => ({ id: String(node.id), kind: node.kind, dependsOn: node.dependsOn.map(String) })),
      timeline: descriptor.timeline,
      stepOmissions: descriptor.stepOmissions,
    },
    envelope.stepOmissions ?? [],
  );
  const runs = deps.authority.authority.runs;
  const instant = () => IsoInstantSchema.parse(clock.now().toISOString());

  const getRun = (): RunRecord => {
    const current = runs.get(runId);
    if (current === undefined) throw new Error(`run ${runId} disappeared from authority mid-execution`);
    return current;
  };

  const requireOriginalClaim = (current: RunRecord): void => {
    const held = runClaim(current);
    if (held === undefined || held.workerId !== claim.workerId || held.claimGeneration !== claim.claimGeneration) {
      throw new RunAbandonedError("lost original execution claim");
    }
  };

  const checkPause = (current: RunRecord): void => {
    if (pendingInterruptOf(current) === "pause-requested") {
      requireOriginalClaim(current);
      throw new RunPauseRequestedError("paused");
    }
  };

  const pauseAtBoundary = (): void => {
    checkCancellation();
    checkPause(getRun());
  };

  const transitionTo = (lifecycle: RunLifecycle): RunRecord => {
    const current = getRun();
    checkCancellation();
    const outcome = deps.lifecycle.workerTransition({
      commandId: lifecycleCommandId("executor-transition", { runId, generation: claim.claimGeneration, version: current.version }),
      runId,
      claim,
      lifecycle,
    });
    return requireLifecycleApplied(outcome);
  };

  const runningLifecycle = (currentNodeId?: NodeId): RunLifecycle => RunLifecycleSchema.parse({
    state: "running",
    workerId: claim.workerId,
    claimedAt,
    heartbeatAt: instant(),
    ...(currentNodeId === undefined ? {} : { currentNodeId }),
  });

  const runSpanIdentity = {
    runId,
    attempt: envelope.attempt,
    traceId: envelope.traceId,
    spanPath: runSpanPath(envelope.traceId),
  } as const;

  const drainBrowserActions = (spanPath: string, actions: readonly BrowserAction[], screenshotTaskId?: TaskId): void => {
    const sink = deps.taskNotes;
    const screenshotFailures: unknown[] = [];
    if (sink === undefined) {
      if (screenshotTaskId !== undefined && actions.some(action => action.kind === "screenshot")) {
        throw new TaskError(screenshotTaskId, "BROWSER_SCREENSHOT_CAPTURE_FAILED", "Screenshot action persistence is unavailable");
      }
      return;
    }
    const address = { runId, attempt: envelope.attempt, traceId: envelope.traceId, spanPath };
    drainBrowserActionNotes({ actions,
      emitAction: action => { sink.emitRunAction({
          workflow: descriptor.id,
          address,
          action,
        }, getRun()); },
      warn: () => deps.log.warn("browser action note could not be recorded"),
      onFailure: (action, error) => { if (screenshotTaskId !== undefined && action.kind === "screenshot") screenshotFailures.push(error); },
    });
    if (screenshotTaskId !== undefined && screenshotFailures.length > 0) {
      throw new TaskError(screenshotTaskId, "BROWSER_SCREENSHOT_CAPTURE_FAILED", "Screenshot action could not be persisted", {
        cause: new AggregateError(screenshotFailures, "Screenshot action persistence failed"),
      });
    }
  };

  const emit = (event: Readonly<Record<string, unknown>>): void => {
    deps.emitter.emit(ExecutorSpanEventSchema.parse({
      ts: instant(),
      workflow: descriptor.id,
      ...event,
    }));
  };

  const checkCancellation = (): void => {
    const current = getRun();
    if (pendingInterruptOf(current) !== "stop-requested") return;
    requireLifecycleApplied(deps.lifecycle.terminalize({
      kind: "cancelled", commandId: lifecycleCommandId("cancel", { runId, generation: claim.claimGeneration }),
      runId, expectedVersion: current.version, claim, endedAt: instant(),
    }, descriptor));
    throw new RunAbandonedError("cancelled");
  };


  const terminalizeAsFailure = async (failure: FailureRecord): Promise<RunExecutionOutcome> => {
    const capture = deps.diagnostics;
    const prepared = capture === undefined ? undefined : await capture.captureForFailure({
      failure,
      configFingerprint: envelope.configFingerprint,
      descriptorFingerprint: descriptor.contractFingerprint,
    });
    let disposed = false;
    try {
    const bound = prepared === undefined
      ? failure
      : FailureRecordSchema.parse({ ...failure, diagnosticBundleId: prepared.bundleId });
    checkCancellation();
    // The member-Retry hold check and failure admission share one transaction so no Retry or Pause commits between them.
    const settle = (repositories?: AuthorityRepositories): "held" | "settled" | RunTerminalAdmissionLostError => {
      const current = getRun();
      requireOriginalClaim(current);
      if (repositories !== undefined && pendingInterruptOf(current) === "pause-requested"
        && authenticateDelegationRetryPause(repositories, descriptor, current, initial.version)) {
        requireLifecycleApplied(deps.lifecycle.acknowledgePause({
          commandId: lifecycleCommandId("executor-pause", { runId, generation: claim.claimGeneration, commandId: current.pause?.commandId }),
          runId, claim,
        }));
        return "held";
      }
      const authorization = buildTerminalAuthorization({
        run: current,
        authorizedAt: instant(),
        consequence: { kind: "failed", failure: bound },
      });
      const outcome = deps.lifecycle.terminalize({ kind: "failure",
        commandId: lifecycleCommandId("failure", { runId, failureId: bound.failureId }),
        terminal: { failure: bound, authorization },
      }, descriptor);
      if (outcome.state === "refused" && outcome.refusal.reason === "lost")
        return new RunTerminalAdmissionLostError(outcome, authorization.expectedVersion);
      requireLifecycleApplied(outcome);
      if (prepared !== undefined && capture !== undefined) capture.persist(prepared);
      return "settled";
    };
    if (prepared !== undefined && deps.authority.withAuthorityTransaction === undefined) {
      throw new Error(
        `run ${runId} has a diagnostic capture port but no authority transaction to settle its bundle with the failure`,
      );
    }
    const settled = deps.authority.withAuthorityTransaction === undefined ? settle() : deps.authority.withAuthorityTransaction(settle);
    if (settled instanceof RunTerminalAdmissionLostError) throw settled;
    if (settled === "held") {
      disposed = true;
      if (prepared !== undefined && capture !== undefined) capture.discard(prepared);
      return RunExecutionOutcomeSchema.parse({ state: "abandoned", runId, reason: "paused" });
    }
    // Emitted after commit so a logging fault can neither roll back the failure nor discard its committed bundle.
    disposed = true;
    deps.debugEvents?.emit({ category: "worker", phase: "failed", area: "run-execution", reason: "run-failed",
      code: bound.code, correlationId: bound.failureId }, { kind: "run", runId }, envelope.workflow);
    return RunExecutionOutcomeSchema.parse({ state: "failed", runId, failureId: bound.failureId });
    } catch (error) {
      if (!disposed && prepared !== undefined && capture !== undefined) {
        try { capture.discard(prepared); } catch (cleanup) { throw new AggregateError([error, cleanup], "diagnostic-failure-settlement-disposal-failed", { cause: cleanup }); }
      }
      throw error;
    }
  };

  const interpret = async (): Promise<RunExecutionOutcome> => {
    /* ── validating: ref workflow-model entry validation, before any browser ────── */
    transitionTo({ state: "validating", workerId: claim.workerId, claimedAt, heartbeatAt: instant() });

    pauseAtBoundary();
    const accounting = deps.authority.withAuthorityTransaction?.(repositories => {
      const current = getRun();
      checkPause(current);
      return delegationAccountingExecution(repositories, descriptor, current);
    });
    const assertAccounting = (): void => { pauseAtBoundary(); accounting?.assertCurrent(); };

    const problems: string[] = [];
    let canonicalInput: JsonValue | undefined;
    try {
      canonicalInput = JsonValueSchema.parse(parseCanonicalInputSnapshot(descriptor.canonicalInput, initial.input.parsed, { owner: { kind: "run-input", id: runId }, source: initial.input, schemaReader: deps.authority.evidenceSchemaHash?.bind(deps.authority) }));
    } catch (error) {
      problems.push(error instanceof Error ? error.message : "canonical input snapshot failed to parse");
    }

    const injectedByNode = new Map<string, CheckpointPatch[]>();
    for (const patch of envelope.injected ?? []) {
      const existing = injectedByNode.get(String(patch.nodeId));
      if (existing === undefined) injectedByNode.set(String(patch.nodeId), [patch]);
      else existing.push(patch);
    }
    const patchedInserts: RunCheckpointRecord[] = [];

    const taskIndex = taskIndexOf(deps.stores);
    const plan = new Map<string, PlanEntry>();
    const outputs: Record<string, JsonValue> = {};
    const checkpointRecords = new Map<string, RunCheckpointRecord>();
    const childResultEvidence = new Map<string, Extract<TerminalDependencyEvidence, { state: "delegation-resolved" }>>();
    const gateResultEvidence = new Map<string, Extract<TerminalDependencyEvidence, { state: "gate-resolved" }>>();
    const replayedForFreshness: ReplayedCheckpoint[] = [];
    const skippedReasons = new Map<string, "condition-false" | "branch-not-selected" | "step-omitted">();

    const assertedRecords = new Map<string, Readonly<{ step: string; assertedAt: IsoInstant; output: Readonly<{ schemaHash: Fingerprint; value: JsonValue }> }>>();


    const childUpstreamEvidenceFor = (nodeId: NodeId) => {
      const child = childResultEvidence.get(String(nodeId));
      if (child === undefined) return undefined;
      const results: RunResultRecord[] = [];
      const checkpoints: RunCheckpointRecord[] = [];
      const visited = new Set<string>();
      const visit = (record: RunResultRecord, depth = 0): void => {
        if (depth > 16 || visited.has(record.runId) || visited.size >= 256) throw new Error("child-upstream-cycle-or-depth");
        visited.add(record.runId); results.push(record);
        for (const dependency of record.dependencies) {
          if (dependency.state === "resolved") {
            const address = dependency.checkpoint;
            const checkpoint = deps.authority.authority.runCheckpoints.get(address.workflowId, address.itemId, dependency.nodeId, address.attempt, address.claimGeneration);
            if (checkpoint === undefined || checkpoints.length >= 256) throw new Error("child-upstream-checkpoint-unavailable-or-limit");
            if (!checkpoints.some(retained => canonicalJsonStringify(retained) === canonicalJsonStringify(checkpoint))) checkpoints.push(checkpoint);
          } else if (dependency.state === "child-resolved") {
            const nested = deps.authority.authority.runResults.get(dependency.child.runId);
            const nestedRun = deps.authority.authority.runs.get(dependency.child.runId);
            if (nested === undefined || nestedRun?.lifecycle.state !== "terminal" || nestedRun.envelope.parent?.runId !== record.runId
              || nestedRun.envelope.parent.edgeId !== dependency.edgeId || nested.resultDigest !== dependency.child.resultDigest
              || nested.dependencyDigest !== dependency.child.dependencyDigest || nested.contractFingerprint !== dependency.child.contractFingerprint
              || nested.resultSchemaHash !== dependency.child.resultSchemaHash) throw new Error("child-upstream-canonical-descendant-mismatch");
            visit(RunResultRecordSchema.parse(nested), depth + 1);
          } else if (dependency.state === "delegation-resolved") {
            for (const member of dependency.members) {
              const nested = deps.authority.authority.runResults.get(member.runId);
              const nestedRun = deps.authority.authority.runs.get(member.runId);
              if (nested === undefined || nestedRun?.lifecycle.state !== "terminal" || nestedRun.envelope.parent?.runId !== record.runId
                || nestedRun.envelope.parent.edgeId !== dependency.edgeId || nested.resultDigest !== member.resultDigest) throw new Error("child-upstream-canonical-descendant-mismatch");
              visit(RunResultRecordSchema.parse(nested), depth + 1);
            }
          }
        }
      };
      for (const member of child.children) visit(member.result);
      return { evidence: child, results, checkpoints };
    };

    const dependencyEvidenceFor = (
      nodeIds: readonly NodeId[],
      purpose: string,
    ): readonly TerminalDependencyEvidence[] => nodeIds.map((dependency) => {
      const child = childResultEvidence.get(String(dependency));
      if (child !== undefined) return child;
      const gate = gateResultEvidence.get(String(dependency));
      if (gate !== undefined) return gate;
      const asserted = assertedRecords.get(String(dependency));
      if (asserted !== undefined) {
        return { state: "asserted" as const, nodeId: dependency, step: asserted.step, assertedAt: asserted.assertedAt, output: asserted.output };
      }
      const record = checkpointRecords.get(String(dependency));
      if (record !== undefined) return { state: "resolved" as const, nodeId: dependency, checkpoint: record };
      const reason = skippedReasons.get(String(dependency));
      if (reason !== undefined) return { state: "not-run" as const, nodeId: dependency, reason };
      throw new Error(
        `${purpose} dependency "${dependency}" has neither a checkpoint-backed output nor a closed not-run reason`,
      );
    });

    // Commit terminal state and result in one authority transaction.
    const settleSuccess = (
      current: RunRecord,
      built: Readonly<{ record: RunResultRecord; authorization: object }>,
    ): RunExecutionOutcome => {
      checkCancellation();
      requireOriginalClaim(current);
      const authorization = buildTerminalAuthorization({
        run: current,
        authorizedAt: built.record.createdAt,
        consequence: { kind: "done", result: built.record },
      });
      const settle = () => {
        assertAccounting();
        const outcome = deps.lifecycle.terminalize({ kind: "success",
          commandId: lifecycleCommandId("success", { runId, resultDigest: built.record.resultDigest,
            ...(current.delegationRefresh === undefined ? {} : { refreshCommandId: current.delegationRefresh.commandId, claimGeneration: current.claimGeneration }) }),
          terminal: { result: built.record, authorization },
        }, descriptor, built.authorization);
        if (accounting === undefined && outcome.state === "refused" && outcome.refusal.reason === "lost")
          throw new RunTerminalAdmissionLostError(outcome, authorization.expectedVersion);
        requireLifecycleApplied(outcome);
      };
      if (accounting === undefined) settle();
      else if (deps.authority.withAuthorityTransaction !== undefined) deps.authority.withAuthorityTransaction(settle);
      else throw new Error("delegation-accounting-transaction-unavailable");
      return RunExecutionOutcomeSchema.parse({ state: "done", runId });
    };


    const dryRunSteps = new Map<string, RunPreviewStep>();
    const previewOnly = new Set<string>();
    const markUnavailable = (node: RuntimeFlowNode): void => {
      previewOnly.add(String(node.id));
      dryRunSteps.set(String(node.id), { nodeId: node.id, state: "unavailable", reason: "requires-unsubmitted-output" });
      deps.taskNotes?.emitRunLog({ workflow: descriptor.id,
        address: { runId, attempt: envelope.attempt, traceId: envelope.traceId, spanPath: `${envelope.traceId}/${node.id}` },
        level: "warn", message: "Dry run: this stage is unavailable because it requires an unsubmitted result.",
      }, getRun());
    };
    const branchExcluded = new Set<string>();

    const scopeFor = (dependsOn: readonly NodeId[]): RuntimeScope => {
      if (canonicalInput === undefined) {
        throw new Error(`run ${runId} has no validated canonical input; entry validation must have refused`);
      }
      const picked: Record<string, JsonValue> = {};
      for (const dependency of dependsOn) {
        const value = outputs[String(dependency)];
        if (value !== undefined) picked[String(dependency)] = value;
      }
      return { input: canonicalInput, outputs: Object.freeze(picked),
        ...(envelope.dryRun ? { dryRun: { transactions: [...dryRunSteps.values()].filter(step => step.state === "transaction-preview") } } : {}),
        protectedInputBindings: retainedRunProtectedBindings(getRun()) };
    };

    const continuationSources = validateRunContinuation(deps.authority.authority, envelope);
    const continuationAuthority = envelope.continuation === undefined ? undefined
      : deps.authority.withAuthorityTransaction?.(repositories => AuthenticatedRunContinuation.authenticate(repositories, envelope));
    if (envelope.continuation !== undefined && continuationAuthority === undefined) throw new RunContinuationRefusedError("run-continuation-authority-unavailable");
    const memberRetry = continuationAuthority === undefined ? undefined : deps.lifecycle.delegationRetryExecution({ runId, claim });
    const boundAt = (consumer: RunCheckpointRecord) => (source: RunRecord, dependency: NodeId) => originalCheckpoint(deps.authority.authority, source, String(dependency), consumer.claimGeneration);
    // `pick` names the one row the consumer was bound from; nothing is searched by time or taken as latest.
    // `conditions` is false where the record already holds every dependency's value, so none was skipped by its `when`.
    const sourceScopeFor = (sourceRunId: string, dependsOn: readonly NodeId[], pick: (source: RunRecord, dependency: NodeId) => RunCheckpointRecord | undefined, conditions = true): RuntimeScope => {
      const source = sourceRunId === runId ? getRun() : continuationSources.find(row => row.envelope.runId === sourceRunId);
      if (source === undefined) throw new RunContinuationRefusedError("run-continuation-input-source-unavailable");
      const values: Record<string, JsonValue> = {};
      for (const dependency of dependsOn) {
        const dependencyNode = nodes.find(node => node.id === dependency);
        if (conditions && (dependencyNode?.kind === "task" || dependencyNode?.kind === "gate" && dependencyNode.resolvedBy === "operator") && dependencyNode.when !== undefined
          && !evaluateNodeCondition(dependencyNode.when, sourceScopeFor(sourceRunId, dependencyNode.dependsOn, pick))) continue;
        const checkpoint = pick(source, dependency);
        const gate = readContinuationGate(deps.authority.authority, source.envelope, String(dependency));
        if (checkpoint !== undefined) {
          values[String(dependency)] = dependencyNode?.kind === "transaction"
            ? JsonValueSchema.parse(projectTransactionOutcome(dependencyNode.commit.uses, checkpoint.output.value, "Continuation source scope", { checkpoint, schemaReader: deps.authority.evidenceSchemaHash?.bind(deps.authority) })) : checkpoint.output.value;
        }
        else if (gate !== undefined) values[String(dependency)] = gate.result.value;
        else {
          if (dependencyNode?.kind === "child-run") {
            const child = deps.authority.withAuthorityTransaction?.(repositories => AuthenticatedRunContinuation.authenticate(repositories, source.envelope)
              .dependency(String(dependency), String(dependencyNode.edgeId), true));
            if (child !== undefined) { values[String(dependency)] = JsonValueSchema.parse(delegationEvidenceOutput(child, dependencyNode.target.result, deps.authority.evidenceSchemaHash?.bind(deps.authority))); continue; }
          }
          throw new RunContinuationRefusedError("run-continuation-input-context-unavailable");
        }
      }
      return { input: source.input.parsed.value, outputs: values,
        protectedInputBindings: retainedRunProtectedBindings(source) };
    };
    // Mirrors sourceScopeFor's walk: a child reached directly or through a conditional dependency is authenticated only there.
    const reachesChild = (dependsOn: readonly NodeId[]): boolean => dependsOn.some(id => {
      const dependency = nodes.find(candidate => candidate.id === id);
      return dependency?.kind === "child-run" || (dependency?.kind === "task" || dependency?.kind === "gate" && dependency.resolvedBy === "operator")
        && dependency.when !== undefined && reachesChild(dependency.dependsOn);
    });
    const startAt = envelope.startAt;
    let startIndex: number | undefined;
    if (startAt !== undefined) {
      const found = nodes.findIndex((node) => String(node.id) === String(startAt));
      if (found < 0) {
        problems.push(`start node "${startAt}" does not exist in ${descriptor.id} v${String(descriptor.version)}`);
      } else {
        startIndex = found;
      }
    }

    const startNode = startIndex === undefined ? undefined : nodes[startIndex];
    const previousNode = startIndex === undefined ? undefined : nodes[startIndex - 1];
    const resolvedResumeGate = envelope.continuation === undefined
      ? (startNode?.kind === "gate" ? readContinuationGate(deps.authority.authority, envelope, String(startNode.id)) : undefined)
        ?? (previousNode?.kind === "gate" ? readContinuationGate(deps.authority.authority, envelope, String(previousNode.id)) : undefined)
      : undefined;
    const ownGateResume = resolvedResumeGate?.runId === runId;
    const completedOwnDelegation = (node: ChildRunRuntimeNode) => {
      const evidence = deps.authority.withAuthorityTransaction?.(repositories =>
        AuthenticatedRunContinuation.authenticate(repositories, envelope).dependency(String(node.id), String(node.edgeId)));
      if (evidence === undefined || evidence.parentRunId !== runId || evidence.nodeId !== node.id || evidence.edgeId !== node.edgeId
        || node.await !== "terminal" || evidence.manifest.cardinality !== node.cardinality || evidence.manifest.join !== node.join
        || canonicalJsonStringify(evidence.manifest.policy) !== canonicalJsonStringify(node.policy)
        || (deps.authority.evidenceSchemaHash?.({ kind: "delegation-input", id: evidence.manifest.manifestId }, evidence.manifest, evidence.manifest.inputSchemaHash, deriveSchemaHash(node.target.input, "input")) ?? evidence.manifest.inputSchemaHash) !== deriveSchemaHash(node.target.input, "input")
        || (deps.authority.evidenceSchemaHash?.({ kind: "delegation-result", id: evidence.manifest.manifestId }, evidence.manifest, evidence.manifest.resultSchemaHash, deriveSchemaHash(node.target.result, "output")) ?? evidence.manifest.resultSchemaHash) !== deriveSchemaHash(node.target.result, "output")
        || evidence.children.some(child => child.run.envelope.workflow !== node.target.id || child.run.envelope.dryRun !== envelope.dryRun)) {
        throw new RunContinuationRefusedError("run-gate-resume-child-authority-unavailable");
      }
      resolveDelegationEvidenceOutput(evidence, node.target.result, deps.authority.evidenceSchemaHash?.bind(deps.authority));
      return evidence;
    };

    const checkpointExpectation = (node: TaskRuntimeNode) => CheckpointExpectationSchema.parse({
      descriptorVersion: descriptor.version,
      contractFingerprint: descriptor.contractFingerprint,
      implFingerprint: taskImplFingerprint(node.uses),
      outputSchemaHash: deriveSchemaHash(node.uses.output, "output"),
    });

    const retainedTransaction = (node: RuntimeFlowNode) => node.kind === "transaction"
      && envelope.continuation?.checkpoints.some(row => row.nodeId === node.id) === true;
    const pendingCommits = nodes.filter(node => node.kind === "transaction" && !retainedTransaction(node)
      && !omissionPlan.omitted.has(String(node.id)) && !omissionPlan.asserted.has(String(node.id))).map(node => node.id);
    // An explicit start node requires every ancestor to resolve without executing it.
    let ancestorRegionOpen = canonicalInput !== undefined;
    const publicationRegion = new Set<string>();
    if (envelope.dryRun) for (const node of nodes) {
      if (node.kind === "task" && node.dryRun === "stop-before-publish" || node.dependsOn.some(id => publicationRegion.has(String(id)))) publicationRegion.add(String(node.id));
    }
    for (const [index, node] of nodes.entries()) {

      if (omissionPlan.omitted.has(String(node.id))) {
        plan.set(String(node.id), { mode: "omitted" });
        continue;
      }
      if (omissionPlan.asserted.has(String(node.id))) {
        const own = readRunCheckpoint(deps.authority.authority, envelope, String(node.id), true);
        const ownRecord = own === undefined ? undefined : RunCheckpointRecordSchema.parse(own);
        const replay = ownRecord !== undefined
          && ownRecord.assertion !== undefined
          && ownRecord.runId === runId
          && ownRecord.attempt === envelope.attempt
          ? ownRecord
          : undefined;
        plan.set(String(node.id), replay === undefined ? { mode: "asserted" } : { mode: "asserted", replay });
        continue;
      }
      // A dry run re-derives a publication boundary and everything behind it; stored state never stands in.
      if (publicationRegion.has(String(node.id))) {
        plan.set(String(node.id), { mode: "execute" });
        continue;
      }
      const retainedAccounting = accounting?.plan.retain.includes(String(node.id)) === true;
      if (accounting?.plan.recompute.includes(String(node.id))) {
        plan.set(String(node.id), { mode: "execute" });
        continue;
      }
      if (retainedAccounting && node.kind === "child-run") {
        plan.set(String(node.id), { mode: "replay-child", evidence: completedOwnDelegation(node) });
        continue;
      }
      const explicit = startIndex !== undefined && envelope.continuation === undefined;
      const inAncestorRegion = retainedAccounting || envelope.continuation !== undefined || (explicit
        ? index < (startIndex ?? 0) || ownGateResume && index === startIndex && node.id === resolvedResumeGate?.nodeId : ancestorRegionOpen);
      if (!inAncestorRegion) {
        plan.set(String(node.id), { mode: "execute" });
        continue;
      }
      if (node.kind === "task") {
        if (node.replay === "always-rerun" && (envelope.continuation === undefined || retainedAccounting || memberRetry !== undefined)) {
          // NEVER consult loadCheckpoint for an always-rerun node (§5.3).
          plan.set(String(node.id), { mode: "execute" });
          continue;
        }
        let conditionKnown = true;
        for (const dependency of node.dependsOn) {
          const dependencyEntry = plan.get(String(dependency));
          if (dependencyEntry === undefined || dependencyEntry.mode === "execute" || dependencyEntry.mode === "asserted"
            || !Object.hasOwn(outputs, String(dependency))) {
            conditionKnown = false;
          }
        }
        if (node.when !== undefined && conditionKnown) {

          const condition = evaluateNodeCondition(node.when, scopeFor(node.dependsOn));
          if (!condition) {
            plan.set(String(node.id), { mode: "skipped-condition" });
            continue;
          }
        }
        const stored = retainedAccounting
          ? deps.authority.authority.runCheckpoints.listByAttempt(envelope.workflow, envelope.itemId, node.id, envelope.attempt)
            .filter(record => record.runId === runId).at(-1)
          : readRunCheckpoint(deps.authority.authority, envelope, String(node.id), true);

        if ((envelope.recovery === "restart-from-start" || envelope.sourceBound !== undefined && envelope.continuation === undefined) && stored !== undefined && stored.runId !== runId) {
          if (explicit) {
            problems.push(
              `node "${node.id}" (${labelOf(node)}) cannot be replayed on a restart-from-start attempt; `
              + "a restart owns no explicit start node",
            );
            continue;
          }
          ancestorRegionOpen = false;
          plan.set(String(node.id), { mode: "execute" });
          continue;
        }
        const load = loadCheckpoint(
          stored,
          checkpointExpectation(node),
          node.uses.output,
        );
        if (retainedAccounting && !load.found) throw new RunContinuationRefusedError("delegation-accounting-upstream-checkpoint-unavailable");
        // `stored` is the repository's strict parse already; a found load has a row.
        const storedRecord = load.found ? requireStoredCheckpoint(stored, String(node.id)) : undefined;
        const storedAssertion = storedRecord?.assertion;
        if (storedAssertion !== undefined) {

          if (explicit) {
            problems.push(
              `node "${node.id}" (${labelOf(node)}) latest checkpoint is an operator assertion for omitted step `
              + `"${storedAssertion.step}", and this run does not omit that step; an assertion never replays as an observation`,
            );
            continue;
          }
          ancestorRegionOpen = false;
          plan.set(String(node.id), { mode: "execute" });
          continue;
        }
        if (load.found) {
          const record = requireStoredCheckpoint(stored, String(node.id));
          // A stale always-rerun fact is read again; only checkpoint tasks refuse.
          if (node.replay === "always-rerun" && auditCheckpointFreshness({ workflowId: descriptor.id, runId, startAt: startAt ?? node.id, nodes,
            replayed: [{ nodeId: node.id, taskId: node.uses.id, freshness: node.uses.freshness, provenance: record.provenance }],
            scheduled: pendingCommits, now: clock.now(), attempt: envelope.attempt,
            ...(envelope.freshnessOverride === undefined ? {} : { overrides: envelope.freshnessOverride }) }).length > 0) {
            plan.set(String(node.id), { mode: "execute" });
            continue;
          }
          const deferred = node.dependsOn.some(dependency => !Object.hasOwn(outputs, String(dependency)));
          if (!deferred && envelope.continuation !== undefined) {
            const original = node.uses.input.parse(node.bind(sourceScopeFor(record.runId, node.dependsOn, boundAt(record))));
            const continued = node.uses.input.parse(node.bind(scopeFor(node.dependsOn)));
            if (boundInputIdentity(original) !== boundInputIdentity(continued)) {
              problems.push(`Completed node "${node.id}" has incompatible corrected input; continuation refused`);
              continue;
            }
          }
          const nodePatches = injectedByNode.get(String(node.id));
          let effective = record;
          if (nodePatches !== undefined && !deferred) {
            injectedByNode.delete(String(node.id));
            try {
              const patched = applyCheckpointPatches({
                replayed: record,
                patches: nodePatches,
                outputSchema: node.uses.output,
                attempt: envelope.attempt,
                claimGeneration: claim.claimGeneration,
                runId,
                writtenAt: instant(),
              });
              effective = patched.record;
              patchedInserts.push(patched.record);
            } catch (error) {
              problems.push(
                `injected correction for node "${node.id}" was refused: `
                + (error instanceof Error ? error.message : String(error)),
              );
              continue;
            }
          }
          if (deferred && nodePatches !== undefined) injectedByNode.delete(String(node.id));
          plan.set(String(node.id), { mode: "replay", record: effective, ...(deferred ? { deferred: true,
            ...(nodePatches === undefined ? {} : { patches: nodePatches }) } : {}) });
          if (deferred) continue;
          outputs[String(node.id)] = JsonValueSchema.parse(effective.output.value);
          checkpointRecords.set(String(node.id), effective);
          replayedForFreshness.push({
            nodeId: node.id,
            taskId: node.uses.id,
            freshness: node.uses.freshness,
            provenance: effective.provenance,
          });
          continue;
        }
        if (explicit || envelope.continuation?.checkpoints.some(row => row.nodeId === node.id)) {
          problems.push(
            `missing context "${node.id}" (${labelOf(node)} → ${node.uses.id}) — ${load.reason}: ${load.detail}; `
            + `replay policy is "checkpoint".`,
          );
          continue;
        }
        ancestorRegionOpen = false;
        plan.set(String(node.id), { mode: "execute" });
        continue;
      }
      if (node.kind === "gate") {
        if (node.resolvedBy === "operator" && node.when !== undefined
          && node.dependsOn.every((dependency) => outputs[String(dependency)] !== undefined)
          && !evaluateNodeCondition(node.when, scopeFor(node.dependsOn))) {
          if (readContinuationGate(deps.authority.authority, envelope, String(node.id)) !== undefined) {
            problems.push(`inapplicable gate "${node.id}" carries a stored operator result; evidence changed`);
            continue;
          }
          plan.set(String(node.id), { mode: "skipped-condition" });
          continue;
        }
        const stored = readContinuationGate(deps.authority.authority, envelope, String(node.id));
        if (stored !== undefined) {
          if ((stored.runId !== runId && !envelope.continuation?.gates.some(row => row.runId === stored.runId && row.nodeId === node.id)) || String(stored.nodeId) !== String(node.id) || (deps.authority.evidenceSchemaHash?.({ kind: "gate-result", id: canonicalJsonStringify([stored.runId, stored.gateId]) }, stored, stored.result.schemaHash, deriveSchemaHash(node.result, "output")) ?? stored.result.schemaHash) !== deriveSchemaHash(node.result, "output")) throw new Error(`gate "${node.id}" stored result binding changed`);
          if (stored.runId !== runId) {
            const source = continuationSources.find(row => row.envelope.runId === stored.runId);
            if (source === undefined || canonicalJsonStringify(source.input.parsed) !== canonicalJsonStringify(initial.input.parsed)) {
              problems.push(`Completed gate "${node.id}" has incompatible corrected input; continuation refused`);
              continue;
            }
          }
          outputs[String(node.id)] = JsonValueSchema.parse(node.result.parse(stored.result.value));
          plan.set(String(node.id), { mode: "replay-gate", record: stored });
          continue;
        }
        if (explicit) {
          problems.push(`gate "${node.id}" has no stored result; a resume past an unresolved gate is impossible`);
          continue;
        }
        ancestorRegionOpen = false;
        plan.set(String(node.id), { mode: "execute" });
        continue;
      }
      if (node.kind === "branch" || node.kind === "parallel") {
        // Pure control nodes re-derive deterministically from validated data.
        plan.set(String(node.id), { mode: "execute" });
        continue;
      }
      if (explicit && ownGateResume && node.kind === "child-run" && node.await === "terminal") {
        plan.set(String(node.id), { mode: "replay-child", evidence: completedOwnDelegation(node) });
        continue;
      }
      if (explicit) {
        problems.push(
          `cannot resume across ${node.kind} node "${node.id}"; its recovery/reuse semantics `
          + "belong to the owning seam and are not a Phase-1 interpreter replay",
        );
        continue;
      }
      ancestorRegionOpen = false;
      plan.set(String(node.id), { mode: "execute" });
    }

    for (const nodeId of injectedByNode.keys()) {
      problems.push(
        `injected correction names node "${nodeId}", which this run does not replay from a checkpoint; `
        + "a fresh read supersedes any correction, so the patch is refused rather than silently ignored",
      );
    }


    if (canonicalInput !== undefined) {
      const scheduled = nodes
        .filter((node) => plan.get(String(node.id))?.mode === "execute" && !retainedTransaction(node))
        .map((node) => node.id);
      const firstNode = nodes[0];
      if (firstNode === undefined) throw new Error(`${descriptor.id} declares no nodes`);
      problems.push(...auditCheckpointFreshness({
        workflowId: descriptor.id,
        runId,
        startAt: startAt ?? scheduled[0] ?? firstNode.id,
        nodes,
        replayed: replayedForFreshness,
        scheduled,
        now: clock.now(),
        attempt: envelope.attempt,
        ...(envelope.freshnessOverride === undefined ? {} : { overrides: envelope.freshnessOverride }),
      }));
    }


    for (const refusal of omissionPlan.refusals) {
      problems.push(`step omission refused [${refusal.code}]: ${refusal.message}`);
    }
    if (problems.length > 0) {
      const failure = buildEntryValidationFailureRecord({
        run: getRun(),
        failureId: deps.ids.uuid(),
        problems,
        occurredAt: instant(),
      });
      return await terminalizeAsFailure(failure);
    }

    /* ── running: walk the plan in declaration order ─────────────────────── */
    transitionTo(runningLifecycle());


    for (const record of patchedInserts) {
      deps.authority.authority.runCheckpoints.insert(record);
    }

    const excludedByBranch = (node: RuntimeFlowNode): boolean => {
      if (branchExcluded.has(String(node.id))) return true;
      for (const dependency of node.dependsOn) {
        if (branchExcluded.has(String(dependency))) {
          branchExcluded.add(String(node.id));
          return true;
        }
      }
      return false;
    };

    const failNode = (
      node: RuntimeFlowNode,
      taskId: string | undefined,
      error: unknown,
      secondaryCauses: readonly FailureEvidenceCause[] = [],
    ): Promise<RunExecutionOutcome> => terminalizeAsFailure(buildNodeFailureRecord({
      run: getRun(),
      failureId: deps.ids.uuid(),
      nodeId: node.id,
      ...(taskId === undefined ? {} : { taskId: TaskIdSchema.parse(taskId) }),
      error,
      secondaryCauses,
      occurredAt: instant(),
      writes: deps.authority.withAuthorityTransaction?.(repositories => AuthenticatedRunContinuation.authenticate(repositories, getRun().envelope)
        .writeRunIds().flatMap(id => repositories.writeIntents.listByRun(id))) ?? [],
    }));

    const abortReason = (fallback: string): RunAbandonedError => new RunAbandonedError(
      input.signal.reason instanceof Error ? input.signal.reason.message : fallback,
    );

    const interruptBeforeFence = (nodeId: string): void => {
      if (input.signal.aborted) throw abortReason(`run ${runId} was aborted during ${nodeId}`);
      pauseAtBoundary();
    };

    const waitForBackoff = async (ms: number): Promise<void> => {
      if (ms <= 0) return;
      await new Promise<void>((resolve, reject) => {
        const handle = deps.scheduler.schedule(clock.monotonicMs() + ms, () => {
          input.signal.removeEventListener("abort", onAbort);
          resolve();
        });
        const onAbort = (): void => {
          handle.cancel();
          reject(new RunAbandonedError(`run ${runId} was aborted during retry backoff`));
        };
        input.signal.addEventListener("abort", onAbort, { once: true });
      });
    };


    const gateResultFor = (nodeId: string): GateResultRecord | undefined => {
      const gateNode = nodes.find((candidate) => String(candidate.id) === nodeId);
      if (gateNode?.kind !== "gate") return undefined;
      return readContinuationGate(deps.authority.authority, envelope, nodeId);
    };

    const invokeTask = async (
      node: TaskRuntimeNode,
      task: AnyTask,
      scope: RuntimeScope,
      need: SessionNeed | undefined,
      capabilityWiring: TaskCapabilityWiring,
      spanPath: string,
      failureCauses: FailureEvidenceCause[],
    ): Promise<RunCheckpointRecord> => {
      const contract: AnyReadTaskContract = node.uses;
      const bound: unknown = node.bind(scope);
      const parsedInput: unknown = contract.input.parse(bound);
      const conditionIds = new Set<string>();
      const gatherCondition = (id: string): void => {
        const skipped = nodes.find(candidate => String(candidate.id) === id);
        if ((skipped?.kind !== "task" && !(skipped?.kind === "gate" && skipped.resolvedBy === "operator")) || skipped.when === undefined || skipped.when.of.from !== "node") return;
        const source = String(skipped.when.of.nodeId);
        if (!node.dependsOn.some(dependency => String(dependency) === source)) conditionIds.add(source);
        if (skippedReasons.get(source) === "condition-false") gatherCondition(source);
      };
      for (const dependency of node.dependsOn) if (skippedReasons.get(String(dependency)) === "condition-false") gatherCondition(String(dependency));
      const collector = createTaskProvenanceCollector({
        descriptor,
        schemaReader: deps.authority.evidenceSchemaHash?.bind(deps.authority),
        ...(continuationAuthority === undefined ? {} : { continuation: continuationAuthority }),
        canonicalInput,
        execution: {
          runId,
          traceId: envelope.traceId,
          attempt: envelope.attempt,
          workflowId: descriptor.id,
          nodeId: String(node.id),
          taskId: contract.id,
        },

        upstreamEvidence: {
          conditionEvidence: {
            checkpoints: [...conditionIds].flatMap(id => { const checkpoint = checkpointRecords.get(id); return checkpoint === undefined ? [] : [checkpoint]; }),
            gateResults: [...conditionIds].flatMap(id => { const gate = gateResultFor(id); return gate === undefined ? [] : [gate]; }),
            skippedTasks: [...conditionIds].filter(id => skippedReasons.get(id) === "condition-false" && nodes.some(node => String(node.id) === id && node.kind === "task")),
            skippedGates: [...conditionIds].filter(id => skippedReasons.get(id) === "condition-false" && nodes.some(node => String(node.id) === id && node.kind === "gate")),
          },
          children: node.dependsOn.flatMap((dependency) => { const child = childUpstreamEvidenceFor(dependency); return child === undefined ? [] : [child]; }),
          checkpoints: node.dependsOn.flatMap((dependency) => {
            if (childResultEvidence.has(String(dependency))) return [];
            const record = checkpointRecords.get(String(dependency));
            if (record !== undefined) return [record];
            if (skippedReasons.get(String(dependency)) === "condition-false"
              && nodes.some((candidate) => candidate.id === dependency && (candidate.kind === "gate" || candidate.kind === "task"))) return [];
            if (gateResultFor(String(dependency)) !== undefined) return [];
            throw new Error(
              `task ${contract.id} declared dependency "${dependency}" has no checkpoint record to hand `
              + "to the provenance collector",
            );
          }),
          skippedTasks: node.dependsOn.filter((dependency) =>
            skippedReasons.get(String(dependency)) === "condition-false"
            && nodes.some((candidate) => candidate.id === dependency && candidate.kind === "task")),
          skippedGates: node.dependsOn.filter((dependency) =>
            skippedReasons.get(String(dependency)) === "condition-false"
            && nodes.some((candidate) => candidate.id === dependency && candidate.kind === "gate")),
          gateResults: node.dependsOn.flatMap((dependency) => {
            if (skippedReasons.get(String(dependency)) === "condition-false") return [];
            const stored = gateResultFor(String(dependency));
            return stored === undefined ? [] : [stored];
          }),
        },
        clock,

        onRecord: ({ recordedAt, points }) => {
          emit({
            t: "data.observed",
            ts: recordedAt,
            ...runSpanIdentity,
            spanPath,
            parentSpanPath: runSpanIdentity.spanPath,
            nodeId: String(node.id),
            taskId: contract.id,
            observedAt: recordedAt,
            points: redactObservedDataPoints(contract.id, points),
          });
        },
        observationSpanPath: spanPath,
      });

      const taskLog = (level: "step" | "debug" | "warn", message: string,
        fields?: Parameters<TaskLogger["info"]>[1]): void => {
        const sink = deps.taskNotes;
        if (sink === undefined) return;
        const address = { runId, attempt: envelope.attempt, traceId: envelope.traceId, spanPath };
        sink.emitRunLog({
          workflow: descriptor.id,
          address,
          level,
          message,
          fields,
        }, getRun());
      };
      const taskLogger: TaskLogger = {
        debug: (message, fields) => {
          deps.log.debug(message, fields);
          taskLog("debug", message, fields);
        },
        info: (message, fields) => {
          deps.log.info(message, fields);
          taskLog("step", message, fields);
        },
        warn: (message, fields) => {
          deps.log.warn(message, fields);
          taskLog("warn", message, fields);
        },
      };

      const controller = new AbortController();
      const forwardAbort = (): void => {
        controller.abort(input.signal.reason instanceof Error
          ? input.signal.reason
          : new Error(`run ${runId} execution was aborted`));
      };
      if (input.signal.aborted) forwardAbort();
      input.signal.addEventListener("abort", forwardAbort, { once: true });
      const deadline = deps.scheduler.schedule(
        clock.monotonicMs() + deps.taskDeadlineMs,
        () => {
          controller.abort(new Error(
            `${contract.id} exceeded its immutable ${String(deps.taskDeadlineMs)}ms task deadline`,
          ));
        },
      );

      const run = RunnableTaskSchema.parse(task.impl.run);
      const ctxCommon = {
        signal: controller.signal,
        log: taskLogger,
        fail: (code: string, message: string, options?: Readonly<{
          subject?: string; transient?: boolean; cause?: unknown;
        }>): never => {
          throw new TaskError(contract.id, code, message, options);
        },
        recordData: collector.recordData,
      } as const;

      const declaredProviders = contract.providers ?? [];
      let providerClients: Readonly<Record<string, ProviderClient<ProviderCapabilityId>>> | undefined;
      if (declaredProviders.length > 0) {
        const provider = capabilityWiring.providers;
        if (provider === undefined) {
          throw new Error(
            `${contract.id} requires provider capabilities but reached invocation without wiring; `
            + "executeTaskNode must refuse before invoking",
          );
        }
        // Mint one provider client per capability and invocation; it is not reusable authority.
        const clients: Record<string, ProviderClient<ProviderCapabilityId>> = {};
        for (const declared of declaredProviders) {
          const capability = ProviderCapabilityIdSchema.parse(declared);
          const client = admittedClientFor(capability, {
            execution: {
              runId,
              attempt: envelope.attempt,
              nodeId: String(node.id),
              taskId: contract.id,
            },
            configSnapshotId: envelope.configSnapshotId,
            configFingerprint: envelope.configFingerprint,
            configSnapshot: provider.storedSnapshot,
            runSignal: controller.signal,
            adapters: provider.wiring.adapters,
            observe: event => {
              taskLogger.debug("provider request", { ...event, nodeId: String(node.id), taskId: contract.id });
              if (event.state !== "produced") deps.debugEvents?.emit({ category: "worker", phase: "failed", area: "provider",
                code: "PROVIDER_CALL_FAILED", correlationId: event.requestId ?? runId,
                reason: event.state === "timeout" ? "provider-timeout" : event.state === "aborted" ? "provider-aborted"
                  : event.state === "invalid-response" ? "provider-response-invalid" : "provider-unavailable" }, { kind: "run", runId }, envelope.workflow);
            },
            clock,
            idFactory: provider.wiring.idFactory,
            deadlineScheduler: deps.scheduler,
          });
          if (memberRetry !== undefined && memberRetry.nodeId === node.id && capability === "ocr.approved-snapshot") {
            clients[capability] = Object.freeze({ ...client, async call(payload: Parameters<typeof client.call>[0]) {
              const response = await client.call(payload);
              if (response.state === "produced") {
                const result = schemaBoundValueSchema(OcrApprovalReadResultSchema, deriveSchemaHash(OcrApprovalReadResultSchema, "output"))
                  .parse(response.value).value;
                if (result.state === "record") memberRetry.assertRetained(RunCheckpointRecordSchema.shape.output.parse({ schemaHash: deriveSchemaHash(contract.output, "output"),
                  value: JsonValueSchema.parse(contract.output.parse({ record: result.record })),
                  ...(retainedRunProtectedBindings(initial).length === 0 ? {} : { protectedBindings: retainedRunProtectedBindings(initial) }) }));
              }
              return response;
            } });
          } else clients[capability] = client;
        }
        providerClients = Object.freeze(clients);
      }
      const ctxExtras = {
        ...(providerClients === undefined ? {} : { providers: providerClients }),
        ...(capabilityWiring.artifacts === undefined ? {} : { artifacts: capabilityWiring.artifacts }),
      } as const;

      const retain = deps.retainCallback === undefined ? undefined : (operation: Promise<unknown>) => {
        deps.retainCallback?.({ runId, claimGeneration: claim.claimGeneration, attempt: envelope.attempt }, operation);
      };
      let raw: unknown;
      try {
        if (need === undefined) {
          raw = await withBrowserActionNotes(clock, () => raceAbortable(
            Promise.resolve().then(() => run({ input: parsedInput, ctx: { ...ctxCommon, ...ctxExtras } })),
            controller.signal, contract.id, retain,
          ), (actions) => drainBrowserActions(spanPath, actions));
        } else {
          const instanceSelection = envelope.resolvedInstance[need.system];
          if (instanceSelection === undefined) {
            throw new Error(
              `run ${runId} resolved no ${need.system} instance at enqueue, and ${contract.id} needs one`,
            );
          }
          const captureRefusals: string[] = [];
          const screenshotLog: Pick<TaskLogger, "warn"> = { warn: (message, fields) => {
            if (fields?.code === "BROWSER_SCREENSHOT_CAPTURE_FAILED" && typeof fields.reason === "string") captureRefusals.push(fields.reason);
            taskLogger.warn(message, fields);
          } };
          let operationFailure: Readonly<{ error: unknown }> | undefined;
          let stopped: Readonly<{ error: unknown }> | undefined;
          const failureCapture: { state: "pending" | "settled" } = { state: "pending" };
          const failureCaptureRefused = (reason: string): void => {
            if (failureCapture.state === "settled") return;
            failureCapture.state = "settled";
            failureCauses.push({ code: "BROWSER_SCREENSHOT_CAPTURE_FAILED", summary: `Failure screenshot not taken: ${reason}` });
          };
          try {
            raw = await withBrowserActionNotes(clock,
              () => raceAbortable(
                deps.sessions.withDriver(need, instanceSelection, controller.signal, (driver, captureScreenshot) => raceAbortable(
                  Promise.resolve().then(async () => {
                      let captured = false;
                      let captureFailure: Readonly<{ error: unknown }> | undefined;
                      const requiredCapture = async (): Promise<void> => {
                        try { await captureScreenshot(); captured = true; }
                        catch (error) { captureFailure = { error }; throw error; }
                      };
                      let output: unknown;
                      try {
                        output = await run({ input: parsedInput, ctx: { ...ctxCommon, ...ctxExtras, driver,
                          captureScreenshot: task.impl.screenshots === "task" ? requiredCapture : () => Promise.reject(new TaskError(
                            contract.id, "BROWSER_SCREENSHOT_CAPTURE_FAILED", "Task screenshot capture requires declared task ownership",
                          )),
                        } });
                      } catch (taskFailure) {
                        stopped = { error: taskFailure };
                        // The page the step stopped on, while its lease still holds it; a refusal is evidence, never the failure.
                        if (captureFailure === undefined || captureFailure.error !== taskFailure) {
                          const earlierRefusals = captureRefusals.length;
                          try { await captureScreenshot(); }
                          catch { failureCaptureRefused(captureRefusals.slice(earlierRefusals).at(-1) ?? (controller.signal.aborted ? "task-deadline" : "lease-ended")); }
                        }
                        failureCapture.state = "settled";
                        throw taskFailure;
                      }
                      if (captureFailure !== undefined) throw captureFailure.error;
                      if (!captured) await requiredCapture();
                      return output;
                    }),
                  controller.signal,
                  contract.id, retain,
                ), { taskId: contract.id, nodeId: String(node.id), attempt: envelope.attempt, log: screenshotLog }),
                controller.signal,
                contract.id, retain,
              ).catch((error: unknown) => { operationFailure = { error }; throw error; }),
              (actions) => {
                try { drainBrowserActions(spanPath, actions, contract.id); }
                catch (error) {
                  if (operationFailure === undefined) throw error;
                  failureCauses.push({ code: "BROWSER_SCREENSHOT_CAPTURE_FAILED", summary: "Failure screenshot not saved to the run log" });
                }
              },
            );
          } catch (error) {
            // A deadline or lease fault after the task stopped is recorded beside the task's own failure, not in its place.
            if (stopped === undefined || error === stopped.error || error instanceof RunAbandonedError) throw error;
            if (failureCapture.state === "settled") failureCauses.push(followingFailureCause(error, "The browser lease failed after the task stopped"));
            else failureCaptureRefused(controller.signal.aborted ? "task-deadline" : "lease-ended");
            throw stopped.error;
          }
        }
      } finally {
        deadline.cancel();
        input.signal.removeEventListener("abort", forwardAbort);
      }


      const provenance = collector.finalizeRead(raw);
      const parsedOutput: unknown = contract.output.parse(raw);
      return RunCheckpointRecordSchema.parse({
        workflowId: descriptor.id,
        itemId: envelope.itemId,
        nodeId: String(node.id),
        attempt: envelope.attempt,

        claimGeneration: claim.claimGeneration,
        runId,
        output: {
          schemaHash: deriveSchemaHash(contract.output, "output"),
          value: JsonValueSchema.parse(parsedOutput),
          ...(retainedRunProtectedBindings(initial).length === 0 ? {} : { protectedBindings: retainedRunProtectedBindings(initial) }),
        },
        descriptorVersion: descriptor.version,
        contractFingerprint: descriptor.contractFingerprint,
        implFingerprint: taskImplFingerprint(contract),
        provenance: provenance.provenance,
        observationOrigins: provenance.points.flatMap(point => observationLeafPaths(point.value).map(path => ({
          path: [...point.field.split("."), ...path], origin: resolveObservationOrigin({ ...point.execution, spanPath }, point, path),
        }))),
        writtenAt: instant(),
      });
    };

    const projectionsFor = (nodeId: string) =>
      (descriptor.artifactProjections ?? []).filter((spec) => String(spec.source.nodeId) === nodeId);
    const dryRunProjectionRefusal = (node: TaskRuntimeNode) =>
      new Error(`node "${node.id}" declares a durable artifact projection, which a dry run must never reach`);

    // Only the exact source checkpoint may acknowledge its retained output updates.
    const resumePendingProjections = async (
      node: TaskRuntimeNode,
      record: RunCheckpointRecord,
    ): Promise<RunExecutionOutcome | undefined> => {
      const specs = projectionsFor(String(node.id));
      if (specs.length === 0) return undefined;
      if (envelope.dryRun) return await failNode(node, node.uses.id, dryRunProjectionRefusal(node));
      try {
        const withTransaction = deps.authority.withAuthorityTransaction?.bind(deps.authority);
        if (withTransaction === undefined) throw new Error("generated-artifact-replay-requires-transaction");
        const pending = withTransaction(repositories => pendingGeneratedUpdateIds(repositories, record, specs));
        if (pending.length === 0) return undefined;
        const projector = deps.artifactProjector;
        if (projector === undefined) {
          return await failNode(node, node.uses.id, new Error(
            `node "${node.id}" replays a checkpoint with ${String(pending.length)} unacknowledged artifact `
            + "outbox rows, and this composition wires no artifact sink projector",
          ));
        }
        await projectGeneratedUpdates(projector, pending);
      } catch (error) {
        return await failNode(node, node.uses.id, error);
      }
      return undefined;
    };

    const executeTaskNode = async (
      node: TaskRuntimeNode,
      scope: RuntimeScope,
    ): Promise<RunExecutionOutcome | undefined> => {
      const contract = node.uses;
      const task = taskIndex.get(contract.id);
      if (task === undefined) {
        return await failNode(node, contract.id, new Error(`no store implements ${contract.id}`));
      }
      if (task.contract !== contract) {
        return await failNode(node, contract.id, new Error(
          `store task ${contract.id} binds a different contract object than the descriptor imports`,
        ));
      }
      if (contract.artifacts !== undefined && deps.artifacts === undefined) {
        return await failNode(node, contract.id, new Error(
          `${contract.id} declares content-addressed artifacts, and this composition wires no artifact writer`,
        ));
      }
      let providerInvocation: ProviderInvocationContext | undefined;
      if (contract.providers !== undefined && contract.providers.length > 0) {
        const wiring = deps.providers;
        if (wiring === undefined) {
          return await failNode(node, contract.id, new Error(
            `${contract.id} requires provider capabilities, and this composition wires no admitted provider client`,
          ));
        }

        const storedSnapshot = wiring.configSnapshots.get(envelope.configSnapshotId);
        if (storedSnapshot === undefined) {
          return await failNode(node, contract.id, new Error(
            `run ${runId} retained config snapshot ${envelope.configSnapshotId} is absent from authority; `
            + `refusing to admit ${contract.id} provider calls without the exact stored snapshot`,
          ));
        }
        providerInvocation = Object.freeze({ wiring, storedSnapshot });
      }
      const capabilityWiring: TaskCapabilityWiring = Object.freeze({
        ...(providerInvocation === undefined ? {} : { providers: providerInvocation }),
        ...(contract.artifacts === undefined || deps.artifacts === undefined
          ? {}
          : { artifacts: deps.artifacts }),
      });

      const declaredProjections = projectionsFor(String(node.id));
      if (envelope.dryRun && declaredProjections.length > 0) return await failNode(node, contract.id, dryRunProjectionRefusal(node));
      if (declaredProjections.length > 0 && deps.artifactProjector === undefined) {
        return await failNode(node, contract.id, new Error(
          `node "${node.id}" declares a durable artifact projection, and this composition wires no `
          + "artifact sink projector",
        ));
      }
      if (declaredProjections.length > 0 && deps.authority.withAuthorityTransaction === undefined) {
        return await failNode(node, contract.id, new Error(
          `node "${node.id}" declares a durable artifact projection, whose checkpoint and outbox rows `
          + "must commit atomically — and this authority exposes no transaction",
        ));
      }

      const refreshedMember = memberRetry?.nodeId === node.id;
      const refreshedRetained = node.replay === "always-rerun" && accounting?.plan.retain.includes(String(node.id)) === true;
      const attempts = task.impl.retry?.attempts ?? 1;
      const backoffMs = task.impl.retry?.backoffMs ?? 0;
      const need = task.impl.sessions[0];
      for (let taskAttempt = 1; taskAttempt <= attempts; taskAttempt += 1) {
        transitionTo(runningLifecycle(node.id));
        const spanPath = taskSpanPath(envelope.traceId, node.id, taskAttempt, claim.claimGeneration);
        emit({
          t: "span.started", kind: "task",
          ...runSpanIdentity, spanPath, parentSpanPath: runSpanIdentity.spanPath,
          name: labelOf(node),
          ...(need === undefined ? {} : { system: need.system }),
        });
        const failureCauses: FailureEvidenceCause[] = [];
        try {
          const record = await invokeTask(node, task, scope, need, capabilityWiring, spanPath, failureCauses);
          if (refreshedRetained || refreshedMember || accounting?.plan.recompute.includes(String(node.id))) {
            pauseAtBoundary();
            if (deps.authority.withAuthorityTransaction === undefined) throw new Error("delegation-accounting-transaction-unavailable");
            deps.authority.withAuthorityTransaction(repositories => {
              assertAccounting();
              if (refreshedRetained) accounting?.assertRetained(record);
              if (refreshedMember) memberRetry?.assertRetained(record.output);
              repositories.runCheckpoints.insert(record);
              deps.publishCheckpoint?.(repositories, record);
            });
          } else if (declaredProjections.length === 0) {
            if (deps.publishCheckpoint === undefined) deps.authority.authority.runCheckpoints.insert(record);
            else {
              if (deps.authority.withAuthorityTransaction === undefined) throw new Error("checkpoint-publication-transaction-unavailable");
              deps.authority.withAuthorityTransaction(repositories => {
                repositories.runCheckpoints.insert(record);
                deps.publishCheckpoint?.(repositories, record);
              });
            }
          } else {

            const withTransaction = deps.authority.withAuthorityTransaction?.bind(deps.authority);
            const projector = deps.artifactProjector;
            if (withTransaction === undefined || projector === undefined) {
              throw new Error(`node "${node.id}" projection wiring disappeared between refusal check and commit`);
            }
            const derived = deriveArtifactProjectionRows({
              specs: declaredProjections,
              nodeId: String(node.id),
              outputValue: record.output.value,
              runId: record.runId,
            });
            const outboxRows = derived.map((row) => ({
              outboxId: generatedUpdateId(record, row),
              artifactId: deps.ids.uuid(),
              projectionId: row.projectionId,
              stableKeyFingerprint: row.stableKeyFingerprint,
              keyValues: row.keyValues,
              sinkId: row.sinkId,
              sourceRunId: runId,
              sourceNodeId: String(node.id),
              state: "pending",
              payload: { schemaHash: record.output.schemaHash, value: row.value },
              createdAt: instant(),
            }));

            commitGeneratedCheckpoint({withTransaction, checkpoint:record, updates:outboxRows,
              ...(deps.publishCheckpoint === undefined ? {} : { publish: deps.publishCheckpoint })});
            // A task cannot finish before every artifact outbox row is acknowledged.
            await projectGeneratedUpdates(projector, outboxRows.map((row) => String(row.outboxId)));
          }
          checkpointRecords.set(String(node.id), record);
          outputs[String(node.id)] = JsonValueSchema.parse(record.output.value);
          emit({
            t: "span.ended", kind: "task",
            ...runSpanIdentity, spanPath, parentSpanPath: runSpanIdentity.spanPath,
            outcome: "done",
          });
          return undefined;
        } catch (error) {
          if (input.signal.aborted) {
            emit({
              t: "span.ended", kind: "task",
              ...runSpanIdentity, spanPath, parentSpanPath: runSpanIdentity.spanPath,
              outcome: "cancelled",
            });
            throw abortReason(`run ${runId} was aborted during ${contract.id}`);
          }
          if (error instanceof RunAbandonedError || (refreshedRetained || refreshedMember) && error instanceof RunContinuationRefusedError) throw error;
          const loginFailure = browserLoginFailure(error);
          const nestedTaskError = taskErrorCause(error);
          const taskError = error instanceof TaskError ? error : nestedTaskError?.code === "BROWSER_SCREENSHOT_CAPTURE_FAILED"
            ? new TaskError(contract.id, nestedTaskError.code, "The browser screenshot could not be captured or saved.", { cause: error })
            : loginFailure !== undefined
            ? new TaskError(contract.id, loginFailure.code, loginFailure.message, { cause: error })
            : wrapUnhandledTaskError(contract.id, error);
          emit({
            t: "span.ended", kind: "task",
            ...runSpanIdentity, spanPath, parentSpanPath: runSpanIdentity.spanPath,
            outcome: "failed",
            diagnosticSafetyVersion: CURRENT_DIAGNOSTIC_SAFETY_VERSION,
            errorSummary: `task ${contract.id} failed; inspect its structured failure record`,
          });
          const retryable = shouldRetryTaskFailure(taskError.transient, taskAttempt, attempts);
          if (!retryable) return await failNode(node, contract.id, taskError, failureCauses);
          await waitForBackoff(backoffMs);
        }
      }
      throw new Error(`task ${contract.id} exhausted its retry loop without a terminal decision`);
    };

    const recordCheckpointReplay = (nodeId: string, record: RunCheckpointRecord): void => {
      const now = deps.clock.now();
      deps.authority.authority.timelineEvents.append({ schemaVersion: 1,
        eventId: lifecycleCommandId("timeline-checkpoint-replayed", { runId, nodeId: nodeId, claimGeneration: claim.claimGeneration }),
        workflow: descriptor.id, scope: { kind: "run", runId }, occurredAt: now.toISOString(),
        recordedAt: now.toISOString(), retentionDate: localDatePart(now), source: { kind: "native" },
        payload: { kind: "checkpoint-replayed", runId, workflow: descriptor.id, attempt: envelope.attempt,
          claimGeneration: claim.claimGeneration, checkpoint: timelineCheckpointReference(record) },
      });
    };

    const CONDITION_SKIP = { outcome: "skipped", notRunReason: "condition-false" } as const;
    /** A task span for a node that owns no task execution, so its timeline step reads settled. */
    const emitSettledSpan = (node: RuntimeFlowNode, end: Readonly<{ outcome: "done" }> | typeof CONDITION_SKIP,
      spanPath = taskSpanPath(envelope.traceId, node.id, 1, claim.claimGeneration)): void => {
      emit({ t: "span.started", kind: "task", ...runSpanIdentity, spanPath, parentSpanPath: runSpanIdentity.spanPath, name: runtimeNodeLabel(node) });
      emit({ t: "span.ended", kind: "task", ...runSpanIdentity, spanPath, parentSpanPath: runSpanIdentity.spanPath, ...end });
    };
    /** Whether this attempt's timeline already closed the task span at `spanPath` (an ordinary reclaim re-reads a settled join). */
    const spanEnded = (spanPath: string): boolean => {
      const timeline = deps.authority.authority.timelineEvents;
      for (let after = 0; ;) {
        const page = timeline.page({ runId, after, limit: 1000 });
        if (page.some(({ payload }) => payload.kind === "span" && payload.event.t === "span.ended" && payload.event.kind === "task"
          && payload.event.attempt === envelope.attempt && payload.event.spanPath === spanPath)) return true;
        const last = page.at(-1);
        if (page.length < 1000 || last === undefined) return false;
        after = last.cursor;
      }
    };
    const recordConditionSkip = (node: RuntimeFlowNode): void => {
      skippedReasons.set(String(node.id), "condition-false");
      if (envelope.dryRun) dryRunSteps.set(String(node.id), { nodeId: node.id, state: "not-run", reason: "condition-false" });
      emitSettledSpan(node, CONDITION_SKIP);
    };

    const childSourceEvidence = (node: ChildRunRuntimeNode) => {
      const entry = plan.get(String(node.id));
      if (entry === undefined) throw new Error("delegation-branch-plan-unavailable");
      if (entry.mode === "replay-child"
        && canonicalJsonStringify(completedOwnDelegation(node)) !== canonicalJsonStringify(entry.evidence)) {
        throw new RunContinuationRefusedError("run-gate-resume-child-authority-changed");
      }
      if (accounting?.plan.retain.includes(String(node.id)) && entry.mode === "replay-child") return entry.evidence;
      if (accounting?.plan.joinNodeId === node.id) return undefined;
      const sourceEvidence = continuationAuthority?.delegation(String(node.id), String(node.edgeId));
      if (sourceEvidence !== undefined) {
        const admitted = continuationAuthority?.delegationScope(String(node.id), String(node.edgeId)) ?? [];
        const original = node.bind(sourceScopeFor(sourceEvidence.parentRunId, node.dependsOn, (_source, dependency) => {
          const entry = admitted.find(row => row.nodeId === dependency);
          return entry !== undefined && "checkpoint" in entry ? entry.checkpoint : undefined;
        }, false));
        const continued = node.bind(scopeFor(node.dependsOn));
        if (boundInputIdentity(original) !== boundInputIdentity(continued)
          || sourceEvidence.manifest.cardinality !== node.cardinality || sourceEvidence.manifest.join !== node.join
          || canonicalJsonStringify(sourceEvidence.manifest.policy) !== canonicalJsonStringify(node.policy)
          || sourceEvidence.manifest.inputSchemaHash !== deriveSchemaHash(node.target.input, "input")) throw new RunContinuationRefusedError("run-continuation-child-input-mismatch");
      }
      return sourceEvidence;
    };
    const childBatchOutputs = new Map<string, JsonValue>();

    for (const [index, node] of nodes.entries()) {
      pauseAtBoundary();
      if (envelope.dryRun) dryRunSteps.set(String(node.id), { nodeId: node.id, state: "exercised" });
      checkCancellation();
      if (input.signal.aborted) throw abortReason(`run ${runId} execution was aborted`);
      let entry = plan.get(String(node.id));
      if (entry === undefined) throw new Error(`node "${node.id}" has no execution plan entry`);
      if (entry.mode === "replay") {
        if (entry.deferred) {
          if (node.kind !== "task") throw new RunContinuationRefusedError("run-continuation-deferred-task-required");
          if (excludedByBranch(node)) { skippedReasons.set(String(node.id), "branch-not-selected"); continue; }
          const scope = scopeFor(node.dependsOn);
          if (node.when !== undefined && !evaluateNodeCondition(node.when, scope)) {
            skippedReasons.set(String(node.id), "condition-false"); continue;
          }
          if (node.dependsOn.some(dependency => !Object.hasOwn(scope.outputs, String(dependency)) && !skippedReasons.has(String(dependency)))) {
            throw new RunContinuationRefusedError("run-continuation-task-context-unavailable");
          }
          if (envelope.continuation !== undefined
            && boundInputIdentity(node.uses.input.parse(node.bind(sourceScopeFor(entry.record.runId, node.dependsOn, boundAt(entry.record)))))
              !== boundInputIdentity(node.uses.input.parse(node.bind(scope)))) {
            throw new RunContinuationRefusedError("run-continuation-task-input-mismatch");
          }
          const freshness = auditCheckpointFreshness({ workflowId: descriptor.id, runId, startAt: startAt ?? node.id, nodes,
            replayed: [{ nodeId: node.id, taskId: node.uses.id, freshness: node.uses.freshness, provenance: entry.record.provenance }],
            scheduled: nodes.filter(candidate => plan.get(String(candidate.id))?.mode === "execute" && !retainedTransaction(candidate)).map(candidate => candidate.id),
            now: clock.now(), attempt: envelope.attempt, ...(envelope.freshnessOverride === undefined ? {} : { overrides: envelope.freshnessOverride }) });
          if (freshness.length > 0) return await terminalizeAsFailure(buildEntryValidationFailureRecord({ run: getRun(), failureId: deps.ids.uuid(),
            problems: freshness, occurredAt: instant() }));
          if (entry.patches !== undefined) {
            let patched: ReturnType<typeof applyCheckpointPatches>;
            try {
              patched = applyCheckpointPatches({ replayed: entry.record, patches: entry.patches, outputSchema: node.uses.output,
                attempt: envelope.attempt, claimGeneration: claim.claimGeneration, runId, writtenAt: instant() });
            } catch (error) {
              return await terminalizeAsFailure(buildEntryValidationFailureRecord({ run: getRun(), failureId: deps.ids.uuid(),
                problems: [`injected correction for node "${node.id}" was refused: ${error instanceof Error ? error.message : String(error)}`], occurredAt: instant() }));
            }
            deps.authority.authority.runCheckpoints.insert(patched.record);
            entry = { mode: "replay", record: patched.record };
          }
          outputs[String(node.id)] = entry.record.output.value;
          checkpointRecords.set(String(node.id), entry.record);
        }
        recordCheckpointReplay(String(node.id), entry.record);
        if (node.kind === "task") {
          const owed = await resumePendingProjections(node, entry.record);
          if (owed !== undefined) return owed;
        }
        continue;
      }
      if (entry.mode === "skipped-condition") {
        // An explicit start re-walks nodes whose skip this run already recorded.
        if (startIndex !== undefined && envelope.continuation === undefined) {
          skippedReasons.set(String(node.id), "condition-false");
          if (envelope.dryRun) dryRunSteps.set(String(node.id), { nodeId: node.id, state: "not-run", reason: "condition-false" });
        } else recordConditionSkip(node);
        continue;
      }
      if (entry.mode === "replay-gate") {
        if (node.kind !== "gate") throw new Error(`node "${node.id}" is not a gate but planned a gate replay`);
        const stored = readContinuationGate(deps.authority.authority, envelope, String(node.id));
        if (stored === undefined) throw new Error(`gate "${node.id}" stored result disappeared mid-execution`);
        if (canonicalJsonStringify(stored) !== canonicalJsonStringify(entry.record)
          || node.resolvedBy === "operator" && node.when !== undefined && !evaluateNodeCondition(node.when, scopeFor(node.dependsOn))) {
          throw new RunContinuationRefusedError("run-gate-resume-result-changed");
        }
        terminalGateDependencyRecord(node.id, stored);
        const expectedHash = deriveSchemaHash(node.result, "output");
        if ((deps.authority.evidenceSchemaHash?.({ kind: "gate-result", id: canonicalJsonStringify([stored.runId, stored.gateId]) }, stored, stored.result.schemaHash, expectedHash) ?? stored.result.schemaHash) !== expectedHash) {
          throw new Error(
            `gate "${node.id}" stored result is bound to schema ${stored.result.schemaHash}, `
            + `and this descriptor's gate schema is ${expectedHash}`,
          );
        }
        outputs[String(node.id)] = JsonValueSchema.parse(node.result.parse(stored.result.value));
        gateResultEvidence.set(String(node.id), { state: "gate-resolved", nodeId: node.id, gate: stored });
        continue;
      }

      if (excludedByBranch(node)) {
        skippedReasons.set(String(node.id), "branch-not-selected");
        if (envelope.dryRun) dryRunSteps.set(String(node.id), { nodeId: node.id, state: "not-run", reason: "branch-not-selected" });
        continue;
      }
      if (entry.mode === "omitted") {

        skippedReasons.set(String(node.id), "step-omitted");
        if (envelope.dryRun) dryRunSteps.set(String(node.id), { nodeId: node.id, state: "not-run", reason: "step-omitted" });
        const spanPath = taskSpanPath(envelope.traceId, node.id, 1, claim.claimGeneration);
        emit({
          t: "span.started", kind: "task",
          ...runSpanIdentity, spanPath, parentSpanPath: runSpanIdentity.spanPath,
          name: node.kind === "task" ? labelOf(node) : node.kind === "transaction" ? (node.label ?? node.commit.uses.title) : String(node.id),
        });
        emit({
          t: "span.ended", kind: "task",
          ...runSpanIdentity, spanPath, parentSpanPath: runSpanIdentity.spanPath,
          outcome: "skipped",
          notRunReason: "step-omitted",
        });
        continue;
      }
      if (entry.mode === "asserted") {
        if (envelope.dryRun) dryRunSteps.set(String(node.id), { nodeId: node.id, state: "not-run", reason: "operator-asserted" });

        const assertion = omissionPlan.asserted.get(String(node.id));
        if (assertion === undefined || node.kind !== "task") {
          throw new Error(`node "${node.id}" was planned as asserted but the omission plan does not assert a task there`);
        }
        transitionTo(runningLifecycle(node.id));
        if (entry.replay !== undefined) {

          const replayed = entry.replay;
          recordCheckpointReplay(String(node.id), replayed);
          if (replayed.assertion === undefined) throw new Error(`node "${node.id}" planned an assertion replay over an unmarked row`);
          outputs[String(node.id)] = replayed.output.value;
          checkpointRecords.set(String(node.id), replayed);
          assertedRecords.set(String(node.id), Object.freeze({
            step: replayed.assertion.step,
            assertedAt: replayed.assertion.assertedAt,
            output: Object.freeze({ ...replayed.output,
              ...(retainedRunProtectedBindings(initial).length === 0 ? {} : { protectedBindings: retainedRunProtectedBindings(initial) }) }),
          }));
          const replaySpanPath = taskSpanPath(envelope.traceId, node.id, 1, claim.claimGeneration);
          emit({
            t: "span.started", kind: "task",
            ...runSpanIdentity, spanPath: replaySpanPath, parentSpanPath: runSpanIdentity.spanPath,
            name: labelOf(node),
          });
          emit({
            t: "span.ended", kind: "task",
            ...runSpanIdentity, spanPath: replaySpanPath, parentSpanPath: runSpanIdentity.spanPath,
            outcome: "skipped",
            notRunReason: "operator-asserted",
          });
          continue;
        }
        const scope = scopeFor(node.dependsOn);
        const assertedAt = instant();
        let produced: unknown;
        try {
          produced = assertion.produce({ facts: assertion.facts, scope, assertedAt });
        } catch (error) {
          return await failNode(node, node.uses.id, error);
        }
        const parsed = node.uses.output.safeParse(produced);
        if (!parsed.success) {
          return await failNode(node, node.uses.id, new Error(
            `step "${assertion.step}" producer for node "${node.id}" returned a value the node's output schema refuses at: `
            + [...new Set(parsed.error.issues.map((issue) => issue.path.map(String).join(".") || "(root)"))].join(", "),
          ));
        }
        const value = JsonValueSchema.parse(parsed.data);
        if (projectionsFor(String(node.id)).length > 0) {
          return await failNode(node, node.uses.id, new Error(
            `node "${node.id}" declares artifact projections and cannot be asserted; an assertion projects nothing`,
          ));
        }

        const outputSchemaHash = deriveSchemaHash(node.uses.output, "output");
        const assertedRecord = RunCheckpointRecordSchema.parse({
          workflowId: descriptor.id,
          itemId: envelope.itemId,
          nodeId: String(node.id),
          attempt: envelope.attempt,
          claimGeneration: claim.claimGeneration,
          runId,
          output: { schemaHash: outputSchemaHash, value,
            ...(retainedRunProtectedBindings(initial).length === 0 ? {} : { protectedBindings: retainedRunProtectedBindings(initial) }) },
          descriptorVersion: descriptor.version,
          contractFingerprint: descriptor.contractFingerprint,
          implFingerprint: taskImplFingerprint(node.uses),
          provenance: jsonLeafPaths(value).map((path) => ({
            path, source: "operator", observedAt: assertedAt, originalObservedAt: assertedAt,
          })),
          writtenAt: instant(),
          assertion: { step: assertion.step, assertedAt },
        });
        deps.authority.authority.runCheckpoints.insert(assertedRecord);
        checkpointRecords.set(String(node.id), assertedRecord);
        outputs[String(node.id)] = value;
        assertedRecords.set(String(node.id), Object.freeze({
          step: assertion.step,
          assertedAt,
          output: Object.freeze({ schemaHash: outputSchemaHash, value,
            ...(retainedRunProtectedBindings(initial).length === 0 ? {} : { protectedBindings: retainedRunProtectedBindings(initial) }) }),
        }));
        const spanPath = taskSpanPath(envelope.traceId, node.id, 1, claim.claimGeneration);
        emit({
          t: "span.started", kind: "task",
          ...runSpanIdentity, spanPath, parentSpanPath: runSpanIdentity.spanPath,
          name: labelOf(node),
        });
        emit({
          t: "span.ended", kind: "task",
          ...runSpanIdentity, spanPath, parentSpanPath: runSpanIdentity.spanPath,
          outcome: "skipped",
          notRunReason: "operator-asserted",
        });
        continue;
      }

      if (envelope.dryRun && node.kind !== "transaction" && node.dependsOn.some(id => previewOnly.has(String(id)))) {
        markUnavailable(node);
        continue;
      }
      switch (node.kind) {
        case "task": {
          transitionTo(runningLifecycle(node.id));
          const scope = scopeFor(node.dependsOn);
          if (node.when !== undefined) {
            const condition = evaluateNodeCondition(node.when, scope);
            if (!condition) {
              recordConditionSkip(node);
              continue;
            }
          }
          if (envelope.dryRun && node.dryRun === "stop-before-publish") {
            try {
              node.uses.input.parse(node.bind(scope));
            } catch (error) {
              return await failNode(node, node.uses.id, wrapUnhandledTaskError(node.uses.id, error));
            }
            previewOnly.add(String(node.id));
            dryRunSteps.set(String(node.id), { nodeId: node.id, state: "publication-preview" });
            deps.taskNotes?.emitRunLog({ workflow: descriptor.id,
              address: { runId, attempt: envelope.attempt, traceId: envelope.traceId, spanPath: `${envelope.traceId}/${node.id}` },
              level: "step", message: "Dry run: this save was prepared and checked. Nothing was saved.",
            }, getRun());
            continue;
          }
          const outcome = await executeTaskNode(node, scope);
          if (outcome !== undefined) return outcome;
          continue;
        }
        case "branch": {
          transitionTo(runningLifecycle(node.id));
          const scope = scopeFor(node.dependsOn);
          const selected = node.choose(scope);
          if (!Object.hasOwn(node.cases, selected)) {
            return await failNode(node, undefined, new Error(
              `branch "${node.id}" chose "${String(selected)}", which is not a declared case `
              + `(${Object.keys(node.cases).join(", ")})`,
            ));
          }
          for (const [caseKey, targets] of Object.entries(node.cases)) {
            if (caseKey === selected) continue;
            for (const target of targets) branchExcluded.add(String(target));
          }
          outputs[String(node.id)] = JsonValueSchema.parse({ selected });
          continue;
        }
        case "parallel": {
          transitionTo(runningLifecycle(node.id));
          if (node.join !== "all") {
            return await failNode(node, undefined, new Error(
              `parallel "${node.id}" join "${node.join}" is not interpretable by this runtime; `
              + "the all-settled arm lands with its owning milestone (capability-unavailable)",
            ));
          }
          const branches: Record<string, readonly string[]> = {};
          for (const branch of node.branches) branches[branch.id] = branch.nodes;
          outputs[String(node.id)] = JsonValueSchema.parse({ join: node.join, branches });
          continue;
        }
        case "gate": {
          if (node.resolvedBy === "operator" && node.when !== undefined
            && !evaluateNodeCondition(node.when, scopeFor(node.dependsOn))) {
            if (readContinuationGate(deps.authority.authority, envelope, String(node.id)) !== undefined) {
              return await failNode(node, undefined, new Error(`inapplicable gate "${node.id}" carries a stored operator result; evidence changed`));
            }
            recordConditionSkip(node);
            continue;
          }
          transitionTo(runningLifecycle(node.id));
          let sourceBinding: unknown;
          if (node.resolvedBy !== "operator") {
            if (deps.gateSources === undefined || canonicalInput === undefined) {
              return await failNode(node, undefined, new Error(
                `gate "${node.id}" is resolved by ${node.resolvedBy}, but its registered source runtime is unavailable`,
              ));
            }
            try {
              const current = getRun();
              sourceBinding = deps.gateSources.bind(node, {
                run: current,
                canonicalInput,
                dependencyOutputs: scopeFor(node.dependsOn).outputs,
                parkedVersion: current.version + 1,
              });
            } catch (error) {
              return await failNode(node, undefined, error instanceof Error
                ? error
                : new Error(`gate "${node.id}" source binding failed`, { cause: error }));
            }
          }
          // A parked write owns durable checkpoints; recovery resumes without inventing task execution.
          await deps.sessions.closeAll("parked");
          const resumeAt = nodes[index + 1]?.id ?? node.id;
          transitionTo(RunLifecycleSchema.parse({
            state: "parked-gate",
            gateId: GateIdSchema.parse(String(node.id)),
            parkedAt: instant(),
            resumeAt,
            ...(sourceBinding === undefined ? {} : { sourceBinding }),
          }));
          return RunExecutionOutcomeSchema.parse({ state: "parked-gate", runId, gateId: String(node.id) });
        }
        case "transaction": {
          transitionTo(runningLifecycle(node.id));
          if (deps.writeSequencer === undefined) {
            return await failNode(node, node.commit.uses.id, new TaskError(
              node.commit.uses.id,
              "capability-unavailable",
              `transaction node "${node.id}" requires the ref write-safety write sequencer, which is not wired; `
              + "refusing to skip a write node",
            ));
          }
          const transactionScope = scopeFor(node.dependsOn);
          if (!envelope.dryRun && envelope.continuation !== undefined) {
            const settled = readRunCheckpoint(deps.authority.authority, envelope, String(node.id), true);
            // A run's own settlement replays from its receipt: its input is fixed, so a later re-read is an observation, not a correction.
            // A child-run dependency keeps the guard, which alone authenticates the original member authority.
            const checkpoint = settled?.runId === runId && envelope.injected === undefined && !reachesChild(node.dependsOn) ? undefined : settled;
            if (checkpoint !== undefined) {
              const originalScope = sourceScopeFor(checkpoint.runId, node.dependsOn, boundAt(checkpoint));
              const mappings = (scope: RuntimeScope) => ({ prepare: node.prepare.uses.input.parse(node.prepare.bind(scope)),
                commit: node.commit.uses.input.parse(node.commit.bind(scope)) });
              if (canonicalJsonStringify(mappings(originalScope)) !== canonicalJsonStringify(mappings(transactionScope))) {
                throw new RunContinuationRefusedError("run-continuation-transaction-input-mismatch");
              }
            }
          }
          let previewBinding: DryRunBinding | undefined;
          if (envelope.dryRun) {
            try {
              previewBinding = node.previewBind?.(transactionScope);
              if (previewBinding !== undefined) previewBinding = { ...previewBinding, samples: previewBinding.samples.map(sample => DryRunSampleSchema.parse(sample)) };
            }
            catch (error) { return await failNode(node, node.prepare.uses.id, error); }
            if (node.dependsOn.some(id => previewOnly.has(String(id))) && previewBinding === undefined) {
              markUnavailable(node);
              continue;
            }
          }
          try {
            const captureLog: Pick<TaskLogger, "warn"> = {
              warn(message, fields) {
                deps.log.warn(message, fields);
                deps.taskNotes?.emitRunLog({ workflow: descriptor.id,
                  address: { runId, attempt: envelope.attempt, traceId: envelope.traceId,
                    spanPath: `${envelope.traceId}/${String(node.id)}/commit` },
                  level: "warn", message, fields,
                }, getRun());
              },
            };
            if (envelope.dryRun) {
              const samples = [...(previewBinding?.samples ?? [])];
              for (const sample of samples) deps.taskNotes?.emitRunLog({ workflow: descriptor.id,
                address: { runId, attempt: envelope.attempt, traceId: envelope.traceId, spanPath: `${envelope.traceId}/${node.id}/prepare` },
                level: "step", message: "dry-run sample", fields: { field: sample.field, value: canonicalJsonStringify(sample.value) },
              }, getRun());
              let preview: TransactionDryRunPreview;
              try {
                preview = TransactionDryRunPreviewSchema.parse(await withBrowserActionNotes(clock, () => deps.writeSequencer!.executeDryRun({
                  descriptor, node, run: getRun(), claim,
                  scope: transactionScope,
                  dryRun: true, captureLog,
                  ...(previewBinding === undefined ? {} : { previewBinding }),
                  signal: input.signal,
                }), (actions) => drainBrowserActions(runSpanIdentity.spanPath, actions.filter(action => action.kind !== "screenshot")),
                  action => { if (action.kind === "screenshot") drainBrowserActions(runSpanIdentity.spanPath, [action], node.commit.uses.id); }));
              } catch (error) {
                if (error instanceof RunAbandonedError) throw error;
                interruptBeforeFence(node.id);
                return await failNode(node, node.commit.uses.id, error);
              }
              emit({
                t: "transaction.previewed",
                ...runSpanIdentity,
                node: node.id,

                subject: preview.outcome.state === "would-prepare"
                  ? preview.outcome.subject.state
                  : "not-observed",
                externalCommit: "none",
              });
              dryRunSteps.set(String(node.id), { nodeId: node.id, state: "transaction-preview", preview, samples: preview.outcome.state === "would-prepare" ? samples : [] });
              previewOnly.add(String(node.id));
              continue;
            }
            const raw = await withBrowserActionNotes(clock, () => deps.writeSequencer!.executeTransaction({
              descriptor, node, run: getRun(), claim,
              scope: transactionScope,
              dryRun: envelope.dryRun, captureLog,
              signal: input.signal,
            }), (actions) => drainBrowserActions(runSpanIdentity.spanPath, actions.filter(action => action.kind !== "screenshot")),
                action => { if (action.kind === "screenshot") drainBrowserActions(runSpanIdentity.spanPath, [action], node.commit.uses.id); });
            const OutcomeSchema = z.strictObject({
              disposition: z.enum(["committed", "already-present"]),
              proofSource: z.enum([
                "normal-output", "recovery-probe", "operator-attestation", "durable-intent", "live-probe",
              ]),
              output: node.commit.uses.output,
              proof: JsonValueSchema,
            });
            const settled = JsonValueSchema.parse(OutcomeSchema.parse(raw));
            outputs[String(node.id)] = settled;

            // A transaction terminal dependency refers to its durable outcome wrapper, not its declared inner output.
            const stored = readRunCheckpoint(deps.authority.authority, envelope, String(node.id));
            if (stored === undefined) {
              throw new Error(
                `transaction node "${node.id}" settled but run ${runId} has no durable checkpoint for it; `
                + "beat ⑦ writes one in the same authority transaction as the settlement",
              );
            }
            const record = stored;
            const storedOutcome = TransactionOutcomeSchema.parse(record.output.value);
            const projected = JsonValueSchema.parse(OutcomeSchema.parse({
              disposition: storedOutcome.disposition,
              proofSource: storedOutcome.proofSource,
              output: storedOutcome.output.value,
              proof: storedOutcome.proof.value,
            }));
            if (canonicalJsonStringify(projected) !== canonicalJsonStringify(settled)) {
              throw new Error(
                `transaction node "${node.id}" durable checkpoint does not carry the settlement `
                + `the sequencer reported for run ${runId}`,
              );
            }
            checkpointRecords.set(String(node.id), record);
          } catch (error) {
            if (error instanceof RunAbandonedError) throw error;
            if (error instanceof WriteParkedError) {

              const parked = getRun();
              if (parked.lifecycle.state !== "parked-write"
                || parked.lifecycle.writeIntentId !== error.writeIntentId
                || parked.lifecycle.intentGeneration !== error.intentGeneration) {
                throw new Error(
                  `transaction node "${node.id}" raised WriteParkedError for intent ${error.writeIntentId} `
                  + `generation ${String(error.intentGeneration)}, but run ${runId} is `
                  + `"${parked.lifecycle.state}" in authority; the park signal does not match durable state`,
                  { cause: error },
                );
              }
              return RunExecutionOutcomeSchema.parse({
                state: "parked-write",
                runId,
                writeIntentId: error.writeIntentId,
                intentGeneration: error.intentGeneration,
                code: error.parkCode,
              });
            }
            // An attempting intent means the failure came after the fence: keep the claim for recovery, never pause or fail.
            // Once recovery has taken the claim, the claim check abandons the run instead.
            if (deps.authority.withAuthorityTransaction?.(repositories =>
              repositories.writeIntents.listByRun(runId).some(intent => intent.status === "attempting")) === true) {
              requireOriginalClaim(getRun());
              throw error;
            }
            interruptBeforeFence(node.id);
            return await failNode(node, node.commit.uses.id, error);
          }
          continue;
        }
        case "child-run": {
          const parallel = nodes.find(candidate => candidate.kind === "parallel"
            && candidate.branches.some(branch => branch.nodes.includes(node.id)));
          const owner = parallel?.kind === "parallel" ? parallel : node;
          transitionTo(runningLifecycle(owner.id));
          const unresolved = deps.authority.withAuthorityTransaction?.(repositories =>
            repositories.writeIntents.listAttemptingByItem({ workflowId: envelope.workflow, itemId: envelope.itemId })[0]
              ?? repositories.writeIntents.listByRun(runId).find(intent => intent.status === "parked"));
          if (unresolved !== undefined) {
            const current = getRun();
            const recovery = deps.lifecycle.requeue({ commandId: lifecycleCommandId("delegation-write-recovery", { runId, version: current.version }),
              runId, expectedVersion: current.version, claim, cause: "recovery" });
            if (recovery.state !== "recovery-required" || recovery.writeIntentId !== unresolved.writeIntentId
              || recovery.intentGeneration !== unresolved.generation) throw new Error("delegation-write-recovery-unproved");
            const parked = getRun();
            if (!recovery.parked || parked.lifecycle.state !== "parked-write" || parked.lifecycle.writeIntentId !== unresolved.writeIntentId
              || parked.lifecycle.intentGeneration !== unresolved.generation || runClaim(parked) !== undefined) throw new Error("delegation-write-recovery-unproved");
            await deps.sessions.closeAll("parked");
            return RunExecutionOutcomeSchema.parse({ state: "parked-write", runId, writeIntentId: parked.lifecycle.writeIntentId,
              intentGeneration: parked.lifecycle.intentGeneration, code: parked.lifecycle.code });
          }
          if (deps.childRuns === undefined) {
            return await failNode(owner, undefined, new Error(
              `child-run node "${node.id}" requires the delegation executor seam, which is not wired `
              + "(capability-unavailable); refusing to skip a delegation",
            ));
          }
          try {
            await deps.sessions.closeAll("parked");
            if (input.signal.aborted) throw abortReason(`run ${runId} was aborted before ${node.id}`);
            checkCancellation();
            requireOriginalClaim(getRun());
            const sourceEvidence = childSourceEvidence(node);
            let raw: unknown;
            if (sourceEvidence !== undefined) raw = resolveDelegationEvidenceOutput(sourceEvidence, node.target.result, deps.authority.evidenceSchemaHash?.bind(deps.authority)).output;
            else if (childBatchOutputs.has(node.id)) raw = childBatchOutputs.get(node.id);
            else {
              const leafIds = owner.kind === "child-run" ? [owner.id] : owner.branches.flatMap(branch => branch.nodes);
              const leaves = leafIds.flatMap(id => {
                const leaf = nodes.find(candidate => candidate.id === id);
                if (leaf?.kind !== "child-run") return [];
                childSourceEvidence(leaf);
                return [{ node: leaf, scope: scopeFor(leaf.dependsOn) }];
              });
              const returned = await deps.childRuns.executeChildRuns({ descriptor, owner, run: getRun(), claim, leaves, signal: input.signal });
              if (DelegationPendingSchema.safeParse(returned).success) raw = returned;
              else {
                const values = z.record(z.string(), JsonValueSchema).parse(returned);
                for (const [id, value] of Object.entries(values)) childBatchOutputs.set(id, value);
                raw = childBatchOutputs.get(node.id);
              }
            }
            if (input.signal.aborted) throw abortReason(`run ${runId} was aborted during ${node.id}`);
            const pending = DelegationPendingSchema.safeParse(raw);
            if (pending.success) {
              if (entry.mode === "replay-child") throw new RunContinuationRefusedError("run-gate-resume-child-unsettled");
              const released = getRun();
              if (pending.data.runId !== runId || released.lifecycle.state !== "queued" || runClaim(released) !== undefined
                || pendingInterruptOf(released) === "stop-requested" || Number(released.claimGeneration) !== Number(claim.claimGeneration)) throw new Error("delegation-release-unproved");
              const manifest = deps.authority.withAuthorityTransaction?.(repositories => {
                const wait = repositories.dependencies.wait(runId, descriptor);
                if (wait?.admissionCommandId !== pending.data.admissionCommandId || wait.nodeId !== owner.id
                  || !wait.manifests.some(manifest => manifest.manifestId === pending.data.manifestId)) throw new Error("delegation-release-authority-unavailable");
                const manifest = repositories.delegationManifests.get(pending.data.manifestId);
                if (manifest === undefined || manifest.parentRunId !== runId || !nodes.some(candidate => candidate.kind === "child-run" && candidate.edgeId === manifest.edgeId
                  && (owner.kind === "child-run" ? candidate.id === owner.id : owner.branches.some(branch => branch.nodes.includes(candidate.id))))) throw new Error("delegation-release-manifest-unavailable");
                repositories.dependencies.readiness(runId, "join");
                return manifest;
              });
              if (manifest === undefined || owner.kind === "child-run" && node.await === "none") throw new Error("delegation-release-authority-unavailable");
              await deps.sessions.closeAll("parked");
              return RunExecutionOutcomeSchema.parse({ ...pending.data, state: "yielded-delegation" });
            }
            pauseAtBoundary();
            requireOriginalClaim(getRun());
            const resolved = deps.authority.withAuthorityTransaction?.(repositories => {
              assertAccounting();
              deps.lifecycle.assertCurrentExecution({ runId, claim });
              const evidence = sourceEvidence ?? repositories.dependencies.evidence(runId, node.id);
              if (entry.mode === "replay-child" && canonicalJsonStringify(evidence) !== canonicalJsonStringify(entry.evidence))
                throw new RunContinuationRefusedError("run-gate-resume-child-authority-changed");
              const resolution = resolveDelegationEvidenceOutput(evidence, node.target.result, deps.authority.evidenceSchemaHash?.bind(deps.authority));
              if (canonicalJsonStringify(raw) !== canonicalJsonStringify(resolution.output)) throw new Error("delegation-outcome-value-mismatch");
              return { evidence, resolution };
            });
            if (resolved === undefined) throw new Error("delegation-outcome-authority-unavailable");
            const { evidence, resolution } = resolved;
            childResultEvidence.set(String(node.id), evidence);
            if (resolution.kind === "preview") {
              if (!envelope.dryRun) throw new Error("delegation-preview-dry-run-required");
              previewOnly.add(String(node.id));
              dryRunSteps.set(String(node.id), { nodeId: node.id, state: "delegation-preview" });
              continue;
            }
            outputs[String(node.id)] = JsonValueSchema.parse(resolution.output);
            // A settled join reads done, or not needed when it bound no members, once per manifest; its dry-run and dependency accounting stay resolved.
            const joinSpanPath = `${envelope.traceId}/${node.id}#join-${evidence.manifest.manifestId}`;
            if (entry.mode !== "replay-child" && evidence.manifest.join !== "none" && !spanEnded(joinSpanPath)) {
              emitSettledSpan(node, evidence.manifest.children.length === 0 ? CONDITION_SKIP : { outcome: "done" }, joinSpanPath);
            }
          } catch (error) {
            if (error instanceof RunAbandonedError || error instanceof WorkerSessionClosureUnprovedError
              || error instanceof RunLifecycleRefusedError && error.outcome.state === "refused" && error.outcome.refusal.reason === "lost") throw error;
            if (runClaim(getRun())?.claimGeneration !== claim.claimGeneration) throw error;
            deps.lifecycle.assertCurrentExecution({ runId, claim });
            return await failNode(owner, undefined, error);
          }
          continue;
        }
      }
    }

    // The last node's boundary: an abort pauses, cancels or abandons the run instead of settling it done.
    if (input.signal.aborted) throw abortReason(`run ${runId} was aborted before its terminal settlement`);
    assertAccounting();
    if (envelope.dryRun) {
      const support = workflowDryRunSupport(descriptor);
      if (support.state === "supported") {
        const steps = AnyRunPreviewStepSchema.array().parse(nodes.map(node => dryRunSteps.get(String(node.id))));
        return settleSuccess(getRun(), buildRunPreviewResult(descriptor, getRun(), steps,
          dependencyEvidenceFor(workflowPreviewDependencyIds(descriptor, steps), "dry-run preview"), clock, deps.authority.evidenceSchemaHash?.bind(deps.authority)));
      }
      if (envelope.parent === undefined || support.reason !== "no-transaction-node") throw new Error("dry-run preview has no supported preparation boundary");
    }
    const terminal = workflowTerminalResultExecution(descriptor);
    const current = getRun();
    return settleSuccess(current, buildRunResult(
      descriptor,
      current,
      [...dependencyEvidenceFor(terminal.dependsOn, "terminal"), ...[...childResultEvidence.values()].filter(entry => !terminal.dependsOn.includes(entry.nodeId))],
      clock,
      deps.authority.evidenceSchemaHash?.bind(deps.authority),
    ));
  };

  const handleInterruption = (error: unknown):
    { state: "handled"; outcome: RunExecutionOutcome } | { state: "unhandled"; failure: unknown } => {
    let failure = error;
    // An aborted run settles a requested pause or cancellation from durable state; any other abort abandons.
    if (input.signal.aborted && failure instanceof RunAbandonedError && !(failure instanceof RunPauseRequestedError)) {
      try {
        const current = getRun(); requireOriginalClaim(current); checkCancellation(); checkPause(current);
        // Resume withdrew the pause that stopped this step: release the run to continue from its checkpoint.
        if (input.signal.reason instanceof RunControlAbortError) throw new RunPauseRequestedError("resumed");
      } catch (control) { failure = control; }
    }
    if (failure instanceof RunTerminalAdmissionLostError) {
      const admissionVersion = failure.admissionVersion;
      try {
        checkCancellation();
        const acknowledged = deps.authority.withAuthorityTransaction?.(repositories => {
          const current = getRun();
          requireOriginalClaim(current);
          if (pendingInterruptOf(current) === "stop-requested" || !authenticateDelegationRetryPause(repositories, descriptor, current, admissionVersion)) return false;
          requireLifecycleApplied(deps.lifecycle.acknowledgePause({
            commandId: lifecycleCommandId("executor-pause", { runId, generation: claim.claimGeneration, commandId: current.pause?.commandId }),
            runId, claim,
          }));
          return true;
        });
        if (acknowledged) return { state: "handled", outcome: RunExecutionOutcomeSchema.parse({ state: "abandoned", runId, reason: "paused" }) };
      } catch (admissionFailure) { failure = admissionFailure; }
    }
    if (failure instanceof RunPauseRequestedError) {
      try {
        checkCancellation();
        const current = getRun();
        requireOriginalClaim(current);
        const released = requireLifecycleApplied(deps.lifecycle.acknowledgePause({
          commandId: lifecycleCommandId("executor-pause", { runId, generation: claim.claimGeneration, ...(current.pause === undefined ? {} : { commandId: current.pause.commandId }) }),
          runId, claim,
        }));
        return { state: "handled", outcome: RunExecutionOutcomeSchema.parse({ state: "abandoned", runId, reason: released.pause === undefined ? "resumed" : "paused" }) };
      } catch (pauseFailure) { failure = pauseFailure; }
    }
    // A command can commit cancellation between a boundary read and terminal admission.
    // Settle it here, after any enclosing evidence transaction has unwound.
    if (failure instanceof RunLifecycleRefusedError) {
      try { checkCancellation(); } catch (cancellation) { failure = cancellation; }
    }
    if (failure instanceof RunAbandonedError || (failure instanceof RunLifecycleRefusedError
      && failure.outcome.state === "refused" && failure.outcome.refusal.reason === "lost")) {
      return { state: "handled", outcome: RunExecutionOutcomeSchema.parse({ state: "abandoned", runId, reason: failure.message }) };
    }
    return { state: "unhandled", failure };
  };

  try {
    return await interpret();
  } catch (error) {
    const interrupted = handleInterruption(error);
    if (interrupted.state === "handled") return interrupted.outcome;
    const failure = interrupted.failure;
    if (failure instanceof RunContinuationRefusedError) {
      try {
        return await terminalizeAsFailure(buildEntryValidationFailureRecord({
          run: getRun(), failureId: deps.ids.uuid(), code: failure.code, problems: [failure.message], occurredAt: instant(),
        }));
      } catch (terminalFailure) {
        const terminal = handleInterruption(terminalFailure);
        if (terminal.state === "handled") return terminal.outcome;
        throw terminal.failure;
      }
    }
    throw failure;
  }
}
