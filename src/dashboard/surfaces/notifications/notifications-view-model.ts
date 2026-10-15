import type { NotificationTarget } from "../../../models/notifications/notifications.js";

export type NotificationCategory = "all" | "attention" | "failed";
export type NotificationFilter = "all" | "unread" | "attention" | "failed";
export type NotificationDestination = NotificationTarget
  | Readonly<{ kind: "preview-run"; runId: string; day: string; records: boolean }>;
export type NotificationItem = Readonly<{
  id: string; title: string; subject: string; workflow: string; detail: string;
  tone: "danger" | "warning" | "positive" | "info"; age: string;
  read: boolean; action: string; destination: NotificationDestination;
}>;
export type NotificationPinned = Readonly<{ id: string; title: string; detail: string }>;
export type NotificationsState = Readonly<{ state: "ready"; items: readonly NotificationItem[]; pinned: readonly NotificationPinned[] }>
  | Readonly<{ state: "loading" }> | Readonly<{ state: "unavailable"; reason: string }>;
export type NotificationControl = "read" | "unread";
export const NOTIFICATION_VIEW_FILTERS: readonly { id: NotificationFilter; label: string }[] = [
  { id: "all", label: "All" }, { id: "unread", label: "Unread" }, { id: "attention", label: "Needs you" }, { id: "failed", label: "Failed" },
];
export function notificationView(state: NotificationsState, filter: NotificationFilter, category: NotificationCategory = "all") {
  if (state.state !== "ready") return { unread: undefined, shown: [] as readonly NotificationItem[], pinned: [] as readonly NotificationPinned[] };
  return {
    unread: state.items.filter(item => !item.read).length,
    pinned: [],
    shown: [...state.items].sort((a, b) => (a.tone === "danger" ? 0 : a.tone === "warning" ? 1 : 2) - (b.tone === "danger" ? 0 : b.tone === "warning" ? 1 : 2)).filter(item => filter === "unread" ? !item.read : filter === "attention" ? item.tone === "danger" || item.tone === "warning" : filter === "failed" ? item.tone === "danger" : true).filter(item => category === "attention" ? item.tone === "danger" || item.tone === "warning" : category === "failed" ? item.tone === "danger" : true),
  };
}
export function updateNotification(state: NotificationsState, id: string, control: NotificationControl): NotificationsState {
  if (state.state !== "ready") throw new Error("notification-preview-not-ready");
  if (!state.items.some(item => item.id === id)) throw new Error("notification-preview-item-missing");
  return { ...state, items: state.items.map(item => item.id === id && item.read !== (control === "read") ? { ...item, read: control === "read" } : item) };
}

export function applyNotificationReads(state: NotificationsState, reads: Readonly<Record<string, boolean>>): NotificationsState {
  if (state.state !== "ready") return state;
  return { ...state, items: state.items.map(item => reads[item.id] === undefined || reads[item.id] === item.read ? item : { ...item, read: reads[item.id] }) };
}
