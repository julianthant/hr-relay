import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../models/failures/error-catalog.js";
import type { DashboardDayWire } from "../../../models/dashboard/projection.js";
import type { QueueSurfaceWire } from "../shell/shell-model.js";
import type { WorkflowCatalogEntry } from "../workflows/workflow-catalog-model.js";
import { SYSTEM_NAME } from "../shared/status/system-chip-model.js";
import { workerBrowserView, workerDirectiveNote, workerElapsedSeconds, workerRetryProblem } from "./session-panel-model.js";

type WorkerCardWire = DashboardDayWire["workerCards"][number];

export type SessionWorkerState = "running" | "starting" | "idle" | "waiting" | "paused" | "stopped" | "failed" | "unavailable";
export type SessionBrowserState = "ready" | "active" | "starting" | "unopened" | "closed" | "unavailable" | "failed" | "needs-duo" | "signed-out";
export type SessionControl = "pause" | "resume" | "retry" | "stop" | "remove";
export type SessionNode = Readonly<{ id: string; label: string; state: "completed" | "active" | "pending" | "waiting" | "paused" | "failed" }>;
export type SessionWorker = Readonly<{
  authority?: WorkerCardWire;
  timelineUnavailable?: string;
  id: string;
  label: string;
  workflowId: string;
  workflow: string;
  subject?: string;
  action: string;
  state: SessionWorkerState;
  elapsed?: string;
  timeline?: readonly SessionNode[];
  problem?: string;
  note?: string;
  browsers: readonly Readonly<{ id: string; label: string; state: SessionBrowserState; reason?: string }>[];
}>;
export type SessionsViewState = Readonly<{ state: "ready"; workers: readonly SessionWorker[] }>
  | Readonly<{ state: "loading" }> | Readonly<{ state: "unavailable"; reason: string; diagnostic?: unknown }>;
export function sessionsUnavailable(diagnostic?: unknown): SessionsViewState {
  return { state: "unavailable", reason: formatErrorCatalogFailure(createErrorCatalogFailure("SESSIONS_UNAVAILABLE", {})).text,
    ...(diagnostic === undefined ? {} : { diagnostic }) };
}
/** One plain sentence for how a settled lease ended; a deliberate stop is not an error. */
const SETTLED_LINE: Readonly<Record<NonNullable<WorkerCardWire["stopReason"]>, string>> = { operator: "You stopped this worker.", shutdown: "Relay shut down.", crashed: "Worker stopped unexpectedly." };
export const SESSION_STATE_LABELS: Readonly<Record<SessionWorkerState, string>> = {
  running: "Running", starting: "Starting", idle: "Idle", waiting: "Waiting", paused: "Paused", stopped: "Stopped", failed: "Failed", unavailable: "Unavailable",
};
const LAST_RUN_LINE: Readonly<Record<NonNullable<Extract<WorkerCardWire["lastRun"], { state: "present" }>["outcome"]>, string>> = {
  done: "Last run finished.", failed: "Last run failed.", cancelled: "Last run was cancelled.", discarded: "Last run was discarded.", interrupted: "Last run was interrupted.", superseded: "Last run was replaced.",
};
const WAITING_LINE: Readonly<Record<NonNullable<WorkerCardWire["waitingActivity"]>, string>> = { acquiring: "Opening browser sessions", authenticating: "Signing in", closing: "Closing browser sessions" };
const TIMELINE_REASON: Readonly<Record<NonNullable<Extract<WorkerCardWire["timeline"], { state: "unavailable" }>["reason"]>, string>> = {
  "run-not-in-day": "Run timeline is not served on this day", "run-unavailable": "Run timeline is not served on this day",
  "no-steps-recorded": "No steps are served for this run", "timeline-incompatible": "The current timeline contains states unavailable in this view",
};
export function sessionStateColor(state: SessionWorkerState): string {
  return state === "failed" ? "text-ui-danger" : state === "waiting" || state === "starting" || state === "unavailable" ? "text-ui-warning"
    : state === "running" ? "text-ui-positive" : "text-ui-muted";
}
export function sessionTallies(workers: readonly SessionWorker[]): readonly { state: SessionWorkerState; count: number }[] {
  const order: readonly SessionWorkerState[] = ["running", "starting", "idle", "waiting", "paused", "stopped", "failed", "unavailable"];
  return order.map(state => ({ state, count: workers.filter(worker => worker.state === state).length }))
    .filter(tally => tally.count > 0 || ["running", "starting", "idle"].includes(tally.state));
}
export function sessionTimelineSummary(nodes: readonly SessionNode[]): { completed: number; total: number } {
  if (!nodes.length || new Set(nodes.map(node => node.id)).size !== nodes.length) throw new Error("session-timeline-invalid");
  return { completed: nodes.filter(node => node.state === "completed").length, total: nodes.length };
}

export function sessionWorkerLifetimeKey(card: WorkerCardWire): string {
  return JSON.stringify([card.member, card.controls?.basis.state === "present" ? card.controls.basis.value.leaseGeneration : undefined,
    card.browsers.map(browser => [browser.sessionId, browser.observation?.state === "present" ? [browser.observation.instance, browser.observation.configFingerprint, browser.observation.browserMode] : undefined]).sort()]);
}
export function sessionWorkerAuthorityKey(card: WorkerCardWire): string {
  return JSON.stringify([sessionWorkerLifetimeKey(card), card.controls?.basis]);
}

export function sessionsFromDay(day: DashboardDayWire, catalog: readonly WorkflowCatalogEntry[], nowIso: string): SessionsViewState {
  if (day.workerAuthority.state !== "present") return sessionsUnavailable(day.workerAuthority);
  const workers: SessionWorker[] = [];
  for (const card of day.workerCards) {
    const registration = catalog.find(entry => entry.id === card.workflowId);
    if (registration === undefined) return sessionsUnavailable({ code: "SESSION_WORKFLOW_UNREGISTERED", workflowId: card.workflowId });
    const currentRun = card.currentRun;
    const settled = card.state === "failed";
    const lastRun = card.lastRun?.state === "present" ? card.lastRun : undefined;
    // A settled worker keeps the run it last claimed, so its card shows the step it ended on.
    const runId = currentRun.state === "present" ? currentRun.runId : settled ? lastRun?.runId : undefined;
    const row = runId === undefined ? undefined : day.queueSurfaces.find(run => run.runId === runId && run.workflowId === card.workflowId);
    const timelineUnavailable = runId === undefined ? currentRun.state === "absent" ? currentRun.reason : undefined
      : card.timeline?.state === "unavailable" ? TIMELINE_REASON[card.timeline.reason]
      : row === undefined ? TIMELINE_REASON["run-not-in-day"]
      : row.pipeline.length === 0 ? TIMELINE_REASON["no-steps-recorded"]
      : row.pipeline.some(step => step.state === "skipped" || step.state === "cancelled") ? TIMELINE_REASON["timeline-incompatible"] : undefined;
    const frozenNode = settled && lastRun?.step !== undefined && lastRun.step.state !== "done" ? lastRun.step.nodeId : undefined;
    const atStep = (step: QueueSurfaceWire["pipeline"][number]) => step.state === "active" || step.id === frozenNode && step.state === "pending";
    const timeline: SessionNode[] | undefined = timelineUnavailable === undefined ? row?.pipeline.map(step => ({ id: step.id, label: step.label,
      state: step.state === "done" ? "completed" : step.state === "blocked" ? "waiting" : atStep(step) && (card.state === "paused" || settled && card.stopReason !== "crashed") ? "paused"
        : atStep(step) && settled ? "failed"
        : atStep(step) ? "active" : step.state === "failed" ? "failed" : "pending" })) : undefined;
    const seconds = workerElapsedSeconds(card, nowIso);
    const browserView = workerBrowserView(card);
    const stepLabel = row?.pipeline.find(step => atStep(step) || step.state === "blocked" || step.state === "failed")?.label;
    const problem = workerRetryProblem(card) ?? (card.stopReason === undefined ? card.state === "idle" && lastRun?.outcome !== undefined ? LAST_RUN_LINE[lastRun.outcome] : undefined : SETTLED_LINE[card.stopReason]);
    const state = card.state === "failed" && (card.stopReason === "operator" || card.stopReason === "shutdown") ? "stopped" : card.state;
    const note = workerDirectiveNote(card) ?? (card.waitingActivity === undefined ? undefined : WAITING_LINE[card.waitingActivity]);
    workers.push({ id: card.workerId, label: `Worker ${card.member.ordinal}`, workflowId: card.workflowId, workflow: registration.label,
      authority: card, state,
      ...(row === undefined ? {} : { subject: row.title }),
      action: settled ? stepLabel ?? "" : row?.liveMessage.state === "present" ? row.liveMessage.value : stepLabel
        ?? (card.state === "idle" ? "Ready for the next run" : card.state === "starting" ? "Preparing worker" : ""),
      ...(card.state === "idle" ? {} : { elapsed: seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s` }),
      ...(timeline === undefined ? { timelineUnavailable } : { timeline }),
      ...(problem === undefined ? {} : { problem }),
      ...(note === undefined ? {} : { note }),
      browsers: browserView.slots.map((slot, index) => slot.state !== "open"
        ? { id: `required:${card.workerId}:${index}:${slot.system}`, label: SYSTEM_NAME[slot.system], state: slot.state === "closed" ? "closed" : "unopened" }
        : { id: slot.browser.sessionId, label: SYSTEM_NAME[slot.browser.system],
          ...(slot.browser.observation?.state === "unavailable" ? { reason: slot.browser.observation.reason } : {}),
          state: slot.browser.signIn === "needs-duo" ? "needs-duo" : slot.browser.signIn === "signed-out" ? "signed-out"
            : slot.browser.observation?.state !== "present" ? "unavailable"
            : slot.browser.observation.health === "starting" ? "starting"
            : slot.browser.observation.health === "authenticated" ? "ready"
            : slot.browser.observation.health === "failed" ? "failed"
            : slot.browser.observation.health === "unknown" && card.state === "running" ? "active" : "unavailable" }),
    });
  }
  // One card that could not be built never hides its siblings; it keeps its place in the member order.
  for (const card of day.unavailableWorkerCards ?? []) {
    const registration = catalog.find(entry => entry.id === card.member.workflowId);
    if (registration === undefined) return sessionsUnavailable({ code: "SESSION_WORKFLOW_UNREGISTERED", workflowId: card.member.workflowId });
    workers.push({ id: card.workerId, label: `Worker ${card.member.ordinal}`, workflowId: card.member.workflowId, workflow: registration.label,
      state: "unavailable", subject: `Worker ${card.member.ordinal}`, action: "", problem: "Relay can't read this worker right now.", browsers: [] });
  }
  if (day.unavailableWorkerCards?.length) {
    const ordinals = new Map<string, number>([...day.workerCards, ...day.unavailableWorkerCards].map(card => [card.workerId, card.member.ordinal]));
    const workflows = [...new Set(workers.map(worker => worker.workflowId))];
    workers.sort((a, b) => workflows.indexOf(a.workflowId) - workflows.indexOf(b.workflowId) || ordinals.get(a.id)! - ordinals.get(b.id)!);
  }
  return { state: "ready", workers };
}
