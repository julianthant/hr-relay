/**
 * The Top Bar's calendar arithmetic, the preflight verdict fold and the shell-view vocabulary.
 *
 * It lives beside `top-bar.tsx` rather than inside it because a module that exports
 * a component may export nothing else if React Fast Refresh is to treat it as a
 * refresh boundary: one non-component export makes every edit to the surface
 * invalidate upward into `dashboard-app.tsx` and remount the app instead of
 * hot-swapping the component. Same values, same call sites, one import hop.
 */


import type { z } from "zod";


import type { DayCountWireSchema } from "../../domain/dashboard/projection.js";
import type { NotificationWireSchema } from "../../domain/dashboard/projection.js";
import type {
  PreflightCheckWireSchema,
  PreflightVerdictSchema,
  ServerClockWireSchema,
} from "../../domain/dashboard/bootstrap.js";





export type DayCountWire = z.infer<typeof DayCountWireSchema>;

export type ServerClockWire = z.infer<typeof ServerClockWireSchema>;

export interface NotificationRowExtras {
  readonly body?: string;
  readonly triggerLabel?: string;
  readonly delivery?: "ping" | "inbox";
  readonly count?: number;
  readonly desktopDelivered?: boolean;
}

export type NotificationRowWire = z.infer<typeof NotificationWireSchema> & NotificationRowExtras;
export type PinnedNotificationRowWire = Extract<NotificationRowWire, { kind: "backfill-gap" }>;
export type OrdinaryNotificationRowWire = Extract<NotificationRowWire, { kind: "notification" }>;

export const NOTIFICATION_FILTERS = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "ping", label: "Pings" },
  { key: "inbox", label: "Inbox" },
  { key: "snoozed", label: "Snoozed" },
] as const;

export type NotificationFilterKey = (typeof NOTIFICATION_FILTERS)[number]["key"];

export interface NotificationInboxView {
  readonly pinned: readonly PinnedNotificationRowWire[];
  readonly shown: readonly OrdinaryNotificationRowWire[];
  readonly counts: Readonly<Record<NotificationFilterKey, number>>;
  readonly visibleCount: number;
  readonly empty: boolean;
  readonly unread: number;
  readonly critical: boolean;
}

/**
 * The pinned safety lane is partitioned before ordinary filtering. No filter
 * branch receives it, so adding a chip cannot accidentally make the gap
 * disappear. It still contributes to the bell and filter counts.
 */
export function notificationInboxView(
  notifications: readonly NotificationRowWire[],
  filter: NotificationFilterKey,
): NotificationInboxView {
  const pinned: PinnedNotificationRowWire[] = [];
  const listed: OrdinaryNotificationRowWire[] = [];
  for (const entry of notifications) {
    if (entry.kind === "backfill-gap") pinned.push(entry);
    else listed.push(entry);
  }
  const ordinaryUnread = listed.filter((entry) => entry.state === "unread").length;
  const counts: Record<NotificationFilterKey, number> = {
    all: notifications.length,
    unread: pinned.length + ordinaryUnread,
    ping: pinned.length + listed.filter((entry) => entry.delivery === "ping").length,
    inbox: listed.filter((entry) => entry.delivery === "inbox").length,
    snoozed: listed.filter((entry) => entry.state === "snoozed").length,
  };
  const shown = listed.filter((entry) => {
    if (filter === "all") return true;
    if (filter === "unread") return entry.state === "unread";
    if (filter === "snoozed") return entry.state === "snoozed";
    return entry.delivery === filter;
  });
  return Object.freeze({
    pinned: Object.freeze(pinned),
    shown: Object.freeze(shown),
    counts: Object.freeze(counts),
    visibleCount: pinned.length + shown.length,
    empty: pinned.length + shown.length === 0,
    unread: pinned.length + ordinaryUnread,
    critical: pinned.length > 0
      || listed.some((entry) => entry.state === "unread" && entry.severity === "error"),
  });
}

/**
 * "Today", as the SERVER understands it.
 *
 * The demo read a `DEMO_DAY` constant. Here the live day is a served fact —
 * bootstrap's `serverClock`, in the zone the server states — because the queue
 * is day-partitioned by the backend's local midnight, not the browser's. A
 * browser in another zone must not disagree with the tracker about which day
 * "today" is.
 */
export function serverLocalDay(clock: ServerClockWire): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: clock.zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(clock.now));
  const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
  const [year, month, day] = [value("year"), value("month"), value("day")];
  if (year === "" || month === "" || day === "") {
    throw new Error(`serverLocalDay: could not resolve a local day from ${clock.now} in ${clock.zone}`);
  }
  return `${year}-${month}-${day}`;
}

/* ── day vocabulary, over the served counts ──────────────────────────────── */

const MS_DAY = 86_400_000;

export const WEEKDAY_HEADS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function monthOfDay(day: string): string {
  return day.slice(0, 7);
}

/** `2026-08` → `August 2026` */
export function monthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** `2026-08` shifted by whole months, staying a `YYYY-MM` */
export function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Arrow-key movement inside the grid, clamped to the 42 cells it holds.
 *
 * Pure, so the keyboard contract is a test rather than something somebody
 * checks by pressing keys — and it is a CLAMP, not a wrap: running off the
 * right edge of the last week stops, it does not teleport to the first.
 */
export function moveCalendarFocus(index: number, key: string): number | null {
  const delta =
    key === "ArrowRight" ? 1 : key === "ArrowLeft" ? -1 : key === "ArrowDown" ? 7 : key === "ArrowUp" ? -7 : null;
  if (delta === null) {
    if (key === "Home") return index - (index % 7);
    if (key === "End") return index - (index % 7) + 6;
    return null;
  }
  const next = index + delta;
  return next < 0 || next > 41 ? index : next;
}

export interface CalendarCell {
  readonly day: string;
  readonly dayOfMonth: number;
  readonly inMonth: boolean;
  readonly count: number;
  /** the projection served a partition for this day */
  readonly available: boolean;
  readonly isToday: boolean;
}

/**
 * Six Sunday-first weeks, always — 42 cells.
 *
 * A grid whose ROW COUNT changes with the month reflows the popover (and the
 * button under the pointer) every time you step a month, which is the one thing
 * a date picker must not do.
 *
 * Availability and count both come from the served `monthCounts`: a day the
 * projection did not serve is DRAWN and DISABLED rather than skipped, because a
 * calendar with holes in it teaches the operator that the month is missing days.
 */
export function buildCalendarMonth(
  month: string,
  counts: readonly DayCountWire[],
  today: string,
): CalendarCell[] {
  const [year, monthNumber] = month.split("-").map(Number);
  const first = Date.UTC(year, monthNumber - 1, 1);
  const start = first - new Date(first).getUTCDay() * MS_DAY;
  const served = new Map(counts.map((entry) => [String(entry.day), entry.count]));
  const cells: CalendarCell[] = [];
  for (let index = 0; index < 42; index += 1) {
    const ms = start + index * MS_DAY;
    const day = ymd(ms);
    const count = served.get(day);
    cells.push({
      day,
      dayOfMonth: new Date(ms).getUTCDate(),
      inMonth: day.slice(0, 7) === month,
      count: count ?? 0,
      available: count !== undefined,
      isToday: day === today,
    });
  }
  return cells;
}

export function servedDays(counts: readonly DayCountWire[]): string[] {
  return counts.map((entry) => String(entry.day)).sort((a, b) => a.localeCompare(b));
}

/* ── preflight (the doctor) ──────────────────────────────────────────────── */

export type PreflightCheckWire = z.infer<typeof PreflightCheckWireSchema>;

export type PreflightVerdict = z.infer<typeof PreflightVerdictSchema>;

/** How loud the standing indicator should be. `fail` beats `warning` beats `pass`. */
export function preflightVerdict(checks: readonly PreflightCheckWire[]): PreflightVerdict {
  if (checks.some((check) => check.verdict === "fail")) return "fail";
  if (checks.some((check) => check.verdict === "warning")) return "warning";
  return "pass";
}

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
  activity: "Activity",
};

export const SHELL_VIEWS: readonly ShellView[] = ["queue", "archive", "explorer", "activity"];

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
