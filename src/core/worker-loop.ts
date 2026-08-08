/**
 * The Phase-1 worker run loop (doc 05 §3): one workflow-scoped worker, one
 * active item, claim → execute → terminal/park, then the next eligible row.
 *
 * The loop owns exactly the concerns the interpreter cannot: claiming (the
 * store enforces the one-active-item invariant), heartbeat renewal during long
 * operations (a lost heartbeat aborts the run's signal instead of letting a
 * zombie keep driving a browser), the worker-lifetime browser-session set
 * (warm reuse across sequential items — doc 05 §5 — with `worker-stop` close
 * proof at the end), and worker/browser span emission over the injected
 * `SpanEmitter`.
 *
 * Idle behavior is doc 05 §3's bounded re-poll: `deferred` sleeps exactly
 * until the earliest `not_before`, capped by `idleRepollMs`; a worker never
 * sleeps while owning a run.
 */
import { z } from "zod";
import type { TaskLogger } from "../base/task.js";
import type { TaskStoreRegistry } from "../base/store.js";
import type { AnyWorkflowDescriptor } from "../base/workflow.js";
import type { Clock } from "../domain/clock.js";
import type { IdFactory } from "../domain/identifiers.js";
import { WorkerIdSchema, WorkflowIdSchema } from "../domain/ids.js";
import type { WorkerId, WorkflowId } from "../domain/ids.js";
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
   * Builds the doc-09 write sequencer over the loop-OWNED `WorkerSessionManager`
   * (D116: the sequencer's driver leases must come from the exact manager whose
   * run-config-fingerprint window this loop binds). Production composition uses
   * this seam; `writeSequencer` stays for tests that pre-build one. Passing
   * both is a wiring error and fails loud.
   */
  readonly writeSequencerFor?: (sessions: WorkerSessionManager) => WriteSequencer;
  readonly childRuns?: ChildRunExecutor;
  /** Doc 12 §2.2's automatic bundle capture; absent means no bundle is minted. */
  readonly diagnostics?: RunDiagnosticCapture;
  /**
   * Doc 06 §4.11: the admitted-provider wiring and the kernel artifact writer,
   * forwarded verbatim to the executor. Absent, a contract declaring either
   * capability terminalizes with a structured failure naming the missing
   * wiring — the loop never substitutes a client or a writer.
   */
  readonly providers?: RunProviderWiring;
  readonly artifacts?: ContentAddressedArtifactWriter;
  /**
   * Doc 03 §2.4's durable worker directives, observed BETWEEN items: the loop
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
        // idle cadence (doc 05 §3 — a worker never sleeps unboundedly).
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

/* ── the kernel's WorkerRuntimeExecutor seam, Phase-1 shape (doc 05 §0) ──── */

/**
 * Process effects behind the kernel's worker/browser arms. Phase 1 runs ONE
 * worker per workflow with one active item; the supervisor that spawns real
 * processes is composition-owned and injected here.
 */
export interface WorkerProcessSupervisor {
  /** Start (or verify) the single Phase-1 worker process for a workflow. */
  spawnWorker(input: Readonly<{ workflowId: WorkflowId; workerId: WorkerId }>): void;
  refreshBrowser?(input: Readonly<{ workerId: WorkerId; browserSessionId: string }>): void;
  reopenBrowser?(input: Readonly<{ workerId: WorkerId; browserSessionId: string }>): void;
}

export function phase1WorkerId(workflowId: WorkflowId): WorkerId {
  return WorkerIdSchema.parse(`${workflowId}-worker-1`);
}

/**
 * The Phase-1 `WorkerRuntimeExecutor`: exactly one worker per workflow (doc 05
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
      supervisor.spawnWorker({
        workflowId: command.target.workflowId,
        workerId: command.payload.workerId,
      });
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
      supervisor.refreshBrowser({
        workerId: command.target.workerId,
        browserSessionId: command.target.browserSessionId,
      });
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
      supervisor.reopenBrowser({
        workerId: command.target.workerId,
        browserSessionId: command.target.browserSessionId,
      });
      return { state: "accepted" };
    },
  });
}
