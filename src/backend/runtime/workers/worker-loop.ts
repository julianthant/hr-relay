export { WorkerPoolMemberSchema, type WorkerPoolMember } from "../../../models/run/worker-slot.js";
import type { WorkerBrowserObservation } from "../../../models/run/worker-control.js";
import type { RunRecord } from "../../../models/run/record.js";

import { z } from "zod";
import { WorkerPreflightRefusalSchema, WorkerRefusalStandingSchema, type WorkerPreflightRefusal, type WorkerRefusalStanding } from "../../../models/preflight/preflight-contract.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { CURRENT_DIAGNOSTIC_SAFETY_VERSION } from "../../../models/trust/failure.js";
import type { TaskLogger } from "../../../workflow-kit/task.js";
import type { TaskStoreRegistry } from "../../../workflow-kit/task-registry.js";
import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import type { Clock } from "../../../rules/time/clock.js";
import type { IdFactory } from "../../../rules/identity/identifiers.js";
import {
  FingerprintSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../../../rules/identity/ids.js";
import type { WorkerId, WorkflowId } from "../../../rules/identity/ids.js";
import type { BrowserPresentationMode } from "../../../models/run/envelope.js";
import type { ContentAddressedArtifactWriter } from "../../../workflow-kit/artifacts.js";
import type { RunDiagnosticCapture } from "../../../workflow-kit/diagnostics.js";
import type { RunBrowserScreenshotCapture } from "../../../workflow-kit/diagnostics.js";
import type { NoteTimelineWriter } from "../../storage/events/note-timeline-writer.js";
import type { GateSourceRuntime } from "../gates/gate-source-runtime.js";
import type { MonotonicDeadlineScheduler } from "../scheduling/deadline-scheduler.js";
import {
  executeClaimedRun,
  RunControlAbortError,
  RunExecutionOutcomeSchema,
  type ChildRunExecutor,
  type RunArtifactProjector,
  type RunExecutionAuthority,
  type RunExecutionOutcome,
  type RunProviderWiring,
  type WriteSequencer,
} from "../execution/run-executor.js";
import {
  browserSessionSpanPath,
  ExecutorSpanEventSchema,
  workerSpanPath,
  type SpanEmitter,
} from "../../logs/span-emitter.js";
import {
  withBoundRunConfigFingerprint,
  WorkerSessionManager,
  WorkerSessionClosureUnprovedError,
  type WorkerBrowserSessionFactory,
  type WorkerSessionEvent,
} from "./worker-sessions.js";
import type { DuoCeremonyGateFactory } from "../gates/duo-ceremony-gate.js";
import { decideIdleClaim } from "../policies/idle-claim.js";

import { lifecycleCommandId, requireLifecycleApplied, type WorkerRunLifecyclePort, type RunMutationOutcome } from "../../runs/lifecycle/run-record-service.js";

type WorkerClaimRequest = Readonly<{
  commandId: string;
  workflow: WorkflowId;
  workerId: WorkerId;
  now: string;
  configFingerprint?: string;
}>;

export interface WorkerRunResources {
 readonly publishCheckpoint?: import("../execution/run-executor.js").RunExecutorDependencies["publishCheckpoint"];
 readonly sessionFactory: WorkerBrowserSessionFactory;
 readonly duoCeremony: DuoCeremonyGateFactory;
 readonly taskDeadlineMs: number;
 readonly sessionAcquireMs: number;
 readonly defaultBrowserMode: BrowserPresentationMode;
 readonly providers?: RunProviderWiring;
}
const PREFLIGHT_RETRY_CAP_MS = 60_000;

export interface WorkerLoopDependencies {
  readonly debugEvents?: import("../execution/run-executor.js").RunExecutorDependencies["debugEvents"];
 readonly resourcesForRun?: (run:RunRecord)=>WorkerRunResources;
 readonly idleCadence?: ()=>number;
  readonly workflowId: WorkflowId;
  readonly workerId: WorkerId;
  readonly descriptor: AnyWorkflowDescriptor;
  readonly stores: TaskStoreRegistry;
  readonly resolveExecution?: (run: RunRecord) => Readonly<{ descriptor: AnyWorkflowDescriptor; stores: TaskStoreRegistry }> | undefined;
  readonly authority: RunExecutionAuthority;
  readonly lifecycle: WorkerRunLifecyclePort;
  readonly sessionFactory: WorkerBrowserSessionFactory;
  readonly emitter: SpanEmitter;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly scheduler: MonotonicDeadlineScheduler;
  readonly taskDeadlineMs: number;
  // Session acquisition has its own bound, separate from the task deadline.
  readonly sessionAcquireMs: number;
  // Envelopes without browserMode use the configured compatibility mode.
  readonly defaultBrowserMode?: BrowserPresentationMode;

  readonly duoCeremony: DuoCeremonyGateFactory;
  readonly heartbeatIntervalMs: number;
  readonly idleRepollMs: number;
  readonly log: TaskLogger;
  /** Run messages and browser actions; transaction callbacks stay outside this sink. */
  readonly taskNotes?: Pick<NoteTimelineWriter, "emitRunLog" | "emitRunAction">;
  /** Stop claiming and shut the worker down; the active run finishes first. */
  readonly stopSignal: AbortSignal;
  // drainOnce returns at the first idle poll; otherwise the loop runs until stopSignal.
  readonly exitWhenIdle: boolean;
  readonly writeSequencer?: WriteSequencer;

  readonly writeSequencerFor?: (sessions: WorkerSessionManager, taskDeadlineMs:number) => WriteSequencer;
  readonly childRuns?: ChildRunExecutor;
  readonly gateSources?: GateSourceRuntime;
  /** Ref operator-trust's automatic bundle capture; absent means no bundle is minted. */
  readonly diagnostics?: RunDiagnosticCapture;
  /** Explicit per-run screenshot persistence, executed while a lease owns its page. */
  readonly browserScreenshotCapture?: RunBrowserScreenshotCapture;

  readonly providers?: RunProviderWiring;
  readonly artifacts?: ContentAddressedArtifactWriter;
  /** Ref data-intake-and-edit-data's blocking sink projector; absent, a declaring node fails loud. */
  readonly artifactProjector?: RunArtifactProjector;

  /** Read between runs: the parent's pause (the slot) or stop request. */
  readonly controlPoll?: () => "run" | "pause" | "stop";
  /** The child's one turn shared with parent controls: `begin` is false while a control runs. */
  readonly claimTurn?: Readonly<{ begin(): boolean; end(): void }>;
  /** Hands the loop's session manager to the child's parent-request handlers. */
  readonly bindSessions?: (sessions: WorkerSessionManager) => void;
  readonly browserActivity?: (activity: "acquiring" | "authenticating" | "closing") => () => void;
  readonly browserObservation?: (observation: WorkerBrowserObservation) => void;

  readonly configFingerprint?: string;
  /** The standing refusal the parent shows on the worker card. Cleared with `undefined`. */
  readonly onStanding?: (refusal: WorkerRefusalStanding | undefined) => void;
  /** Receives the closure error behind an unproved report, so the worker exit can name its causes. */
  readonly onClosureUnproved?: (error: WorkerSessionClosureUnprovedError) => void;
  /** Production claim gate comparing the exact boot/current epochs inside one SQLite transaction. */
  readonly claimNext: (
    input: WorkerClaimRequest,
    sessions: WorkerSessionManager,
  ) => RunMutationOutcome | WorkerPreflightRefusal | Promise<RunMutationOutcome | WorkerPreflightRefusal>;
}

export const WorkerLoopReportSchema = z.strictObject({
  workerId: z.string().min(1),
  workflowId: z.string().min(1),
  outcomes: z.array(RunExecutionOutcomeSchema),
  /** `stop-directive` = the durable lease directive said stop, between items. */
  stopped: z.enum(["idle", "stop-signal", "stop-directive", "preflight-refused"]),
  closure: z.enum(["proved", "unproved"]),
  preflightRefusal: WorkerPreflightRefusalSchema.optional(),
}).superRefine((report, context) => {
  if ((report.stopped === "preflight-refused") !== (report.preflightRefusal !== undefined)) {
    context.addIssue({ code: "custom", path: ["preflightRefusal"], message: "a preflight stop requires its exact refusal" });
  }
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
  const streamId = deps.ids.uuid();
  const workerPath = `${workerSpanPath(workflowId, workerId)}#${streamId}`;
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
    ...(deps.browserActivity === undefined ? {} : { onActivity: deps.browserActivity }),
    ...(deps.browserObservation === undefined ? {} : { onObservation: deps.browserObservation }),
    onFailure: failure => deps.debugEvents?.emit({ category: "session", phase: "failed", area: "browser-session",
      code: "BROWSER_SESSION_FAILED", reason: failure.reason, correlationId: failure.sessionId ?? deps.ids.uuid() }, { kind: "worker", workerId }),
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
  deps.bindSessions?.(sessions);

  const callbacks = new Map<Promise<unknown>, Readonly<{ runId: string; claimGeneration: number; attempt: number }>>();
  const retainCallback = (identity: Readonly<{ runId: string; claimGeneration: number; attempt: number }>, operation: Promise<unknown>) => {
    callbacks.set(operation, identity);
    void operation.then(() => { callbacks.delete(operation); }, () => { callbacks.delete(operation); });
  };
  const outcomes: RunExecutionOutcome[] = [];
  let closure: WorkerLoopReport["closure"];
  let stopped: WorkerLoopReport["stopped"] = "stop-signal";
  let preflightRefusal: WorkerPreflightRefusal | undefined;
  try {
    const parksWhenIdle = descriptorRuntimeNodes(deps.descriptor).some(node => node.kind === "child-run");
    let refusalStreak = 0;
    const clearRefusal = (): void => {
      refusalStreak = 0;
      deps.onStanding?.(undefined);
    };
    while (!deps.stopSignal.aborted) {
      // Between items only: the active run always settles before the next poll.
      const directive = deps.controlPoll?.() ?? "run";
      if (directive === "stop") {
        stopped = "stop-directive";
        break;
      }
      if (directive === "pause" || deps.claimTurn?.begin() === false) {
        // Paused, or a parent control holds the turn: claim nothing and re-poll on the bounded idle cadence.
        await boundedWait(deps.scheduler, clock, (deps.idleCadence?.() ?? deps.idleRepollMs), deps.stopSignal);
        continue;
      }
      let idleDelayMs: number | undefined;
      try {
      const claimRequest = {
        commandId: lifecycleCommandId("claim", { workerId, nonce: deps.ids.uuid() }),
        workflow: workflowId,
        workerId,
        now: instant(),
        ...(configFingerprint === undefined ? {} : { configFingerprint }),
      };
      const claimed = await deps.claimNext(claimRequest, sessions);
      if (claimed.state === "preflight-refused") {
        preflightRefusal = WorkerPreflightRefusalSchema.parse(claimed);
        deps.debugEvents?.emit({ category: "worker", phase: "failed", correlationId: claimRequest.commandId,
          area: "worker-admission", code: preflightRefusal.code, reason: "operation-refused",
          ...(preflightRefusal.summary === undefined ? {} : { message: preflightRefusal.summary }) }, { kind: "worker", workerId });
        if (deps.exitWhenIdle) { stopped = "preflight-refused"; break; }
        // A pool worker stays up. Each consecutive refusal doubles the idle cadence, capped at a minute.
        refusalStreak += 1;
        const delay = Math.min(PREFLIGHT_RETRY_CAP_MS, (deps.idleCadence?.() ?? deps.idleRepollMs) * 2 ** (refusalStreak - 1));
        idleDelayMs = delay;
        deps.onStanding?.(WorkerRefusalStandingSchema.parse({
          code: preflightRefusal.code, retryAt: new Date(clock.nowMs() + delay).toISOString(),
          ...(preflightRefusal.summary === undefined ? {} : { summary: preflightRefusal.summary }),
        }));
        preflightRefusal = undefined;
        continue;
      }
      if (claimed.state === "refused" && claimed.refusal.reason === "none-eligible") {
        clearRefusal();
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
        // No browser stays open while a parent waits on a gate or on its children.
        if (parksWhenIdle) await sessions.closeAll("parked");
        idleDelayMs = decision.delayMs;
        continue;
      }

      clearRefusal();
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
      let workPoll = { cancel: (): void => undefined };
      let workPolling = true;
      // A pause request or a cancellation (row Cancel, or Stop's reset Cancel) cancels the current step; a fenced write finishes first.
      const observeWork = (): void => {
        if (!workPolling) return;
        try {
          const current = deps.authority.authority.runs.get(run.envelope.runId);
          if (current?.pause?.state === "requested" || current?.cancelRequested === true) {
            runController.abort(new RunControlAbortError());
            return;
          }
        } catch (error) { runController.abort(error); return; }
        workPoll = deps.scheduler.schedule(clock.monotonicMs() + WORK_CONTROL_POLL_MS, observeWork);
      };
      observeWork();
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
        const execution = deps.resolveExecution === undefined
          ? (run.envelope.workflow === deps.descriptor.id ? { descriptor: deps.descriptor, stores: deps.stores } : undefined)
          : deps.resolveExecution(run);
        if (execution === undefined || execution.descriptor.id !== run.envelope.workflow
          || execution.descriptor.version !== run.envelope.descriptorVersion
          || execution.descriptor.contractFingerprint !== run.envelope.contractFingerprint) throw new Error("worker-execution-descriptor-unavailable");
        await sessions.parkForExecution(run.envelope.workflow, execution.stores);
        sessions.configureExecution(run.envelope.workflow, execution.stores);
        const resources = deps.resourcesForRun?.(run);
        if (resources !== undefined) sessions.configureRunResources(resources);
        const taskDeadlineMs = resources?.taskDeadlineMs ?? deps.taskDeadlineMs;
        const providers = resources === undefined ? deps.providers : resources.providers;
        const writeSequencer = deps.writeSequencer ?? deps.writeSequencerFor?.(sessions,taskDeadlineMs);

        const outcome = await withBoundRunConfigFingerprint(
          sessions,
          run.envelope.configFingerprint,
          () => executeClaimedRun({
            descriptor: execution.descriptor,
            stores: execution.stores,
            authority: deps.authority,
            lifecycle: deps.lifecycle,
            sessions,
            emitter,
            clock,
            ids: deps.ids,
            scheduler: deps.scheduler,
            taskDeadlineMs,
            log: deps.log,
            debugEvents: deps.debugEvents,
            retainCallback,
            ...(deps.taskNotes === undefined ? {} : { taskNotes: deps.taskNotes }),
            ...(writeSequencer === undefined ? {} : { writeSequencer }),
            ...(deps.childRuns === undefined ? {} : { childRuns: deps.childRuns }),
            ...(deps.gateSources === undefined ? {} : { gateSources: deps.gateSources }),
            ...(deps.diagnostics === undefined ? {} : { diagnostics: deps.diagnostics }),
            ...(providers === undefined ? {} : { providers }),
            ...(resources?.publishCheckpoint === undefined ? {} : { publishCheckpoint: resources.publishCheckpoint }),
            ...(deps.artifacts === undefined ? {} : { artifacts: deps.artifacts }),
            ...(deps.artifactProjector === undefined ? {} : { artifactProjector: deps.artifactProjector }),
          }, { run, claim, signal: runController.signal }),
          run.envelope.browserMode,
          {
            runId: run.envelope.runId,
            descriptorFingerprint: run.envelope.contractFingerprint,
          },
        );
        outcomes.push(outcome);
      } finally {
        workPolling = false;
        workPoll.cancel();
        heartbeat.stop();
        deps.stopSignal.removeEventListener("abort", onStop);
      }
      } finally {
        deps.claimTurn?.end();
        if (idleDelayMs !== undefined) await boundedWait(deps.scheduler, clock, idleDelayMs, deps.stopSignal);
      }
    }
  } finally {
    closure = await sessions.closeAll("worker-stop").then(() => "proved" as const, (error: unknown) => {
      if (!(error instanceof WorkerSessionClosureUnprovedError)) throw error;
      deps.onClosureUnproved?.(error);
      return "unproved" as const;
    });
    emit({ t: "span.ended", kind: "worker", workerId, spanPath: workerPath,
      outcome: closure === "proved" && preflightRefusal === undefined ? "done" : "failed",
      ...(closure === "proved" && preflightRefusal === undefined ? {} : {
        diagnosticSafetyVersion: CURRENT_DIAGNOSTIC_SAFETY_VERSION,
        errorSummary: closure === "unproved" ? `worker ${workerId} browser session closure is unproved`
          : ERROR_CATALOG[preflightRefusal?.code ?? "PREFLIGHT_OBSERVATION_CHANGED"].text,
      }),
    });
  }
  return WorkerLoopReportSchema.parse({ workerId, workflowId, outcomes, stopped, closure,
    ...(preflightRefusal === undefined ? {} : { preflightRefusal }) });
}


export const WORK_CONTROL_POLL_MS = 250;
