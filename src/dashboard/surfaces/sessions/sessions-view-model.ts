import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../models/failures/error-catalog.js";
import type { DashboardDayWire } from "../../../models/dashboard/projection.js";
import type { WorkflowCatalogEntry } from "../workflows/workflow-catalog-model.js";
import { SYSTEM_LABEL } from "../shared/status/system-chip-model.js";
import { workerBrowserView, workerDirectiveNote, workerElapsedSeconds } from "./session-panel-model.js";

type WorkerCardWire = DashboardDayWire["workerCards"][number];

export type SessionWorkerState = "running" | "starting" | "idle" | "waiting" | "paused" | "stopped" | "failed";
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
  browsers: readonly Readonly<{ id: string; label: string; state: "ready" | "active" | "starting" | "unopened" | "closed" | "unavailable" | "failed" }>[];
}>;
export type SessionsViewState = Readonly<{ state: "ready"; workers: readonly SessionWorker[] }>
  | Readonly<{ state: "loading" }> | Readonly<{ state: "unavailable"; reason: string; diagnostic?: unknown }>;
export function sessionsUnavailable(diagnostic?: unknown): SessionsViewState {
  return { state: "unavailable", reason: formatErrorCatalogFailure(createErrorCatalogFailure("SESSIONS_UNAVAILABLE", {})).text,
    ...(diagnostic === undefined ? {} : { diagnostic }) };
}
/** One plain sentence for why a worker is not running; a deliberate stop is not an error. */
const SETTLED_LINE: Readonly<Record<NonNullable<WorkerCardWire["stopReason"]>, string>> = { operator: "You stopped this worker.", crashed: "Worker stopped unexpectedly.", "not-started": "Worker didn't start." };
export const SESSION_STATE_LABELS: Readonly<Record<SessionWorkerState, string>> = {
  running: "Running", starting: "Starting", idle: "Idle", waiting: "Waiting", paused: "Paused", stopped: "Stopped", failed: "Failed",
};
export function sessionStateColor(state: SessionWorkerState): string {
  return state === "failed" ? "text-ui-danger" : state === "waiting" || state === "starting" ? "text-ui-warning"
    : state === "running" ? "text-ui-positive" : "text-ui-muted";
}
export function sessionTallies(workers: readonly SessionWorker[]): readonly { state: SessionWorkerState; count: number }[] {
  const order: readonly SessionWorkerState[] = ["running", "starting", "idle", "waiting", "paused", "stopped", "failed"];
  return order.map(state => ({ state, count: workers.filter(worker => worker.state === state).length }))
    .filter(tally => tally.count > 0 || ["running", "starting", "idle"].includes(tally.state));
}
export function sessionTimelineSummary(nodes: readonly SessionNode[]): { completed: number; total: number } {
  if (!nodes.length || new Set(nodes.map(node => node.id)).size !== nodes.length) throw new Error("session-timeline-invalid");
  return { completed: nodes.filter(node => node.state === "completed").length, total: nodes.length };
}

export function sessionWorkerLifetimeKey(card: WorkerCardWire): string {
  return JSON.stringify([card.member, card.controls?.basis.state === "present" ? card.controls.basis.value.lifetimeId : undefined,
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
    const row = currentRun.state === "present" ? day.queueSurfaces.find(run => run.runId === currentRun.runId && run.workflowId === card.workflowId) : undefined;
    const timelineUnavailable = currentRun.state === "absent" ? currentRun.reason : row === undefined ? "Run timeline is not served on this day"
      : row.pipeline.length === 0 ? "No steps are served for this run"
      : row.pipeline.some(step => step.state === "skipped" || step.state === "cancelled") ? "The current timeline contains states unavailable in this view" : undefined;
    const timeline: SessionNode[] | undefined = timelineUnavailable === undefined ? row?.pipeline.map(step => ({ id: step.id, label: step.label,
      state: step.state === "done" ? "completed" : step.state === "blocked" ? "waiting" : step.state === "active" && (card.state === "paused" || card.state === "failed" && card.stopReason !== "crashed") ? "paused"
        : step.state === "active" && card.state === "failed" ? "failed"
        : step.state === "active" ? "active" : step.state === "failed" ? "failed" : "pending" })) : undefined;
    const seconds = workerElapsedSeconds(card, nowIso);
    const browserView = workerBrowserView(card);
    const problem = card.stopReason === undefined ? undefined : SETTLED_LINE[card.stopReason];
    const state = card.state === "failed" && card.stopReason === "operator" ? "stopped" : card.state;
    workers.push({ id: card.workerId, label: `Worker ${card.member.ordinal}`, workflowId: card.workflowId, workflow: registration.label,
      authority: card, state,
      ...(row === undefined ? {} : { subject: row.title }),
      action: row?.liveMessage.state === "present" ? row.liveMessage.value : row?.pipeline.find(step => step.state === "active" || step.state === "blocked")?.label
        ?? (card.state === "idle" ? "Ready for the next run" : card.state === "starting" ? "Preparing worker" : ""),
      ...(card.state === "idle" ? {} : { elapsed: seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s` }),
      ...(timeline === undefined ? { timelineUnavailable } : { timeline }),
      ...(problem === undefined ? {} : { problem }),
      ...(workerDirectiveNote(card) === undefined ? {} : { note: workerDirectiveNote(card) }),
      browsers: browserView.slots.map((slot, index) => slot.state !== "open"
        ? { id: `required:${card.workerId}:${index}:${slot.system}`, label: SYSTEM_LABEL[slot.system], state: slot.state === "closed" ? "closed" : card.state === "starting" ? "starting" : "unopened" }
        : { id: slot.browser.sessionId, label: SYSTEM_LABEL[slot.browser.system],
          state: slot.browser.observation?.state !== "present" ? "unavailable"
            : slot.browser.observation.health === "starting" ? "starting"
            : slot.browser.observation.health === "authenticated" ? "ready"
            : slot.browser.observation.health === "failed" ? "failed"
            : slot.browser.observation.health === "unknown" && card.state === "running" ? "active" : "unavailable" }),
    });
  }
  return { state: "ready", workers };
}
