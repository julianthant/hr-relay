import { useMemo } from "react";
import { isQueueTopLevel } from "../../../models/dashboard/queue-parent.js";
import type { QueueSurfaceWire } from "../../../models/dashboard/projection.js";
import { mockWorkflow } from "../workflows/mocks/workflow-mock-catalog.js";
import { mockNeedsReview,mockReviewRun,mockRunStatus,mockWaitsForOcr,type MockRun } from "../workflows/mocks/workflow-mock-model.js";
import { mockQueueSurfaces } from "../workflows/mocks/workflow-queue-model.js";
import { reviewRecords } from "../workflows/mocks/workflow-review-model.js";
import { notificationsSample,previewNotificationReads } from "./notifications-fixture.js";
import type { NotificationDestination,NotificationItem,NotificationsState } from "./notifications-view-model.js";

type PreviewInput = Readonly<{
  day: string; nowIso: string; anchorIso: string; rows?: readonly QueueSurfaceWire[]; runs: readonly MockRun[];
  workflowLabel: (id: string) => string; unavailable?: string;
  eventTimes?: Readonly<Record<string, string>>;
}>;

export function useWorkspaceNotifications(scenario: string, input: PreviewInput): NotificationsState {
  const { day, nowIso, anchorIso, rows, runs, workflowLabel, eventTimes, unavailable } = input;
  const minute = Math.floor(Date.parse(nowIso) / 60000);
  return useMemo(() => notificationPreviewState(scenario, {
    day, anchorIso, nowIso: new Date(Math.max(minute * 60000, Date.parse(anchorIso), ...Object.values(eventTimes ?? {}).map(Date.parse))).toISOString(),
    rows, runs, workflowLabel, eventTimes, unavailable,
  }), [scenario, day, anchorIso, minute, rows, runs, workflowLabel, eventTimes, unavailable]);
}

function age(instant: string, nowIso: string): string {
  const elapsed = Date.parse(nowIso) - Date.parse(instant);
  if (!Number.isFinite(elapsed)) throw new Error("NOTIFICATION_PREVIEW_TIME_INVALID");
  if (elapsed < 0) return "";
  const minutes = Math.floor(elapsed / 60000);
  return minutes < 1 ? "Just now" : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.floor(minutes / 60)} hr ago` : `${Math.floor(minutes / 1440)} days ago`;
}

function runItem(row: QueueSurfaceWire, read: boolean, input: PreviewInput): NotificationItem {
  const failed = row.status === "failed";
  const waiting = row.status === "awaiting-approval";
  const parked = row.status === "blocked";
  const partial = row.status === "partial";
  const instant = waiting && row.gateOpenedAt.state === "present" ? row.gateOpenedAt.value : row.endedAt.state === "present" ? row.endedAt.value : undefined;
  return { id: `queue:${input.day}:${row.runId}`, subject: row.title, workflow: input.workflowLabel(row.workflowId), read, priority: failed || waiting || parked,
    title: failed ? "Run failed" : waiting ? "Approval waiting" : parked ? "Write parked" : partial ? "Run completed with issues" : "Run completed",
    detail: row.liveMessage.state === "present" ? row.liveMessage.value : partial && row.warnings.state === "present" ? row.warnings.first : failed ? "Review the failed step in the log." : waiting ? "This run is waiting for your review." : partial ? "Some steps did not complete. Review the log." : parked ? "Review the parked write in the log before continuing." : "Completed successfully.",
    tone: failed ? "danger" : waiting || parked || partial ? "warning" : "positive", age: instant ? age(instant, input.nowIso) : "",
    action: waiting ? "Review run" : "Open log", destination: { kind: "run", runId: row.runId, day: input.day } };
}

function mockItem(run: MockRun, read: boolean, input: PreviewInput): NotificationItem {
  const records = run.records !== undefined;
  const waiting = mockNeedsReview(run);
  const count = records ? reviewRecords(run).length : 0;
  const row = mockQueueSurfaces([run], input.anchorIso, input.runs)[0];
  const host = input.runs.find(item => item.id === run.parentId) ?? run;
  const instant = input.eventTimes?.[run.id] ?? (waiting && row.gateOpenedAt.state === "present" ? row.gateOpenedAt.value : row.endedAt.state === "present" ? row.endedAt.value : undefined);
  return { id: `preview:${input.day}:${run.id}`, subject: host.title, workflow: mockWorkflow(host.workflowId).label, read, priority: waiting,
    title: waiting ? "Records ready for approval" : run.discarded ? "Records discarded" : records ? "Records approved" : "Run completed",
    detail: waiting && row.liveMessage.state === "present" ? row.liveMessage.value : records ? `${count} ${count === 1 ? "record" : "records"} · ${mockRunStatus(run)}` : mockRunStatus(run),
    tone: waiting ? "warning" : run.discarded ? "info" : "positive", age: instant ? age(instant, input.nowIso) : "",
    action: records ? waiting ? "Review records" : "View records" : "Open log", destination: { kind: "preview-run", runId: host.id, day: input.day, records } };
}

export function notificationPreviewState(scenario: string, input: PreviewInput): NotificationsState {
  if (!["normal", "ping"].includes(scenario)) return notificationsSample(scenario);
  if (input.unavailable) return { state: "unavailable", reason: input.unavailable };
  if (!input.rows) return { state: "loading" };
  const rows = input.rows.filter(row => isQueueTopLevel(row) && (row.surfaceKind === "single" || row.surfaceKind === "operation")
    && ["failed", "done", "awaiting-approval", "blocked", "partial"].includes(row.status));
  const failed = rows.find(row => row.status === "failed");
  const done = rows.find(row => row.status === "done");
  const items: NotificationItem[] = rows.map(row => runItem(row, row !== failed && row !== done, input));
  for (const run of input.runs) {
    if (((run.seeded || run.parentId) && run.records === undefined) || mockWaitsForOcr(run)) continue;
    items.push(mockItem(run, previewNotificationReads[run.id] ?? run.seeded, input));
  }
  return { state: "ready", items, pinned: [] };
}

export function notificationDestinationRefusal(destination: NotificationDestination, input: Pick<PreviewInput, "day" | "rows" | "runs">): string | undefined {
  if (destination.kind !== "run" && destination.kind !== "preview-run") return "The linked preview is unavailable. Reopen the notification list.";
  if (destination.day !== input.day) return "The notification's day is no longer open. Reopen the notification from that day.";
  if (destination.kind === "run") return input.rows?.some(row => row.runId === destination.runId) ? undefined : "This run is no longer available. Refresh the run list and try again.";
  const run = input.runs.find(item => item.id === destination.runId);
  if (!run || (destination.records && mockReviewRun(run, input.runs).records === undefined)) return "The linked preview is unavailable. Reopen the notification list.";
  return undefined;
}
