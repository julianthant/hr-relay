import type { NotificationTarget } from "../../../models/notifications/notification-target.js";

export type NotificationCategory = "all" | "attention" | "failed";
export type NotificationFilter = "all" | "unread" | "attention" | "failed";
export type NotificationKind = "storage" | "chatgpt" | "run" | "command";
export type NotificationDestination = NotificationTarget
  | Readonly<{ kind: "preview-run"; runId: string; day: string; records: boolean }>
  | Readonly<{ kind: "settings"; section: "general"; target?: "chatgpt.account" }>
  | Readonly<{ kind: "local-recovery"; key: string }>
  | Readonly<{ kind: "local-command-result"; id: string }>
  | Readonly<{ kind: "local-bulk-result" }>
  | Readonly<{ kind: "none" }>;
export type NotificationItem = Readonly<{
  id: string; title: string; subject: string; workflow: string; detail: string;
  tone: "danger" | "warning" | "positive" | "info"; age: string;
  read: boolean; action: string; destination: NotificationDestination;
  readOnlyHistory?: true;
  kind?: NotificationKind;
  /** Repeats folded into this notice; shown only above one. */
  count?: number;
  /** Priority: still needs the operator. Resolved items fall into their day group. */
  priority?: boolean;
  /** Day group label once out of Needs you: Today, Yesterday, a weekday or a date. */
  day?: string;
  /** When it happened; the shown age ticks from it. Without it the age stays as served. */
  at?: string;
  /** The run or failure it pointed at was deleted: the item says so and opens nothing. */
  gone?: boolean;
}>;

/** Whole minutes, hours, then days since `at`. */
export function notificationAge(at: string, nowIso: string): string {
  const elapsed = Math.max(0, Math.floor((Date.parse(nowIso) - Date.parse(at)) / 60000));
  return elapsed < 1 ? "Just now" : elapsed < 60 ? `${elapsed} min ago` : elapsed < 1440 ? `${Math.floor(elapsed / 60)} hr ago` : `${Math.floor(elapsed / 1440)} days ago`;
}
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

/** Commands whose outcome is unknown or refused stay Priority until the operator opens them. */
export function withCommandNotices(state: NotificationsState, notices: readonly NotificationItem[]): NotificationsState {
  if (notices.length === 0) return state;
  return state.state === "ready" ? { ...state, items: [...notices, ...state.items] } : { state: "ready", items: notices, pinned: [] };
}

export function applyNotificationReads(state: NotificationsState, reads: Readonly<Record<string, boolean>>): NotificationsState {
  if (state.state !== "ready") return state;
  return { ...state, items: state.items.map(item => reads[item.id] === undefined || reads[item.id] === item.read ? item : { ...item, read: reads[item.id] }) };
}

export const itemDay = (item: NotificationItem) => item.day ?? "Today";
/** The workflow (or the system the notice is about) and the run, as served; nothing is invented when the run name is not served. */
export const itemContext = (item: NotificationItem) => [item.workflow !== "" ? item.workflow : itemSource(item), item.kind === "run" || item.kind === "command" ? item.subject : ""].filter(part => part !== "").join(" · ");
export const itemSource = (item: NotificationItem) => item.kind === "storage" ? "Storage" : item.kind === "chatgpt" ? "ChatGPT" : item.kind === "command" ? "Commands" : item.workflow;
