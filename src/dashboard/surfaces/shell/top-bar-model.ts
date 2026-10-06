

/* ── the product view switcher ───────────────────────────────────────────── */

/**
 * The four PRODUCT views, ported verbatim from the demo's `SWITCHER_VIEWS`.
 *
 * `queue` is the dashboard proper; the other three are takeovers that replace
 * the main region whole. They are a switcher rather than four buttons in the
 * toolbar because the operator is choosing WHERE THEY ARE, and where you are is
 * the one thing the top bar has always answered.
 */
export type ShellView = "queue" | "archive" | "explorer" | "activity";


export const SHELL_VIEW_LABEL: Record<ShellView, string> = {
  queue: "Dashboard",
  archive: "Archive",
  explorer: "Explorer",
  activity: "Analytics",
};


export const SHELL_VIEWS: readonly ShellView[] = ["queue", "explorer", "activity"];


/**
 * Which segment the switcher presses — or that it presses NOTHING.
 *
 * Ported from the demo (legacy `1ec1d870`
 * `src/dashboard/components/dev/rebuild-demo/DemoShell.tsx:560-573`), where the
 * switcher reads the app's FULL view union and draws `aria-pressed={view === v}`
 * over the four names it knows. A view the switcher does not name — the demo's
 * `settings`, ours also `intake` and `catalog` — therefore presses nothing, and
 * the gear is left as the only "you are here" claim on the bar.
 *
 * The rebuild had narrowed the prop to `ShellView`, which has no such value, so
 * the three unnamed takeovers had to be folded onto `queue` and the bar claimed
 * the operator was on the dashboard while a takeover covered it (UF-SET-2).
 * `"none"` is that missing value, stated rather than encoded as a lie.
 */
export type ShellViewSelection = ShellView | "none";
export { WEEKDAY_HEADS,buildCalendarMonth,monthLabel,monthOfDay,moveCalendarFocus,servedDays,serverLocalDay,shiftMonth } from "./date-navigation-model.js";
export type { CalendarCell,DayCountWire,ServerClockWire } from "./date-navigation-model.js";
export { NOTIFICATION_FILTERS,notificationInboxView } from "../notifications/notification-bell-model.js";
export type { NotificationFilterKey,NotificationInboxView,NotificationRowExtras,NotificationRowWire,OrdinaryNotificationRowWire,PinnedNotificationRowWire } from "../notifications/notification-bell-model.js";
export { preflightVerdict } from "./preflight-popover-model.js";
export type { PreflightCheckWire,PreflightVerdict } from "./preflight-popover-model.js";
