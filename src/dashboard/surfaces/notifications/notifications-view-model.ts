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
