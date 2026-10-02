import type { WorkerBrowserObservation } from "../../domain/worker-control.js";
import type { RunRecord } from "../../domain/run/record.js";
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
import { CURRENT_DIAGNOSTIC_SAFETY_VERSION } from "../../domain/trust/failure.js";
import type { TaskLogger } from "../../base/task.js";
import type { TaskStoreRegistry } from "../../base/store.js";
import type { AnyWorkflowDescriptor } from "../../base/workflow.js";
import type { Clock } from "../../domain/clock.js";
import type { IdFactory } from "../../domain/identifiers.js";
import {
  ActorIdSchema,
  BrowserSessionIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  PositiveIntSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../../domain/ids.js";
import type { BrowserSessionId, PositiveInt, WorkerId, WorkflowId } from "../../domain/ids.js";
import type { BrowserPresentationMode } from "../../domain/run/envelope.js";
import { WorkerDirectiveSchema, type WorkerDirective } from "../../domain/run/worker.js";
import type {
  CanonicalInputSnapshotMigration,
  CheckpointMigration,
} from "../../domain/workflow/checkpoint.js";
import type {
  WorkerPlanAcknowledgementSchema,
  WorkerRuntimeAcknowledgementSchema,
  WorkerRuntimeContext,
  WorkerRuntimeExecutor,
} from "../runs/command-kernel.js";
import type { ContentAddressedArtifactWriter } from "../../base/artifacts.js";
import type { RunDiagnosticCapture } from "../../base/diagnostics.js";
import type { RunBrowserScreenshotCapture } from "../../base/diagnostics.js";
import type { NoteJsonlWriter } from "../storage/events/note-jsonl-writer.js";
import type { GateSourceRuntime } from "./gate-source-runtime.js";
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
  workerSpanPath,
  type SpanEmitter,
} from "../../core/span-emitter.js";
import {
  withBoundRunConfigFingerprint,
  WorkerSessionManager,
  type WorkerBrowserSessionFactory,
  type WorkerSessionEvent,
} from "./worker-sessions.js";
import type { DuoCeremonyGateFactory } from "./duo-ceremony-gate.js";
import { decideIdleClaim } from "./policies/idle-claim.js";

import { lifecycleCommandId, requireLifecycleApplied, type WorkerRunLifecyclePort, type RunMutationOutcome } from "../runs/run-record-service.js";

type WorkerClaimRequest = Readonly<{
  commandId: string;
  workflow: WorkflowId;
  workerId: WorkerId;
  now: string;
  configFingerprint?: string;
}>;

export interface WorkerRunResources {
 readonly sessionFactory: WorkerBrowserSessionFactory;
 readonly duoCeremony: DuoCeremonyGateFactory;
 readonly taskDeadlineMs: number;
 readonly sessionAcquireMs: number;
 readonly defaultBrowserMode: BrowserPresentationMode;
 readonly providers?: RunProviderWiring;
}
export interface WorkerLoopDependencies {
 readonly resourcesForRun?: (run:RunRecord)=>WorkerRunResources;
 readonly idleCadence?: ()=>number;
  readonly workflowId: WorkflowId;
  readonly workerId: WorkerId;
  readonly descriptor: AnyWorkflowDescriptor;
  readonly stores: TaskStoreRegistry;
  readonly authority: RunExecutionAuthority;
  readonly lifecycle: WorkerRunLifecyclePort;
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
  /** Compatibility mode used only by historical envelopes with no browserMode. */
  readonly defaultBrowserMode?: BrowserPresentationMode;
  /** D267 (ref execution-and-sessions §10): the per-credential Duo ceremony lease gate factory. */
  readonly duoCeremony: DuoCeremonyGateFactory;
  readonly heartbeatIntervalMs: number;
  readonly idleRepollMs: number;
  readonly log: TaskLogger;
  /** Run messages and browser actions; transaction callbacks stay outside this sink. */
  readonly taskNotes?: Pick<NoteJsonlWriter, "emitRunLog" | "emitRunAction">;
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
  readonly writeSequencerFor?: (sessions: WorkerSessionManager, taskDeadlineMs:number) => WriteSequencer;
  readonly childRuns?: ChildRunExecutor;
  readonly gateSources?: GateSourceRuntime;
  /** Ref operator-trust §2.2's automatic bundle capture; absent means no bundle is minted. */
  readonly diagnostics?: RunDiagnosticCapture;
  /** Explicit per-run screenshot persistence, executed while a lease owns its page. */
  readonly browserScreenshotCapture?: RunBrowserScreenshotCapture;
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
  readonly browserControl?: (sessions: WorkerSessionManager) => Promise<void>;
  readonly browserObservation?: (observation: Omit<WorkerBrowserObservation, "leaseGeneration">) => void;
  /**
   * Production composition's resolved boot config. Optional only for focused
   * loop fixtures that exercise lifecycle mechanics without composing config.
   */
  readonly configFingerprint?: string;
  /** Production claim gate comparing the exact boot/current epochs inside one SQLite transaction. */
  readonly claimNext: (
    input: WorkerClaimRequest,
  ) => RunMutationOutcome | Promise<RunMutationOutcome>;
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
  lifecycle: WorkerRunLifecyclePort;
  ids: IdFactory;
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
    const outcome = input.lifecycle.renewClaim({
      commandId: lifecycleCommandId("heartbeat", { runId: input.runId, claim: input.claim, nonce: input.ids.uuid() }),
      runId: input.runId,
      claim: input.claim,
    });
    if (outcome.state === "refused" && outcome.refusal.reason === "lost") {
      stopped = true;
      input.onLost("lost");
      return;
    }
    requireLifecycleApplied(outcome);
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
  const configFingerprint = deps.configFingerprint === undefined
    ? undefined
    : FingerprintSchema.parse(deps.configFingerprint);
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
    ...(deps.defaultBrowserMode === undefined ? {} : { defaultBrowserMode: deps.defaultBrowserMode }),
    ...(deps.browserScreenshotCapture === undefined
      ? {}
      : { browserScreenshotCapture: deps.browserScreenshotCapture }),
    ...(deps.browserObservation === undefined ? {} : { onObservation: deps.browserObservation }),
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
        const clean = event.reason === "operator-reopen"
          || event.reason === "fresh-boundary"
          || event.reason === "parked"
          || event.reason === "worker-stop";
        emit({
          t: "span.ended", kind: "browser", workerId, spanPath, parentSpanPath: workerPath,
          outcome: clean ? "done" : "failed",
          ...(clean
            ? {}
            : {
              diagnosticSafetyVersion: CURRENT_DIAGNOSTIC_SAFETY_VERSION,
              errorSummary: `browser session closed as ${event.reason}`,
            }),
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


  emit({ t: "span.started", kind: "worker", workerId, spanPath: workerPath, name: workflowId });

  const outcomes: RunExecutionOutcome[] = [];
  let stopped: "idle" | "stop-signal" | "stop-directive" = "stop-signal";
  try {
    while (!deps.stopSignal.aborted) {
      await deps.browserControl?.(sessions);
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
        await boundedWait(deps.scheduler, clock, (deps.idleCadence?.() ?? deps.idleRepollMs), deps.stopSignal);
        continue;
      }
      const claimRequest = {
        commandId: lifecycleCommandId("claim", { workerId, nonce: deps.ids.uuid() }),
        workflow: workflowId,
        workerId,
        now: instant(),
        ...(configFingerprint === undefined ? {} : { configFingerprint }),
      };
      const claimed = await deps.claimNext(claimRequest);
      if (claimed.state === "refused" && claimed.refusal.reason === "none-eligible") {
        const notBefore = claimed.refusal.notBefore;
        const decision = deps.exitWhenIdle
          ? decideIdleClaim({ exitWhenIdle: true, notBefore })
          : notBefore === undefined
            ? decideIdleClaim({ exitWhenIdle: false, cadenceMs: deps.idleCadence?.() ?? deps.idleRepollMs })
            : decideIdleClaim({ exitWhenIdle: false, notBefore, nowMs: clock.nowMs(), cadenceMs: deps.idleCadence?.() ?? deps.idleRepollMs });
        if (decision.kind === "exit") {
          stopped = "idle";
          break;
        }
        await boundedWait(deps.scheduler, clock, decision.delayMs, deps.stopSignal);
        continue;
      }

      const run = requireLifecycleApplied(claimed);
      const claim = {
        workerId,
        claimGeneration: run.claimGeneration,
      };


      const runController = new AbortController();
      const onStop = (): void => {
        runController.abort(new Error(`worker ${workerId} received its stop signal mid-run`));
      };
      deps.stopSignal.addEventListener("abort", onStop, { once: true });
      const heartbeat = startHeartbeat({
        lifecycle: deps.lifecycle,
        ids: deps.ids,
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
        const resources = deps.resourcesForRun?.(run);
        if (resources !== undefined) sessions.configureRunResources(resources);
        const taskDeadlineMs = resources?.taskDeadlineMs ?? deps.taskDeadlineMs;
        const providers = resources === undefined ? deps.providers : resources.providers;
        const writeSequencer = deps.writeSequencer ?? deps.writeSequencerFor?.(sessions,taskDeadlineMs);
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
            lifecycle: deps.lifecycle,
            sessions,
            emitter,
            clock,
            ids: deps.ids,
            scheduler: deps.scheduler,
            taskDeadlineMs,
            log: deps.log,
            ...(deps.taskNotes === undefined ? {} : { taskNotes: deps.taskNotes }),
            ...(deps.checkpointMigrations === undefined ? {} : { checkpointMigrations: deps.checkpointMigrations }),
            ...(deps.canonicalInputMigrations === undefined
              ? {}
              : { canonicalInputMigrations: deps.canonicalInputMigrations }),
            ...(writeSequencer === undefined ? {} : { writeSequencer }),
            ...(deps.childRuns === undefined ? {} : { childRuns: deps.childRuns }),
            ...(deps.gateSources === undefined ? {} : { gateSources: deps.gateSources }),
            ...(deps.diagnostics === undefined ? {} : { diagnostics: deps.diagnostics }),
            ...(providers === undefined ? {} : { providers }),
            ...(deps.artifacts === undefined ? {} : { artifacts: deps.artifacts }),
            ...(deps.artifactProjector === undefined ? {} : { artifactProjector: deps.artifactProjector }),
          }, { run, claim, signal: runController.signal }),
          run.envelope.browserMode,
          {
            runId: run.envelope.runId,
            descriptorFingerprint: run.envelope.contractFingerprint,
            ...(run.envelope.captureBrowserScreenshots === undefined
              ? {}
              : { captureBrowserScreenshots: run.envelope.captureBrowserScreenshots }),
          },
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

/**
 * The canonical bounded-stop escalation ORDER. The policy below states the
 * plan (stages and their timeouts, declared up front); observed stages record
 * what actually happened, one timestamped record per stage AS IT OCCURS.
 */
export const WORKER_STOP_ESCALATION_STAGES = Object.freeze(
  ["graceful-stop-requested", "sigterm-sent", "sigkill-sent"] as const,
);

/** The stop POLICY: what will be tried and for how long — a plan, not a claim. */
export const WorkerStopEscalationPolicySchema = z.tuple([
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
export type WorkerStopEscalationPolicy = Readonly<z.infer<typeof WorkerStopEscalationPolicySchema>>;

/** One OBSERVED escalation stage: it happened, at this instant. */
export const WorkerStopObservedStageSchema = z.strictObject({
  stage: z.enum(WORKER_STOP_ESCALATION_STAGES),
  at: IsoInstantSchema,
});
export type WorkerStopObservedStage = z.infer<typeof WorkerStopObservedStageSchema>;

/**
 * The timestamped observation record: a strict PREFIX of the escalation order
 * (graceful first, no skipped stage, no repeats) with non-decreasing
 * timestamps. A sequence that jumps past the graceful stage, inverts the
 * order, or time-travels is refused at the schema — an illegal transition can
 * never be acknowledged.
 */
export const WorkerStopObservedStagesSchema = z
  .array(WorkerStopObservedStageSchema)
  .min(1)
  .max(WORKER_STOP_ESCALATION_STAGES.length)
  .superRefine((observed, context) => {
    for (const [index, record] of observed.entries()) {
      const expected = WORKER_STOP_ESCALATION_STAGES[index];
      if (record.stage !== expected) {
        context.addIssue({
          code: "custom",
          path: [index, "stage"],
          message: `observed stop stages must follow the escalation policy in order: position `
            + `${String(index + 1)} must be ${String(expected)}, saw ${record.stage}`,
        });
        return;
      }
      const previous = observed[index - 1];
      if (previous !== undefined && Date.parse(record.at) < Date.parse(previous.at)) {
        context.addIssue({
          code: "custom",
          path: [index, "at"],
          message: `observed stage ${record.stage} at ${record.at} precedes ${previous.stage} at `
            + `${previous.at}; escalation observations must carry non-decreasing timestamps`,
        });
        return;
      }
    }
  });
export type WorkerStopObservedStages = z.infer<typeof WorkerStopObservedStagesSchema>;

/**
 * Durable supervisor ownership of a pool member. `external` is reportable so a
 * supervisor can tell the truth about a process it did not start — and every
 * mutating control REFUSES it by name: only a member the supervisor durably
 * owns may be planned over, spawned, stopped, paused, resumed, or have its
 * browser controlled.
 */
export const WorkerPoolOwnershipSchema = z.enum(["supervised", "external"]);
export type WorkerPoolOwnership = z.infer<typeof WorkerPoolOwnershipSchema>;

export const WorkerPoolMemberReconciliationFactSchema = z.discriminatedUnion("stage", [
  z.strictObject({
    member: WorkerPoolMemberSchema,
    stage: z.literal("running"),
    ownership: WorkerPoolOwnershipSchema,
  }),
  z.strictObject({
    member: WorkerPoolMemberSchema,
    stage: z.literal("unmet"),
    reason: z.enum(["not-started", "crashed"]),
  }),
  z.strictObject({
    member: WorkerPoolMemberSchema,
    stage: z.literal("graceful-stop-requested"),
    ownership: WorkerPoolOwnershipSchema,
    /**
     * Supervisor-attested provenance of the stop, schema-pinned so it can
     * never be left implicit: `initiating` — THIS plan requested the graceful
     * stop, so exactly the graceful stage can have been observed;
     * `reconciling` — the stop was already in flight when this plan was
     * acknowledged, and `observed` reports every escalation stage that has
     * ALREADY occurred. Both arms stay bounded by the command's `now`.
     */
    phase: z.enum(["initiating", "reconciling"]),
    escalation: WorkerStopEscalationPolicySchema,
    /** Recorded AS THEY OCCUR: a later `reconciling` fact reports escalations that happened since. */
    observed: WorkerStopObservedStagesSchema,
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
  ownership: WorkerPoolOwnershipSchema,
  stage: z.literal("started"),
});

/**
 * The durable stop directive write's own lease versions — reported by the
 * graceful-stop channel that performed the write, threaded through the stop
 * acknowledgement so command authority audits the WRITE's change, never a
 * later lease read that would absorb unrelated bumps (a worker heartbeat)
 * into the command's claimed change.
 */
export const WorkerDirectiveLeaseVersionsSchema = z.strictObject({
  before: PositiveIntSchema,
  after: PositiveIntSchema,
}).superRefine((versions, context) => {
  if (versions.after !== versions.before + 1) {
    context.addIssue({
      code: "custom",
      message: `a lease directive write bumps its version by exactly one; before ${String(versions.before)} → `
        + `after ${String(versions.after)} is not one write`,
    });
  }
});
export type WorkerDirectiveLeaseVersions = z.infer<typeof WorkerDirectiveLeaseVersionsSchema>;

const WorkerStopAcknowledgementSchema = z.strictObject({
  command: z.literal("stop-worker"),
  state: z.literal("acknowledged"),
  member: WorkerPoolMemberSchema,
  ownership: WorkerPoolOwnershipSchema,
  /** The POLICY echoed back: stages that WILL be tried, with their bounds. */
  escalation: WorkerStopEscalationPolicySchema,
  /** What actually happened so far. The initial acknowledgement may contain only the graceful request. */
  observed: WorkerStopObservedStagesSchema,
  /**
   * Optional AT THIS SCHEMA only because a synthetic phase-1 supervisor may
   * predate the version-reporting channel; the kernel's async pool door
   * REQUIRES it (`WorkerStopPoolAcknowledgementSchema`) before it will audit
   * a stop, so an acknowledgement without it refuses loudly there.
   */
  directiveLeaseVersions: WorkerDirectiveLeaseVersionsSchema.optional(),
});

const WorkerPauseAcknowledgementSchema = z.strictObject({
  command: z.literal("pause-worker"),
  state: z.literal("acknowledged"),
  member: WorkerPoolMemberSchema,
  ownership: WorkerPoolOwnershipSchema,
  stage: z.literal("pause-requested"),
});

const WorkerResumeAcknowledgementSchema = z.strictObject({
  command: z.literal("resume-worker"),
  state: z.literal("acknowledged"),
  member: WorkerPoolMemberSchema,
  ownership: WorkerPoolOwnershipSchema,
  stage: z.literal("resume-requested"),
});

const WorkerRefreshAcknowledgementSchema = z.strictObject({
  command: z.literal("refresh-browser"),
  state: z.literal("acknowledged"),
  member: WorkerPoolMemberSchema,
  ownership: WorkerPoolOwnershipSchema,
  browserSessionId: BrowserSessionIdSchema,
  stage: z.literal("refreshed"),
});

const WorkerReopenAcknowledgementSchema = z.strictObject({
  command: z.literal("reopen-browser"),
  state: z.literal("acknowledged"),
  member: WorkerPoolMemberSchema,
  ownership: WorkerPoolOwnershipSchema,
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

/**
 * The durable stop directive's identity, threaded from the kernel command that
 * initiates a stop — a `stop-worker`, or a plan that stops an excess member.
 * `requestedAt` is the COMMAND's `now`, the same instant
 * `requireObservedNotAfterNow` bounds observed stages against: the injected
 * graceful-stop channel writes the lease directive at EXACTLY this instant, so
 * the recorded graceful stage can never postdate the acknowledgement that
 * carries it (the W1/W2 seam gap this closes). `requestedBy`/`reason` are the
 * command's own actor and reason — a directive is authority, and authority
 * never carries a fabricated actor.
 */
export const WorkerStopDirectiveContextSchema = z.strictObject({
  commandId: z.uuid().optional(),
  requestedAt: IsoInstantSchema,
  requestedBy: ActorIdSchema,
  reason: z.string().min(1).optional(),
});
export type WorkerStopDirectiveContext = z.infer<typeof WorkerStopDirectiveContextSchema>;

export interface WorkerPoolPlanRequest {
  readonly commandId?: string;
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
  /** The stop identity for any excess member this plan gracefully stops. */
  readonly directive: WorkerStopDirectiveContext;
}

export interface WorkerPoolSpawnRequest {
  readonly commandId?: string;
  readonly command: "spawn-worker";
  readonly member: WorkerPoolMember;
}

export interface WorkerPoolStopRequest {
  readonly commandId?: string;
  readonly command: "stop-worker";
  readonly member: WorkerPoolMember;
  readonly escalation: WorkerStopEscalationPolicy;
  /** The durable stop directive's identity — the command's now/actor/reason. */
  readonly directive: WorkerStopDirectiveContext;
}

export interface WorkerPoolPauseRequest {
  readonly commandId?: string;
  readonly command: "pause-worker";
  readonly member: WorkerPoolMember;
}

export interface WorkerPoolResumeRequest {
  readonly commandId?: string;
  readonly command: "resume-worker";
  readonly member: WorkerPoolMember;
}

export interface WorkerPoolRefreshRequest {
  readonly commandId?: string;
  readonly command: "refresh-browser";
  readonly member: WorkerPoolMember;
  readonly browserSessionId: BrowserSessionId;
}

export interface WorkerPoolReopenRequest {
  readonly commandId?: string;
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
 *
 * DELIBERATELY not a `WorkerRuntimeExecutor`: the pool methods carry distinct
 * names, so wiring this executor into the kernel's synchronous `workerRuntime`
 * dependency is a compile error rather than a mis-wire that launches the real
 * supervisor effect and abandons its promise as an unhandled rejection when
 * the synchronous zod parse throws on it.
 */
export interface WorkerPoolRuntimeExecutor {
  planPoolWorkerCount(context: WorkerRuntimeContext): Promise<unknown>;
  spawnPoolWorker(context: WorkerRuntimeContext): Promise<unknown>;
  refreshPoolBrowser(context: WorkerRuntimeContext): Promise<unknown>;
  reopenPoolBrowser(context: WorkerRuntimeContext): Promise<unknown>;
  stopPoolWorker(context: WorkerRuntimeContext): Promise<unknown>;
  pausePoolWorker(context: WorkerRuntimeContext): Promise<unknown>;
  resumePoolWorker(context: WorkerRuntimeContext): Promise<unknown>;
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

function workerStopEscalation(): WorkerStopEscalationPolicy {
  const escalation = WorkerStopEscalationPolicySchema.parse([
    { stage: "graceful-stop-requested", timeoutMs: WORKER_GRACEFUL_STOP_TIMEOUT_MS },
    { stage: "sigterm-sent", timeoutMs: WORKER_SIGTERM_TIMEOUT_MS },
    { stage: "sigkill-sent" },
  ]);
  for (const stage of escalation) Object.freeze(stage);
  return Object.freeze(escalation);
}

/**
 * The command's own now/actor/reason, parsed into the durable stop identity a
 * stop's channel writes. A malformed `now` refuses HERE, before the supervisor
 * is consulted — it would otherwise both unbound the observed-stage check and
 * stamp garbage into a durable directive.
 */
function stopDirectiveContext(context: WorkerRuntimeContext): WorkerStopDirectiveContext {
  const { command } = context;
  const now = IsoInstantSchema.safeParse(context.now);
  if (!now.success) {
    throw new Error(
      `${command.type} received an unparseable command now ${JSON.stringify(context.now)}; `
      + "refusing to derive a durable stop directive from a malformed instant",
    );
  }
  return WorkerStopDirectiveContextSchema.parse({
    commandId: command.commandId,
    requestedAt: now.data,
    requestedBy: command.requestedBy,
    ...(command.reason === undefined ? {} : { reason: command.reason }),
  });
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

function requireDurableOwnership(
  command: WorkerSupervisorRequest["command"],
  member: WorkerPoolMember,
  ownership: WorkerPoolOwnership,
): void {
  if (ownership !== "supervised") {
    throw new Error(
      `${command} touches externally owned member ${member.workerId} at index ${String(member.poolIndex)}; `
      + "a mutating control requires durable supervisor ownership of the member it acts on",
    );
  }
}

/**
 * The acknowledgement being checked INITIATED the graceful stop — a stop
 * command always, a plan fact when the supervisor attests `initiating` — so
 * at acknowledgement time only `graceful-stop-requested` can have been
 * observed. The schema pins observation order; this pins TIME: SIGTERM/SIGKILL
 * are recorded through later `reconciling` plan facts as they occur, never
 * promised by the initiating acknowledgement.
 */
function requireInitialGracefulObservation(
  command: WorkerSupervisorRequest["command"],
  member: WorkerPoolMember,
  observed: WorkerStopObservedStages,
): void {
  const futureStages = observed.slice(1);
  if (futureStages.length > 0) {
    throw new Error(
      `${command} for ${member.workerId} may acknowledge only the observed graceful-stop-requested stage; `
      + `future stages (${futureStages.map(({ stage }) => stage).join(", ")}) are recorded as they occur, `
      + "not promised in advance",
    );
  }
}

/**
 * An observed stage is a record of something that HAPPENED. One timestamped
 * after the command's own `now` is a claim about the future dressed as a
 * fact — refused by name rather than persisted as history.
 */
function requireObservedNotAfterNow(
  command: WorkerSupervisorRequest["command"],
  member: WorkerPoolMember,
  observed: WorkerStopObservedStages,
  now: string,
): void {
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) {
    // `> NaN` is false for every instant, so a malformed `now` would silently
    // accept ANY observed timestamp — the bound must fail loud instead.
    throw new Error(
      `${command} for ${member.workerId} received an unparseable command now ${JSON.stringify(now)}; `
      + "refusing to bound observed escalation stages against a malformed instant",
    );
  }
  for (const record of observed) {
    if (Date.parse(record.at) > nowMs) {
      throw new Error(
        `${command} for ${member.workerId} reports ${record.stage} observed at ${record.at}, after the `
        + `command's now ${now}; an observation cannot postdate the acknowledgement that carries it`,
      );
    }
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
    async planPoolWorkerCount(context: WorkerRuntimeContext): Promise<z.input<typeof WorkerPlanAcknowledgementSchema>> {
      const { command } = context;
      if (command.type !== "plan-worker-count") {
        throw new Error(`planPoolWorkerCount received a ${command.type} command`);
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
        commandId: command.commandId,
        workflowId: command.target.workflowId,
        desiredWorkers,
        members,
        excessMembers,
        directive: stopDirectiveContext(context),
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
        if (fact.stage !== "unmet") {
          requireDurableOwnership("plan-worker-count", fact.member, fact.ownership);
        }
        if (offset < desiredWorkers && fact.stage === "graceful-stop-requested") {
          throw new Error(
            `plan-worker-count cannot stop desired member ${fact.member.workerId} at index ${String(offset + 1)}`,
          );
        }
        if (fact.stage === "graceful-stop-requested") {
          // `initiating` (this plan requested the stop) pins the observation
          // to the graceful stage alone; a supervisor-attested `reconciling`
          // fact reports the policy-ordered prefix that ALREADY occurred —
          // the schema pins its order, and both arms stay bounded by now.
          if (fact.phase === "initiating") {
            requireInitialGracefulObservation("plan-worker-count", fact.member, fact.observed);
          }
          requireObservedNotAfterNow("plan-worker-count", fact.member, fact.observed, context.now);
        }
        if (offset >= desiredWorkers && fact.stage === "running") {
          // Stop coverage is owed only for a process that exists: a running
          // excess member must carry its bounded graceful stop, while an
          // honest `unmet` fact (crashed / never started — D271's visibly
          // unmet declaration) has no process to stop and satisfies coverage.
          throw new Error(
            `plan-worker-count must select running excess member ${fact.member.workerId} for bounded graceful stop`,
          );
        }
      }
      return { state: "accepted", workerIds: [...plannedWorkerIds] };
    },
    async spawnPoolWorker(context: WorkerRuntimeContext): Promise<z.input<typeof WorkerRuntimeAcknowledgementSchema>> {
      const { command } = context;
      if (command.type !== "spawn-worker") {
        throw new Error(`spawnPoolWorker received a ${command.type} command`);
      }
      const member = poolMemberFromWorkerId(command.target.workflowId, command.payload.workerId);
      const acknowledgement = WorkerSpawnAcknowledgementSchema.parse(await supervisor.execute(Object.freeze({
        command: "spawn-worker",
        commandId: command.commandId,
        member,
      })));
      requireSameMember("spawn-worker", member, acknowledgement.member);
      requireDurableOwnership("spawn-worker", acknowledgement.member, acknowledgement.ownership);
      return { state: "accepted" };
    },
    async stopPoolWorker(context: WorkerRuntimeContext): Promise<Readonly<{
      state: "accepted";
      directiveLeaseVersions?: WorkerDirectiveLeaseVersions;
    }>> {
      const { command } = context;
      if (command.type !== "stop-worker") {
        throw new Error(`stopPoolWorker received a ${command.type} command`);
      }
      const member = poolMemberFromIdentity(command.target.workerId);
      const escalation = workerStopEscalation();
      const acknowledgement = WorkerStopAcknowledgementSchema.parse(await supervisor.execute(Object.freeze({
        command: "stop-worker",
        commandId: command.commandId,
        member,
        escalation,
        directive: stopDirectiveContext(context),
      })));
      requireSameMember("stop-worker", member, acknowledgement.member);
      requireDurableOwnership("stop-worker", acknowledgement.member, acknowledgement.ownership);
      requireInitialGracefulObservation("stop-worker", member, acknowledgement.observed);
      requireObservedNotAfterNow("stop-worker", member, acknowledgement.observed, context.now);
      // Forwarded verbatim when the supervisor attested the directive write's
      // versions; the kernel's pool door refuses an absence by name.
      return acknowledgement.directiveLeaseVersions === undefined
        ? { state: "accepted" }
        : { state: "accepted", directiveLeaseVersions: acknowledgement.directiveLeaseVersions };
    },
    async pausePoolWorker(context: WorkerRuntimeContext): Promise<z.input<typeof WorkerRuntimeAcknowledgementSchema>> {
      const { command } = context;
      if (command.type !== "pause-worker") {
        throw new Error(`pausePoolWorker received a ${command.type} command`);
      }
      const member = poolMemberFromIdentity(command.target.workerId);
      const acknowledgement = WorkerPauseAcknowledgementSchema.parse(await supervisor.execute(Object.freeze({
        command: "pause-worker",
        commandId: command.commandId,
        member,
      })));
      requireSameMember("pause-worker", member, acknowledgement.member);
      requireDurableOwnership("pause-worker", acknowledgement.member, acknowledgement.ownership);
      return { state: "accepted" };
    },
    async resumePoolWorker(context: WorkerRuntimeContext): Promise<z.input<typeof WorkerRuntimeAcknowledgementSchema>> {
      const { command } = context;
      if (command.type !== "resume-worker") {
        throw new Error(`resumePoolWorker received a ${command.type} command`);
      }
      const member = poolMemberFromIdentity(command.target.workerId);
      const acknowledgement = WorkerResumeAcknowledgementSchema.parse(await supervisor.execute(Object.freeze({
        command: "resume-worker",
        commandId: command.commandId,
        member,
      })));
      requireSameMember("resume-worker", member, acknowledgement.member);
      requireDurableOwnership("resume-worker", acknowledgement.member, acknowledgement.ownership);
      return { state: "accepted" };
    },
    async refreshPoolBrowser(context: WorkerRuntimeContext): Promise<z.input<typeof WorkerRuntimeAcknowledgementSchema>> {
      const { command } = context;
      if (command.type !== "refresh-browser") {
        throw new Error(`refreshPoolBrowser received a ${command.type} command`);
      }
      const member = poolMemberFromIdentity(command.target.workerId);
      const acknowledgement = WorkerRefreshAcknowledgementSchema.parse(await supervisor.execute(Object.freeze({
        command: "refresh-browser",
        commandId: command.commandId,
        member,
        browserSessionId: command.target.browserSessionId,
      })));
      requireSameMember("refresh-browser", member, acknowledgement.member);
      requireDurableOwnership("refresh-browser", acknowledgement.member, acknowledgement.ownership);
      if (acknowledgement.browserSessionId !== command.target.browserSessionId) {
        throw new Error(
          `refresh-browser requested session ${command.target.browserSessionId} but the supervisor acknowledged `
          + acknowledgement.browserSessionId,
        );
      }
      return { state: "accepted" };
    },
    async reopenPoolBrowser(context: WorkerRuntimeContext): Promise<z.input<typeof WorkerRuntimeAcknowledgementSchema>> {
      const { command } = context;
      if (command.type !== "reopen-browser") {
        throw new Error(`reopenPoolBrowser received a ${command.type} command`);
      }
      const member = poolMemberFromIdentity(command.target.workerId);
      const acknowledgement = WorkerReopenAcknowledgementSchema.parse(await supervisor.execute(Object.freeze({
        command: "reopen-browser",
        commandId: command.commandId,
        member,
        browserSessionId: command.target.browserSessionId,
      })));
      requireSameMember("reopen-browser", member, acknowledgement.member);
      requireDurableOwnership("reopen-browser", acknowledgement.member, acknowledgement.ownership);
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
      requireDurableOwnership("spawn-worker", acknowledgement.member, acknowledgement.ownership);
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
      requireDurableOwnership("refresh-browser", acknowledgement.member, acknowledgement.ownership);
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
      requireDurableOwnership("reopen-browser", acknowledgement.member, acknowledgement.ownership);
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
