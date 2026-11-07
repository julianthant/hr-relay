

/** ── the product view switcher ───────────────────────────────────────────── */

/** The four PRODUCT views, ported verbatim from the demo's `SWITCHER_VIEWS`.
 * `queue` is the dashboard proper; the other three are takeovers that replace */
export type ShellView = "queue" | "archive" | "explorer" | "activity";


export const SHELL_VIEW_LABEL: Record<ShellView, string> = {
  queue: "Dashboard",
  archive: "Archive",
  explorer: "Explorer",
  activity: "Analytics",
};


export const SHELL_VIEWS: readonly ShellView[] = ["queue", "explorer", "activity"];


/** Which segment the switcher presses — or that it presses NOTHING.
 * Ported from the demo (legacy `1ec1d870` */
export type ShellViewSelection = ShellView | "none";
export { WEEKDAY_HEADS,buildCalendarMonth,monthLabel,monthOfDay,moveCalendarFocus,servedDays,serverLocalDay,shiftMonth } from "./date-navigation-model.js";
export type { CalendarCell,DayCountWire,ServerClockWire } from "./date-navigation-model.js";
export { NOTIFICATION_FILTERS,notificationInboxView } from "../notifications/notification-bell-model.js";
export type { NotificationFilterKey,NotificationInboxView,NotificationRowExtras,NotificationRowWire,OrdinaryNotificationRowWire,PinnedNotificationRowWire } from "../notifications/notification-bell-model.js";
export { preflightVerdict } from "./preflight-popover-model.js";
export type { PreflightCheckWire,PreflightVerdict } from "./preflight-popover-model.js";
