/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/DemoTopBarSurfaces.tsx (the date
 * navigator, its month grid and the shortcuts popover) and DemoShell.tsx (the
 * Top Bar frame and its history controls).
 *
 * 1i scope, per the work item: BASE nav + calendar only. The notification bell
 * and the search control are 2i and are ABSENT rather than stubbed — a control
 * that opens nothing is worse than no control, and it is exactly what this
 * surface was ported to fix in the first place.
 *
 * Every day count on this bar reads `DashboardDayWire.monthCounts` — the ONE
 * projection (D81). The pill, the calendar cells and the Status Bar therefore
 * cannot disagree, because there is nothing here that counts anything.
 */
import { useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Bell, Calendar, ChevronLeft, ChevronRight, Keyboard, Moon, ShieldCheck, Sun } from "lucide-react";
import type { z } from "zod";
import { cn } from "../lib/utils.js";
import {
  Button,
  CountBadge,
  DEMO_THEME_LABEL,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  dsBorder,
  dsFocus,
  dsIcon,
  dsMotion,
  dsRadius,
  dsSize,
  dsSurface,
  dsText,
  type DemoTheme,
} from "../ds/ui.js";
import type { DayCountWireSchema, NotificationWireSchema } from "../../domain/dashboard/projection.js";
import type { ServerClockWireSchema } from "../../domain/dashboard/bootstrap.js";
import { systemClock } from "../../domain/clock.js";
import { useDashboardClient } from "../state/client-context.js";
import { DemoShortcutsLegend } from "./shortcuts.js";
import { fmtClock, plural } from "./format.js";
import {
  SettingsControl,
  type SettingsSection,
  type StorageHealthSummary,
} from "./settings.js";

export type DayCountWire = z.infer<typeof DayCountWireSchema>;
export type ServerClockWire = z.infer<typeof ServerClockWireSchema>;

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
const WEEKDAY_HEADS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function ymd(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** `2026-08-03` → `Mon, Aug 3` — the day, in the operator's short form. */
export function dayLabel(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function dayLabelWithToday(day: string, today: string): string {
  return day === today ? `${dayLabel(day)} · today` : dayLabel(day);
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

function servedDays(counts: readonly DayCountWire[]): string[] {
  return counts.map((entry) => String(entry.day)).sort((a, b) => a.localeCompare(b));
}

function DateCalendar({
  day,
  today,
  counts,
  onPick,
}: {
  day: string;
  today: string;
  counts: readonly DayCountWire[];
  onPick: (day: string) => void;
}) {
  const [month, setMonth] = useState(() => monthOfDay(day));
  const cells = useMemo(() => buildCalendarMonth(month, counts, today), [month, counts, today]);
  const days = useMemo(() => servedDays(counts), [counts]);
  const firstMonth = days.length > 0 ? monthOfDay(days[0]) : month;
  const lastMonth = days.length > 0 ? monthOfDay(days[days.length - 1]) : month;
  const previous = month > firstMonth ? shiftMonth(month, -1) : undefined;
  const next = month < lastMonth ? shiftMonth(month, 1) : undefined;

  // The roving tab stop starts on the selected day when it is in view, and on
  // the first selectable cell otherwise — never on a disabled one, which would
  // put the caret somewhere Enter does nothing.
  const initial = cells.findIndex((cell) => cell.day === day);
  const [focus, setFocus] = useState(initial >= 0 ? initial : cells.findIndex((cell) => cell.available));
  const gridRef = useRef<HTMLDivElement>(null);

  const moveTo = (index: number): void => {
    setFocus(index);
    // The cells are real buttons in DOM order, so the nth button IS the nth cell.
    gridRef.current?.querySelectorAll<HTMLButtonElement>("button[data-demo-day]")[index]?.focus();
  };

  return (
    <div className="flex flex-col gap-[var(--ds-space-snug)]">
      <div className="flex items-center gap-[var(--ds-space-snug)]">
        <IconButton
          size="sm"
          disabled={previous === undefined}
          label={
            previous === undefined
              ? `The projection serves nothing before ${monthLabel(firstMonth)}`
              : `Previous month — ${monthLabel(previous)}`
          }
          onClick={() => {
            if (previous !== undefined) setMonth(previous);
          }}
          icon={<ChevronLeft aria-hidden className={dsIcon.md} />}
        />
        <span className={cn(dsText.ui, "min-w-0 flex-1 text-center font-semibold text-[color:var(--ds-fg)]")}>
          {monthLabel(month)}
        </span>
        <IconButton
          size="sm"
          disabled={next === undefined}
          label={
            next === undefined
              ? `The projection serves nothing after ${monthLabel(lastMonth)}`
              : `Next month — ${monthLabel(next)}`
          }
          onClick={() => {
            if (next !== undefined) setMonth(next);
          }}
          icon={<ChevronRight aria-hidden className={dsIcon.md} />}
        />
      </div>

      <div aria-hidden className={cn(dsText.caps, "grid grid-cols-7 text-center text-[color:var(--ds-fg-muted)]")}>
        {WEEKDAY_HEADS.map((weekday) => (
          <span key={weekday} className="py-[var(--ds-space-hair)]">
            {weekday}
          </span>
        ))}
      </div>

      <div
        ref={gridRef}
        role="grid"
        aria-label="Pick a day"
        onKeyDown={(event) => {
          const to = moveCalendarFocus(focus, event.key);
          if (to === null) return;
          event.preventDefault();
          moveTo(to);
        }}
        className="grid grid-cols-7 gap-[var(--ds-space-hair)]"
      >
        {cells.map((cell, index) => {
          const selected = cell.day === day;
          return (
            <button
              key={cell.day}
              type="button"
              data-demo-day={cell.day}
              role="gridcell"
              aria-selected={selected}
              aria-current={cell.isToday ? "date" : undefined}
              disabled={!cell.available}
              tabIndex={index === focus ? 0 : -1}
              onFocus={() => setFocus(index)}
              onClick={() => onPick(cell.day)}
              aria-label={`${dayLabelWithToday(cell.day, today)}${
                cell.available ? ` — ${plural(cell.count, "row")}` : " — the projection serves no rows"
              }`}
              title={cell.available ? undefined : "The projection holds no partition for this day"}
              className={cn(
                "relative flex cursor-pointer flex-col items-center justify-center",
                "h-[var(--ds-h-md)] w-full",
                dsRadius.sm,
                dsText.meta,
                dsText.nums,
                dsFocus,
                dsMotion.fast,
                "disabled:cursor-default",
                selected
                  ? cn(dsBorder.loud, "border bg-[var(--ds-surface-selected)] font-semibold text-[color:var(--ds-fg)]")
                  : cell.available
                    ? "text-[color:var(--ds-fg)] hover:bg-[var(--ds-surface-3)]"
                    : cell.inMonth
                      ? "text-[color:var(--ds-fg-faint)]"
                      : "text-[color:var(--ds-fg-faint)] opacity-50",
              )}
            >
              {cell.dayOfMonth}
              {/* A DOT, not the count: 42 numbers plus 42 counts is a wall, and
                  the count the operator is acting on is already on the pill.
                  It is `--ds-accent-mark` — a mark, never text. */}
              {cell.available && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute bottom-[var(--ds-space-hair)] size-1 rounded-full",
                    cell.count > 0 ? "bg-[var(--ds-accent-mark)]" : "bg-[var(--ds-fg-faint)]",
                  )}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* TODAY IN ONE ACTION, from anywhere in the calendar. It moves the month
          AND the day, so a picker parked three months out is one press from
          live rather than three. */}
      <div className={cn("flex items-center border-t pt-[var(--ds-space-snug)]", dsBorder.subtle)}>
        <Button
          size="sm"
          variant="secondary"
          disabled={day === today}
          onClick={() => {
            setMonth(monthOfDay(today));
            onPick(today);
          }}
        >
          Today
        </Button>
        <span className={cn(dsText.meta, "ml-auto text-[color:var(--ds-fg-muted)]")}>
          <span className={dsText.nums}>{days.length}</span> days served
        </span>
      </div>
    </div>
  );
}

/**
 * ‹ 📅 Mon, Aug 3 · today [38] ›. The date is not decoration: it selects the
 * day partition the whole app reads. The rail badges, the Status Bar pills and
 * the rows all move with it, because all of them read the ONE projection for
 * whichever day this control names.
 */
export function DateNav({
  day,
  today,
  monthCounts,
  onDay,
}: {
  day: string;
  today: string;
  monthCounts: readonly DayCountWire[];
  onDay: (day: string) => void;
}) {
  const days = useMemo(() => servedDays(monthCounts), [monthCounts]);
  const index = days.indexOf(day);
  const older = index > 0 ? days[index - 1] : undefined;
  const newer = index >= 0 && index < days.length - 1 ? days[index + 1] : undefined;
  const count = monthCounts.find((entry) => String(entry.day) === day)?.count ?? 0;
  const [open, setOpen] = useState(false);

  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <IconButton
        label={older === undefined ? "No earlier day is served" : `Previous day — ${dayLabelWithToday(older, today)}`}
        size="sm"
        disabled={older === undefined}
        onClick={() => {
          if (older !== undefined) onDay(older);
        }}
        icon={<ChevronLeft aria-hidden className={dsIcon.md} />}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Pick a day — showing ${dayLabelWithToday(day, today)}, ${plural(count, "row")}`}
            title={`${plural(count, "row")} on this day · the projection serves ${plural(days.length, "day")}`}
            className={cn(
              "inline-flex cursor-pointer items-center border border-transparent",
              "h-[var(--ds-h-sm)] gap-1.5 px-1.5",
              dsRadius.md,
              dsText.ui,
              dsFocus,
              dsMotion.fast,
              "text-[color:var(--ds-fg)] hover:bg-[var(--ds-surface-3)] active:translate-y-px",
              "data-[state=open]:border-[color:var(--ds-border-loud)] data-[state=open]:bg-[var(--ds-surface-selected)]",
            )}
          >
            <Calendar aria-hidden className={cn(dsIcon.sm, "text-[color:var(--ds-fg-muted)]")} />
            {dayLabelWithToday(day, today)}
            <CountBadge value={count} tone={day === today ? "info" : "neutral"} />
          </button>
        </PopoverTrigger>
        <PopoverContent title="Pick a day" hideTitle width="md" align="center" side="bottom">
          <DateCalendar
            day={day}
            today={today}
            counts={monthCounts}
            onPick={(next) => {
              setOpen(false);
              if (next !== day) onDay(next);
            }}
          />
        </PopoverContent>
      </Popover>
      <IconButton
        label={newer === undefined ? "This is the newest day served" : `Next day — ${dayLabelWithToday(newer, today)}`}
        size="sm"
        disabled={newer === undefined}
        onClick={() => {
          if (newer !== undefined) onDay(newer);
        }}
        icon={<ChevronRight aria-hidden className={dsIcon.md} />}
      />
    </span>
  );
}

/* ── history ─────────────────────────────────────────────────────────────── */

/**
 * The two history controls, as the Top Bar sees them. The shell owns the
 * history value itself; this is only what the pair of buttons needs to render
 * and to call.
 */
export interface NavControls {
  canBack: boolean;
  canForward: boolean;
  /** the place each direction lands on, named — undefined when there is none */
  backTo?: string;
  forwardTo?: string;
  onBack: () => void;
  onForward: () => void;
}

/**
 * BACK AND FORWARD, and they sit in the Top Bar rather than on the queue.
 *
 * A disabled direction stays in place rather than disappearing: a pair that
 * collapses to one button at the start of a session moves every control to its
 * right by 28px the first time you navigate, which is a layout that shifts
 * under the pointer.
 */
export function NavHistoryControls({ nav }: { nav: NavControls }) {
  return (
    <span className="flex shrink-0 items-center gap-[var(--ds-space-hair)]">
      <IconButton
        size="sm"
        label="Back"
        title={nav.backTo === undefined ? "Back — nowhere to go yet" : `Back to ${nav.backTo}`}
        disabled={!nav.canBack}
        onClick={nav.onBack}
        icon={<ArrowLeft aria-hidden className={dsIcon.md} />}
      />
      <IconButton
        size="sm"
        label="Forward"
        title={nav.forwardTo === undefined ? "Forward — nowhere to go yet" : `Forward to ${nav.forwardTo}`}
        disabled={!nav.canForward}
        onClick={nav.onForward}
        icon={<ArrowRight aria-hidden className={dsIcon.md} />}
      />
    </span>
  );
}

/* ── shortcuts ───────────────────────────────────────────────────────────── */

/**
 * The Top Bar's route to the keyboard flow. A Popover is the sanctioned home
 * for something that has to be REACHABLE rather than visible: it opens on
 * click, so pointer, touch and keyboard all get to it, unlike the hover-only
 * tooltip DESIGN.md forbids for anything load-bearing.
 */
type NotificationWire = z.infer<typeof NotificationWireSchema>;

const SEVERITY_TONE: Record<NotificationWire["severity"], string> = {
  error: "text-[color:var(--ds-danger)]",
  warning: "text-[color:var(--ds-status-waiting-fg)]",
  info: "text-[color:var(--ds-fg)]",
};

/**
 * 2i-B: the inbox bell over doc 03 §2.6's durable rows. Every row renders
 * durable state — the wire is the fold, not a toast log — and the actions
 * are the three activated lifecycle arms. Read/unread and snooze are
 * independent axes; snoozing does not mark read (D138). A failed command is
 * fine to drop silently HERE only because nothing local changed: the row
 * re-renders from the next SSE snapshot either way, so the surface can never
 * disagree with authority.
 */
export function NotificationBell({ notifications, actorId }: {
  notifications: readonly NotificationWire[];
  actorId: string;
}) {
  const client = useDashboardClient();
  const [commandError, setCommandError] = useState<string | null>(null);
  const unread = notifications.filter((entry) => entry.state === "unread").length;
  const issue = (
    type: "notification-read" | "notification-unread" | "notification-snooze",
    entry: NotificationWire,
  ): void => {
    setCommandError(null);
    client.executeCommand({
      commandId: crypto.randomUUID(),
      requestedAt: systemClock.now().toISOString(),
      requestedBy: actorId,
      source: "notification-bell",
      family: "notification",
      type,
      target: { notificationId: entry.notificationId, actorId, expectedVersion: entry.revision },
      ...(type === "notification-snooze"
        ? { payload: { until: new Date(systemClock.nowMs() + 3_600_000).toISOString() } }
        : {}),
    }).then((result) => {
      if (result.state === "rejected") setCommandError(result.message);
    }, (caught: unknown) => {
      setCommandError(caught instanceof Error ? caught.message : String(caught));
    });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={unread > 0 ? `Notifications — ${plural(unread, "unread item")}` : "Notifications"}
          icon={<Bell aria-hidden className={dsIcon.md} />}
        >
          <CountBadge value={unread} tone={unread > 0 ? "info" : "neutral"} />
        </Button>
      </PopoverTrigger>
      <PopoverContent title="Notifications" width="lg" align="end">
        {commandError !== null && (
          <span role="alert" className={cn(dsText.meta, "text-[color:var(--ds-danger)]")}>
            {commandError}
          </span>
        )}
        {notifications.length === 0 ? (
          <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
            Nothing needs your attention.
          </span>
        ) : (
          <div className="flex flex-col gap-[var(--ds-space-base)]">
            {notifications.map((entry) => (
              <div key={entry.notificationId} className="flex flex-col gap-[var(--ds-space-tight)]">
                <span className="flex items-baseline gap-[var(--ds-space-snug)]">
                  <span
                    className={cn(
                      dsText.body,
                      "min-w-0 flex-1 truncate",
                      entry.state === "read" ? "text-[color:var(--ds-fg-muted)]" : SEVERITY_TONE[entry.severity],
                      entry.state === "unread" && "font-semibold",
                    )}
                  >
                    {entry.title}
                  </span>
                  <span className={cn(dsText.meta, dsText.nums, "shrink-0 text-[color:var(--ds-fg-muted)]")}>
                    {entry.state === "snoozed" ? `snoozed · ${fmtClock(entry.occurredAt)}` : fmtClock(entry.occurredAt)}
                  </span>
                </span>
                <span className="flex gap-[var(--ds-space-snug)]">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => issue(entry.state === "unread" ? "notification-read" : "notification-unread", entry)}
                  >
                    {entry.state === "unread" ? "Mark read" : "Mark unread"}
                  </Button>
                  {entry.state !== "snoozed" && (
                    <Button variant="ghost" size="sm" onClick={() => issue("notification-snooze", entry)}>
                      Snooze 1h
                    </Button>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function ShortcutsPopover({ onOpenHelp }: { onOpenHelp?: () => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton size="sm" label="Keyboard shortcuts" icon={<Keyboard aria-hidden className={dsIcon.md} />} />
      </PopoverTrigger>
      <PopoverContent
        title="Keyboard"
        description="Nothing here fires while the caret is in a field."
        width="lg"
        align="end"
      >
        <DemoShortcutsLegend />
        {onOpenHelp !== undefined && (
          <div className="mt-[var(--ds-space-base)] border-t border-[color:var(--ds-border-subtle)] pt-[var(--ds-space-snug)]">
            <Button
              variant="ghost"
              size="sm"
              onClick={onOpenHelp}
              icon={<ArrowUpRight aria-hidden className={dsIcon.md} />}
              className="w-full justify-start"
            >
              Help
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/* ── the bar ─────────────────────────────────────────────────────────────── */

/**
 * The Top Bar.
 *
 * 1i renders one view, so the demo's Dashboard / Archive / Explorer / Activity
 * switcher is absent rather than rendered with three dead entries — a switcher
 * of one is chrome that teaches the operator nothing. It returns in 2i with the
 * views it switches between.
 */
export function TopBar({
  notifications,
  actorId,
  storage,
  settingsSections,
  day,
  today,
  monthCounts,
  onDay,
  theme,
  onToggleTheme,
  nav,
  onOpenHelp,
}: {
  notifications: readonly NotificationWire[];
  actorId: string;
  /** the bootstrap's storage health summary — the gear's attention dot (2i-D) */
  storage: StorageHealthSummary;
  settingsSections: readonly SettingsSection[];
  /** the day partition the whole app is reading */
  day: string;
  today: string;
  monthCounts: readonly DayCountWire[];
  onDay: (day: string) => void;
  theme: DemoTheme;
  onToggleTheme: () => void;
  nav: NavControls;
  onOpenHelp?: () => void;
}) {
  return (
    <header
      className={cn(
        "flex shrink-0 items-center border-b",
        dsSize.hTopbar,
        dsBorder.base,
        dsSurface.card,
        "gap-[var(--ds-space-cozy)] px-[var(--ds-shell-inset)]",
      )}
    >
      {/* The app's name is the page's ONE h1. It reads at `dsText.ui` like the
          chrome it is — heading LEVEL is the document outline, not a type size. */}
      <div className="flex shrink-0 items-center gap-[var(--ds-space-base)]">
        <span
          aria-hidden
          className={cn("flex items-center justify-center", dsRadius.md, "size-[var(--ds-h-sm)] bg-[var(--ds-accent-quiet)]")}
        >
          <ShieldCheck className={cn(dsIcon.md, "text-[color:var(--ds-accent-mark)]")} />
        </span>
        <h1 className={cn(dsText.ui, dsText.flush, "font-semibold text-[color:var(--ds-fg)]")}>HR Automation</h1>
      </div>

      <NavHistoryControls nav={nav} />

      <DateNav day={day} today={today} monthCounts={monthCounts} onDay={onDay} />

      <span className="ml-auto flex shrink-0 items-center gap-[var(--ds-space-hair)]">
        <NotificationBell notifications={notifications} actorId={actorId} />
        <SettingsControl storage={storage} sections={settingsSections} />
        <ShortcutsPopover onOpenHelp={onOpenHelp} />
        {/* The theme pair. One control, and its LABEL names the destination
            ("Switch to Paper Ink"), because a lone sun/moon glyph never says
            which of the two states it is reporting. */}
        <IconButton
          size="sm"
          label={`Switch to ${DEMO_THEME_LABEL[theme === "dark" ? "light" : "dark"]}`}
          onClick={onToggleTheme}
          icon={
            theme === "dark" ? (
              <Sun aria-hidden className={dsIcon.md} />
            ) : (
              <Moon aria-hidden className={dsIcon.md} />
            )
          }
        />
      </span>
    </header>
  );
}
