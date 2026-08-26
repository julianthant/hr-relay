/**
 * The Phase-1 worker run loop (ref execution-and-sessions §3): one workflow-scoped worker, one
 * active item, claim → execute → terminal/park, then the next eligible row.
 *
 * The loop owns exactly the concerns the interpreter cannot: claiming (the
 * store enforces the one-active-item invariant), heartbeat renewal during long
 * operations (a lost heartbeat aborts the run's signal instead of letting a
 * zombie keep driving a browser), the worker-lifetime browser-session set
 * (warm reuse across sequential items — ref execution-and-sessions §5 — with `worker-stop` close
 * proof at the end), and worker/browser span emission over the injected
 * `SpanEmitter`.
 *
 * Idle behavior is ref execution-and-sessions §3's bounded re-poll: `deferred` sleeps exactly
 * until the earliest `not_before`, capped by `idleRepollMs`; a worker never
 * sleeps while owning a run.
 */
import { z } from "zod";
import type { TaskLogger } from "../base/task.js";
import type { TaskStoreRegistry } from "../base/store.js";
import type { AnyWorkflowDescriptor } from "../base/workflow.js";
import type { Clock } from "../domain/clock.js";
import type { IdFactory } from "../domain/identifiers.js";
import { BrowserSessionIdSchema, PositiveIntSchema, WorkerIdSchema, WorkflowIdSchema } from "../domain/ids.js";
import type { BrowserSessionId, PositiveInt, WorkerId, WorkflowId } from "../domain/ids.js";
import { WorkerDirectiveSchema, type WorkerDirective } from "../domain/run/worker.js";
import type {
  CanonicalInputSnapshotMigration,
  CheckpointMigration,
} from "../domain/workflow/checkpoint.js";
import type {
  WorkerPlanAcknowledgementSchema,
  WorkerRuntimeAcknowledgementSchema,
  WorkerRuntimeContext,
  WorkerRuntimeExecutor,
} from "./command-kernel.js";
import type { ContentAddressedArtifactWriter } from "../base/artifacts.js";
import type { RunDiagnosticCapture } from "../base/diagnostics.js";
import type { MonotonicDeadlineScheduler } from "./deadline-scheduler.js";
import {
  executeClaimedRun,
  RunExecutionOutcomeSchema,
  type ChildRunExecutor,
  type RunArtifactProjector,
  type RunExecutionAuthority,
  type RunExecutionOutcome,
  type RunProviderWiring,
  type WriteSequencer,
} from "./run-executor.js";
import {
  browserSessionSpanPath,
  ExecutorSpanEventSchema,
  runSpanPath,
  workerSpanPath,
  type SpanEmitter,
} from "./span-emitter.js";
import {
  withBoundRunConfigFingerprint,
  WorkerSessionManager,
  type WorkerBrowserSessionFactory,
  type WorkerSessionEvent,
} from "./worker-sessions.js";
import type { DuoCeremonyGateFactory } from "./duo-ceremony-gate.js";

export interface WorkerLoopDependencies {
  readonly workflowId: WorkflowId;
  readonly workerId: WorkerId;
  readonly descriptor: AnyWorkflowDescriptor;
  readonly stores: TaskStoreRegistry;
  readonly authority: RunExecutionAuthority;
  readonly sessionFactory: WorkerBrowserSessionFactory;
  readonly emitter: SpanEmitter;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly scheduler: MonotonicDeadlineScheduler;
  readonly taskDeadlineMs: number;
  /**
   * D125 — `timeouts.sessionAcquireMs`: the bound on acquiring one browser
   * session (open + login), distinct from and much shorter than
   * `taskDeadlineMs`. Required, so a composition cannot fall back to the
   * whole-task deadline for session liveness.
   */
  readonly sessionAcquireMs: number;
  /** D267 (ref execution-and-sessions §10): the per-credential Duo ceremony lease gate factory. */
  readonly duoCeremony: DuoCeremonyGateFactory;
  readonly heartbeatIntervalMs: number;
  readonly idleRepollMs: number;
  readonly log: TaskLogger;
  /** Stop claiming and shut the worker down; the active run finishes first. */
  readonly stopSignal: AbortSignal;
  /**
   * `true` drains the queue once and returns at the first idle poll — the
   * Phase-1 harness/CLI mode. `false` keeps re-polling until `stopSignal`.
   */
  readonly exitWhenIdle: boolean;
  readonly checkpointMigrations?: readonly CheckpointMigration[];
  readonly canonicalInputMigrations?: readonly CanonicalInputSnapshotMigration[];
  readonly writeSequencer?: WriteSequencer;
  /**
   * Builds the ref write-safety write sequencer over the loop-OWNED `WorkerSessionManager`
   * (D116: the sequencer's driver leases must come from the exact manager whose
   * run-config-fingerprint window this loop binds). Production composition uses
   * this seam; `writeSequencer` stays for tests that pre-build one. Passing
   * both is a wiring error and fails loud.
   */
  readonly writeSequencerFor?: (sessions: WorkerSessionManager) => WriteSequencer;
  readonly childRuns?: ChildRunExecutor;
  /** Ref operator-trust §2.2's automatic bundle capture; absent means no bundle is minted. */
  readonly diagnostics?: RunDiagnosticCapture;
  /**
   * Ref data-intake-and-edit-data §4.11: the admitted-provider wiring and the kernel artifact writer,
   * forwarded verbatim to the executor. Absent, a contract declaring either
   * capability terminalizes with a structured failure naming the missing
   * wiring — the loop never substitutes a client or a writer.
   */
  readonly providers?: RunProviderWiring;
  readonly artifacts?: ContentAddressedArtifactWriter;
  /** Ref data-intake-and-edit-data §4.1's blocking sink projector; absent, a declaring node fails loud. */
  readonly artifactProjector?: RunArtifactProjector;
  /**
   * Ref dashboard-surfaces §2.4's durable worker directives, observed BETWEEN items: the loop
   * polls before each claim, so `stop` ends the loop only after the active run
   * settled and `pause` stops claiming without ending the worker. `stopSignal`
   * remains the mid-run abort channel (SIGINT / claim loss). A poll that
   * throws aborts the loop loudly — an unreadable directive is never "run".
   */
  readonly controlPoll?: () => WorkerDirective;
}

export const WorkerLoopReportSchema = z.strictObject({
  workerId: z.string().min(1),
  workflowId: z.string().min(1),
  outcomes: z.array(RunExecutionOutcomeSchema),
  /** `stop-directive` = the durable lease directive said stop, between items. */
  stopped: z.enum(["idle", "stop-signal", "stop-directive"]),
});
export type WorkerLoopReport = z.infer<typeof WorkerLoopReportSchema>;

/** Renew exactly one claim on a fixed cadence; a lost claim aborts the run. */
function startHeartbeat(input: Readonly<{
  authority: RunExecutionAuthority;
  runId: string;
  claim: Readonly<{ workerId: string; claimGeneration: number }>;
  clock: Clock;
  scheduler: MonotonicDeadlineScheduler;
  intervalMs: number;
  onLost: (message: string) => void;
}>): Readonly<{ stop: () => void }> {
  let stopped = false;
  let handle = { cancel: (): void => undefined };
  const tick = (): void => {
    if (stopped) return;
    const outcome = input.authority.authority.runs.renewClaim({
      runId: input.runId,
      claim: input.claim,
      now: input.clock.now().toISOString(),
    });
    if (outcome.state === "lost") {
      stopped = true;
      input.onLost(outcome.message);
      return;
    }
    handle = input.scheduler.schedule(input.clock.monotonicMs() + input.intervalMs, tick);
  };
  handle = input.scheduler.schedule(input.clock.monotonicMs() + input.intervalMs, tick);
  return Object.freeze({
    stop: (): void => {
      stopped = true;
      handle.cancel();
    },
  });
}

async function boundedWait(
  scheduler: MonotonicDeadlineScheduler,
  clock: Clock,
  ms: number,
  signal: AbortSignal,
): Promise<void> {
  if (ms <= 0 || signal.aborted) return;
  await new Promise<void>((resolve) => {
    const handle = scheduler.schedule(clock.monotonicMs() + ms, () => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    });
    const onAbort = (): void => {
      handle.cancel();
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function runWorkerLoop(deps: WorkerLoopDependencies): Promise<WorkerLoopReport> {
  const workflowId = WorkflowIdSchema.parse(deps.workflowId);
  const workerId = WorkerIdSchema.parse(deps.workerId);
  const { emitter, clock } = deps;
  const workerPath = workerSpanPath(workflowId, workerId);
  const instant = (): string => clock.now().toISOString();
  const emit = (event: Readonly<Record<string, unknown>>): void => {
    emitter.emit(ExecutorSpanEventSchema.parse({ ts: instant(), workflow: workflowId, ...event }));
  };

  const sessions = new WorkerSessionManager({
    workerId,
    workflowId,
    stores: deps.stores,
    factory: deps.sessionFactory,
    clock,
    scheduler: deps.scheduler,
    acquireDeadlineMs: deps.sessionAcquireMs,
    duoCeremony: deps.duoCeremony,
    onEvent: (event: WorkerSessionEvent): void => {
      const spanPath = browserSessionSpanPath(workflowId, workerId, event.system, event.sessionId);
      if (event.type === "browser-session:start") {
        emit({
          t: "span.started", kind: "browser", workerId, spanPath, parentSpanPath: workerPath,
          name: `browser-session:${event.system}`, system: event.system,
        });
        return;
      }
      if (event.type === "browser-session:close") {
        const clean = event.reason === "fresh-boundary"
          || event.reason === "parked"
          || event.reason === "worker-stop";
        emit({
          t: "span.ended", kind: "browser", workerId, spanPath, parentSpanPath: workerPath,
          outcome: clean ? "done" : "failed",
          ...(clean ? {} : { errorSummary: `browser session closed as ${event.reason}` }),
        });
      }
      // resets are lease hygiene, not span boundaries.
    },
  });

  if (deps.writeSequencer !== undefined && deps.writeSequencerFor !== undefined) {
    throw new Error(
      `worker ${workerId} received both writeSequencer and writeSequencerFor; exactly one seam may own the sequencer`,
    );
  }
  const writeSequencer = deps.writeSequencer ?? deps.writeSequencerFor?.(sessions);

  emit({ t: "span.started", kind: "worker", workerId, spanPath: workerPath, name: workflowId });

  const outcomes: RunExecutionOutcome[] = [];
  let stopped: "idle" | "stop-signal" | "stop-directive" = "stop-signal";
  try {
    while (!deps.stopSignal.aborted) {
      // Between items only: the active run always settles before the next poll.
      const directive = deps.controlPoll === undefined
        ? "run"
        : WorkerDirectiveSchema.parse(deps.controlPoll());
      if (directive === "stop") {
        stopped = "stop-directive";
        break;
      }
      if (directive === "pause") {
        // Paused: claim nothing, keep the worker alive, re-poll on the bounded
        // idle cadence (ref execution-and-sessions §3 — a worker never sleeps unboundedly).
        await boundedWait(deps.scheduler, clock, deps.idleRepollMs, deps.stopSignal);
        continue;
      }
      const claimed = deps.authority.authority.runs.claimNext({
        workflow: workflowId,
        workerId,
        now: instant(),
      });
      if (claimed.state === "idle") {
        if (deps.exitWhenIdle) {
          stopped = "idle";
          break;
        }
        await boundedWait(deps.scheduler, clock, deps.idleRepollMs, deps.stopSignal);
        continue;
      }
      if (claimed.state === "deferred") {
        if (deps.exitWhenIdle) {
          stopped = "idle";
          break;
        }
        const untilMs = Math.max(0, Date.parse(claimed.nextEligibleAt) - clock.nowMs());
        await boundedWait(deps.scheduler, clock, Math.min(untilMs, deps.idleRepollMs), deps.stopSignal);
        continue;
      }

      const run = claimed.run;
      const claim = {
        workerId,
        claimGeneration: run.claimGeneration,
      };
      emit({
        t: "run.claimed",
        runId: run.envelope.runId,
        attempt: run.envelope.attempt,
        traceId: run.envelope.traceId,
        spanPath: runSpanPath(run.envelope.traceId),
        workerId,
      });

      const runController = new AbortController();
      const onStop = (): void => {
        runController.abort(new Error(`worker ${workerId} received its stop signal mid-run`));
      };
      deps.stopSignal.addEventListener("abort", onStop, { once: true });
      const heartbeat = startHeartbeat({
        authority: deps.authority,
        runId: run.envelope.runId,
        claim,
        clock,
        scheduler: deps.scheduler,
        intervalMs: deps.heartbeatIntervalMs,
        onLost: (message: string): void => {
          runController.abort(new Error(`claim lost during heartbeat renewal: ${message}`));
        },
      });
      try {
        // D116: the claimed run's immutable config fingerprint becomes part of
        // the session reuse identity for every driver lease this run takes —
        // bound for exactly the execution window, released on every exit.
        const outcome = await withBoundRunConfigFingerprint(
          sessions,
          run.envelope.configFingerprint,
          () => executeClaimedRun({
            descriptor: deps.descriptor,
            stores: deps.stores,
            authority: deps.authority,
            sessions,
            emitter,
            clock,
            ids: deps.ids,
            scheduler: deps.scheduler,
            taskDeadlineMs: deps.taskDeadlineMs,
            log: deps.log,
            ...(deps.checkpointMigrations === undefined ? {} : { checkpointMigrations: deps.checkpointMigrations }),
            ...(deps.canonicalInputMigrations === undefined
              ? {}
              : { canonicalInputMigrations: deps.canonicalInputMigrations }),
            ...(writeSequencer === undefined ? {} : { writeSequencer }),
            ...(deps.childRuns === undefined ? {} : { childRuns: deps.childRuns }),
            ...(deps.diagnostics === undefined ? {} : { diagnostics: deps.diagnostics }),
            ...(deps.providers === undefined ? {} : { providers: deps.providers }),
            ...(deps.artifacts === undefined ? {} : { artifacts: deps.artifacts }),
            ...(deps.artifactProjector === undefined ? {} : { artifactProjector: deps.artifactProjector }),
          }, { run, claim, signal: runController.signal }),
        );
        outcomes.push(outcome);
      } finally {
        heartbeat.stop();
        deps.stopSignal.removeEventListener("abort", onStop);
      }
    }
  } finally {
    await sessions.closeAll("worker-stop");
    emit({ t: "span.ended", kind: "worker", workerId, spanPath: workerPath, outcome: "done" });
  }
  return WorkerLoopReportSchema.parse({ workerId, workflowId, outcomes, stopped });
}

/* ── the kernel's WorkerRuntimeExecutor seam, Phase-1 shape (ref execution-and-sessions §0) ──── */

/**
 * Process effects behind the kernel's worker/browser arms. Phase 1 runs ONE
 * worker per workflow with one active item; the supervisor that spawns real
 * processes is composition-owned and injected here.
 */
export interface WorkerProcessSupervisor {
  /** Start the explicit Phase-1 pool member and return evidence that it started. */
  spawnWorker(input: WorkerPoolMember): unknown;
  refreshBrowser?(input: Readonly<{ member: WorkerPoolMember; browserSessionId: BrowserSessionId }>): unknown;
  reopenBrowser?(input: Readonly<{ member: WorkerPoolMember; browserSessionId: BrowserSessionId }>): unknown;
}

export function poolWorkerId(workflowId: WorkflowId, poolIndex: PositiveInt): WorkerId {
  return WorkerIdSchema.parse(`${workflowId}-worker-${String(poolIndex)}`);
}

export function phase1WorkerId(workflowId: WorkflowId): WorkerId {
  return poolWorkerId(workflowId, PositiveIntSchema.parse(1));
}

export const MAX_WORKERS_PER_POOL = 3;
export const WORKER_GRACEFUL_STOP_TIMEOUT_MS = 120_000;
export const WORKER_SIGTERM_TIMEOUT_MS = 30_000;

const PoolSizeSchema = PositiveIntSchema.refine(
  (value) => value <= MAX_WORKERS_PER_POOL,
  `worker pool size must not exceed ${String(MAX_WORKERS_PER_POOL)}`,
);

export const WorkerPoolMemberSchema = z.strictObject({
  workflowId: WorkflowIdSchema,
  poolIndex: PoolSizeSchema,
  workerId: WorkerIdSchema,
}).superRefine((member, context) => {
  const expectedWorkerId = `${member.workflowId}-worker-${String(member.poolIndex)}`;
  if (member.workerId !== expectedWorkerId) {
    context.addIssue({
      code: "custom",
      message: `pool member index ${String(member.poolIndex)} for ${member.workflowId} requires worker id ${expectedWorkerId}`,
      path: ["workerId"],
    });
  }
});
export type WorkerPoolMember = z.infer<typeof WorkerPoolMemberSchema>;

export const WorkerStopEscalationSchema = z.tuple([
  z.strictObject({
    stage: z.literal("graceful-stop-requested"),
    timeoutMs: z.literal(WORKER_GRACEFUL_STOP_TIMEOUT_MS),
  }),
  z.strictObject({
    stage: z.literal("sigterm-sent"),
    timeoutMs: z.literal(WORKER_SIGTERM_TIMEOUT_MS),
  }),
  z.strictObject({ stage: z.literal("sigkill-sent") }),
]);
export type WorkerStopEscalation = Readonly<z.infer<typeof WorkerStopEscalationSchema>>;

export const WorkerPoolMemberReconciliationFactSchema = z.discriminatedUnion("stage", [
  z.strictObject({
    member: WorkerPoolMemberSchema,
    stage: z.literal("running"),
    ownership: z.enum(["supervised", "external"]),
  }),
  z.strictObject({
    member: WorkerPoolMemberSchema,
    stage: z.literal("unmet"),
    reason: z.enum(["not-started", "crashed"]),
  }),
  z.strictObject({
    member: WorkerPoolMemberSchema,
    stage: z.literal("graceful-stop-requested"),
    escalation: WorkerStopEscalationSchema,
  }),
]);
export type WorkerPoolMemberReconciliationFact = z.infer<typeof WorkerPoolMemberReconciliationFactSchema>;

export const WorkerPoolReconciliationAcknowledgementSchema = z.strictObject({
  command: z.literal("plan-worker-count"),
  state: z.literal("acknowledged"),
  desiredWorkers: PoolSizeSchema,
  members: z.array(WorkerPoolMemberReconciliationFactSchema).min(1).max(MAX_WORKERS_PER_POOL),
});
export type WorkerPoolReconciliationAcknowledgement = z.infer<
  typeof WorkerPoolReconciliationAcknowledgementSchema
>;

const WorkerSpawnAcknowledgementSchema = z.strictObject({
  command: z.literal("spawn-worker"),
  state: z.literal("acknowledged"),
  member: WorkerPoolMemberSchema,
  stage: z.literal("started"),
});

const WorkerStopAcknowledgementSchema = z.strictObject({
  command: z.literal("stop-worker"),
  state: z.literal("acknowledged"),
  member: WorkerPoolMemberSchema,
  stage: z.literal("graceful-stop-requested"),
  escalation: WorkerStopEscalationSchema,
});

const WorkerPauseAcknowledgementSchema = z.strictObject({
  command: z.literal("pause-worker"),
  state: z.literal("acknowledged"),
  member: WorkerPoolMemberSchema,
  stage: z.literal("pause-requested"),
});

const WorkerResumeAcknowledgementSchema = z.strictObject({
  command: z.literal("resume-worker"),
  state: z.literal("acknowledged"),
  member: WorkerPoolMemberSchema,
  stage: z.literal("resume-requested"),
});

const WorkerRefreshAcknowledgementSchema = z.strictObject({
  command: z.literal("refresh-browser"),
  state: z.literal("acknowledged"),
  member: WorkerPoolMemberSchema,
  browserSessionId: BrowserSessionIdSchema,
  stage: z.literal("refreshed"),
});

const WorkerReopenAcknowledgementSchema = z.strictObject({
  command: z.literal("reopen-browser"),
  state: z.literal("acknowledged"),
  member: WorkerPoolMemberSchema,
  browserSessionId: BrowserSessionIdSchema,
  stage: z.literal("reopened"),
});

export const WorkerSupervisorAcknowledgementSchema = z.discriminatedUnion("command", [
  WorkerPoolReconciliationAcknowledgementSchema,
  WorkerSpawnAcknowledgementSchema,
  WorkerStopAcknowledgementSchema,
  WorkerPauseAcknowledgementSchema,
  WorkerResumeAcknowledgementSchema,
  WorkerRefreshAcknowledgementSchema,
  WorkerReopenAcknowledgementSchema,
]);
export type WorkerSupervisorAcknowledgement = z.infer<typeof WorkerSupervisorAcknowledgementSchema>;

export interface WorkerPoolPlanRequest {
  readonly command: "plan-worker-count";
  readonly workflowId: WorkflowId;
  readonly desiredWorkers: PositiveInt;
  /** The desired roster: canonical members at indices 1..desiredWorkers. */
  readonly members: readonly WorkerPoolMember[];
  /**
   * The AUTHORITATIVE excess set: every canonical index above `desiredWorkers`
   * up to `MAX_WORKERS_PER_POOL`. A scale-down names these explicitly, and the
   * acknowledgement must cover each of them with a bounded graceful stop —
   * omitting one, or stopping a desired index instead, refuses.
   */
  readonly excessMembers: readonly WorkerPoolMember[];
}

export interface WorkerPoolSpawnRequest {
  readonly command: "spawn-worker";
  readonly member: WorkerPoolMember;
}

export interface WorkerPoolStopRequest {
  readonly command: "stop-worker";
  readonly member: WorkerPoolMember;
  readonly escalation: WorkerStopEscalation;
}

export interface WorkerPoolPauseRequest {
  readonly command: "pause-worker";
  readonly member: WorkerPoolMember;
}

export interface WorkerPoolResumeRequest {
  readonly command: "resume-worker";
  readonly member: WorkerPoolMember;
}

export interface WorkerPoolRefreshRequest {
  readonly command: "refresh-browser";
  readonly member: WorkerPoolMember;
  readonly browserSessionId: BrowserSessionId;
}

export interface WorkerPoolReopenRequest {
  readonly command: "reopen-browser";
  readonly member: WorkerPoolMember;
  readonly browserSessionId: BrowserSessionId;
}

export type WorkerSupervisorRequest =
  | WorkerPoolPlanRequest
  | WorkerPoolSpawnRequest
  | WorkerPoolStopRequest
  | WorkerPoolPauseRequest
  | WorkerPoolResumeRequest
  | WorkerPoolRefreshRequest
  | WorkerPoolReopenRequest;

/**
 * The pool supervisor's ONE effect seam. `execute` may return the
 * acknowledgement synchronously or as a promise of it: the runtime executor
 * AWAITS the result before validating, so a process/browser effect is proved
 * settled before anything is acknowledged — success is never fabricated ahead
 * of the effect, and a failed effect rejects the command instead of
 * acknowledging it.
 */
export interface WorkerPoolProcessSupervisor {
  execute(request: WorkerSupervisorRequest): unknown;
}

/**
 * Every pool control is awaitable: the acknowledgement settles only after the
 * supervisor's effect settled (the kernel's synchronous Phase-1 seam keeps
 * `createPhase1WorkerRuntimeExecutor`, which refuses pending effects instead).
 */
export interface WorkerPoolRuntimeExecutor extends WorkerRuntimeExecutor {
  planWorkerCount(context: WorkerRuntimeContext): Promise<unknown>;
  spawnWorker(context: WorkerRuntimeContext): Promise<unknown>;
  refreshBrowser(context: WorkerRuntimeContext): Promise<unknown>;
  reopenBrowser(context: WorkerRuntimeContext): Promise<unknown>;
  stopWorker(context: WorkerRuntimeContext): Promise<unknown>;
  pauseWorker(context: WorkerRuntimeContext): Promise<unknown>;
  resumeWorker(context: WorkerRuntimeContext): Promise<unknown>;
}

/**
 * Members are FROZEN at mint: every acknowledgement is compared against the
 * original request scalars, so a supervisor that mutates the submitted request
 * after the fact fails loudly instead of steering what gets acknowledged.
 */
function poolMember(workflowId: WorkflowId, poolIndex: number): WorkerPoolMember {
  const parsedIndex = PoolSizeSchema.parse(poolIndex);
  return Object.freeze(WorkerPoolMemberSchema.parse({
    workflowId,
    poolIndex: parsedIndex,
    workerId: poolWorkerId(workflowId, parsedIndex),
  }));
}

function poolMemberFromIdentity(workerId: WorkerId): WorkerPoolMember {
  const match = /^(?<workflowId>.+)-worker-(?<poolIndex>[1-9]\d*)$/.exec(workerId);
  if (match?.groups === undefined) {
    throw new Error(`worker ${workerId} must carry an explicit positive pool index`);
  }
  const workflowId = WorkflowIdSchema.parse(match.groups.workflowId);
  const rawIndex = match.groups.poolIndex;
  const member = poolMember(workflowId, Number(rawIndex));
  if (member.workerId !== workerId) {
    throw new Error(`worker ${workerId} is not the canonical identity for pool index ${rawIndex}`);
  }
  return member;
}

function poolMemberFromWorkerId(workflowId: WorkflowId, workerId: WorkerId): WorkerPoolMember {
  const member = poolMemberFromIdentity(workerId);
  if (member.workflowId !== workflowId) {
    throw new Error(`worker ${workerId} is not a pool member of workflow ${workflowId}`);
  }
  return member;
}

function workerStopEscalation(): WorkerStopEscalation {
  const escalation = WorkerStopEscalationSchema.parse([
    { stage: "graceful-stop-requested", timeoutMs: WORKER_GRACEFUL_STOP_TIMEOUT_MS },
    { stage: "sigterm-sent", timeoutMs: WORKER_SIGTERM_TIMEOUT_MS },
    { stage: "sigkill-sent" },
  ]);
  for (const stage of escalation) Object.freeze(stage);
  return Object.freeze(escalation);
}

function requireSameMember(
  command: WorkerSupervisorRequest["command"],
  expected: WorkerPoolMember,
  acknowledged: WorkerPoolMember,
): void {
  if (
    acknowledged.workflowId !== expected.workflowId
    || acknowledged.poolIndex !== expected.poolIndex
    || acknowledged.workerId !== expected.workerId
  ) {
    throw new Error(
      `${command} requested member ${expected.workerId} at index ${String(expected.poolIndex)} but the supervisor `
      + `acknowledged ${acknowledged.workerId} at index ${String(acknowledged.poolIndex)}`,
    );
  }
}

function requireSupervisorAcknowledgement(command: WorkerSupervisorRequest["command"], value: unknown): unknown {
  if (value === undefined) {
    throw new Error(`${command} supervisor acknowledgement is required; refusing to accept an unproved effect`);
  }
  if (
    typeof value === "object"
    && value !== null
    && "then" in value
    && typeof value.then === "function"
  ) {
    // The kernel consumes this seam inside its synchronous authority
    // transaction, so a pending effect can never be awaited here. Refusing is
    // the only honest answer: acknowledging now would fabricate a success the
    // process has not proved. An asynchronous supervisor belongs behind the
    // awaitable `WorkerPoolProcessSupervisor.execute` seam instead.
    throw new Error(
      `${command} supervisor returned a pending promise; the synchronous phase-1 seam cannot prove the effect `
      + "before acknowledging it — use the pool contract's awaitable execute seam",
    );
  }
  return value;
}

/**
 * The pool-capable runtime adapter. The supervisor acknowledges exact member
 * facts before the kernel may persist the declaration; an `accepted` envelope
 * is never manufactured from a missing or mismatched process observation.
 */
export function createWorkerPoolRuntimeExecutor(
  supervisor: WorkerPoolProcessSupervisor,
): WorkerPoolRuntimeExecutor {
  return Object.freeze({
    async planWorkerCount(context: WorkerRuntimeContext): Promise<z.input<typeof WorkerPlanAcknowledgementSchema>> {
      const { command } = context;
      if (command.type !== "plan-worker-count") {
        throw new Error(`planWorkerCount received a ${command.type} command`);
      }
      const desiredWorkers = PoolSizeSchema.parse(command.payload.desiredWorkers);
      const members = Object.freeze(Array.from(
        { length: desiredWorkers },
        (_, offset) => poolMember(command.target.workflowId, offset + 1),
      ));
      // The authoritative excess set: pool identities are deterministic and
      // capped at MAX_WORKERS_PER_POOL, so a plan for N workers names indices
      // N+1..MAX as the EXACT members whose bounded graceful stop the
      // acknowledgement must cover.
      const excessMembers = Object.freeze(Array.from(
        { length: MAX_WORKERS_PER_POOL - desiredWorkers },
        (_, offset) => poolMember(command.target.workflowId, desiredWorkers + offset + 1),
      ));
      const roster = Object.freeze([...members, ...excessMembers]);
      // Snapshot the acknowledged ids BEFORE the supervisor sees the request:
      // the accepted plan names the original scalars, never a post-submission
      // rewrite (the frozen roster makes such a rewrite throw anyway).
      const plannedWorkerIds = Object.freeze(members.map(({ workerId }) => workerId));
      const acknowledgement = WorkerPoolReconciliationAcknowledgementSchema.parse(await supervisor.execute(Object.freeze({
        command: "plan-worker-count",
        workflowId: command.target.workflowId,
        desiredWorkers,
        members,
        excessMembers,
      })));
      if (acknowledgement.desiredWorkers !== desiredWorkers) {
        throw new Error(
          `plan-worker-count requested ${String(desiredWorkers)} workers but the supervisor acknowledged `
          + String(acknowledgement.desiredWorkers),
        );
      }
      for (const [offset, expected] of roster.entries()) {
        const fact = acknowledgement.members[offset];
        if (fact === undefined) {
          throw new Error(
            offset < desiredWorkers
              ? `plan-worker-count requires acknowledgement for desired member ${expected.workerId} `
                + `at index ${String(offset + 1)}`
              : `plan-worker-count requires a bounded graceful stop acknowledgement for excess member `
                + `${expected.workerId} at index ${String(offset + 1)}`,
          );
        }
        requireSameMember("plan-worker-count", expected, fact.member);
        if (offset < desiredWorkers && fact.stage === "graceful-stop-requested") {
          throw new Error(
            `plan-worker-count cannot stop desired member ${fact.member.workerId} at index ${String(offset + 1)}`,
          );
        }
        if (offset >= desiredWorkers && fact.stage !== "graceful-stop-requested") {
          throw new Error(
            `plan-worker-count must select excess member ${fact.member.workerId} for bounded graceful stop`,
          );
        }
      }
      return { state: "accepted", workerIds: [...plannedWorkerIds] };
    },
    async spawnWorker(context: WorkerRuntimeContext): Promise<z.input<typeof WorkerRuntimeAcknowledgementSchema>> {
      const { command } = context;
      if (command.type !== "spawn-worker") {
        throw new Error(`spawnWorker received a ${command.type} command`);
      }
      const member = poolMemberFromWorkerId(command.target.workflowId, command.payload.workerId);
      const acknowledgement = WorkerSpawnAcknowledgementSchema.parse(await supervisor.execute(Object.freeze({
        command: "spawn-worker",
        member,
      })));
      requireSameMember("spawn-worker", member, acknowledgement.member);
      return { state: "accepted" };
    },
    async stopWorker(context: WorkerRuntimeContext): Promise<z.input<typeof WorkerRuntimeAcknowledgementSchema>> {
      const { command } = context;
      if (command.type !== "stop-worker") {
        throw new Error(`stopWorker received a ${command.type} command`);
      }
      const member = poolMemberFromIdentity(command.target.workerId);
      const escalation = workerStopEscalation();
      const acknowledgement = WorkerStopAcknowledgementSchema.parse(await supervisor.execute(Object.freeze({
        command: "stop-worker",
        member,
        escalation,
      })));
      requireSameMember("stop-worker", member, acknowledgement.member);
      return { state: "accepted" };
    },
    async pauseWorker(context: WorkerRuntimeContext): Promise<z.input<typeof WorkerRuntimeAcknowledgementSchema>> {
      const { command } = context;
      if (command.type !== "pause-worker") {
        throw new Error(`pauseWorker received a ${command.type} command`);
      }
      const member = poolMemberFromIdentity(command.target.workerId);
      const acknowledgement = WorkerPauseAcknowledgementSchema.parse(await supervisor.execute(Object.freeze({
        command: "pause-worker",
        member,
      })));
      requireSameMember("pause-worker", member, acknowledgement.member);
      return { state: "accepted" };
    },
    async resumeWorker(context: WorkerRuntimeContext): Promise<z.input<typeof WorkerRuntimeAcknowledgementSchema>> {
      const { command } = context;
      if (command.type !== "resume-worker") {
        throw new Error(`resumeWorker received a ${command.type} command`);
      }
      const member = poolMemberFromIdentity(command.target.workerId);
      const acknowledgement = WorkerResumeAcknowledgementSchema.parse(await supervisor.execute(Object.freeze({
        command: "resume-worker",
        member,
      })));
      requireSameMember("resume-worker", member, acknowledgement.member);
      return { state: "accepted" };
    },
    async refreshBrowser(context: WorkerRuntimeContext): Promise<z.input<typeof WorkerRuntimeAcknowledgementSchema>> {
      const { command } = context;
      if (command.type !== "refresh-browser") {
        throw new Error(`refreshBrowser received a ${command.type} command`);
      }
      const member = poolMemberFromIdentity(command.target.workerId);
      const acknowledgement = WorkerRefreshAcknowledgementSchema.parse(await supervisor.execute(Object.freeze({
        command: "refresh-browser",
        member,
        browserSessionId: command.target.browserSessionId,
      })));
      requireSameMember("refresh-browser", member, acknowledgement.member);
      if (acknowledgement.browserSessionId !== command.target.browserSessionId) {
        throw new Error(
          `refresh-browser requested session ${command.target.browserSessionId} but the supervisor acknowledged `
          + acknowledgement.browserSessionId,
        );
      }
      return { state: "accepted" };
    },
    async reopenBrowser(context: WorkerRuntimeContext): Promise<z.input<typeof WorkerRuntimeAcknowledgementSchema>> {
      const { command } = context;
      if (command.type !== "reopen-browser") {
        throw new Error(`reopenBrowser received a ${command.type} command`);
      }
      const member = poolMemberFromIdentity(command.target.workerId);
      const acknowledgement = WorkerReopenAcknowledgementSchema.parse(await supervisor.execute(Object.freeze({
        command: "reopen-browser",
        member,
        browserSessionId: command.target.browserSessionId,
      })));
      requireSameMember("reopen-browser", member, acknowledgement.member);
      if (acknowledgement.browserSessionId !== command.target.browserSessionId) {
        throw new Error(
          `reopen-browser requested session ${command.target.browserSessionId} but the supervisor acknowledged `
          + acknowledgement.browserSessionId,
        );
      }
      return { state: "accepted" };
    },
  });
}

/**
 * The Phase-1 `WorkerRuntimeExecutor`: exactly one worker per workflow (ref execution-and-sessions
 * §0.3 scoped to this phase's single-operator runtime). A plan asking for more
 * throws — the command unwinds rather than acknowledging capacity that does
 * not exist — and the browser arms fail loud until the 1g supervisor can
 * actually reach a live worker's session set.
 */
export function createPhase1WorkerRuntimeExecutor(
  supervisor: WorkerProcessSupervisor,
): WorkerRuntimeExecutor {
  return Object.freeze({
    planWorkerCount(context: WorkerRuntimeContext): z.input<typeof WorkerPlanAcknowledgementSchema> {
      const { command } = context;
      if (command.type !== "plan-worker-count") {
        throw new Error(`planWorkerCount received a ${command.type} command`);
      }
      if (command.payload.desiredWorkers !== 1) {
        throw new Error(
          `Phase 1 runs exactly one worker per workflow; a plan for `
          + `${String(command.payload.desiredWorkers)} workers is not reconcilable yet`,
        );
      }
      return { state: "accepted", workerIds: [phase1WorkerId(command.target.workflowId)] };
    },
    spawnWorker(context: WorkerRuntimeContext): z.input<typeof WorkerRuntimeAcknowledgementSchema> {
      const { command } = context;
      if (command.type !== "spawn-worker") {
        throw new Error(`spawnWorker received a ${command.type} command`);
      }
      const member = poolMemberFromWorkerId(command.target.workflowId, command.payload.workerId);
      const acknowledgement = WorkerSpawnAcknowledgementSchema.parse(requireSupervisorAcknowledgement(
        "spawn-worker",
        supervisor.spawnWorker(member),
      ));
      requireSameMember("spawn-worker", member, acknowledgement.member);
      return { state: "accepted" };
    },
    refreshBrowser(context: WorkerRuntimeContext): z.input<typeof WorkerRuntimeAcknowledgementSchema> {
      const { command } = context;
      if (command.type !== "refresh-browser") {
        throw new Error(`refreshBrowser received a ${command.type} command`);
      }
      if (supervisor.refreshBrowser === undefined) {
        throw new Error(
          "refresh-browser requires the 1g browser supervisor; refusing to acknowledge an effect that did not happen",
        );
      }
      const member = poolMemberFromIdentity(command.target.workerId);
      const acknowledgement = WorkerRefreshAcknowledgementSchema.parse(requireSupervisorAcknowledgement(
        "refresh-browser",
        supervisor.refreshBrowser(Object.freeze({
          member,
          browserSessionId: command.target.browserSessionId,
        })),
      ));
      requireSameMember("refresh-browser", member, acknowledgement.member);
      if (acknowledgement.browserSessionId !== command.target.browserSessionId) {
        throw new Error(
          `refresh-browser requested session ${command.target.browserSessionId} but the supervisor acknowledged `
          + acknowledgement.browserSessionId,
        );
      }
      return { state: "accepted" };
    },
    reopenBrowser(context: WorkerRuntimeContext): z.input<typeof WorkerRuntimeAcknowledgementSchema> {
      const { command } = context;
      if (command.type !== "reopen-browser") {
        throw new Error(`reopenBrowser received a ${command.type} command`);
      }
      if (supervisor.reopenBrowser === undefined) {
        throw new Error(
          "reopen-browser requires the 1g browser supervisor; refusing to acknowledge an effect that did not happen",
        );
      }
      const member = poolMemberFromIdentity(command.target.workerId);
      const acknowledgement = WorkerReopenAcknowledgementSchema.parse(requireSupervisorAcknowledgement(
        "reopen-browser",
        supervisor.reopenBrowser(Object.freeze({
          member,
          browserSessionId: command.target.browserSessionId,
        })),
      ));
      requireSameMember("reopen-browser", member, acknowledgement.member);
      if (acknowledgement.browserSessionId !== command.target.browserSessionId) {
        throw new Error(
          `reopen-browser requested session ${command.target.browserSessionId} but the supervisor acknowledged `
          + acknowledgement.browserSessionId,
        );
      }
      return { state: "accepted" };
    },
  });
}
