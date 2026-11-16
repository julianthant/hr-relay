import { z } from "zod";
import { operatorFailureSentence } from "../../../models/failures/error-catalog.js";
import { WorkerBrowserWireSchema, WorkerCardWireSchema, WorkerLastRunWireSchema, type StepInterruptWire } from "../../../models/dashboard/projection.js";
import type { RunRecord } from "../../../models/run/record.js";
import { workerPoolMember, type WorkerSlotRecord } from "../../../models/run/worker-slot.js";
import { pendingInterruptOf } from "../../../rules/runs/run-interrupt.js";
import type { WorkerChildBrowserObservation } from "../../runtime/workers/worker-messages.js";
import type { WorkerExitFact, WorkerMemberView } from "../../runtime/workers/worker-pool.js";
import { nodeIdOfTaskSpanPath } from "../lifecycle/support.js";
import type { RunFoldRecord } from "./run-queue-projection.js";

export type WorkerCardWire = z.infer<typeof WorkerCardWireSchema>;

/** ONE open browser session as the span fold observed it. */
export interface WorkerBrowserFold {
  readonly sessionId: string;
  readonly system: string;
  readonly openedAt: string;
}

function workerCardState(view: WorkerMemberView): WorkerCardWire["state"] {
  if (view.state === "exited") return "failed";
  if (view.state === "starting") return "starting";
  switch (view.activity?.state) {
    case "busy": return "running";
    case "waiting": return "waiting";
    case "paused": return "paused";
    case "idle":
    case undefined: return "idle";
  }
}

/** Stop is the run's durable cancellation (row Cancel, or the Reset's own Cancel), so the run alone says which interrupt is pending. */
export function stepInterruptOf(run: RunRecord, writeInFlight: boolean): StepInterruptWire | undefined {
  const pending = pendingInterruptOf(run);
  const action = pending === "stop-requested" ? "stop" : pending === "pause-requested" ? "pause" : undefined;
  return action === undefined ? undefined : { action, step: writeInFlight ? "finish-write" : "cancel" };
}

type WorkerLastRun = NonNullable<WorkerCardWire["lastRun"]>;

/** The run this worker last claimed: the run's own terminal facts, and its last task span on the claimed attempt (an open span wins). */
export function lastRunOf(input: Readonly<{
  claim: Readonly<{ runId: string; attempt: number }> | undefined;
  run: RunRecord | undefined;
  spans: RunFoldRecord["taskSpans"] | undefined;
  taskIdOf: (nodeId: string, spanPath: string) => string | undefined;
}>): WorkerLastRun {
  if (input.claim === undefined) return { state: "unavailable", reason: "no-run-recorded" };
  const { run } = input;
  if (run?.envelope.runId !== input.claim.runId) return { state: "unavailable", reason: "run-unavailable" };
  const claimed = (input.spans ?? []).filter(span => span.attempt === input.claim?.attempt && span.startedAt !== undefined);
  const span = claimed.findLast(candidate => candidate.endedAt === undefined) ?? claimed.at(-1);
  const nodeId = span === undefined ? undefined : nodeIdOfTaskSpanPath(span.spanPath);
  const taskId = span === undefined || nodeId === undefined ? undefined : input.taskIdOf(nodeId, span.spanPath);
  return WorkerLastRunWireSchema.parse({
    state: "present", runId: run.envelope.runId, traceId: run.envelope.traceId,
    ...(run.lifecycle.state === "terminal" ? { outcome: run.lifecycle.outcome, endedAt: run.lifecycle.endedAt } : {}),
    ...(span?.startedAt === undefined || nodeId === undefined ? {} : { step: { nodeId, ...(taskId === undefined ? {} : { taskId }),
      state: span.outcome === undefined ? "open" : span.outcome === "done" || span.outcome === "skipped" ? "done" : "failed", startedAt: span.startedAt } }),
  });
}

function signInOf(view: WorkerMemberView, observed: WorkerChildBrowserObservation, duoSystems: readonly string[]): NonNullable<WorkerCardWire["browsers"][number]["signIn"]> {
  if (observed.health === "authenticated") return "signed-in";
  // Closed and failed rows keep no authentication history, so signed-out is not provable.
  if (observed.health === "closed" || observed.health === "failed") return "unknown";
  if (duoSystems.includes(observed.system)) return "needs-duo";
  if (observed.health === "starting" || view.activity?.state === "waiting" && view.activity.waiting !== "closing") return "signing-in";
  return "unknown";
}

function stopReasonOf(exit: WorkerExitFact | undefined): NonNullable<WorkerCardWire["stopReason"]> {
  if (exit?.outcome !== "stopped" || exit.reason === "fault") return "crashed";
  return exit.reason === "shutdown" || exit.reason === "logout" ? "shutdown" : "operator";
}

/** A card is the pool's in-memory member joined with its durable slot; the fence it serves is the member's lifetime and version. */
export function workerCardOf(input: Readonly<{
  slot: WorkerSlotRecord;
  /** Absent when the slot has no process this boot (its start was refused or never attempted); the card then offers Retry. */
  view: WorkerMemberView | undefined;
  /** A capacity step for this workflow has not settled, so a member with no live process is still starting, not failed. */
  startupPending?: boolean;
  /** Span events folded for this worker; a patch cursor, never a CAS token. */
  foldRevision: number;
  resolveRun: (runId: string) => RunRecord | undefined;
  /** Systems whose live Duo lease this worker holds. */
  duoSystems?: readonly string[];
  lastRun?: WorkerLastRun;
  timeline?: WorkerCardWire["timeline"];
  writeInFlight?: (runId: string) => boolean;
}>): WorkerCardWire {
  const { slot, view } = input;
  if (slot.retiredAt !== null || (view !== undefined && (view.member.workerId !== slot.workerId || view.member.workflowId !== slot.workflow))) {
    throw new Error("worker-member-authority-unavailable");
  }
  const base = { member: workerPoolMember(slot), workerId: slot.workerId, workflowId: slot.workflow,
    directive: view?.state === "stopping" ? "stop" : slot.paused ? "pause" : "run",
    ...(input.lastRun === undefined ? {} : { lastRun: input.lastRun }), ...(input.timeline === undefined ? {} : { timeline: input.timeline }),
    availability: { state: "available" } } as const;
  if (input.startupPending === true && (view === undefined || view.state === "exited")) {
    return WorkerCardWireSchema.parse({ ...base, state: "starting", startedAt: view?.startedAt ?? slot.createdAt,
      controls: { basis: { state: "present", value: { lifetimeId: view?.lifetimeId ?? null, version: view?.version ?? 0 } } },
      currentRun: { state: "absent", reason: "no current claimed run" }, browsers: [], revision: input.foldRevision + (view?.version ?? 0) + 1 });
  }
  if (view === undefined) {
    return WorkerCardWireSchema.parse({ ...base, state: "failed", stopReason: "not-started", startedAt: slot.createdAt,
      controls: { basis: { state: "present", value: { lifetimeId: null, version: 0 } } },
      currentRun: { state: "absent", reason: "no current claimed run" }, browsers: [], revision: input.foldRevision + 1 });
  }
  const runId = view.activity?.runId, run = runId === undefined ? undefined : input.resolveRun(runId);
  const exit = view.state === "exited" ? view.exit : undefined;
  const browserWire = (browser: WorkerChildBrowserObservation) => WorkerBrowserWireSchema.parse({
    sessionId: browser.sessionId, system: browser.system, openedAt: browser.openedAt,
    observation: { state: "present", health: browser.health, observedAt: browser.observedAt, instance: browser.instance,
      browserMode: browser.browserMode, configFingerprint: browser.configFingerprint },
    signIn: signInOf(view, browser, input.duoSystems ?? []) });
  const state = workerCardState(view);
  const browsers = view.state === "exited" ? [] : view.browsers.filter(browser => browser.health !== "closed").map(browserWire);
  const current = run !== undefined && "workerId" in run.lifecycle && run.lifecycle.workerId === slot.workerId ? run : undefined;
  const interrupt = current === undefined ? undefined : stepInterruptOf(current, input.writeInFlight?.(current.envelope.runId) === true);
  return WorkerCardWireSchema.parse({
    ...base,
    state,
    controls: { basis: { state: "present", value: { lifetimeId: view.lifetimeId, version: view.version } } },
    startedAt: view.startedAt,
    ...(view.state === "exited"
      ? { endedAt: exit?.at ?? view.startedAt, stopReason: stopReasonOf(exit),
        ...(exit?.outcome === "crashed" && exit.failureCode !== undefined ? { failureCode: exit.failureCode } : {}),
        // An exited member holds no live browser; its last reported sessions stay readable.
        lastBrowsers: view.browsers.map(browserWire) }
      : {}),
    currentRun: current === undefined ? { state: "absent", reason: "no current claimed run" }
      : { state: "present", runId: current.envelope.runId, traceId: current.envelope.traceId },
    ...(view.browserSystems === undefined ? {} : { browserRequirements: { state: "present", systems: view.browserSystems,
      missing: view.browserSystems.filter(system => !browsers.some(browser => browser.system === system && browser.signIn === "signed-in")) } }),
    browsers,
    ...(state === "waiting" && view.activity?.waiting !== undefined ? { waitingActivity: view.activity.waiting } : {}),
    ...(state === "idle" && view.activity?.refusal !== undefined ? { refusal: {
      code: view.activity.refusal.code,
      summary: view.activity.refusal.summary ?? operatorFailureSentence(view.activity.refusal.code),
      retryAt: view.activity.refusal.retryAt,
    } } : {}),
    ...(interrupt === undefined ? {} : { interrupt }),
    revision: input.foldRevision + view.version + 1,
  });
}
