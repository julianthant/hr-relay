/**
 * The Phase-1f graph interpreter (doc 02 §§4–5; doc 05 §3): a worker claims a
 * queued run and walks the descriptor's node tuple to a terminal state.
 *
 * The shape follows the run-state machine exactly. Entry validation runs in
 * `validating`, BEFORE any browser launches (doc 02 §5.4), and aggregates
 * every problem into one legible terminal failure. Execution then advances
 * `running.currentNodeId` node by node; browser tasks reach their driver only
 * inside `WorkerSessionManager.withDriver`'s callback lease; every read output
 * passes D115 provenance finalization before it may become a checkpoint or a
 * terminal-result dependency; and both terminal arms go through the atomic
 * authority composites with a factory-built `TerminalAuthorizationRecord`.
 *
 * Every task invocation is raced against an immutable, abortable deadline
 * (doc 05 §5.5): a service or driver call that ignores its signal cannot
 * occupy the worker past the bound.
 *
 * Replay policy is structural: the interpreter consults `loadCheckpoint` ONLY
 * for `replay:"checkpoint"` task nodes — an `always-rerun` node re-executes on
 * every resume and its stored rows are audit, never authority (doc 02 §5.3).
 *
 * Two node arms are typed SEAMS, not implementations: the `transaction` arm
 * delegates to a `WriteSequencer` (doc 09's beat family — a separate task) and
 * the `child-run` arm to a `ChildRunExecutor` (doc 02 §3.2's enqueue/join
 * authority). Invoked without an implementation, each fails loud in the
 * `capability-unavailable` style — a structured terminal failure naming the
 * missing seam — and never skips the node.
 */
import { z } from "zod";
import { TaskError, wrapUnhandledTaskError } from "../base/errors.js";
import type { AnyTask, TaskLogger } from "../base/task.js";
import type { TaskStoreRegistry } from "../base/store.js";
import {
  descriptorRuntimeNodes,
  workflowTerminalResultExecution,
  type AnyWorkflowDescriptor,
} from "../base/workflow.js";
import { JsonValueSchema } from "../domain/canonical-json.js";
import type { JsonValue } from "../domain/canonical-json.js";
import type { Clock } from "../domain/clock.js";
import type { AnyReadTaskContract } from "../domain/contracts/base.js";
import type { IdFactory } from "../domain/identifiers.js";
import {
  GateIdSchema,
  IsoInstantSchema,
  OutboxIdSchema,
  TaskIdSchema,
} from "../domain/ids.js";
import type { NodeId } from "../domain/ids.js";
import {
  RunLifecycleSchema,
  RunRecordSchema,
  type RunLifecycle,
  type RunRecord,
} from "../domain/run/record.js";
import { RunTerminalOutboxRecordSchema } from "../domain/run/terminal-outbox.js";
import type { SessionNeed } from "../domain/session.js";
import type { FailureRecord } from "../domain/trust/failure.js";
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
  type ReplayedCheckpoint,
  type RunCheckpointRecord,
} from "../domain/workflow/checkpoint.js";
import {
  childRunOutcomeSchema,
  DelegationManifestRefSchema,
} from "../domain/workflow/graph.js";
import type { RuntimeFlowNode, RuntimeScope } from "../domain/workflow/graph.js";
import { deriveSchemaHash } from "../domain/schema-bound-value.js";
import type { AuthorityRepositories } from "../infra/sqlite/authority-database.js";
import { RunClaimTokenSchema, type RunClaimToken } from "../infra/sqlite/run-store-contracts.js";
import type {
  FailureTerminalizationReport,
  SuccessTerminalizationReport,
} from "../infra/sqlite/run-terminal-contracts.js";
import type { MonotonicDeadlineScheduler } from "./provider-admission.js";
import {
  buildEntryValidationFailureRecord,
  buildNodeFailureRecord,
} from "./run-failure.js";
import { buildRunResult } from "./run-result.js";
import {
  ExecutorSpanEventSchema,
  runSpanPath,
  taskSpanPath,
  type SpanEmitter,
} from "./span-emitter.js";
import { createTaskProvenanceCollector } from "./task-provenance.js";
import { buildTerminalAuthorization } from "./terminal-authorization.js";
import type { WorkerSessionManager } from "./worker-sessions.js";

/* ── injected seams ──────────────────────────────────────────────────────── */

/** The authority surface a run execution needs; `AuthorityDatabase` satisfies it. */
export interface RunExecutionAuthority {
  readonly authority: Pick<AuthorityRepositories, "runs" | "runCheckpoints" | "gateResults">;
  terminalizeFailure(descriptor: AnyWorkflowDescriptor, input: unknown): FailureTerminalizationReport;
  terminalizeSuccess(input: unknown, factoryAuthorization?: object): SuccessTerminalizationReport;
}

type TransactionRuntimeNode = Extract<RuntimeFlowNode, { kind: "transaction" }>;
type ChildRunRuntimeNode = Extract<RuntimeFlowNode, { kind: "child-run" }>;
type TaskRuntimeNode = Extract<RuntimeFlowNode, { kind: "task" }>;

/**
 * Doc 09 §4.1's write sequencer seam. It owns probe → lease → prepare →
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
}

/** Doc 02 §3.2's delegation seam: atomic fan-out enqueue, park, and typed join. */
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

export interface RunExecutorDependencies {
  readonly descriptor: AnyWorkflowDescriptor;
  readonly stores: TaskStoreRegistry;
  readonly authority: RunExecutionAuthority;
  readonly sessions: WorkerSessionManager;
  readonly emitter: SpanEmitter;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly scheduler: MonotonicDeadlineScheduler;
  /** Immutable per-invocation task bound (doc 05 §5.5); no default, no opt-out. */
  readonly taskDeadlineMs: number;
  readonly log: TaskLogger;
  readonly checkpointMigrations?: readonly CheckpointMigration[];
  readonly canonicalInputMigrations?: readonly CanonicalInputSnapshotMigration[];
  readonly writeSequencer?: WriteSequencer;
  readonly childRuns?: ChildRunExecutor;
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

function labelOf(node: TaskRuntimeNode): string {
  return node.label ?? node.uses.title;
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
  operation.catch(() => undefined);
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
  const runs = deps.authority.authority.runs;
  const instant = () => IsoInstantSchema.parse(clock.now().toISOString());

  const getRun = (): RunRecord => {
    const current = runs.get(runId);
    if (current === undefined) throw new Error(`run ${runId} disappeared from authority mid-execution`);
    return current;
  };

  const transitionTo = (lifecycle: RunLifecycle): RunRecord => {
    const current = getRun();
    const outcome = runs.transition({
      runId,
      expectedVersion: current.version,
      claim,
      lifecycle,
      now: instant(),
    });
    if (outcome.state !== "applied") throw new RunAbandonedError(outcome.message);
    return outcome.run;
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

  const emit = (event: Readonly<Record<string, unknown>>): void => {
    deps.emitter.emit(ExecutorSpanEventSchema.parse({
      ts: instant(),
      workflow: descriptor.id,
      ...event,
    }));
  };

  const terminalizeAsFailure = (failure: FailureRecord): RunExecutionOutcome => {
    const current = getRun();
    const authorization = buildTerminalAuthorization({
      run: current,
      authorizedAt: instant(),
      consequence: { kind: "failed", failure },
    });
    deps.authority.terminalizeFailure(descriptor, { failure, authorization });
    emit({ t: "span.ended", kind: "run", ...runSpanIdentity, outcome: "failed", failureId: failure.failureId });
    return RunExecutionOutcomeSchema.parse({ state: "failed", runId, failureId: failure.failureId });
  };

  const interpret = async (): Promise<RunExecutionOutcome> => {
    /* ── validating: doc 02 §5.4 entry validation, before any browser ────── */
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
    if (envelope.injected !== undefined) {
      problems.push(
        "injected checkpoint patches (Edit Data) are a Phase 2h capability; "
        + "this run must be re-planned without corrections or started from the producing step",
      );
    }

    const taskIndex = taskIndexOf(deps.stores);
    const plan = new Map<string, PlanEntry>();
    const outputs: Record<string, JsonValue> = {};
    const checkpointRecords = new Map<string, RunCheckpointRecord>();
    const replayedForFreshness: ReplayedCheckpoint[] = [];
    const skippedReasons = new Map<string, "condition-false" | "branch-not-selected">();
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
      return { input: canonicalInput, outputs: Object.freeze(picked) };
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
          if (dependencyEntry === undefined || dependencyEntry.mode === "execute") conditionKnown = false;
        }
        if (node.when !== undefined && conditionKnown) {
          const condition = node.when(scopeFor(node.dependsOn));
          if (typeof condition !== "boolean") {
            problems.push(`node "${node.id}" when() returned a non-boolean; refusing to guess whether it runs`);
            continue;
          }
          if (!condition) {
            plan.set(String(node.id), { mode: "skipped-condition" });
            continue;
          }
        }
        const stored = deps.authority.authority.runCheckpoints.latest(
          descriptor.id,
          envelope.itemId,
          String(node.id),
        );
        const load = loadCheckpoint(
          stored,
          checkpointExpectation(node),
          node.uses.output,
          deps.checkpointMigrations ?? [],
        );
        if (load.found) {
          const record = RunCheckpointRecordSchema.parse(stored);
          plan.set(String(node.id), { mode: "replay", record });
          outputs[String(node.id)] = JsonValueSchema.parse(load.output);
          checkpointRecords.set(String(node.id), record);
          replayedForFreshness.push({
            nodeId: node.id,
            taskId: node.uses.id,
            freshness: node.uses.freshness,
            provenance: load.provenance,
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

    if (problems.length > 0) {
      const failure = buildEntryValidationFailureRecord({
        run: getRun(),
        failureId: deps.ids.uuid(),
        problems,
        occurredAt: instant(),
      });
      return terminalizeAsFailure(failure);
    }

    /* ── running: walk the plan in declaration order ─────────────────────── */
    transitionTo(runningLifecycle());

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
    ): RunExecutionOutcome => terminalizeAsFailure(buildNodeFailureRecord({
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

    const invokeTask = async (
      node: TaskRuntimeNode,
      task: AnyTask,
      scope: RuntimeScope,
      need: SessionNeed | undefined,
    ): Promise<RunCheckpointRecord> => {
      const contract: AnyReadTaskContract = node.uses;
      const bound: unknown = node.bind(scope);
      const parsedInput: unknown = contract.input.parse(bound);
      const collector = createTaskProvenanceCollector({
        descriptor,
        execution: {
          runId,
          traceId: envelope.traceId,
          attempt: envelope.attempt,
          workflowId: descriptor.id,
          nodeId: String(node.id),
          taskId: contract.id,
        },
        upstreamEvidence: {
          checkpoints: node.dependsOn.map((dependency) => {
            const record = checkpointRecords.get(String(dependency));
            if (record === undefined) {
              throw new Error(
                `task ${contract.id} declared dependency "${dependency}" has no checkpoint record to hand `
                + "to the provenance collector",
              );
            }
            return record;
          }),
        },
        clock,
      });

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
        log: deps.log,
        fail: (code: string, message: string, options?: Readonly<{
          subject?: string; transient?: boolean; cause?: unknown;
        }>): never => {
          throw new TaskError(contract.id, code, message, options);
        },
        recordData: collector.recordData,
      } as const;

      let raw: unknown;
      try {
        if (need === undefined) {
          raw = await raceAbortable(
            Promise.resolve().then(() => run({ input: parsedInput, ctx: ctxCommon })),
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
          raw = await raceAbortable(
            deps.sessions.withDriver(need, instanceSelection, controller.signal, (driver) =>
              run({ input: parsedInput, ctx: { ...ctxCommon, driver } })),
            controller.signal,
            contract.id,
          );
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
        runId,
        output: {
          schemaHash: deriveSchemaHash(contract.output, "output"),
          value: JsonValueSchema.parse(parsedOutput),
        },
        descriptorVersion: descriptor.version,
        contractFingerprint: descriptor.contractFingerprint,
        implFingerprint: resolveTaskImplFingerprint(BUILD_MANIFEST, contract.id),
        provenance: provenance.provenance,
        writtenAt: instant(),
      });
    };

    const executeTaskNode = async (
      node: TaskRuntimeNode,
      scope: RuntimeScope,
    ): Promise<RunExecutionOutcome | undefined> => {
      const contract = node.uses;
      const task = taskIndex.get(contract.id);
      if (task === undefined) {
        return failNode(node, contract.id, new Error(`no store implements ${contract.id}`));
      }
      if (task.contract !== contract) {
        return failNode(node, contract.id, new Error(
          `store task ${contract.id} binds a different contract object than the descriptor imports`,
        ));
      }
      if (contract.artifacts !== undefined) {
        return failNode(node, contract.id, new Error(
          `${contract.id} declares content-addressed artifacts; the artifact writer lands with its owning slice`,
        ));
      }
      if (contract.providers !== undefined && contract.providers.length > 0) {
        return failNode(node, contract.id, new Error(
          `${contract.id} requires provider capabilities; the admitted provider client is not wired into this executor`,
        ));
      }

      const attempts = task.impl.retry?.attempts ?? 1;
      const backoffMs = task.impl.retry?.backoffMs ?? 0;
      const need = task.impl.sessions[0];
      for (let taskAttempt = 1; taskAttempt <= attempts; taskAttempt += 1) {
        transitionTo(runningLifecycle(node.id));
        const spanPath = taskSpanPath(envelope.traceId, node.id, taskAttempt);
        emit({
          t: "span.started", kind: "task",
          ...runSpanIdentity, spanPath, parentSpanPath: runSpanIdentity.spanPath,
          name: labelOf(node),
          ...(need === undefined ? {} : { system: need.system }),
        });
        try {
          const record = await invokeTask(node, task, scope, need);
          deps.authority.authority.runCheckpoints.insert(record);
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
            errorSummary: taskError.message,
          });
          const retryable = taskError.transient && taskAttempt < attempts;
          if (!retryable) return failNode(node, contract.id, taskError);
          await waitForBackoff(backoffMs);
        }
      }
      throw new Error(`task ${contract.id} exhausted its retry loop without a terminal decision`);
    };

    for (const [index, node] of nodes.entries()) {
      if (input.signal.aborted) throw abortReason(`run ${runId} execution was aborted`);
      const entry = plan.get(String(node.id));
      if (entry === undefined) throw new Error(`node "${node.id}" has no execution plan entry`);
      if (entry.mode === "replay") continue;
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

      switch (node.kind) {
        case "task": {
          transitionTo(runningLifecycle(node.id));
          const scope = scopeFor(node.dependsOn);
          if (node.when !== undefined) {
            const condition = node.when(scope);
            if (typeof condition !== "boolean") {
              return failNode(node, node.uses.id, new Error(`node "${node.id}" when() returned a non-boolean`));
            }
            if (!condition) {
              skippedReasons.set(String(node.id), "condition-false");
              const spanPath = taskSpanPath(envelope.traceId, node.id, 1);
              emit({
                t: "span.started", kind: "task",
                ...runSpanIdentity, spanPath, parentSpanPath: runSpanIdentity.spanPath,
                name: labelOf(node),
              });
              emit({
                t: "span.ended", kind: "task",
                ...runSpanIdentity, spanPath, parentSpanPath: runSpanIdentity.spanPath,
                outcome: "skipped",
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
            return failNode(node, undefined, new Error(
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
            return failNode(node, undefined, new Error(
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
          transitionTo(runningLifecycle(node.id));
          // §4 park: the checkpoint barrier is already durable (each output
          // was checkpointed at production), then gate.opened, then session
          // release, then the parked state. A parked run owns no browser.
          emit({ t: "gate.opened", ...runSpanIdentity, gate: node.id });
          await deps.sessions.closeAll("parked");
          const resumeAt = nodes[index + 1]?.id ?? node.id;
          transitionTo({
            state: "parked-gate",
            gateId: GateIdSchema.parse(String(node.id)),
            parkedAt: instant(),
            resumeAt,
          });
          return RunExecutionOutcomeSchema.parse({ state: "parked-gate", runId, gateId: String(node.id) });
        }
        case "transaction": {
          transitionTo(runningLifecycle(node.id));
          if (deps.writeSequencer === undefined) {
            return failNode(node, node.commit.uses.id, new TaskError(
              node.commit.uses.id,
              "capability-unavailable",
              `transaction node "${node.id}" requires the doc-09 write sequencer, which is not wired; `
              + "refusing to skip a write node",
            ));
          }
          try {
            const raw = await deps.writeSequencer.executeTransaction({
              descriptor, node, run: getRun(), claim,
              scope: scopeFor(node.dependsOn),
              dryRun: envelope.dryRun,
              signal: input.signal,
            });
            const OutcomeSchema = z.strictObject({
              disposition: z.enum(["committed", "already-present"]),
              proofSource: z.enum([
                "normal-output", "recovery-probe", "operator-attestation", "durable-intent", "live-probe",
              ]),
              output: node.commit.uses.output,
              proof: JsonValueSchema,
            });
            outputs[String(node.id)] = JsonValueSchema.parse(OutcomeSchema.parse(raw));
          } catch (error) {
            if (error instanceof RunAbandonedError) throw error;
            return failNode(node, node.commit.uses.id, error);
          }
          continue;
        }
        case "child-run": {
          transitionTo(runningLifecycle(node.id));
          if (deps.childRuns === undefined) {
            return failNode(node, undefined, new Error(
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
            return failNode(node, undefined, error);
          }
          continue;
        }
      }
    }

    /* ── terminal success (D110/D114) ────────────────────────────────────── */
    const terminal = workflowTerminalResultExecution(descriptor);
    const evidence = terminal.dependsOn.map((dependency) => {
      const record = checkpointRecords.get(String(dependency));
      if (record !== undefined) return { state: "resolved" as const, nodeId: dependency, checkpoint: record };
      const reason = skippedReasons.get(String(dependency));
      if (reason !== undefined) return { state: "not-run" as const, nodeId: dependency, reason };
      throw new Error(
        `terminal dependency "${dependency}" has neither a checkpoint-backed output nor a closed not-run reason`,
      );
    });
    const current = getRun();
    const built = buildRunResult(descriptor, current, evidence, clock);
    const outboxId = OutboxIdSchema.parse(deps.ids.uuid());
    const outbox = RunTerminalOutboxRecordSchema.parse({
      outboxId,
      payload: {
        kind: "run-terminal-result",
        runId: built.record.runId,
        workflowId: built.record.workflowId,
        attempt: built.record.attempt,
        resultDigest: built.record.resultDigest,
      },
      projection: { state: "pending" },
      createdAt: built.record.createdAt,
    });
    const authorization = buildTerminalAuthorization({
      run: current,
      authorizedAt: built.record.createdAt,
      consequence: { kind: "done", result: built.record, outboxId },
    });
    deps.authority.terminalizeSuccess(
      { result: built.record, outbox, authorization },
      built.authorization,
    );
    emit({ t: "span.ended", kind: "run", ...runSpanIdentity, outcome: "done" });
    return RunExecutionOutcomeSchema.parse({ state: "done", runId });
  };

  try {
    return await interpret();
  } catch (error) {
    if (error instanceof RunAbandonedError) {
      return RunExecutionOutcomeSchema.parse({ state: "abandoned", runId, reason: error.message });
    }
    throw error;
  }
}
