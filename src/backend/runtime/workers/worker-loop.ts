import { randomUUID } from "node:crypto";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { WorkerPoolMemberSchema, WorkerRetirementProofSchema, workerPoolMember, type WorkerPoolMember, type WorkerSlotRecord } from "../../../models/run/worker-slot.js";
export { WorkerPoolMemberSchema, type WorkerPoolMember } from "../../../models/run/worker-slot.js";
import type { WorkerBrowserObservation } from "../../../models/run/worker-control.js";
import type { WorkerSupervisorEffect } from "../../storage/sqlite/worker-control.js";
import type { WorkerLifecycleBinding, WorkerResetBinding } from "../../../models/run/worker-control.js";
import type { RunRecord } from "../../../models/run/record.js";

import { z } from "zod";
import { CURRENT_DIAGNOSTIC_SAFETY_VERSION } from "../../../models/trust/failure.js";
import type { TaskLogger } from "../../../workflow-kit/task.js";
import type { TaskStoreRegistry } from "../../../workflow-kit/task-registry.js";
import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import type { Clock } from "../../../rules/time/clock.js";
import type { IdFactory } from "../../../rules/identity/identifiers.js";
import {
  ActorIdSchema,
  BrowserSessionIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  PositiveIntSchema,
  WorkerIdSchema,
  WorkflowIdSchema,
} from "../../../rules/identity/ids.js";
import type { BrowserSessionId, WorkerId, WorkflowId } from "../../../rules/identity/ids.js";
import type { BrowserPresentationMode } from "../../../models/run/envelope.js";
import { WorkerDirectiveSchema, type WorkerDirective } from "../../../models/run/worker.js";
import type {
  WorkerPlanAcknowledgementSchema,
  WorkerRuntimeAcknowledgementSchema,
  WorkerRuntimeContext,
} from "../../runs/commands/command-kernel.js";
import type { ContentAddressedArtifactWriter } from "../../../workflow-kit/artifacts.js";
import type { RunDiagnosticCapture } from "../../../workflow-kit/diagnostics.js";
import type { RunBrowserScreenshotCapture } from "../../../workflow-kit/diagnostics.js";
import type { NoteTimelineWriter } from "../../storage/events/note-timeline-writer.js";
import { createConfirmedActionPublisher } from "../../logs/confirmed-action-publisher.js";
import type { ConfirmedActionEvent } from "../../../models/events/confirmed-action.js";
import type { GateSourceRuntime } from "../gates/gate-source-runtime.js";
import type { MonotonicDeadlineHandle, MonotonicDeadlineScheduler } from "../scheduling/deadline-scheduler.js";
import {
  executeClaimedRun,
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
  // Worker-local publication handoff; persistent transport is supplied separately.
  readonly confirmedActionAppend?: (event: ConfirmedActionEvent) => void;
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

  readonly initialize?: (sessions: WorkerSessionManager, signal: AbortSignal) => Promise<void>;
  readonly resetOwner?: Pick<WorkerResetBinding, "member" | "lifetime">;
  readonly resetControl?: (sessions: WorkerSessionManager, reset: WorkerResetBinding) => Promise<void>;
  readonly pendingReset?: () => WorkerResetBinding | undefined;
  readonly activeWorkReset?: (run: RunRecord, claim: Readonly<{ workerId: string; claimGeneration: number }>) => boolean;
  readonly controlPoll?: () => WorkerDirective;
  readonly browserControl?: (sessions: WorkerSessionManager) => Promise<void>;
  readonly browserActivity?: (activity: "acquiring" | "authenticating" | "closing") => () => void;
  readonly browserObservation?: (observation: Omit<WorkerBrowserObservation, "leaseGeneration">) => void;

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
  closure: z.enum(["proved", "unproved"]),
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
  const confirmedActionPublisher = createConfirmedActionPublisher({
    workerId, streamId, clock, capacity: 256,
    append: deps.confirmedActionAppend,
    onHealth: health => {
      if (health.state !== "healthy") deps.log.warn("confirmed action publication unhealthy", {
        state: health.state, pending: health.pending, diagnosticFailure: health.diagnosticFailure,
      });
    },
  });
  const workerPath = `${workerSpanPath(workflowId, workerId)}#${streamId}`;
  const instant = (): string => clock.now().toISOString();
  const emit = (event: Readonly<Record<string, unknown>>): void => {
    emitter.emit(ExecutorSpanEventSchema.parse({ ts: instant(), workflow: workflowId, ...event }));
  };

  const sessions = new WorkerSessionManager({
    ...(deps.resetOwner === undefined ? {} : { resetOwner: deps.resetOwner }),
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

  const callbacks = new Map<Promise<unknown>, Readonly<{ runId: string; claimGeneration: number; attempt: number }>>();
  const retainCallback = (identity: Readonly<{ runId: string; claimGeneration: number; attempt: number }>, operation: Promise<unknown>) => {
    callbacks.set(operation, identity);
    void operation.then(() => { callbacks.delete(operation); }, () => { callbacks.delete(operation); });
  };
  let resetSettlement: Readonly<{ binding: string; operation: Promise<void> }> | undefined;
  const finishReset = async (reset: WorkerResetBinding): Promise<void> => {
    const binding = canonicalJsonStringify(reset);
    const bound = reset.work.kind === "absent" ? [] : [reset.work.current, ...reset.work.cascade];
    while (!deps.stopSignal.aborted) {
      const owned = [...callbacks.entries()].filter(([, identity]) => bound.some(member => member.state === "claimed"
        && member.runId === identity.runId && member.claimGeneration === identity.claimGeneration && member.attempt === identity.attempt));
      if (owned.length === callbacks.size) {
        await Promise.allSettled(owned.map(([operation]) => operation));
        break;
      }
      await boundedWait(deps.scheduler, clock, deps.idleRepollMs, deps.stopSignal);
    }
    if (deps.stopSignal.aborted) return;
    const current = deps.pendingReset?.();
    if (current === undefined || canonicalJsonStringify(current) !== binding) return;
    if (resetSettlement?.binding !== binding) resetSettlement = { binding, operation: deps.resetControl?.(sessions, reset) ?? Promise.resolve() };
    try { await resetSettlement.operation; }
    catch { await boundedWait(deps.scheduler, clock, deps.idleRepollMs, deps.stopSignal); }
  };
  const outcomes: RunExecutionOutcome[] = [];
  let closure: WorkerLoopReport["closure"] = "proved";
  let stopped: "idle" | "stop-signal" | "stop-directive" = "stop-signal";
  try {
    if (deps.initialize !== undefined) {
      const controller = new AbortController();
      const onShutdown = () => { controller.abort(deps.stopSignal.reason); };
      deps.stopSignal.addEventListener("abort", onShutdown, { once: true });
      if (deps.stopSignal.aborted) onShutdown();
      let observing = true;
      let timer: MonotonicDeadlineHandle = { cancel: () => undefined };
      const poll = () => {
        if (!observing || controller.signal.aborted) return;
        try { if (deps.pendingReset?.() !== undefined) { controller.abort(new Error("worker-initialization-reset")); return; } }
        catch (error) { controller.abort(error); return; }
        timer = deps.scheduler.schedule(clock.monotonicMs() + deps.idleRepollMs, poll);
      };
      poll();
      try { await deps.initialize(sessions, controller.signal); }
      catch (error) {
        const reset = deps.pendingReset?.();
        if (reset === undefined) throw error;
        await finishReset(reset);
      } finally { observing = false; timer.cancel(); deps.stopSignal.removeEventListener("abort", onShutdown); }
    }
    while (!deps.stopSignal.aborted) {
      const pendingReset = deps.pendingReset?.();
      if (pendingReset !== undefined) {
        await finishReset(pendingReset);
        if (deps.pendingReset?.() === undefined) continue;
        await boundedWait(deps.scheduler, clock, deps.idleRepollMs, deps.stopSignal);
        continue;
      }
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
        // idle cadence (ref execution-and-sessions — a worker never sleeps unboundedly).
        await boundedWait(deps.scheduler, clock, (deps.idleCadence?.() ?? deps.idleRepollMs), deps.stopSignal);
        continue;
      }
      if (descriptorRuntimeNodes(deps.descriptor).some(node => node.kind === "child-run")) await sessions.closeAll("parked");
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
      let resetPoll = { cancel: (): void => undefined };
      let resetPolling = true;
      const observeReset = (): void => {
        if (!resetPolling) return;
        try {
          if (deps.activeWorkReset?.(run, claim) === true) {
            runController.abort(new Error("worker-reset-current-work"));
            return;
          }
        } catch (error) { runController.abort(error); return; }
        resetPoll = deps.scheduler.schedule(clock.monotonicMs() + deps.idleRepollMs, observeReset);
      };
      if (deps.activeWorkReset !== undefined) observeReset();
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
            confirmedActionPublisher,
            retainCallback,
            ...(deps.taskNotes === undefined ? {} : { taskNotes: deps.taskNotes }),
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
      } catch (error) {
        if (deps.pendingReset?.() === undefined) throw error;
      } finally {
        const reset = deps.pendingReset?.();
        if (reset !== undefined) await finishReset(reset);
        resetPolling = false;
        resetPoll.cancel();
        heartbeat.stop();
        deps.stopSignal.removeEventListener("abort", onStop);
      }
    }
  } finally {
    const publication = confirmedActionPublisher.close();
    if (publication.pending > 0) {
      try { deps.log.warn("confirmed action publication closed with pending events", { pending: publication.pending }); }
      catch { /* Health remains queryable through the publisher; shutdown still owns session closure. */ }
    }
    await sessions.closeAll("worker-stop").catch((error: unknown) => {
      if (!(error instanceof WorkerSessionClosureUnprovedError)) throw error;
      closure = "unproved";
    });
    emit({ t: "span.ended", kind: "worker", workerId, spanPath: workerPath,
      outcome: closure === "proved" ? "done" : "failed",
      ...(closure === "proved" ? {} : {
        diagnosticSafetyVersion: CURRENT_DIAGNOSTIC_SAFETY_VERSION,
        errorSummary: `worker ${workerId} browser session closure is unproved`,
      }),
    });
  }
  return WorkerLoopReportSchema.parse({ workerId, workflowId, outcomes, stopped, closure });
}

/* ── the kernel's WorkerRuntimeExecutor seam, Phase-1 shape (ref execution-and-sessions ) ──── */



export const WORKER_GRACEFUL_STOP_TIMEOUT_MS = 120_000;
export const WORKER_SIGTERM_TIMEOUT_MS = 30_000;

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

// Observed escalation stages are a timestamped prefix with no gaps or repeats.
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


export const WorkerPoolOwnershipSchema = z.enum(["supervised", "external"]);
export type WorkerPoolOwnership = z.infer<typeof WorkerPoolOwnershipSchema>;

export const WorkerPoolMemberReconciliationFactSchema = z.discriminatedUnion("stage", [
  z.strictObject({ member: WorkerPoolMemberSchema, stage: z.literal("retired"), proof: WorkerRetirementProofSchema }),
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
    // Stop provenance distinguishes initiation from reconciliation of an existing directive.
    phase: z.enum(["initiating", "reconciling"]),
    escalation: WorkerStopEscalationPolicySchema,
    /** Recorded AS THEY OCCUR: a later `reconciling` fact reports escalations that happened since. */
    observed: WorkerStopObservedStagesSchema,
  }),
]);

export const WorkerPoolReconciliationAcknowledgementSchema = z.strictObject({
  command: z.literal("plan-worker-count"),
  state: z.literal("acknowledged"),
  desiredWorkers: z.number().int().min(0),
  members: z.array(WorkerPoolMemberReconciliationFactSchema),
});

const WorkerSpawnAcknowledgementSchema = z.strictObject({
  command: z.literal("spawn-worker"),
  state: z.literal("acknowledged"),
  member: WorkerPoolMemberSchema,
  ownership: WorkerPoolOwnershipSchema,
  stage: z.literal("started"),
});


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
  // The async pool boundary requires directive versions even when synthetic supervisors omit them.
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
  readonly desiredWorkers: number;
  readonly members: readonly WorkerPoolMember[];

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


export interface WorkerPoolProcessSupervisor {
  assertLifecycleOwner?(operation: "remove" | "retry", member: WorkerPoolMember, lifetime: Readonly<{ leaseGeneration: number; processId: number; startedAt: string }>): void;
  ownWorkerControl?(commandId: string, work: () => Promise<void>): void;
  removeWorker?(binding: WorkerLifecycleBinding, directive: WorkerStopDirectiveContext): Promise<WorkerSupervisorEffect>;
  retryWorker?(binding: WorkerLifecycleBinding): Promise<WorkerSupervisorEffect>;
  assertResetOwner?(member: WorkerPoolMember, lifetime: Readonly<{ leaseGeneration: number; processId: number; startedAt: string }>): void;
  execute(request: WorkerSupervisorRequest): unknown;
}


export interface WorkerPoolRuntimeExecutor {
  beginLifecycle?(context: WorkerRuntimeContext): void;
  assertLifecycleOwner?(operation: "remove" | "retry", workerId: string, membershipRevision: number, lifetime: Readonly<{ leaseGeneration: number; processId: number; startedAt: string }>): void;
  assertResetOwner?(workerId: string, membershipRevision: number, lifetime: Readonly<{ leaseGeneration: number; processId: number; startedAt: string }>): void;
  planPoolWorkerCount(context: WorkerRuntimeContext): Promise<unknown>;
  spawnPoolWorker(context: WorkerRuntimeContext): Promise<unknown>;
  refreshPoolBrowser(context: WorkerRuntimeContext): Promise<unknown>;
  reopenPoolBrowser(context: WorkerRuntimeContext): Promise<unknown>;
  stopPoolWorker(context: WorkerRuntimeContext): Promise<unknown>;
  pausePoolWorker(context: WorkerRuntimeContext): Promise<unknown>;
  resumePoolWorker(context: WorkerRuntimeContext): Promise<unknown>;
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

// An initiated stop acknowledgement can attest only the graceful stage at the request instant.
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

// Observed stage timestamps cannot lie after the command instant.
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

export function createWorkerPoolRuntimeExecutor(
  supervisor: WorkerPoolProcessSupervisor,
  slots: Readonly<{ get(workerId: string): WorkerSlotRecord | undefined }>,
  lifecycle?: Readonly<{ database: AuthorityDatabase; clock: Clock }>,
): WorkerPoolRuntimeExecutor {
  const poolMemberFromIdentity = (workerId: WorkerId): WorkerPoolMember => {
    const slot = slots.get(workerId);
    if (slot === undefined) throw new Error("worker-slot-not-admitted");
    return Object.freeze(workerPoolMember(slot));
  };
  const poolMemberFromWorkerId = (workflowId: WorkflowId, workerId: WorkerId): WorkerPoolMember => {
    const member = poolMemberFromIdentity(workerId);
    if (member.workflowId !== workflowId) throw new Error("worker-slot-workflow-mismatch");
    return member;
  };
  return Object.freeze({
    assertLifecycleOwner(operation: "remove" | "retry", workerId: string, membershipRevision: number, lifetime: Readonly<{ leaseGeneration: number; processId: number; startedAt: string }>): void {
      const member = poolMemberFromIdentity(WorkerIdSchema.parse(workerId));
      if (member.membershipRevision !== membershipRevision || supervisor.assertLifecycleOwner === undefined || supervisor.ownWorkerControl === undefined
        || lifecycle === undefined) throw new Error("worker-lifecycle-owner-unavailable");
      lifecycle.database.assertWorkerLifecycleRelease(workerId);
      if (operation === "retry" && lifecycle.database.authority.workerControls.browsers(workerId).some(browser => browser.health !== "closed")) throw new Error("worker-retry-browser-release-unproved");
      supervisor.assertLifecycleOwner(operation, member, lifetime);
    },
    beginLifecycle(context: WorkerRuntimeContext): void {
      const command = context.command;
      if ((command.type !== "remove-worker" && command.type !== "retry-worker" && command.type !== "stop-worker") || lifecycle === undefined || supervisor.ownWorkerControl === undefined) throw new Error("worker-lifecycle-owner-unavailable");
      const binding = lifecycle.database.authority.workerControls.get(command.commandId)?.lifecycle;
      if (binding === undefined) throw new Error("worker-lifecycle-binding-unavailable");
      supervisor.ownWorkerControl(command.commandId, async () => {
        try {
          if (command.type === "remove-worker") {
            if (supervisor.removeWorker === undefined) throw new Error("worker-removal-owner-unavailable");
            const proof = await supervisor.removeWorker(binding, stopDirectiveContext(context));
            lifecycle.database.settleWorkerRemoval(command.commandId, proof, lifecycle.clock.now().toISOString(), randomUUID());
          } else {
            if (supervisor.retryWorker === undefined) throw new Error("worker-retry-owner-unavailable");
            const proof = await supervisor.retryWorker(binding);
            if (command.type === "stop-worker") lifecycle.database.observeWorkerLifecycleEffect(command.commandId, proof, lifecycle.clock.now().toISOString());
            else lifecycle.database.settleWorkerRetry(command.commandId, proof, lifecycle.clock.now().toISOString(), randomUUID());
          }
        } catch (error) {
          const current = lifecycle.database.authority.workerControls.get(command.commandId);
          if (current?.phase.state === "executing") lifecycle.database.authority.workerControls.transition(command.commandId, "executing", {
            state: "uncertain", startedAt: current.phase.startedAt, observedAt: lifecycle.clock.now().toISOString(), message: "worker-lifecycle-effect-or-settlement-unproved" });
          throw error;
        }
      });
    },
    assertResetOwner(workerId: string, membershipRevision: number, lifetime: Readonly<{ leaseGeneration: number; processId: number; startedAt: string }>): void {
      const member = poolMemberFromIdentity(WorkerIdSchema.parse(workerId));
      if (member.membershipRevision !== membershipRevision) throw new Error("worker-reset-owned-member-changed");
      if (supervisor.assertResetOwner === undefined) throw new Error("worker-reset-owner-unavailable");
      supervisor.assertResetOwner(member, lifetime);
    },
    async planPoolWorkerCount(context: WorkerRuntimeContext): Promise<z.input<typeof WorkerPlanAcknowledgementSchema>> {
      const { command } = context;
      if (command.type !== "plan-worker-count") {
        throw new Error(`planPoolWorkerCount received a ${command.type} command`);
      }
      const desiredWorkers = command.payload.desiredWorkers;
      const admitted = context.roster;
      if (admitted === undefined || admitted.selected.length !== desiredWorkers) throw new Error("worker-roster-not-admitted");
      const members = Object.freeze(admitted.selected.map(slot => Object.freeze(workerPoolMember(slot))));
      const excessMembers = Object.freeze(admitted.excess.map(slot => Object.freeze(workerPoolMember(slot))));
      const roster = Object.freeze([...members, ...excessMembers]);

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
        if (fact.stage !== "unmet" && fact.stage !== "retired") {
          requireDurableOwnership("plan-worker-count", fact.member, fact.ownership);
        }
        if (offset < desiredWorkers && (fact.stage === "graceful-stop-requested" || fact.stage === "retired")) {
          throw new Error(
            `plan-worker-count cannot stop desired member ${fact.member.workerId} at index ${String(offset + 1)}`,
          );
        }
        if (fact.stage === "graceful-stop-requested") {

          if (fact.phase === "initiating") {
            requireInitialGracefulObservation("plan-worker-count", fact.member, fact.observed);
          }
          requireObservedNotAfterNow("plan-worker-count", fact.member, fact.observed, context.now);
        }
        if (offset >= desiredWorkers && fact.stage === "running") {

          throw new Error(
            `plan-worker-count must select running excess member ${fact.member.workerId} for bounded graceful stop`,
          );
        }
      }
      const retirements = excessMembers.map(member => {
        const fact = acknowledgement.members.find(value => value.member.workerId === member.workerId);
        if (fact?.stage !== "retired" || fact.proof.workerId !== member.workerId
          || fact.proof.membershipRevision !== member.membershipRevision) throw new Error("worker-retirement-not-proved");
        return fact.proof;
      });
      if (acknowledgement.members.length !== roster.length) throw new Error("worker-roster-acknowledgement-size-mismatch");
      return { state: "accepted", workerIds: [...plannedWorkerIds], retirements };
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
