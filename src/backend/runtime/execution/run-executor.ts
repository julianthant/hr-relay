import { parseCanonicalInputSnapshot } from "../../../models/workflow/canonical-input.js";
import { ConfigSnapshotRecordSchema } from "../../../models/config/snapshot.js";
import { SETTINGS_CATALOG } from "../../../models/config/catalog.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { commitGeneratedCheckpoint, generatedUpdateId, pendingGeneratedUpdateIds, projectGeneratedUpdates } from "../../logs/generated-artifact-projection.js";
import { timelineCheckpointReference } from "../../../models/events/timeline.js";
import { localDatePart } from "../../../rules/time/clock.js";
import { retainedRunProtectedBindings } from "../../../models/write-safety/protected-input.js";
import { readRunCheckpoint } from "../checkpoints/run-checkpoint-reader.js";
import type { GateSourceRuntime } from "../gates/gate-source-runtime.js";
import { shouldRetryTaskFailure } from "../policies/task-retry.js";

import { z } from "zod";
import { CURRENT_DIAGNOSTIC_SAFETY_VERSION } from "../../../models/trust/failure.js";
import type { ContentAddressedArtifactWriter } from "../../../workflow-kit/artifacts.js";
import type { RunDiagnosticCapture } from "../../../workflow-kit/diagnostics.js";
import { browserLoginFailure } from "../../systems/browser-shared/login-contract.js";
import { TaskError, taskErrorCause, wrapUnhandledTaskError } from "../../../workflow-kit/errors.js";
import type { ProviderClient } from "../../../workflow-kit/providers.js";
import type { AnyTask, TaskLogger, ConfirmedTaskActions } from "../../../workflow-kit/task.js";
import type { TaskStoreRegistry } from "../../../workflow-kit/task-registry.js";
import { descriptorRuntimeNodes, workflowTerminalResultExecution, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { JsonValueSchema, canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { JsonValue } from "../../../rules/validation/canonical-json.js";
import { TransactionDryRunPreviewSchema, TransactionOutcomeSchema, type TransactionDryRunPreview } from "../../../rules/write-safety/write-safety-primitives.js";
import type { Clock } from "../../../rules/time/clock.js";
import type { AnyReadTaskContract } from "../../../models/task/task-contract.js";
import type { GateResultRecord } from "../../../models/workflow/gates.js";
import type { IdFactory } from "../../../rules/identity/identifiers.js";
import type { NoteTimelineWriter } from "../../storage/events/note-timeline-writer.js";
import type { ConfirmedActionPublisher } from "../../logs/confirmed-action-publisher.js";
import { createConfirmedInvocation } from "../../logs/confirmed-invocation.js";
import { publishConfirmedSubmit } from "../../logs/confirmed-submit.js";
import { drainBrowserActionNotes } from "../../logs/browser-action-drain.js";
import { withBrowserActionBinding, withBrowserActionNotes, type BrowserAction, type BrowserActionBinder } from "../../systems/browser-shared/action-notes.js";
import type { TaskId } from "../../../rules/identity/ids.js";
import { GateIdSchema, IsoInstantSchema, NodeIdSchema, ProviderCapabilityIdSchema, TaskIdSchema } from "../../../rules/identity/ids.js";
import type { Fingerprint, IsoInstant, NodeId, ProviderCapabilityId } from "../../../rules/identity/ids.js";
import { RunLifecycleSchema, RunRecordSchema, runClaim, type RunLifecycle, type RunRecord } from "../../../models/run/record.js";
import type { RunResultRecord, TerminalDependencyEvidence } from "../../../models/run/result.js";
import type { SessionNeed } from "../../../models/sessions/session.js";
import { FailureRecordSchema, type FailureRecord } from "../../../models/trust/failure.js";
import { BUILD_MANIFEST, resolveTaskImplFingerprint } from "../../../workflow-kit/validation/build-manifest.js";
import { auditCheckpointFreshness, CheckpointExpectationSchema, loadCheckpoint, RunCheckpointRecordSchema, type CheckpointPatch, type ReplayedCheckpoint, type RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import { applyCheckpointPatches } from "../checkpoints/checkpoint-patch.js";
import { deriveArtifactProjectionRows } from "../../../models/workflow/artifact-projection.js";
import { childRunOutcomeSchema, DelegationManifestRefSchema } from "../../../models/workflow/graph.js";
import type { RuntimeFlowNode, RuntimeScope } from "../../../models/workflow/graph.js";
import { evaluateNodeCondition } from "../../../models/workflow/node-condition.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { planStepOmissions } from "../../../models/workflow/step-omission.js";
import { requireWorkflowOperationDisplaySnapshot } from "../../../models/workflow/operation-display-snapshot.js";
import { jsonLeafPaths } from "../../runs/provenance/task-provenance.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import { RunClaimTokenSchema, type RunClaimToken } from "../../storage/sqlite/run-store-contracts.js";
import { WriteIntentParkCodeSchema, type WriteIntentParkCode } from "../../storage/sqlite/write-commit-contracts.js";
import type { MonotonicDeadlineScheduler } from "../scheduling/deadline-scheduler.js";
import { createProviderClient, type ProviderAdapterRegistry, type ProviderClientDependencies, type ProviderRequestIdFactory } from "../../processing/providers/provider-client.js";
import { buildEntryValidationFailureRecord, buildNodeFailureRecord } from "./run-failure.js";
import { buildRunPreviewResult, buildRunResult } from "../../runs/lifecycle/run-result.js";
import { ExecutorSpanEventSchema, runSpanPath, taskSpanPath, type SpanEmitter } from "../../logs/span-emitter.js";
import { redactObservedDataPoints } from "../../logs/observed-data.js";
import { createTaskProvenanceCollector } from "../../runs/provenance/task-provenance.js";
import { RunResultRecordSchema } from "../../../models/run/result.js";
import { createDeclaredActionBinder } from "../writes/operation-action-binding.js";
import { buildTerminalAuthorization } from "../../runs/lifecycle/terminal-authorization.js";
import { lifecycleCommandId, requireLifecycleApplied, RunLifecycleRefusedError, type WorkerRunLifecyclePort } from "../../runs/lifecycle/run-record-service.js";
import type { WorkerSessionManager } from "../workers/worker-sessions.js";

/* ── injected seams ──────────────────────────────────────────────────────── */

/** The authority surface a run execution needs; `AuthorityDatabase` satisfies it. */
export interface RunExecutionAuthority {
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
  readonly signal: AbortSignal;
  /** Synchronous in-memory handoff after beat ⑦; consumers publish after the sequencer returns. */
  readonly onDurableCommit?: (proof: Readonly<{ writeIntentId: string; confirmedAt: string; proofDigest: string }>) => void;
  readonly onSavedEffectVerified?: (proof: Readonly<{ proofDigest: string }>) => void;
  readonly onDiagnosticDeliveryFailure?: () => void;
  readonly confirmedForRole?: (role: "probe" | "prepare" | "verify", taskId: string, parsedInput: unknown) => ConfirmedTaskActions | undefined;
  readonly operationReadBinder?: (role: "probe" | "verify", taskId: string, parsedInput: unknown) => BrowserActionBinder;
  /** Pure completed-gesture binders; persistence remains outside the write fence. */
  readonly operationActionBinders?: Readonly<{
    probe?: BrowserActionBinder;
    prepare?: BrowserActionBinder;
    commit?: BrowserActionBinder;
    verify?: BrowserActionBinder;
  }>;
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

export interface ChildRunExecutor {
  executeChildRun(context: ChildRunContext): Promise<unknown>;
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
    case "geocode.census": return createProviderClient(capability, dependencies);
    case "geocode.nominatim": return createProviderClient(capability, dependencies);
  }
}

export interface RunExecutorDependencies {
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
  readonly confirmedActionPublisher?: ConfirmedActionPublisher;
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
  | Readonly<{ mode: "replay"; record: RunCheckpointRecord }>
  | Readonly<{ mode: "skipped-condition" }>

  | Readonly<{ mode: "asserted"; replay?: RunCheckpointRecord }>

  | Readonly<{ mode: "omitted" }>
  | Readonly<{ mode: "replay-gate" }>;

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
  const operationDisplaySnapshot = envelope.operationDisplaySnapshot === undefined
    ? undefined
    : requireWorkflowOperationDisplaySnapshot(envelope.operationDisplaySnapshot, {
      workflowId: envelope.workflow,
      definitionFingerprint: envelope.contractFingerprint,
    });
  if (descriptor.operationDisplay?.capability === "complete" && operationDisplaySnapshot === undefined) {
    throw new Error(`complete run ${envelope.workflow} is missing its frozen operation display snapshot`);
  }
  if (descriptor.operationDisplay?.capability !== "complete" && operationDisplaySnapshot !== undefined) {
    throw new Error(`legacy run ${envelope.workflow} cannot carry a complete operation display snapshot`);
  }
  if (initial.lifecycle.state !== "claimed") {
    throw new Error(`run ${runId} is ${initial.lifecycle.state}; the executor starts from a fresh claim`);
  }
  const claimedAt = initial.lifecycle.claimedAt;
  const workerLifetime = initial.lifecycle.workerLifetime;
  z.number().int().positive().parse(deps.taskDeadlineMs);

  const nodes = descriptorRuntimeNodes(descriptor);
  const configurationValues: Record<string, JsonValue> = {};
  const configurationKeys = descriptor.operationDisplay?.capability === "complete"
    ? descriptor.operationDisplay.transforms.flatMap((transform) => transform.inputs.flatMap((source) => source.value.kind === "configuration" ? [source.value.key] : [])) : [];
  if (configurationKeys.length > 0) {
    const stored = deps.authority.authority.configSnapshots?.get(envelope.configSnapshotId);
    if (stored === undefined) throw new Error("declared-action-transform-config-snapshot-unavailable");
    const snapshot = ConfigSnapshotRecordSchema.parse(stored);
    if (snapshot.configSnapshotId !== envelope.configSnapshotId || snapshot.fingerprint !== envelope.configFingerprint
      || sha256Hex(canonicalJsonStringify(snapshot.config)) !== snapshot.fingerprint) throw new Error("declared-action-transform-config-snapshot-mismatch");
    for (const key of configurationKeys) {
      if (!SETTINGS_CATALOG.some((row) => row.key === key && row.sensitivity === "ordinary")) throw new Error("declared-action-transform-config-source-not-ordinary");
      let value: unknown = snapshot.config;
      for (const segment of key.split(".")) value = value !== null && typeof value === "object" ? Reflect.get(value, segment) : undefined;
      if (value === undefined) throw new Error("declared-action-transform-configuration-unavailable");
      configurationValues[key] = JsonValueSchema.parse(value);
    }
  }


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
    ...(workerLifetime === undefined ? {} : { workerLifetime }),
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
      publisher: deps.confirmedActionPublisher,
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
    if (current.cancelRequested !== true) return;
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
    try {
    const bound = prepared === undefined
      ? failure
      : FailureRecordSchema.parse({ ...failure, diagnosticBundleId: prepared.bundleId });
    checkCancellation();
    const current = getRun();
    requireOriginalClaim(current);
    const authorization = buildTerminalAuthorization({
      run: current,
      authorizedAt: instant(),
      consequence: { kind: "failed", failure: bound },
    });
    if (prepared === undefined || capture === undefined) {
      requireLifecycleApplied(deps.lifecycle.terminalize({ kind: "failure",
        commandId: lifecycleCommandId("failure", { runId, failureId: bound.failureId }),
        terminal: { failure: bound, authorization },
      }, descriptor));
    } else if (deps.authority.withAuthorityTransaction === undefined) {
      throw new Error(
        `run ${runId} has a diagnostic capture port but no authority transaction to settle its bundle with the failure`,
      );
    } else {
      deps.authority.withAuthorityTransaction(() => {
        requireLifecycleApplied(deps.lifecycle.terminalize({ kind: "failure",
          commandId: lifecycleCommandId("failure", { runId, failureId: bound.failureId }),
          terminal: { failure: bound, authorization },
        }, descriptor));
        capture.persist(prepared);
      });
    }
    return RunExecutionOutcomeSchema.parse({ state: "failed", runId, failureId: bound.failureId });
    } catch (error) {
      if (prepared !== undefined && capture !== undefined) {
        try { capture.discard(prepared); } catch (cleanup) { throw new AggregateError([error, cleanup], "diagnostic-failure-settlement-disposal-failed", { cause: cleanup }); }
      }
      throw error;
    }
  };

  const interpret = async (): Promise<RunExecutionOutcome> => {
    /* ── validating: ref workflow-model entry validation, before any browser ────── */
    transitionTo({ state: "validating", workerId: claim.workerId, ...(workerLifetime === undefined ? {} : { workerLifetime }), claimedAt, heartbeatAt: instant() });

    const problems: string[] = [];
    let canonicalInput: JsonValue | undefined;
    try {
      canonicalInput = JsonValueSchema.parse(parseCanonicalInputSnapshot(descriptor.canonicalInput, initial.input.parsed));
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
    const childResultEvidence = new Map<string, Extract<TerminalDependencyEvidence, { state: "child-resolved" }>>();
    const childSources: NonNullable<Parameters<typeof createDeclaredActionBinder>[0]["childSources"]> = new Map();
    const actionSources: NonNullable<Parameters<typeof createDeclaredActionBinder>[0]["sources"]> = new Map();
    const hydrateActionSources = (record: RunCheckpointRecord): void => {
      for (const source of record.operationSources ?? []) {
        if (source.identity.runId !== record.runId || source.identity.nodeId !== record.nodeId
          || source.identity.attempt !== record.attempt || source.identity.claimGeneration !== record.claimGeneration
          || source.identity.definitionFingerprint !== record.contractFingerprint) throw new Error("checkpoint-operation-source-identity-mismatch");
        let value: unknown = record.output.value;
        for (const segment of source.path.split(".")) value = value !== null && typeof value === "object" ? Reflect.get(value, segment) : undefined;
        if (value === undefined) throw new Error("checkpoint-operation-source-field-unavailable");
        actionSources.set(`${record.nodeId}/${source.path}`, { identity: source.identity, value: JsonValueSchema.parse(value) });
      }
    };
    const replayedForFreshness: ReplayedCheckpoint[] = [];
    const skippedReasons = new Map<string, "condition-false" | "branch-not-selected" | "step-omitted">();

    const assertedRecords = new Map<string, Readonly<{ step: string; assertedAt: IsoInstant; output: Readonly<{ schemaHash: Fingerprint; value: JsonValue }> }>>();


    const childUpstreamEvidenceFor = (nodeId: NodeId) => {
      const child = childResultEvidence.get(String(nodeId));
      if (child === undefined) return undefined;
      const result = RunResultRecordSchema.parse(child.result);
      const results: RunResultRecord[] = [];
      const checkpoints: RunCheckpointRecord[] = [];
      const visited = new Set<string>();
      const visit = (record: RunResultRecord): void => {
        if (visited.has(record.runId) || visited.size >= 16) throw new Error("child-upstream-cycle-or-depth");
        visited.add(record.runId); results.push(record);
        for (const dependency of record.dependencies) {
          if (dependency.state === "resolved") {
            const address = dependency.checkpoint;
            const checkpoint = deps.authority.authority.runCheckpoints.get(address.workflowId, address.itemId, dependency.nodeId, address.attempt, address.claimGeneration);
            if (checkpoint === undefined || checkpoints.length >= 256) throw new Error("child-upstream-checkpoint-unavailable-or-limit");
            checkpoints.push(checkpoint);
          } else if (dependency.state === "child-resolved") {
            const nested = deps.authority.authority.runResults.get(dependency.child.runId);
            const nestedRun = deps.authority.authority.runs.get(dependency.child.runId);
            if (nested === undefined || (nestedRun?.lifecycle.state !== "terminal" || nestedRun.lifecycle.outcome !== "done") || nestedRun.envelope.parent?.runId !== record.runId || nestedRun.envelope.parent.edgeId !== dependency.edgeId) throw new Error("child-upstream-canonical-descendant-mismatch");
            visit(RunResultRecordSchema.parse(nested));
          }
        }
      };
      visit(result);
      return { nodeId, parentRunId: child.parentRunId, edgeId: child.edgeId, result, results, checkpoints };
    };

    const dependencyEvidenceFor = (
      nodeIds: readonly NodeId[],
      purpose: string,
    ): readonly TerminalDependencyEvidence[] => nodeIds.map((dependency) => {
      const child = childResultEvidence.get(String(dependency));
      if (child !== undefined) return child;
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
      requireLifecycleApplied(deps.lifecycle.terminalize({ kind: "success",
        commandId: lifecycleCommandId("success", { runId, resultDigest: built.record.resultDigest }),
        terminal: { result: built.record, authorization },
      }, descriptor, built.authorization));
      return RunExecutionOutcomeSchema.parse({ state: "done", runId });
    };


    const settlePreview = (
      node: TransactionRuntimeNode,
      preview: TransactionDryRunPreview,
    ): RunExecutionOutcome => {
      const current = getRun();
      return settleSuccess(current, buildRunPreviewResult(
        descriptor,
        current,
        preview,
        dependencyEvidenceFor(
          node.dependsOn.map((nodeId) => NodeIdSchema.parse(nodeId)),
          "dry-run preview",
        ),
        clock,
      ));
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
      return { input: canonicalInput, outputs: Object.freeze(picked), configuration: Object.freeze(configurationValues),
        protectedInputBindings: retainedRunProtectedBindings(getRun()) };
    };

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

    const checkpointExpectation = (node: TaskRuntimeNode) => CheckpointExpectationSchema.parse({
      descriptorVersion: descriptor.version,
      contractFingerprint: descriptor.contractFingerprint,
      implFingerprint: resolveTaskImplFingerprint(BUILD_MANIFEST, node.uses.id),
      outputSchemaHash: deriveSchemaHash(node.uses.output, "output"),
    });

    // An explicit start node requires every ancestor to resolve without executing it.
    let ancestorRegionOpen = canonicalInput !== undefined;
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
      const explicit = startIndex !== undefined;
      const inAncestorRegion = explicit ? index < (startIndex ?? 0) : ancestorRegionOpen;
      if (!inAncestorRegion) {
        plan.set(String(node.id), { mode: "execute" });
        continue;
      }
      if (node.kind === "task") {
        if (node.replay === "always-rerun") {
          // NEVER consult loadCheckpoint for an always-rerun node (§5.3).
          plan.set(String(node.id), { mode: "execute" });
          continue;
        }
        let conditionKnown = true;
        for (const dependency of node.dependsOn) {
          const dependencyEntry = plan.get(String(dependency));
          if (dependencyEntry === undefined || dependencyEntry.mode === "execute" || dependencyEntry.mode === "asserted") {
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
        const stored = readRunCheckpoint(deps.authority.authority, envelope, String(node.id), true);

        if ((envelope.recovery === "restart-from-start" || envelope.sourceBound !== undefined) && stored !== undefined && stored.runId !== runId) {
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
          const nodePatches = injectedByNode.get(String(node.id));
          let effective = record;
          if (nodePatches !== undefined) {
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
          plan.set(String(node.id), { mode: "replay", record: effective });
          outputs[String(node.id)] = JsonValueSchema.parse(effective.output.value);
          checkpointRecords.set(String(node.id), effective);
          hydrateActionSources(effective);
          replayedForFreshness.push({
            nodeId: node.id,
            taskId: node.uses.id,
            freshness: node.uses.freshness,
            provenance: effective.provenance,
          });
          continue;
        }
        if (explicit) {
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
          if (deps.authority.authority.gateResults.get(`${runId}:${node.id}`) !== undefined) {
            problems.push(`inapplicable gate "${node.id}" carries a stored operator result; evidence changed`);
            continue;
          }
          plan.set(String(node.id), { mode: "skipped-condition" });
          continue;
        }
        const stored = deps.authority.authority.gateResults.get(`${runId}:${node.id}`);
        if (stored !== undefined) {
          if (stored.runId !== runId || String(stored.gateId) !== String(node.id) || stored.result.schemaHash !== deriveSchemaHash(node.result, "output")) throw new Error(`gate "${node.id}" stored result binding changed`);
          outputs[String(node.id)] = JsonValueSchema.parse(node.result.parse(stored.result.value));
          plan.set(String(node.id), { mode: "replay-gate" });
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
        .filter((node) => plan.get(String(node.id))?.mode === "execute")
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
    ): Promise<RunExecutionOutcome> => terminalizeAsFailure(buildNodeFailureRecord({
      run: getRun(),
      failureId: deps.ids.uuid(),
      nodeId: node.id,
      ...(taskId === undefined ? {} : { taskId: TaskIdSchema.parse(taskId) }),
      error,
      occurredAt: instant(),
    }));

    const abortReason = (fallback: string): RunAbandonedError => new RunAbandonedError(
      input.signal.reason instanceof Error ? input.signal.reason.message : fallback,
    );

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
      return deps.authority.authority.gateResults.get(`${runId}:${nodeId}`);
    };

    const invokeTask = async (
      node: TaskRuntimeNode,
      task: AnyTask,
      scope: RuntimeScope,
      need: SessionNeed | undefined,
      capabilityWiring: TaskCapabilityWiring,
      spanPath: string,
      taskAttempt: number,
    ): Promise<RunCheckpointRecord> => {
      const contract: AnyReadTaskContract = node.uses;
      const bound: unknown = node.bind(scope);
      const parsedInput: unknown = contract.input.parse(bound);
      for (const [key, source] of actionSources) {
        const sourceNode = key.slice(0, key.indexOf("/"));
        const path = key.slice(key.indexOf("/") + 1);
        const checkpoint = checkpointRecords.get(sourceNode);
        if (source.identity.runId !== runId && nodes.some((candidate) => candidate.id === sourceNode && candidate.kind === "child-run")) continue;
        if (checkpoint === undefined || checkpoint.runId !== source.identity.runId || checkpoint.claimGeneration !== source.identity.claimGeneration
          || checkpoint.provenance.some((fact) => (fact.path === path || path.startsWith(`${fact.path}.`)) && fact.source !== "live")) actionSources.delete(key);
      }
      const registeredSystem = need === undefined ? undefined : task.driver?.system;
      if (need !== undefined && registeredSystem === undefined) throw new Error("confirmed-action-registered-driver-missing");
      const confirmedInvocation = operationDisplaySnapshot === undefined
        ? undefined
        : createConfirmedInvocation({ binding: {
          snapshot: operationDisplaySnapshot,
          runId,
          attempt: envelope.attempt,
          claimGeneration: claim.claimGeneration,
          taskAttempt,
          nodeId: String(node.id),
          taskId: contract.id,
          contractRole: "task",
          parsedInput: JsonValueSchema.parse(parsedInput),
          protectedBindings: retainedRunProtectedBindings(initial),
          sources: actionSources, childSources,
          ...(descriptor.operationDisplay?.capability === "complete" ? { transforms: descriptor.operationDisplay.transforms } : {}),
          runInput: canonicalInput, outputs, configurationValues,
          ...(envelope.parent === undefined
            ? {}
            : { childInvocation: { parentRunId: envelope.parent.runId, edgeId: envelope.parent.edgeId } }),
        }, clock, publisher: deps.confirmedActionPublisher, traceId: envelope.traceId,
          ...(registeredSystem === undefined
            ? { headlessSystem: contract.id.startsWith("workflow:") ? "workflow" as const : "service" as const }
            : { registeredDriverSystem: registeredSystem }),
          ...(initial.sessionId === undefined ? {} : { runSessionId: initial.sessionId }),
        });
      const declaredActionBinder = confirmedInvocation?.binder;
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
        ...(confirmedInvocation?.actions === undefined ? {} : { confirmed: confirmedInvocation.actions }),
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
          clients[capability] = admittedClientFor(capability, {
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
            observe: event => taskLogger.debug("provider request", { ...event, nodeId: String(node.id), taskId: contract.id }),
            clock,
            idFactory: provider.wiring.idFactory,
            deadlineScheduler: deps.scheduler,
          });
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
          raw = await (confirmedInvocation?.withNotes ?? ((operation, drain) => withBrowserActionNotes(clock, operation, drain)))(() => raceAbortable(
            Promise.resolve().then(() => withBrowserActionBinding(declaredActionBinder,
              () => run({ input: parsedInput, ctx: { ...ctxCommon, ...ctxExtras } }))),
            controller.signal, contract.id, retain,
          ), (actions) => drainBrowserActions(spanPath, actions));
        } else {
          const instanceSelection = envelope.resolvedInstance[need.system];
          if (instanceSelection === undefined) {
            throw new Error(
              `run ${runId} resolved no ${need.system} instance at enqueue, and ${contract.id} needs one`,
            );
          }
          raw = await (confirmedInvocation?.withNotes ?? ((operation, drain) => withBrowserActionNotes(clock, operation, drain)))(
            () => raceAbortable(
              deps.sessions.withDriver(need, instanceSelection, controller.signal, (driver, captureScreenshot) => raceAbortable(
                Promise.resolve().then(() => withBrowserActionBinding(
                  declaredActionBinder,
                  () => run({ input: parsedInput, ctx: { ...ctxCommon, ...ctxExtras, driver,
                    captureScreenshot: task.impl.screenshots === "task" ? captureScreenshot : () => Promise.reject(new TaskError(
                      contract.id, "BROWSER_SCREENSHOT_CAPTURE_FAILED", "Task screenshot capture requires declared task ownership",
                    )),
                  } }),
                )),
                controller.signal,
                contract.id, retain,
              ), task.impl.screenshots === "task" ? { taskId: contract.id, nodeId: String(node.id), attempt: envelope.attempt, log: taskLogger } : undefined),
              controller.signal,
              contract.id, retain,
            ),
            (actions) => drainBrowserActions(spanPath, actions, task.impl.screenshots === "task" ? contract.id : undefined),
          );
        }
      } finally {
        deadline.cancel();
        input.signal.removeEventListener("abort", forwardAbort);
      }


      const provenance = collector.finalizeRead(raw);
      const parsedOutput: unknown = contract.output.parse(raw);
      for (const [key, source] of actionSources) {
        if (!key.startsWith(`${node.id}/`)) continue;
        const path = key.slice(String(node.id).length + 1);
        let current: unknown = parsedOutput;
        for (const segment of path.split(".")) current = current !== null && typeof current === "object" ? Reflect.get(current, segment) : undefined;
        if (current === undefined || canonicalJsonStringify(current) !== canonicalJsonStringify(source.value)) actionSources.delete(key);
      }
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
        implFingerprint: resolveTaskImplFingerprint(BUILD_MANIFEST, contract.id),
        provenance: provenance.provenance,
        observationOrigins: provenance.points.flatMap(point => (point.origins ?? []).map(entry => ({ path: [...point.field.split("."), ...entry.path], origin: entry.origin }))),
        ...(operationDisplaySnapshot === undefined ? {} : { operationSources: [...actionSources].flatMap(([key, source]) =>
          key.startsWith(`${node.id}/`) && source.ambiguous !== true
            ? [{ path: key.slice(String(node.id).length + 1), identity: source.identity }] : []) }),
        writtenAt: instant(),
      });
    };

    const projectionsFor = (nodeId: string) =>
      (descriptor.artifactProjections ?? []).filter((spec) => String(spec.source.nodeId) === nodeId);

    // Only the exact source checkpoint may acknowledge its retained output updates.
    const resumePendingProjections = async (
      node: TaskRuntimeNode,
      record: RunCheckpointRecord,
    ): Promise<RunExecutionOutcome | undefined> => {
      const specs = projectionsFor(String(node.id));
      if (specs.length === 0) return undefined;
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
        try {
          const record = await invokeTask(node, task, scope, need, capabilityWiring, spanPath, taskAttempt);
          if (declaredProjections.length === 0) {
            deps.authority.authority.runCheckpoints.insert(record);
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

            commitGeneratedCheckpoint({withTransaction, checkpoint:record, updates:outboxRows});
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
          if (error instanceof RunAbandonedError) throw error;
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
          if (!retryable) return await failNode(node, contract.id, taskError);
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

    for (const [index, node] of nodes.entries()) {
      checkCancellation();
      if (input.signal.aborted) throw abortReason(`run ${runId} execution was aborted`);
      const entry = plan.get(String(node.id));
      if (entry === undefined) throw new Error(`node "${node.id}" has no execution plan entry`);
      if (entry.mode === "replay") {
        recordCheckpointReplay(String(node.id), entry.record);
        if (node.kind === "task") {
          const owed = await resumePendingProjections(node, entry.record);
          if (owed !== undefined) return owed;
        }
        continue;
      }
      if (entry.mode === "skipped-condition") {
        skippedReasons.set(String(node.id), "condition-false");
        continue;
      }
      if (entry.mode === "replay-gate") {
        if (node.kind !== "gate") throw new Error(`node "${node.id}" is not a gate but planned a gate replay`);
        const stored = deps.authority.authority.gateResults.get(`${runId}:${node.id}`);
        if (stored === undefined) throw new Error(`gate "${node.id}" stored result disappeared mid-execution`);
        const expectedHash = deriveSchemaHash(node.result, "output");
        if (stored.result.schemaHash !== expectedHash) {
          throw new Error(
            `gate "${node.id}" stored result is bound to schema ${stored.result.schemaHash}, `
            + `and this descriptor's gate schema is ${expectedHash}`,
          );
        }
        outputs[String(node.id)] = JsonValueSchema.parse(node.result.parse(stored.result.value));
        continue;
      }

      if (excludedByBranch(node)) {
        skippedReasons.set(String(node.id), "branch-not-selected");
        continue;
      }
      if (entry.mode === "omitted") {

        skippedReasons.set(String(node.id), "step-omitted");
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
          hydrateActionSources(replayed);
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
          implFingerprint: resolveTaskImplFingerprint(BUILD_MANIFEST, node.uses.id),
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

      switch (node.kind) {
        case "task": {
          transitionTo(runningLifecycle(node.id));
          const scope = scopeFor(node.dependsOn);
          if (node.when !== undefined) {
            const condition = evaluateNodeCondition(node.when, scope);
            if (!condition) {
              skippedReasons.set(String(node.id), "condition-false");
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

                notRunReason: "condition-false",
              });
              continue;
            }
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
            if (deps.authority.authority.gateResults.get(`${runId}:${node.id}`) !== undefined) {
              return await failNode(node, undefined, new Error(`inapplicable gate "${node.id}" carries a stored operator result; evidence changed`));
            }
            skippedReasons.set(String(node.id), "condition-false");
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
          const committedGestures: BrowserAction[] = [];
          const savedVerifications: BrowserAction[] = [];
          const roleInvocations = new Map<string, ReturnType<typeof createConfirmedInvocation>>();
          const confirmedRole = (role: "probe" | "prepare" | "verify", taskId: string, parsedInput: unknown) => {
            if (operationDisplaySnapshot === undefined) return undefined;
            const key = `${role}/${taskId}`;
            const previous = roleInvocations.get(key);
            if (previous !== undefined) return previous;
            const registeredDriverSystem = taskIndex.get(taskId)?.driver?.system;
            if (registeredDriverSystem === undefined) throw new Error(`confirmed-${role}-registered-driver-missing`);
            const invocation = createConfirmedInvocation({ binding: {
              snapshot: operationDisplaySnapshot, runId, attempt: envelope.attempt,
              claimGeneration: claim.claimGeneration, taskAttempt: 1,
              nodeId: String(node.id), taskId, contractRole: role,
              parsedInput: JsonValueSchema.parse(parsedInput),
              protectedBindings: retainedRunProtectedBindings(initial), sources: actionSources, childSources,
              ...(descriptor.operationDisplay?.capability === "complete" ? { transforms: descriptor.operationDisplay.transforms } : {}),
              runInput: canonicalInput, outputs, configurationValues,
              ...(envelope.parent === undefined ? {} : { childInvocation: { parentRunId: envelope.parent.runId, edgeId: envelope.parent.edgeId } }),
            }, clock, publisher: deps.confirmedActionPublisher, traceId: envelope.traceId,
              registeredDriverSystem,
              ...(initial.sessionId === undefined ? {} : { runSessionId: initial.sessionId }),
            });
            roleInvocations.set(key, invocation);
            return invocation;
          };
          const operationReadBinder = operationDisplaySnapshot === undefined ? undefined
            : (role: "probe" | "verify", taskId: string, parsedInput: unknown): BrowserActionBinder => {
              const bind = confirmedRole(role, taskId, parsedInput)!.observingBinder;
              return note => {
                const bound = bind(note);
                if (role === "verify" && bound.kind === "verified" && bound.operation?.state === "completed") savedVerifications.push(bound);
                return bound;
              };
            };
          const operationActionBinders = operationDisplaySnapshot === undefined
            ? undefined
            : {
              prepare: confirmedRole("prepare", node.prepare.uses.id, node.prepare.bind(transactionScope))!.observingBinder,
              commit: createDeclaredActionBinder({
                snapshot: operationDisplaySnapshot,
                runId,
                attempt: envelope.attempt,
                claimGeneration: claim.claimGeneration,
                taskAttempt: 1,
                nodeId: String(node.id),
                taskId: node.commit.uses.id,
                contractRole: "commit",
                parsedInput: JsonValueSchema.parse(node.commit.bind(transactionScope)),
                protectedBindings: retainedRunProtectedBindings(initial),
                sources: actionSources, childSources,
                ...(descriptor.operationDisplay?.capability === "complete" ? { transforms: descriptor.operationDisplay.transforms } : {}),
                runInput: canonicalInput, outputs, configurationValues,
                ...(envelope.parent === undefined
                  ? {}
                  : { childInvocation: { parentRunId: envelope.parent.runId, edgeId: envelope.parent.edgeId } }),
              }),
            };
          const trackedBinders = operationActionBinders === undefined ? undefined : {
            ...operationActionBinders,
            commit: (note: BrowserAction): BrowserAction => {
              const bound = operationActionBinders.commit(note);
              if (bound.kind === "clicked" && bound.operation?.state === "completed") committedGestures.push(bound);
              return bound;
            },
          };

          if (envelope.dryRun) {
            let preview: TransactionDryRunPreview;
            try {
              preview = TransactionDryRunPreviewSchema.parse(await withBrowserActionNotes(clock, () => deps.writeSequencer!.executeDryRun({
                descriptor, node, run: getRun(), claim,
                scope: transactionScope,
                dryRun: true,
                signal: input.signal,
                confirmedForRole: (role, taskId, parsedInput) => confirmedRole(role, taskId, parsedInput)?.actions,
                ...(trackedBinders === undefined ? {} : { operationActionBinders: trackedBinders }),
                ...(operationReadBinder === undefined ? {} : { operationReadBinder }),
              }), (actions) => drainBrowserActions(runSpanIdentity.spanPath, actions)));
            } catch (error) {
              if (error instanceof RunAbandonedError) throw error;
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
            return settlePreview(node, preview);
          }
          try {
            let durableCommitProof: Readonly<{ writeIntentId: string; confirmedAt: string; proofDigest: string }> | undefined;
            let savedEffectProof: Readonly<{ proofDigest: string; verifiers: readonly BrowserAction[] }> | undefined;
            const raw = await withBrowserActionNotes(clock, () => deps.writeSequencer!.executeTransaction({
              descriptor, node, run: getRun(), claim,
              scope: transactionScope,
              dryRun: envelope.dryRun,
              signal: input.signal,
              confirmedForRole: (role, taskId, parsedInput) => confirmedRole(role, taskId, parsedInput)?.actions,
              onDurableCommit: proof => { durableCommitProof = proof; },
              onSavedEffectVerified: proof => { savedEffectProof = { proofDigest: proof.proofDigest,
                verifiers: [...savedVerifications] }; },
              onDiagnosticDeliveryFailure: () => { deps.confirmedActionPublisher?.reportAppendFailure(); },
              ...(trackedBinders === undefined ? {} : { operationActionBinders: trackedBinders }),
                ...(operationReadBinder === undefined ? {} : { operationReadBinder }),
            }), (actions) => drainBrowserActions(runSpanIdentity.spanPath, actions));
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
            if (storedOutcome.disposition === "committed" && storedOutcome.proofSource === "normal-output"
              && deps.confirmedActionPublisher !== undefined && operationDisplaySnapshot !== undefined) {
              const system = taskIndex.get(node.commit.uses.id)?.driver?.system;
              if (system === undefined) throw new Error("confirmed-submit-registered-driver-missing");
              const verifierTaskId = node.commit.uses.writeSafety.completion.kind === "receipt"
                ? undefined : node.commit.uses.writeSafety.completion.verify.taskId;
              try { publishConfirmedSubmit({
                publisher: deps.confirmedActionPublisher,
                snapshot: operationDisplaySnapshot,
                system, commitTaskId: node.commit.uses.id, verifierTaskId,
                commits: committedGestures, verifiers: savedEffectProof?.verifiers ?? [],
                verifiedProofDigest: savedEffectProof?.proofDigest,
                durable: durableCommitProof, checkpointNodeId: String(node.id),
                checkpointProofDigest: sha256Hex(canonicalJsonStringify(storedOutcome.proof.value)),
                traceId: envelope.traceId,
                ...(initial.sessionId === undefined ? {} : { runSessionId: initial.sessionId }),
              }); }
              catch { deps.confirmedActionPublisher.reportProgramError(); }
            }
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
            return await failNode(node, node.commit.uses.id, error);
          }
          continue;
        }
        case "child-run": {
          transitionTo(runningLifecycle(node.id));
          if (deps.childRuns === undefined) {
            return await failNode(node, undefined, new Error(
              `child-run node "${node.id}" requires the delegation executor seam, which is not wired `
              + "(capability-unavailable); refusing to skip a delegation",
            ));
          }
          try {
            const raw = await deps.childRuns.executeChildRun({
              descriptor, node, run: getRun(), claim,
              scope: scopeFor(node.dependsOn),
              signal: input.signal,
            });
            const schema = node.await === "none"
              ? DelegationManifestRefSchema
              : node.cardinality === "one"
                ? childRunOutcomeSchema(node.target.result)
                : z.array(childRunOutcomeSchema(node.target.result));
            outputs[String(node.id)] = JsonValueSchema.parse(schema.parse(raw));
            if (node.await === "terminal" && node.cardinality === "one") {
              const outcome = childRunOutcomeSchema(node.target.result).parse(raw);
              if (outcome.state === "done" && (descriptor.operationDisplay?.capability === "complete" || deps.authority.authority.runs.get(outcome.runId) !== undefined)) {
                const child = deps.authority.authority.runs.get(outcome.runId);
                if ((child?.lifecycle.state !== "terminal" || child.lifecycle.outcome !== "done") || child.envelope.parent?.runId !== runId || child.envelope.parent.edgeId !== node.edgeId || child.envelope.itemId !== outcome.itemId || child.envelope.workflow !== node.target.id) throw new Error("child-output-source-parent-mismatch");
                const result = deps.authority.authority.runResults.get(outcome.runId);
                if (result === undefined) throw new Error("child-output-source-result-unavailable");
                if (result !== undefined) {
                  const retainedResult = RunResultRecordSchema.parse(result);
                  if (retainedResult.runId !== outcome.runId || retainedResult.contractFingerprint !== child.envelope.contractFingerprint
                    || retainedResult.workflowId !== child.envelope.workflow || retainedResult.attempt !== child.envelope.attempt
                    || retainedResult.descriptorVersion !== child.envelope.descriptorVersion
                    || retainedResult.resultSchemaHash !== deriveSchemaHash(node.target.result, "output")
                    || canonicalJsonStringify(retainedResult.result.value) !== canonicalJsonStringify(outcome.output)) throw new Error("child-output-source-result-mismatch");
                  childResultEvidence.set(String(node.id), { state: "child-resolved", nodeId: node.id, parentRunId: getRun().envelope.runId, edgeId: node.edgeId,
                    childRun: { runId: child.envelope.runId, itemId: child.envelope.itemId, workflowId: child.envelope.workflow, attempt: child.envelope.attempt,
                      descriptorVersion: child.envelope.descriptorVersion, contractFingerprint: child.envelope.contractFingerprint, lifecycle: "done" }, result: retainedResult });
                  for (const lineage of retainedResult.operationLineage ?? []) {
                    childSources.set(`${node.id}/${lineage.path}`, { result: { runId: retainedResult.runId, definitionFingerprint: retainedResult.contractFingerprint,
                      resultSchemaHash: retainedResult.resultSchemaHash, resultDigest: retainedResult.resultDigest, dependencyDigest: retainedResult.dependencyDigest }, inputs: lineage.inputs });
                  }
                  for (const source of retainedResult.operationSources ?? []) {
                    let value: unknown = outcome.output;
                    for (const segment of source.path.split(".")) value = value !== null && typeof value === "object" ? Reflect.get(value, segment) : undefined;
                    if (value === undefined) throw new Error("child-output-source-field-unavailable");
                    actionSources.set(`${node.id}/${source.path}`, { identity: source.identity, value: JsonValueSchema.parse(value) });
                  }
                }
              }
            }
          } catch (error) {
            if (error instanceof RunAbandonedError) throw error;
            return await failNode(node, undefined, error);
          }
          continue;
        }
      }
    }


    const terminal = workflowTerminalResultExecution(descriptor);
    const current = getRun();
    return settleSuccess(current, buildRunResult(
      descriptor,
      current,
      dependencyEvidenceFor(terminal.dependsOn, "terminal"),
      clock,
    ));
  };

  try {
    return await interpret();
  } catch (error) {
    // A command can commit cancellation between a boundary read and terminal admission.
    // Settle it here, after any enclosing evidence transaction has unwound.
    let failure = error;
    if (failure instanceof RunLifecycleRefusedError) {
      try { checkCancellation(); } catch (cancellation) { failure = cancellation; }
    }
    if (failure instanceof RunAbandonedError || (failure instanceof RunLifecycleRefusedError
      && failure.outcome.state === "refused" && failure.outcome.refusal.reason === "lost")) {
      return RunExecutionOutcomeSchema.parse({ state: "abandoned", runId, reason: failure.message });
    }
    throw failure;
  }
}
