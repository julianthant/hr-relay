import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { mockParam } from "../../../../src/dashboard/app/mock-surfaces.js";
import { formatErrorCatalogFailure, createErrorCatalogFailure } from "../../../../src/models/failures/error-catalog.js";
import { routeWithoutTakeovers } from "../../../../src/dashboard/app/navigation/url-state.js";
import { resolveRunNavigation, type RunNavigation } from "../../../../src/dashboard/app/navigation/run-navigation.js";
import type { InboxHarnessInput, RunNavigationContext } from "../../../../src/dashboard/app/workflow-sources.js";
import type { InboxWiring } from "../../../../src/dashboard/state/inbox-wiring-adapter.js";
import { useToasts } from "../../../../src/dashboard/ds/ui.js";
import type { NotificationTarget } from "../../../../src/models/notifications/notification-target.js";
import type { AppRouteState } from "../../../../src/dashboard/app/navigation/url-state.js";
import { isQueueTopLevel } from "../../../../src/models/dashboard/queue-parent.js";
import type { QueueSurfaceWire } from "../../../../src/models/dashboard/projection.js";
import { notificationsSample } from "./notifications-sample.js";
import { applyNotificationReads, type NotificationDestination,type NotificationItem,type NotificationsState } from "../../../../src/dashboard/surfaces/notifications/notifications-view-model.js";

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

/** Read once at load: the route rewrites the URL after first render. */
let loadedScenario: string | undefined;
const scenario = () => loadedScenario ??= mockParam("notificationsPreview") ?? "normal";

/** An inbox over one notifications state: read marks kept by the caller, every open going through `navigate`. */
export function sampleInbox(state: NotificationsState, base: NotificationsState, setReads: Dispatch<SetStateAction<Readonly<Record<string, boolean>>>>): InboxWiring {
  return {
    state, notice: "",
    canAct: () => true,
    onPublication: () => () => undefined,
    async control(id, action) { if (action !== "read" && action !== "unread") return false; setReads(current => ({ ...current, [id]: action === "read" })); return true; },
    async readAll() { if (base.state === "ready") setReads(current => ({ ...current, ...Object.fromEntries(base.items.map(item => [item.id, true])) })); },
    // shortcut: the sample inbox keeps no cleared rows, so a clear is refused; give it a cleared set when a preview needs clearing.
    async clear() { return false; },
    async clearAll() {},
    open(item, navigate, opened, refused) {
      const markRead = () => setReads(current => ({ ...current, [item.id]: true }));
      if (item.destination.kind === "none") markRead();
      else navigate(item.destination, () => { markRead(); opened(); }, refused);
    },
  };
}

/** The harness inbox: the sample notifications with read marks kept here, and a `ping` scene that raises one toast. */
export function useNotificationsSampleInbox(input: InboxHarnessInput): InboxWiring {
  const base = useWorkspaceNotifications(scenario(), input);
  const [reads, setReads] = useState<Readonly<Record<string, boolean>>>({});
  const state = useMemo(() => applyNotificationReads(base, reads), [base, reads]);
  const { toast } = useToasts();
  const pinged = useRef(false);
  const pingItem = state.state === "ready" ? state.items.find(item => item.destination.kind === "run" && item.title === "Run completed") : undefined;
  useEffect(() => {
    if (scenario() !== "ping" || pingItem === undefined || pinged.current) return;
    pinged.current = true;
    toast({ tone: "success", title: pingItem.title, description: `${pingItem.subject} · ${pingItem.workflow}` });
  }, [pingItem, toast]);
  return useMemo(() => sampleInbox(state, base, setReads), [state, base]);
}

/** Opens a sample run from the harness's own queue rows; other targets take the served route. */
export async function resolveSampleRun(target: NotificationTarget, route: AppRouteState, context: RunNavigationContext): Promise<RunNavigation> {
  if (target.kind !== "run") return resolveRunNavigation(context.client, target, route, context.canOpenRegisteredWorkflow);
  const refusal = notificationDestinationRefusal(target, context);
  if (refusal) return { state: "refused", message: refusal };
  const row = context.rows.find(item => item.runId === target.runId);
  if (row === undefined) return { state: "refused", message: "This run is no longer available. Refresh the run list and try again." };
  if (!context.canSelectWorkflowId(row.workflowId)) return { state: "refused", message: formatErrorCatalogFailure(createErrorCatalogFailure("DASHBOARD_WORKFLOW_UNAVAILABLE", {})).text };
  return { state: "ready", workflowId: row.workflowId, route: { ...routeWithoutTakeovers(route), day: target.day, start: false, run: target.runId, section: "logs",
    view: { ...route.view, queueFilter: ["all"], workflow: row.workflowId, logFailure: undefined } } };
}
