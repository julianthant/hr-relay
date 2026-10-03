import type { NotificationWire } from "../../../models/dashboard/projection.js";
import { elapsedSecondsBetween, fmtElapsed } from "../format.js";

export type NotificationFilter = "all" | "unread" | "attention" | "snoozed";
export type NotificationItem = Readonly<{
  id: string; title: string; subject: string; workflow: string; detail: string;
  tone: "danger" | "warning" | "positive" | "info"; age: string;
  read: boolean; snoozed: boolean; action: string;
}>;
export type NotificationPinned = Readonly<{ id: string; title: string; detail: string }>;
export type NotificationsState = Readonly<{ state: "ready"; items: readonly NotificationItem[]; pinned: readonly NotificationPinned[] }>
  | Readonly<{ state: "loading" }> | Readonly<{ state: "unavailable"; reason: string }>;
export type NotificationControl = "read" | "snooze";
const DETAIL: Record<Exclude<Extract<NotificationWire, { kind: "notification" }>["trigger"], "backfill-gap">, string> = {
  failed: "A run failed.", "gate-waiting": "A run needs operator attention.",
  "write-parked": "A write is parked for review.", repeating: "A failure pattern repeated.",
  storage: "Storage needs attention.", "verified-done": "A run completed with verified evidence.",
};

export function projectNotifications(rows: readonly NotificationWire[], nowIso: string): NotificationsState {
  return {
    state: "ready",
    pinned: rows.filter((row) => row.kind === "backfill-gap").map((row) => ({
      id: row.notificationId, title: row.title,
      detail: "Notification history is incomplete. Resnapshot and reconcile the affected work.",
    })),
    items: rows.filter((row): row is Extract<NotificationWire, { kind: "notification" }> => row.kind === "notification").map((row) => ({
      id: row.notificationId, title: row.title,
      subject: row.context.state === "available" ? row.context.subject : row.context.state === "not-applicable" ? "Not applicable" : "Unavailable",
      workflow: row.context.state === "available" || row.context.state === "workflow-only" ? row.context.workflow : row.context.state === "not-applicable" ? "Not applicable" : "Unavailable",
      detail: `${DETAIL[row.trigger]}${row.count > 1 ? ` ${row.count} occurrences.` : ""}`,
      tone: row.severity === "error" ? "danger" : row.severity === "warning" ? "warning" : row.trigger === "verified-done" ? "positive" : "info",
      age: `${fmtElapsed(Math.max(0, elapsedSecondsBetween(row.occurredAt, nowIso)))} ago`,
      read: row.readState === "read", snoozed: row.state === "snoozed",
      action: row.link?.kind === "storage" ? "Open Storage" : row.link?.kind === "failure" ? "Open failure" : row.link?.kind === "run" ? "Open run" : "Open notification",
    })),
  };
}

export const NOTIFICATION_VIEW_FILTERS: readonly { id: NotificationFilter; label: string }[] = [
  { id: "all", label: "All" }, { id: "unread", label: "Unread" }, { id: "attention", label: "Needs attention" }, { id: "snoozed", label: "Snoozed" },
];
export function notificationView(state: NotificationsState, filter: NotificationFilter) {
  if (state.state !== "ready") return { unread: undefined, shown: [] as readonly NotificationItem[], pinned: [] as readonly NotificationPinned[] };
  return {
    unread: state.pinned.length + state.items.filter(item => !item.read).length,
    pinned: state.pinned,
    shown: state.items.filter(item => filter === "unread" ? !item.read : filter === "attention" ? item.tone === "danger" || item.tone === "warning" : filter === "snoozed" ? item.snoozed : true),
  };
}
export function updateNotification(state: NotificationsState, id: string, control: NotificationControl): NotificationsState {
  if (state.state !== "ready") throw new Error("notification-preview-not-ready");
  if (!state.items.some(item => item.id === id)) throw new Error("notification-preview-item-missing");
  return { ...state, items: state.items.map(item => item.id === id ? { ...item, ...(control === "read" ? { read: !item.read } : { snoozed: !item.snoozed }) } : item) };
}
