import type { NotificationTarget } from "../../../models/notifications/notifications.js";
import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../models/failures/error-catalog.js";
import type { DashboardClient } from "../../client/index.js";
import { routeWithoutTakeovers, type AppRouteState } from "./url-state.js";

export const notificationTargetUnavailable = () => formatErrorCatalogFailure(createErrorCatalogFailure("NOTIFICATION_TARGET_UNAVAILABLE", {})).text;

type Destination = Readonly<{ state: "ready"; route: AppRouteState; workflowId?: string }>
  | Readonly<{ state: "refused"; message: string }>;

export async function resolveNotificationNavigation(client: Pick<DashboardClient, "dashboardDay" | "runDetail" | "runSection">,
  target: NotificationTarget, route: AppRouteState, canSelectWorkflow: (id: string) => boolean): Promise<Destination> {
  const refuse = (): Destination => ({ state: "refused", message: notificationTargetUnavailable() });
  if (target.kind === "refused") return refuse();
  if (target.kind === "archive") return { state: "refused", message: formatErrorCatalogFailure(createErrorCatalogFailure("NOTIFICATION_ARCHIVE_RETIRED", {})).text };
  const base = { ...routeWithoutTakeovers(route), start: false, run: undefined, section: undefined,
    view: { ...route.view, preview: null, mockRun: undefined, records: undefined, logFailure: undefined, notifications: false } };
  if (target.kind === "storage") return { state: "ready", route: { ...base, settings: "storage" } };
  try {
    const day = await client.dashboardDay(target.day);
    const row = day.queueSurfaces.find(item => item.runId === target.runId);
    if (day.day !== target.day || row === undefined || !canSelectWorkflow(row.workflowId)) return refuse();
    const detail = await client.runDetail(target.runId);
    if (detail.runId !== target.runId || detail.header.runId !== target.runId || detail.header.workflowId !== row.workflowId
      || detail.header.traceId !== row.traceId || detail.header.attempt !== row.attempt || detail.rowRevision !== row.rowRevision || detail.panelKind !== row.panelKind) return refuse();
    if (target.kind === "failure") {
      if (!detail.availableSections.includes("failure")) return refuse();
      const section = await client.runSection(target.runId, "failure");
      if (section.section !== "failure" || section.payload.state !== "available") return refuse();
      const failure = section.payload.value;
      if (failure.failureId !== target.failureId || failure.runId !== target.runId || failure.traceId !== row.traceId
        || failure.attempt !== row.attempt || failure.workflowId !== row.workflowId) return refuse();
    }
    return { state: "ready", workflowId: row.workflowId, route: { ...base, day: target.day, run: target.runId, section: "logs",
      view: { ...base.view, workflow: row.workflowId, logFailure: target.kind === "failure" ? { runId: target.runId, failureId: target.failureId } : undefined } } };
  } catch {
    return refuse();
  }
}
