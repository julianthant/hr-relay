import { useMemo } from "react";
import { isQueueTopLevel } from "../../../models/dashboard/queue-parent.js";
import type { QueueSurfaceWire } from "../../../models/dashboard/projection.js";
import { notificationsSample } from "./notifications-fixture.js";
import type { NotificationDestination,NotificationItem,NotificationsState } from "./notifications-view-model.js";

type PreviewInput = Readonly<{
  day: string; nowIso: string; anchorIso: string; rows?: readonly QueueSurfaceWire[];
  workflowLabel: (id: string) => string; unavailable?: string;
  eventTimes?: Readonly<Record<string, string>>;
}>;

export function useWorkspaceNotifications(scenario: string, input: PreviewInput): NotificationsState {
  const { day, nowIso, anchorIso, rows, workflowLabel, eventTimes, unavailable } = input;
  const minute = Math.floor(Date.parse(nowIso) / 60000);
  return useMemo(() => notificationPreviewState(scenario, {
    day, anchorIso, nowIso: new Date(Math.max(minute * 60000, Date.parse(anchorIso), ...Object.values(eventTimes ?? {}).map(Date.parse))).toISOString(),
    rows, workflowLabel, eventTimes, unavailable,
  }), [scenario, day, anchorIso, minute, rows, workflowLabel, eventTimes, unavailable]);
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
  return { id: `queue:${input.day}:${row.runId}`, kind: "run" as const, subject: row.title, workflow: input.workflowLabel(row.workflowId), read, priority: failed || waiting || parked,
    title: failed ? "Run failed" : waiting ? "Approval waiting" : parked ? "Write parked" : partial ? "Run completed with issues" : "Run completed",
    detail: row.liveMessage.state === "present" ? row.liveMessage.value : partial && row.warnings.state === "present" ? row.warnings.first : failed ? "Review the failed step in the log." : waiting ? "This run is waiting for your review." : partial ? "Some steps did not complete. Review the log." : parked ? "Review the parked write in the log before continuing." : "Completed successfully.",
    tone: failed ? "danger" : waiting || parked || partial ? "warning" : "positive", age: instant ? age(instant, input.nowIso) : "",
    action: waiting ? "Review run" : "Open log", destination: { kind: "run", runId: row.runId, day: input.day } };
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
  return { state: "ready", items, pinned: [] };
}

export function notificationDestinationRefusal(destination: NotificationDestination, input: Pick<PreviewInput, "day" | "rows">): string | undefined {
  if (destination.kind !== "run") return "The linked preview is unavailable. Reopen the notification list.";
  if (destination.day !== input.day) return "The notification's day is no longer open. Reopen the notification from that day.";
  return input.rows?.some(row => row.runId === destination.runId) ? undefined : "This run is no longer available. Refresh the run list and try again.";
}
