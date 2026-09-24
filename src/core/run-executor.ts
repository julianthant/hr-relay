import type { ProviderAccountingStorage } from "../base/provider-accounting.js";
import { commitGeneratedCheckpoint, generatedUpdateId, pendingGeneratedUpdateIds, projectGeneratedUpdates } from "./generated-artifact-projection.js";
import { timelineCheckpointReference } from "../events/timeline.js";
import { localDatePart } from "../domain/clock.js";
import { retainedRunProtectedBindings } from "../domain/protected-input.js";
import { readRunCheckpoint } from "./run-checkpoint-reader.js";
import type { GateSourceRuntime } from "./gate-source-runtime.js";
/**
 * The Phase-1f graph interpreter (ref workflow-model §§4–5; ref execution-and-sessions §3): a worker claims a
 * queued run and walks the descriptor's node tuple to a terminal state.
 *
 * The shape follows the run-state machine exactly. Entry validation runs in
 * `validating`, BEFORE any browser launches (ref workflow-model §5.4), and aggregates
 * every problem into one legible terminal failure. Execution then advances
 * `running.currentNodeId` node by node; browser tasks reach their driver only
 * inside `WorkerSessionManager.withDriver`'s callback lease; every read output
 * passes D115 provenance finalization before it may become a checkpoint or a
 * terminal-result dependency; and both terminal arms go through the atomic
 * authority composites with a factory-built `TerminalAuthorizationRecord`.
 *
 * Every task invocation is raced against an immutable, abortable deadline
 * (ref execution-and-sessions §5.5): a service or driver call that ignores its signal cannot
 * occupy the worker past the bound.
 *
 * Replay policy is structural: the interpreter consults `loadCheckpoint` ONLY
 * for `replay:"checkpoint"` task nodes — an `always-rerun` node re-executes on
 * every resume and its stored rows are audit, never authority (ref workflow-model §5.3).
 *
 * Two node arms are typed SEAMS, not implementations: the `transaction` arm
 * delegates to a `WriteSequencer` (ref write-safety's beat family — a separate task) and
 * the `child-run` arm to a `ChildRunExecutor` (ref workflow-model §3.2's enqueue/join
 * authority). Invoked without an implementation, each fails loud in the
 * `capability-unavailable` style — a structured terminal failure naming the
 * missing seam — and never skips the node. A sequencer post-fence park
 * (`WriteParkedError`, durable state already `parked-write`) surfaces as the
 * first-class `parked-write` outcome arm: the interpreter observes the
 * settled park, verifies it against authority, and settles NOTHING else.
 */
import { z } from "zod";
import { CURRENT_DIAGNOSTIC_SAFETY_VERSION } from "../domain/trust/failure.js";
import type { ContentAddressedArtifactWriter } from "../base/artifacts.js";
import type { RunDiagnosticCapture } from "../base/diagnostics.js";
import { TaskError, wrapUnhandledTaskError } from "../base/errors.js";
import type { ProviderAdmissionRepository, ProviderClient } from "../base/providers.js";
import type { AnyTask, TaskLogger } from "../base/task.js";
import type { TaskStoreRegistry } from "../base/store.js";
import {
  descriptorRuntimeNodes,
  workflowTerminalResultExecution,
  type AnyWorkflowDescriptor,
} from "../base/workflow.js";
import { JsonValueSchema, canonicalJsonStringify } from "../domain/canonical-json.js";
import type { JsonValue } from "../domain/canonical-json.js";
import {
  TransactionDryRunPreviewSchema,
  TransactionOutcomeSchema,
  type TransactionDryRunPreview,
} from "../domain/write-safety-primitives.js";
import type { Clock } from "../domain/clock.js";
import type { AnyReadTaskContract } from "../domain/contracts/base.js";
import type { GateResultRecord } from "../domain/gates.js";
import type { IdFactory } from "../domain/identifiers.js";
import type { TaskRunNoteKind } from "../domain/run/task-note.js";
import type { NoteJsonlWriter } from "../infra/events/note-jsonl-writer.js";
import { withBrowserActionNotes, type BrowserAction } from "../infra/browser/action-notes.js";
import {
  GateIdSchema,
  IsoInstantSchema,
  NodeIdSchema,
  ProviderCapabilityIdSchema,
  TaskIdSchema,
} from "../domain/ids.js";
import type { Fingerprint, IsoInstant, NodeId, ProviderCapabilityId } from "../domain/ids.js";
import {
  RunLifecycleSchema,
  RunRecordSchema,
  runClaim,
  type RunLifecycle,
  type RunRecord,
} from "../domain/run/record.js";
import type {
  RunResultRecord,
  TerminalDependencyEvidence,
} from "../domain/run/result.js";
import type { SessionNeed } from "../domain/session.js";
import { FailureRecordSchema, type FailureRecord } from "../domain/trust/failure.js";
import {
  BUILD_MANIFEST,
  resolveTaskImplFingerprint,
} from "../domain/workflow/build-manifest.js";
import {
  auditCheckpointFreshness,
  CheckpointExpectationSchema,
  loadCheckpoint,
  migrateCanonicalInputSnapshot,
  RunCheckpointRecordSchema,
  type CanonicalInputSnapshotMigration,
  type CheckpointMigration,
  type CheckpointPatch,
  type ReplayedCheckpoint,
  type RunCheckpointRecord,
} from "../domain/workflow/checkpoint.js";
import { applyCheckpointPatches } from "./checkpoint-patch.js";
import { deriveArtifactProjectionRows } from "../domain/workflow/artifact-projection.js";
import {
  childRunOutcomeSchema,
  DelegationManifestRefSchema,
} from "../domain/workflow/graph.js";
import type { RuntimeFlowNode, RuntimeScope } from "../domain/workflow/graph.js";
import { evaluateNodeCondition } from "../domain/workflow/node-condition.js";
import { deriveSchemaHash } from "../domain/schema-bound-value.js";
import { planStepOmissions } from "../domain/workflow/step-omission.js";
import { jsonLeafPaths } from "./task-provenance.js";
import type { AuthorityRepositories } from "../infra/sqlite/authority-database.js";
import { RunClaimTokenSchema, type RunClaimToken } from "../infra/sqlite/run-store-contracts.js";
import {
  WriteIntentParkCodeSchema,
  type WriteIntentParkCode,
} from "../infra/sqlite/write-commit-contracts.js";
import type { MonotonicDeadlineScheduler } from "./deadline-scheduler.js";
import {
  createAdmittedProviderClient,
  type ProviderAdapterRegistry,
  type ProviderAdmissionClientDependencies,
  type ProviderAdmissionIdFactory,
} from "./provider-admission.js";
import {
  buildEntryValidationFailureRecord,
  buildNodeFailureRecord,
} from "./run-failure.js";
import { buildRunPreviewResult, buildRunResult } from "./run-result.js";
import {
  ExecutorSpanEventSchema,
  runSpanPath,
  taskSpanPath,
  type SpanEmitter,
} from "./span-emitter.js";
import { redactObservedDataPoints } from "./observed-data.js";
import { createTaskProvenanceCollector } from "./task-provenance.js";
import { buildTerminalAuthorization } from "./terminal-authorization.js";
import { lifecycleCommandId, requireLifecycleApplied, RunLifecycleRefusedError, type WorkerRunLifecyclePort } from "./run-record-service.js";
import type { WorkerSessionManager } from "./worker-sessions.js";

/* ── injected seams ──────────────────────────────────────────────────────── */

/** The authority surface a run execution needs; `AuthorityDatabase` satisfies it. */
export interface RunExecutionAuthority {
  readonly authority: Pick<AuthorityRepositories, "runCheckpoints" | "gateResults" | "artifactOutbox" | "timelineEvents">
    & { readonly runs: Pick<AuthorityRepositories["runs"], "get"> };
  afterAuthorityCommit(publish: () => void): void;
  /**
   * Required only when a `RunDiagnosticCapture` port is injected: the bundle
   * row and the failure terminalization have to land together or the failure's
   * `diagnosticBundleId` forward reference could dangle.
   */
  withAuthorityTransaction?<Result>(work: (repositories: AuthorityRepositories) => Result): Result;
}

type TransactionRuntimeNode = Extract<RuntimeFlowNode, { kind: "transaction" }>;
type ChildRunRuntimeNode = Extract<RuntimeFlowNode, { kind: "child-run" }>;
type TaskRuntimeNode = Extract<RuntimeFlowNode, { kind: "task" }>;

/**
 * Ref write-safety §4.1's write sequencer seam. It owns probe → lease → prepare →
 * subject proof → fence → commit → beat-⑦ atomic settlement, and dry-run's
 * stop-after-prepare arm. A separate task implements it; this interpreter only
 * dispatches to it and fails loud when it is absent.
 */
export interface WriteSequencerContext {
  readonly descriptor: AnyWorkflowDescriptor;
  readonly node: TransactionRuntimeNode;
  readonly run: RunRecord;
  readonly claim: RunClaimToken;
  readonly scope: RuntimeScope;
  readonly dryRun: boolean;
  readonly signal: AbortSignal;
}

export interface WriteSequencer {
  executeTransaction(context: WriteSequencerContext): Promise<unknown>;
  /**
   * D210 — ref write-safety §12's prepare-only arm. It is part of the seam rather than a
   * production-only extra because the interpreter's dry-run path is not
   * optional: a run whose envelope says `dryRun` has no other legal way through
   * a transaction node, and `executeTransaction` refuses to substitute one.
   */
  executeDryRun(context: WriteSequencerContext): Promise<unknown>;
}

/**
 * Raised by the write sequencer AFTER the intent and the run are durably
 * parked (`parked-write`, intent-first ordering — ref write-safety §3's fail-closed
 * post-fence exit). It lives HERE, with the `WriteSequencer` seam it is part
 * of: the sequencer owns the durable settlement, and the interpreter's
 * `parked-write` outcome arm only OBSERVES it — no second settlement, no
 * failure terminalization. The ref write-safety §4.1 typed operator resolutions are the
 * only release paths.
 */
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

/** Ref workflow-model §3.2's delegation seam: atomic fan-out enqueue, park, and typed join. */
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

/**
 * Ref dashboard-surfaces §2.1 (D45) / ref data-intake-and-edit-data §4.1: the sink projector behind a descriptor's
 * `artifactProjections`. The executor commits the checkpoint and the
 * stable-keyed `artifact_outbox` rows in ONE authority transaction, then
 * calls this seam BEFORE the node may report done — a projection that cannot
 * be acknowledged fails the node loudly, never a silently dropped workbook
 * update. The durable rows survive the failure, so a relaunch resumes the
 * projection from the replayed checkpoint.
 */
export interface RunArtifactProjector {
  projectOutbox(outboxIds: readonly string[]): Promise<Readonly<{ projected: number }>>;
}

/**
 * Ref task-contract §3.4 / D112's admitted-provider wiring for contracts that declare
 * `providers`. The executor mints one admitted client PER declared capability
 * PER task invocation, bound to the run's RETAINED config snapshot (read from
 * authority by the envelope's `configSnapshotId` — never re-resolved from
 * current config, D116) and to the invocation's own deadline-bounded abort
 * signal. Provider I/O is never ambient: the admission kernel stays the only
 * path to an adapter, and this seam only carries the kernel's ingredients.
 */
export interface RunProviderWiring {
  readonly adapters: ProviderAdapterRegistry;
  readonly repository: ProviderAdmissionRepository;
  readonly accounting?: ProviderAccountingStorage;
  /** `AuthorityRepositories["configSnapshots"]` satisfies this. */
  readonly configSnapshots: Readonly<{ get(snapshotId: string): unknown }>;
  readonly idFactory: ProviderAdmissionIdFactory;
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

/**
 * `createAdmittedProviderClient`'s public surface is per-capability overloads,
 * which a union-typed capability cannot call — so the executor dispatches
 * through the same closed switch the kernel's own registry lookup uses.
 */
function admittedClientFor(
  capability: ProviderCapabilityId,
  dependencies: ProviderAdmissionClientDependencies,
): ProviderClient<ProviderCapabilityId> {
  switch (capability) {
    case "ocr.extract": return createAdmittedProviderClient(capability, dependencies);
    case "geocode.census": return createAdmittedProviderClient(capability, dependencies);
    case "geocode.nominatim": return createAdmittedProviderClient(capability, dependencies);
    case "ai.advisory": return createAdmittedProviderClient(capability, dependencies);
  }
}

const TASK_LOG_NOTE_KIND_BY_MESSAGE: ReadonlyMap<string, TaskRunNoteKind> = new Map([
  ["contact advisory withheld fields whose classification forbids provider use", "contact-advice-withheld"],
  ["roster match completed", "roster-match-completed"],
]);

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
  /** Immutable per-invocation task bound (ref execution-and-sessions §5.5); no default, no opt-out. */
  readonly taskDeadlineMs: number;
  readonly log: TaskLogger;
  /** Optional production sink for the executor's allowlisted ordinary task notes. */
  readonly taskNotes?: Pick<NoteJsonlWriter, "emitRunNote" | "emitRunAction">;
  readonly checkpointMigrations?: readonly CheckpointMigration[];
  readonly canonicalInputMigrations?: readonly CanonicalInputSnapshotMigration[];
  readonly writeSequencer?: WriteSequencer;
  readonly childRuns?: ChildRunExecutor;
  /** Registered workflow/external source ports for non-operator gates. */
  readonly gateSources?: GateSourceRuntime;
  /** Ref operator-trust §2.2. Absent means no automatic bundle, never a silent empty one. */
  readonly diagnostics?: RunDiagnosticCapture;
  /**
   * Absent means a contract declaring provider capabilities terminalizes with
   * a structured failure naming the missing wiring — never a bypass around
   * admission (ref data-intake-and-edit-data §4.11).
   */
  readonly providers?: RunProviderWiring;
  /**
   * Ref task-contract §2.1's kernel content-addressed writer. Absent means a contract
   * declaring `artifacts: "content-addressed"` terminalizes with a structured
   * failure naming the missing wiring.
   */
  readonly artifacts?: ContentAddressedArtifactWriter;
  /**
   * Absent means a node with a declared durable artifact projection
   * terminalizes with a structured failure naming the missing wiring — a
   * blocking projection is never silently skipped (ref data-intake-and-edit-data §4.1).
   */
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
  /**
   * A post-fence park the sequencer already settled durably (intent parked,
   * run `parked-write`). First-class so a park never masquerades as a failure
   * or an escaping error; released only by ref write-safety §4.1's typed resolutions.
   */
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

/**
 * A `found` checkpoint load has a stored row by construction (`loadCheckpoint`
 * answers `found: false` for an absent row); the narrowing is stated here once
 * so the executor never re-parses a record the repository already parsed
 * strictly, and an impossible found-without-row state fails loud by node.
 */
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

/**
 * Race a promise against an abort signal so a non-cooperative implementation
 * cannot occupy the worker; the settled loser is observed, never unhandled.
 */
async function raceAbortable<Result>(
  operation: Promise<Result>,
  signal: AbortSignal,
  label: string,
): Promise<Result> {
  // Observe the race loser so an operation that settles AFTER the abort won
  // can never become an unhandled rejection. This is not a swallow: when the
  // operation wins, its own settlement — success or failure — is exactly what
  // the race delivers to the caller.
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
  /**
   * D307 — a task an omitted step's producer rebuilds from typed facts at
   * node time; `replay` carries THIS run's own marked row when a resume (a new
   * claim of the same attempt) reaches the node again, so the assertion is
   * republished rather than re-produced and the attempt holds ONE row.
   */
  | Readonly<{ mode: "asserted"; replay?: RunCheckpointRecord }>
  /** D307 — a node of an omitted step nothing rebuilds: never runs, produces nothing. */
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
  if (initial.lifecycle.state !== "claimed") {
    throw new Error(`run ${runId} is ${initial.lifecycle.state}; the executor starts from a fresh claim`);
  }
  const claimedAt = initial.lifecycle.claimedAt;
  z.number().int().positive().parse(deps.taskDeadlineMs);

  const nodes = descriptorRuntimeNodes(descriptor);
  // D307 — classify every node for this run's omitted steps BEFORE anything
  // executes. The start planner refused the same refusals before a run
  // existed; a run that reaches here with one is miswired and fails loud.
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
  let taskNoteCount = 0;
  let taskNoteLimitReported = false;

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

  const drainBrowserActions = (spanPath: string, actions: readonly BrowserAction[]): void => {
    const sink = deps.taskNotes;
    if (sink === undefined) return;
    const address = { runId, attempt: envelope.attempt, traceId: envelope.traceId, spanPath };
    for (const action of actions) {
      try {
        sink.emitRunAction({
          workflow: descriptor.id,
          address,
          action,
        }, getRun());
      } catch {
        // Diagnostic I/O must not change a settled external write into a failed or UNKNOWN result.
        deps.log.warn("browser action note could not be recorded");
      }
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

  /**
   * Ref operator-trust §2.2's task-failure capture trigger, wired to the one place a
   * Phase-1 run's `FailureRecord` becomes durable.
   *
   * The ordering is forced by the schema, not chosen: `FailureRecord`
   * carries the bundle id as a forward reference, while
   * `diagnostic_snapshots.failure_id` references the failure row. So the bundle
   * is PREPARED first (redaction and content-addressed attachments, nothing in
   * authority yet), the failure is terminalized carrying its id, and the bundle
   * row lands in the SAME authority transaction — a failure can never point at
   * a bundle that does not exist, and a bundle can never outlive its failure.
   *
   * With no capture port injected the behaviour is exactly as before: no
   * bundle, no `diagnosticBundleId`, and no transaction wrapper.
   */
  const terminalizeAsFailure = async (failure: FailureRecord): Promise<RunExecutionOutcome> => {
    const capture = deps.diagnostics;
    const prepared = capture === undefined ? undefined : await capture.captureForFailure({
      failure,
      configFingerprint: envelope.configFingerprint,
      descriptorFingerprint: descriptor.contractFingerprint,
    });
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
  };

  const interpret = async (): Promise<RunExecutionOutcome> => {
    /* ── validating: ref workflow-model §5.4 entry validation, before any browser ────── */
    transitionTo({ state: "validating", workerId: claim.workerId, claimedAt, heartbeatAt: instant() });

    const problems: string[] = [];
    let canonicalInput: JsonValue | undefined;
    const canonicalSchemaHash = deriveSchemaHash(descriptor.canonicalInput, "output");
    try {
      const migrated = migrateCanonicalInputSnapshot(
        { schemaHash: initial.input.parsed.schemaHash, value: initial.input.parsed.value },
        canonicalSchemaHash,
        deps.canonicalInputMigrations ?? [],
        descriptor.id,
      );
      canonicalInput = JsonValueSchema.parse(descriptor.canonicalInput.parse(migrated));
    } catch (error) {
      problems.push(error instanceof Error ? error.message : "canonical input snapshot failed to parse");
    }
    // Ref workflow-model §5.6 #3 / ref data-intake-and-edit-data §6 (D166): injected corrections apply to
    // REPLAYED checkpoints during planning. Each group is consumed by its
    // node's replay arm below; anything left over names a node this run will
    // execute (or does not know), and a fresh read supersedes any correction
    // — so leftovers refuse loudly rather than riding along ignored.
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
    const replayedForFreshness: ReplayedCheckpoint[] = [];
    const skippedReasons = new Map<string, "condition-false" | "branch-not-selected" | "step-omitted">();
    /** D307 — asserted outputs, keyed by node, as the terminal evidence will cite them. */
    const assertedRecords = new Map<string, Readonly<{ step: string; assertedAt: IsoInstant; output: Readonly<{ schemaHash: Fingerprint; value: JsonValue }> }>>();

    /**
     * Turn a node-id list into the exact terminal-dependency evidence the sealed
     * factory demands: a durable checkpoint this run actually produced, or a
     * closed not-run reason this run actually recorded. Nothing is invented — a
     * node with neither is a hard error, because "we have no record" and "the
     * node did not run" are the two things that must never be conflated.
     */
    const dependencyEvidenceFor = (
      nodeIds: readonly NodeId[],
      purpose: string,
    ): readonly TerminalDependencyEvidence[] => nodeIds.map((dependency) => {
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

    /**
     * The ONE terminal-success settlement: completion, result, and the
     * authority transaction that writes them with the run CAS. A derived result
     * and D210's preview record differ in what they SAY and not in how they
     * settle, so they share this — a second copy would be a second place for the
     * terminal invariants to drift.
     */
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

    /**
     * D210 — end a previewed run AT the transaction node. The dependency evidence
     * is that node's OWN `dependsOn`, which is the exact set its `prepare`/`commit`
     * binds read; the factory re-derives the expected set from the authenticated
     * descriptor, so this list is checked rather than trusted.
     */
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
      return { input: canonicalInput, outputs: Object.freeze(picked),
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

    // Ancestor planning. With an explicit startAt, every prior node MUST
    // resolve (replay, condition-skip, or stored gate result) or the resume
    // refuses loudly (§5.4). Without one, the maximal replayable prefix is
    // derived and the first non-replayable node begins execution (§5.6 #1/#2).
    let ancestorRegionOpen = canonicalInput !== undefined;
    for (const [index, node] of nodes.entries()) {
      // D307 — an omitted step's nodes are classified before any replay or
      // execute reasoning: they own no checkpoint on any resume and never
      // open or close the ancestor region.
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
          // D228 — ONE evaluator for the declared condition. The old closure
          // could return a non-boolean and had to be checked for it; a declared
          // condition cannot, and every way it can fail to resolve throws by
          // name inside `evaluateNodeCondition` rather than guessing.
          const condition = evaluateNodeCondition(node.when, scopeFor(node.dependsOn));
          if (!condition) {
            plan.set(String(node.id), { mode: "skipped-condition" });
            continue;
          }
        }
        const stored = readRunCheckpoint(deps.authority.authority, envelope, String(node.id), true);
        // D314 — Restart from start: a read/compute checkpoint ANOTHER run of
        // this item produced is not replayed; every read and computation
        // executes again. This run's own rows (a gate resume re-claiming the
        // same attempt) still replay, and an operator assertion for an omitted
        // step is classified above, never here.
        // `stored` is already the repository's strict parse of the durable row
        // (`runCheckpoints.latest` fails loud on a malformed row before this
        // point), so its run id is read directly: a lenient re-parse here would
        // classify an unparseable row as "another run's" instead of refusing.
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
          deps.checkpointMigrations ?? [],
        );
        // `stored` is the repository's strict parse already; a found load has a row.
        const storedRecord = load.found ? requireStoredCheckpoint(stored, String(node.id)) : undefined;
        const storedAssertion = storedRecord?.assertion;
        if (storedAssertion !== undefined) {
          // D307 — the latest row is an operator ASSERTION from a run that
          // omitted this node's step; this run executes the node, so that row
          // is not an observation it may replay. An explicit resume cannot
          // cross it; an ordinary start simply executes.
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

    // D8 freshness walk — run generically even when no commit sink exists.
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

    // D307 — a refused omission is an entry-validation failure of THIS run:
    // it terminalizes with a FailureRecord like a bad canonical input, so the
    // worker drains and the operator sees the refusal by step name.
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

    // The corrected checkpoints become durable AT THIS ATTEMPT only after
    // validation accepted the whole plan. Replay of the same attempt derives
    // byte-identical rows (the applier is pure), so re-insert is idempotent.
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

    /**
     * The stored operator decision for a GATE dependency, or `undefined` when
     * the node is not a gate this run has resolved. It reads the same row the
     * `replay-gate` arm reads, under this run's identity.
     */
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
    ): Promise<RunCheckpointRecord> => {
      const contract: AnyReadTaskContract = node.uses;
      const bound: unknown = node.bind(scope);
      const parsedInput: unknown = contract.input.parse(bound);
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
        /*
         * A dependency's durable evidence is a CHECKPOINT for a task node and a
         * `gate_results` row for a gate node — two different tables, because a
         * gate records an operator decision rather than an observation. Handing
         * the collector a fabricated checkpoint for a gate would make a durable
         * record claim a shape it does not have (D144's refusal); handing it
         * nothing made the post-gate node unrunnable, which is what the first
         * live chunk-3 run found.
         */
        upstreamEvidence: {
          checkpoints: node.dependsOn.flatMap((dependency) => {
            const record = checkpointRecords.get(String(dependency));
            if (record !== undefined) return [record];
            if (skippedReasons.get(String(dependency)) === "condition-false"
              && nodes.some((candidate) => candidate.id === dependency && candidate.kind === "gate")) return [];
            if (gateResultFor(String(dependency)) !== undefined) return [];
            throw new Error(
              `task ${contract.id} declared dependency "${dependency}" has no checkpoint record to hand `
              + "to the provenance collector",
            );
          }),
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
        /*
         * D270 — the observed log. Every recorded batch is emitted on THIS
         * task's span at record time, redacted by the declared classification
         * of its `(taskId, field)` leaf. At record time, not at finalization:
         * a task that throws after reading the page has still read the page,
         * and its observations are exactly what the operator needs to see.
         *
         * An undeclared leaf throws out of `redactObservedDataPoints`, inside
         * `ctx.recordData`, which fails the task by name — the intended loud
         * failure, and the same rule D140 gave the receipt. Nothing else here
         * may throw into a good read: the emitter is synchronous and the
         * points are already schema-parsed.
         */
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
      });

      const taskLog = (message: string): void => {
        const sink = deps.taskNotes;
        if (sink === undefined) return;
        const kind = TASK_LOG_NOTE_KIND_BY_MESSAGE.get(message);
        if (kind === undefined) return;
        const address = { runId, attempt: envelope.attempt, traceId: envelope.traceId, spanPath };
        if (taskNoteCount >= 256) {
          if (!taskNoteLimitReported) {
            taskNoteLimitReported = true;
            sink.emitRunNote({ workflow: descriptor.id, address, kind: "task-log-limit-reached" }, getRun());
          }
          return;
        }
        taskNoteCount += 1;
        sink.emitRunNote({
          workflow: descriptor.id,
          address,
          kind,
        }, getRun());
      };
      const taskLogger: TaskLogger = {
        debug: (message, fields) => {
          deps.log.debug(message, fields);
        },
        info: (message, fields) => {
          deps.log.info(message, fields);
          taskLog(message);
        },
        warn: (message, fields) => {
          deps.log.warn(message, fields);
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
        // One admitted client per declared capability, minted fresh for THIS
        // invocation: the client binds the run's retained config snapshot and
        // this attempt's deadline-bounded signal, so nothing outlives the call.
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
            repository: provider.wiring.repository,
            ...(provider.wiring.accounting===undefined?{}:{accounting:provider.wiring.accounting}),
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

      let raw: unknown;
      try {
        if (need === undefined) {
          raw = await raceAbortable(
            Promise.resolve().then(() => run({ input: parsedInput, ctx: { ...ctxCommon, ...ctxExtras } })),
            controller.signal,
            contract.id,
          );
        } else {
          const instanceSelection = envelope.resolvedInstance[need.system];
          if (instanceSelection === undefined) {
            throw new Error(
              `run ${runId} resolved no ${need.system} instance at enqueue, and ${contract.id} needs one`,
            );
          }
          raw = await withBrowserActionNotes(clock, () => raceAbortable(
            deps.sessions.withDriver(need, instanceSelection, controller.signal, (driver) =>
              run({ input: parsedInput, ctx: { ...ctxCommon, ...ctxExtras, driver } })),
            controller.signal,
            contract.id,
          ), (actions) => drainBrowserActions(spanPath, actions));
        }
      } finally {
        deadline.cancel();
        input.signal.removeEventListener("abort", forwardAbort);
      }

      // D115: provenance finalization gates the output BEFORE it is
      // checkpointed or used — missing/contradictory provenance fails here.
      const provenance = collector.finalizeRead(raw);
      const parsedOutput: unknown = contract.output.parse(raw);
      return RunCheckpointRecordSchema.parse({
        workflowId: descriptor.id,
        itemId: envelope.itemId,
        nodeId: String(node.id),
        attempt: envelope.attempt,
        // D214 — WHICH execution of this attempt produced the row. A gate
        // resume is a fresh claim, so an `always-rerun` node re-executing after
        // one writes under a key nothing owns instead of colliding with its own
        // earlier observation.
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
        // The run's RETAINED snapshot, read by the envelope's own id — a
        // missing row refuses the node rather than re-resolving current
        // config, which would admit against a budget this run never carried.
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
          const record = await invokeTask(node, task, scope, need, capabilityWiring, spanPath);
          if (declaredProjections.length === 0) {
            deps.authority.authority.runCheckpoints.insert(record);
          } else {
            // Bound, not extracted: `withAuthorityTransaction` is a class
            // method whose `this` is the authority — a detached call dies on
            // its own private state.
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
            // Ref dashboard-surfaces §2.1 (D45): the checkpoint and its stable-keyed outbox
            // rows are ONE durable fact — neither may exist without the other.
            commitGeneratedCheckpoint({withTransaction, checkpoint:record, updates:outboxRows});
            // Blocking: the node may not report done until every row is
            // acknowledged. A throw here fails the node; the durable rows
            // survive, and a relaunch resumes projection from the replay arm.
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
          const taskError = error instanceof TaskError ? error : wrapUnhandledTaskError(contract.id, error);
          emit({
            t: "span.ended", kind: "task",
            ...runSpanIdentity, spanPath, parentSpanPath: runSpanIdentity.spanPath,
            outcome: "failed",
            diagnosticSafetyVersion: CURRENT_DIAGNOSTIC_SAFETY_VERSION,
            errorSummary: `task ${contract.id} failed; inspect its structured failure record`,
          });
          const retryable = taskError.transient && taskAttempt < attempts;
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
        // D307 — the operator omitted this node's step and no producer
        // rebuilds it. Its span says so with the closed reason the terminal
        // record will repeat; nothing is fenced, published or checkpointed.
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
        // D307 — rebuild this task's output from the operator's typed facts
        // and the node's own dependency scope, parse it with the node's OWN
        // output schema, and publish it exactly as a checkpoint replay would —
        // minus the checkpoint. A later retry of the same item must never
        // replay an assertion as an observation.
        const assertion = omissionPlan.asserted.get(String(node.id));
        if (assertion === undefined || node.kind !== "task") {
          throw new Error(`node "${node.id}" was planned as asserted but the omission plan does not assert a task there`);
        }
        transitionTo(runningLifecycle(node.id));
        if (entry.replay !== undefined) {
          // A resume of this attempt: republish the row this run already
          // asserted. Re-producing would mint a second marked row for one
          // attempt, which the terminal mirror rightly refuses.
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
        // The assertion becomes DURABLE the way an observation would — a
        // `run_checkpoints` row every later reader (the write sequencer's
        // commit-input rebuild, the provenance collector, the receipt) can
        // resolve — but marked, so it is never mistaken for one: every leaf is
        // `operator`-sourced at `assertedAt`, and the row names its omitted step.
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
                // The SAME closed reason the terminal result records for this
                // node (D114). The timeline must be able to say *why* a step
                // did not run, and re-deriving it from the descriptor later
                // would be a second source for one fact.
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
              `parallel "${node.id}" join "${node.join}" is not interpretable in Phase 1; `
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
          // §4 park: the checkpoint barrier is already durable (each output
          // was checkpointed at production), then gate.opened, then session
          // release, then the parked state. A parked run owns no browser.
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
          /**
           * D210 — the preview arm (ref task-contract §6.2). A dry run reaches the
           * transaction node, runs the sequencer's REAL prepare-only arm (zero
           * intent, zero fence, zero commit), records an honest
           * `transaction.previewed` span, and ENDS THE RUN HERE. Nothing
           * downstream executes: ref task-contract §10.1's default is that a preview stops
           * after the first transaction prepare, and continuing would run nodes
           * whose inputs a real run derives from a commit output this run never
           * produced.
           */
          if (envelope.dryRun) {
            let preview: TransactionDryRunPreview;
            try {
              preview = TransactionDryRunPreviewSchema.parse(await withBrowserActionNotes(clock, () => deps.writeSequencer!.executeDryRun({
                descriptor, node, run: getRun(), claim,
                scope: scopeFor(node.dependsOn),
                dryRun: true,
                signal: input.signal,
              }), (actions) => drainBrowserActions(runSpanIdentity.spanPath, actions)));
            } catch (error) {
              if (error instanceof RunAbandonedError) throw error;
              return await failNode(node, node.commit.uses.id, error);
            }
            emit({
              t: "transaction.previewed",
              ...runSpanIdentity,
              node: node.id,
              // D215 — a preview whose probe settled `already-present` staged
              // nothing and observed no subject, and says so.
              subject: preview.outcome.state === "would-prepare"
                ? preview.outcome.subject.state
                : "not-observed",
              externalCommit: "none",
            });
            return settlePreview(node, preview);
          }
          try {
            const raw = await withBrowserActionNotes(clock, () => deps.writeSequencer!.executeTransaction({
              descriptor, node, run: getRun(), claim,
              scope: scopeFor(node.dependsOn),
              dryRun: envelope.dryRun,
              signal: input.signal,
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

            // D144 — a transaction node may be named in `terminalDependsOn`, so
            // its durable checkpoint has to become terminal evidence like any
            // other node's. The sequencer wrote that row inside beat ⑦'s own
            // authority transaction; the interpreter reads THAT EXACT ROW back
            // rather than minting a record from the value it was handed. A
            // missing row means the sequencer reported a settlement it never
            // durably recorded, and a row that does not project to the very
            // settlement just observed means the two disagree — both are hard
            // errors, never a substituted checkpoint.
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
              // The sequencer already parked the intent AND the run durably
              // (intent-first). This arm only observes that settled state —
              // and it refuses to trust the error object alone: the durable
              // row must actually be the park the signal claims.
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
          } catch (error) {
            if (error instanceof RunAbandonedError) throw error;
            return await failNode(node, undefined, error);
          }
          continue;
        }
      }
    }

    /* ── terminal success (D110/D114) ────────────────────────────────────── */
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
