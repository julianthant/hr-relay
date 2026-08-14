/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * src/dashboard/components/dev/rebuild-demo/DemoTopBarSurfaces.tsx (the date
 * navigator, its month grid and the shortcuts popover) and DemoShell.tsx (the
 * Top Bar frame and its history controls).
 *
 * The bar's COMPOSITION is the demo's, left to right: the brand lockup, the
 * history pair, the product view switcher (Dashboard · Archive · Explorer ·
 * Activity), the search control, the date navigator, then the quiet icon
 * cluster. Anything that was in a different place here was in a different place
 * by accident, not by decision.
 *
 * Every day count on this bar reads `DashboardDayWire.monthCounts` — the ONE
 * projection (D81). The pill, the calendar cells and the Status Bar therefore
 * cannot disagree, because there is nothing here that counts anything.
 */
import { useMemo, useRef, useState, type ReactElement } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  FlaskConical,
  Inbox,
  Keyboard,
  ListChecks,
  Mail,
  MailOpen,
  Moon,
  ShieldCheck,
  Siren,
  Stethoscope,
  Sun,
  TriangleAlert,
} from "lucide-react";
import type { z } from "zod";
import { cn } from "../lib/utils.js";
import {
  Badge,
  Button,
  Chip,
  CountBadge,
  DEMO_THEME_LABEL,
  Drawer,
  DrawerContent,
  EmptyState,
  IconButton,
  MetaLine,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
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
import type {
  PreflightCheckWireSchema,
  PreflightVerdictSchema,
  ServerClockWireSchema,
} from "../../domain/dashboard/bootstrap.js";
import { systemClock } from "../../domain/clock.js";
import { useDashboardClient } from "../state/client-context.js";
import { DemoShortcutsLegend } from "./shortcuts.js";
import { DaySearchControl } from "./day-search.js";
import type { QueueSurfaceWire } from "./queue.js";
import { elapsedSecondsBetween, fmtClock, fmtElapsed, plural } from "./format.js";
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
              ? `The tracker holds nothing before ${monthLabel(firstMonth)}`
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
              ? `The tracker holds nothing after ${monthLabel(lastMonth)}`
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
                cell.available ? ` — ${plural(cell.count, "row")}` : " — the tracker holds no rows"
              }`}
              title={cell.available ? undefined : "The tracker holds no partition for this day"}
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
          <span className={dsText.nums}>{days.length}</span> days on disk
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
  /**
   * THE UNSERVED DAY IS A REAL POSITION, and the demo's indexing is what makes
   * it navigable. `indexOf` answers `-1` for a day the tracker holds no
   * partition for — a link, a typed `?day=`, a calendar cell that lost its
   * file — so `days[index - 1]` is `undefined` (there is nothing to step back
   * to) while `days[index + 1]` is `days[0]`, THE EARLIEST SERVED DAY. Stepping
   * forward from nowhere lands on the oldest thing that exists, which is the
   * only move that gets the operator out. Disabling both arrows, as this
   * control used to, strands them on a day with no rows and no way off it.
   */
  const index = days.indexOf(day);
  const older: string | undefined = days[index - 1];
  const newer: string | undefined = days[index + 1];
  const count = monthCounts.find((entry) => String(entry.day) === day)?.count ?? 0;
  const [open, setOpen] = useState(false);

  return (
    <span className="flex shrink-0 items-center gap-0.5">
      <IconButton
        label={older === undefined ? "No earlier day in the tracker" : `Previous day — ${dayLabelWithToday(older, today)}`}
        size="sm"
        disabled={older === undefined}
        onClick={() => {
          if (older !== undefined) onDay(older);
        }}
        icon={<ChevronLeft aria-hidden className={dsIcon.md} />}
      />
      {/*
        THE HINT IS A `Tooltip`, NOT A `title`, and the operator filed the
        difference as a defect. A native `title` is painted by the browser at
        the CURSOR, so this one appeared adrift in the middle of the page with
        nothing tying it to the pill it describes. The primitive anchors to its
        trigger and opens BELOW it — this control is 10px from the top of the
        window, so `top` would be a flip on every hover.

        It wraps the Popover TRIGGER rather than the Popover, so the hint
        belongs to the button the pointer is actually over.
      */}
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip
          content={`${plural(count, "row")} on this day · the tracker holds ${plural(days.length, "day")}`}
          side="bottom"
        >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Pick a day — showing ${dayLabelWithToday(day, today)}, ${plural(count, "row")}`}
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
        </Tooltip>
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
        label={newer === undefined ? "Today is the newest day" : `Next day — ${dayLabelWithToday(newer, today)}`}
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

/* ── preflight (the doctor) ──────────────────────────────────────────────── */

type PreflightCheckWire = z.infer<typeof PreflightCheckWireSchema>;
type PreflightVerdict = z.infer<typeof PreflightVerdictSchema>;

const PREFLIGHT_TONE: Record<PreflightVerdict, "success" | "warning" | "danger"> = {
  pass: "success",
  warning: "warning",
  fail: "danger",
};

/**
 * The advisory note the demo pins above the check list. It is the whole reason
 * this indicator is on screen rather than filed under a page of preferences.
 */
const PREFLIGHT_ADVISORY_NOTE =
  "Doctor never blocks a run. It tells you what will fail before you spend a Duo prompt finding out — a failing check beside a workflow you are not running today is information, not an error.";

/** How loud the standing indicator should be. `fail` beats `warning` beats `pass`. */
export function preflightVerdict(checks: readonly PreflightCheckWire[]): PreflightVerdict {
  if (checks.some((check) => check.verdict === "fail")) return "fail";
  if (checks.some((check) => check.verdict === "warning")) return "warning";
  return "pass";
}

/**
 * THE DOCTOR, as a standing indicator rather than a Settings section.
 *
 * It was a read-only panel plus a "Run doctor again" button with no `onClick`,
 * filed under a page of preferences — so the one thing it is for (knowing what
 * will fail BEFORE you spend a Duo prompt finding out) was three clicks away
 * from where a run is started. Here it is always on screen and its glyph
 * carries the worst verdict of the set.
 *
 * It mounts ONLY when the bootstrap document serves `preflight`
 * (`FrontendBootstrapWireSchema#preflight`, declared-unserved in
 * `config/pending-wire-bindings.json`, doc 13 §3.1). No served checks means no
 * stethoscope: a green glyph over checks nobody ran would be a pass verdict the
 * server never made. The rerun button is the paired command and is disabled by
 * name until that command exists — a control that 422s on click is worse than
 * one that says why it cannot fire.
 */
function PreflightPopover({
  checks,
  onRerun,
}: {
  checks: readonly PreflightCheckWire[];
  onRerun?: () => void;
}) {
  const verdict = preflightVerdict(checks);
  const failing = checks.filter((check) => check.verdict === "fail").length;
  const warning = checks.filter((check) => check.verdict === "warning").length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <IconButton
          size="sm"
          label={
            verdict === "pass"
              ? "Preflight — every check passes"
              : `Preflight — ${failing} failing, ${warning} warning`
          }
          icon={<Stethoscope aria-hidden className={dsIcon.md} />}
          className={cn(
            verdict === "fail" && "text-[color:var(--ds-danger)]",
            verdict === "warning" && "text-[color:var(--ds-status-waiting-fg)]",
          )}
        />
      </PopoverTrigger>
      <PopoverContent title="Preflight" description={PREFLIGHT_ADVISORY_NOTE} width="lg" side="bottom" align="end">
        <div className="flex flex-col gap-[var(--ds-space-base)]">
          {checks.map((check) => (
            <div key={check.id} className="flex min-w-0 flex-col gap-[var(--ds-space-hair)]">
              <div className="flex min-w-0 items-center gap-[var(--ds-space-snug)]">
                <Badge tone={PREFLIGHT_TONE[check.verdict]}>{check.verdict}</Badge>
                <span className={cn(dsText.ui, "min-w-0 truncate font-medium text-[color:var(--ds-fg)]")}>
                  {check.label}
                </span>
                <span className={cn(dsText.micro, dsText.nums, "ml-auto shrink-0 text-[color:var(--ds-fg-faint)]")}>
                  {fmtClock(check.checkedAt)}
                </span>
              </div>
              <span className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>{check.detail}</span>
              {check.blocks.length > 0 && (
                <span className={cn(dsText.meta, "text-[color:var(--ds-status-waiting-fg)]")}>
                  Blocks: {check.blocks.join(" · ")}
                </span>
              )}
              {check.remediation !== undefined && (
                <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>Fix: {check.remediation}</span>
              )}
            </div>
          ))}
          <Button
            size="sm"
            variant="secondary"
            icon={<ListChecks aria-hidden className={dsIcon.md} />}
            disabled={onRerun === undefined}
            title={onRerun === undefined ? "This build serves no doctor-rerun command" : undefined}
            onClick={onRerun}
          >
            Run doctor again
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ── notifications ───────────────────────────────────────────────────────── */

type NotificationWire = z.infer<typeof NotificationWireSchema>;

/**
 * The row facts doc 03 §2.6 deliberately keeps OFF the notification wire.
 *
 * The demo's row carries a body sentence, a trigger label, a ping/inbox
 * routing verdict, a dedupe count and an OS-delivery flag. This wire carries
 * none of them ON PURPOSE — §2.6's trigger union is ids, closed codes and
 * counts with no free-text field, which is the only way "notification text
 * carries no captured form contents" is enforceable at all (D138).
 *
 * So the markup below ports the demo whole and every one of those arms renders
 * ONLY when its field is present. Today none is, so a row is dot · glyph ·
 * title · age · actions — the honest shape of what the server actually said.
 * This is an on-record deviation from the demo, not a placeholder: nothing
 * here invents a body, a delivery verdict, or a repeat count.
 */
export interface NotificationRowExtras {
  readonly body?: string;
  readonly triggerLabel?: string;
  readonly delivery?: "ping" | "inbox";
  readonly count?: number;
  readonly desktopDelivered?: boolean;
  readonly link?: { readonly label: string; readonly runId: string };
}

export type NotificationRowWire = NotificationWire & NotificationRowExtras;

/**
 * Severity's PAIR — the badge tone and the glyph — off one table, so a row can
 * never carry a red siren beside a neutral badge. The wire's three arms line up
 * with the demo's three: `error` is its `critical`, `warning` its `attention`.
 */
const SEVERITY_TONE: Record<
  NotificationWire["severity"],
  { badge: "danger" | "warning" | "neutral"; icon: typeof Siren }
> = {
  error: { badge: "danger", icon: Siren },
  warning: { badge: "warning", icon: TriangleAlert },
  info: { badge: "neutral", icon: Inbox },
};

const NOTIFICATION_FILTERS = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "ping", label: "Pings" },
  { key: "inbox", label: "Inbox" },
  { key: "snoozed", label: "Snoozed" },
] as const;

type NotificationFilterKey = (typeof NOTIFICATION_FILTERS)[number]["key"];

/**
 * 2i-B: the inbox bell over doc 03 §2.6's durable rows, in the demo's own
 * anatomy — a raw square button with a corner superscript badge, and a 480px
 * Drawer holding the filter chips, the rows and the standing footer.
 *
 * Every row renders durable state; the wire is the fold, not a toast log. A
 * failed command is REPORTED rather than swallowed, which is the one place this
 * surface deliberately outgrows the demo: the demo has no server to refuse it.
 * Read/unread and snooze stay independent axes — snoozing does not mark read
 * (D138).
 */
export function NotificationBell({
  notifications,
  actorId,
  onOpenRun,
}: {
  notifications: readonly NotificationRowWire[];
  actorId: string;
  onOpenRun: (runId: string) => void;
}) {
  const client = useDashboardClient();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<NotificationFilterKey>("all");
  const [commandError, setCommandError] = useState<string | null>(null);
  const nowIso = systemClock.now().toISOString();

  const unread = notifications.filter((entry) => entry.state === "unread").length;
  const critical = notifications.some((entry) => entry.state === "unread" && entry.severity === "error");

  /**
   * Counted over EVERY served record, so the bell's badge and these chips can
   * never disagree about how many exist. `Pings` and `Inbox` count the rows
   * that DECLARE a delivery route — none do yet (see `NotificationRowExtras`),
   * so both read zero and their filter answers the EmptyState below, which says
   * in as many words that a zero here never means a record was deleted.
   */
  const counts: Record<NotificationFilterKey, number> = {
    all: notifications.length,
    unread,
    ping: notifications.filter((entry) => entry.delivery === "ping").length,
    inbox: notifications.filter((entry) => entry.delivery === "inbox").length,
    snoozed: notifications.filter((entry) => entry.state === "snoozed").length,
  };

  const shown = notifications.filter((entry) => {
    if (filter === "all") return true;
    if (filter === "unread") return entry.state === "unread";
    if (filter === "snoozed") return entry.state === "snoozed";
    return entry.delivery === filter;
  });

  const issue = (
    type: "notification-read" | "notification-unread" | "notification-snooze",
    entry: NotificationRowWire,
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
    <>
      <button
        type="button"
        aria-label={`Notifications — ${unread} unread`}
        onClick={() => setOpen(true)}
        className={cn(
          "relative rounded-[var(--ds-radius-md)] p-[var(--ds-space-snug)] text-[color:var(--ds-fg-muted)]",
          "hover:bg-[var(--ds-surface-3)] hover:text-[color:var(--ds-fg)]",
          dsFocus,
          dsMotion.base,
        )}
      >
        <Bell aria-hidden className={dsIcon.md} />
        {unread > 0 && (
          // Dark ink on a bright fill — the same contract the two LOUD statuses
          // use (DESIGN.md). White numerals on this red fail AA at 10px. And
          // NOTHING is painted at zero: a permanently lit badge is chrome, not
          // a signal.
          <span
            aria-hidden
            className={cn(
              "absolute -right-0.5 -top-0.5 flex items-center justify-center rounded-full",
              "size-[var(--ds-space-cozy)] font-semibold",
              dsText.micro,
              dsText.nums,
              critical
                ? "bg-[var(--ds-status-failed-solid-bg)] text-[color:var(--ds-status-failed-solid-fg)]"
                : "bg-[var(--ds-status-waiting-solid-bg)] text-[color:var(--ds-status-waiting-solid-fg)]",
            )}
          >
            {unread}
          </span>
        )}
      </button>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent
          title="Notifications"
          description={`${unread} unread · pings are silent · a record survives a failed desktop delivery`}
          size="480px"
        >
          <div className="flex min-h-0 flex-1 flex-col">
            {/* A refused command is SAID, never dropped: the demo has no server
                to refuse one, and a silently failed Mark read would leave the
                operator believing they had cleared something they had not. */}
            {commandError !== null && (
              <div className="border-b border-[color:var(--ds-border)] px-[var(--ds-space-cozy)] py-[var(--ds-space-base)]">
                <span role="alert" className={cn(dsText.meta, "text-[color:var(--ds-danger)]")}>
                  {commandError}
                </span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-[var(--ds-space-tight)] border-b border-[color:var(--ds-border)] px-[var(--ds-space-cozy)] py-[var(--ds-space-base)]">
              {NOTIFICATION_FILTERS.map((entry) => (
                <Chip
                  key={entry.key}
                  selected={filter === entry.key}
                  onSelect={() => setFilter(entry.key)}
                  tone="neutral"
                >
                  {`${entry.label} ${counts[entry.key]}`}
                </Chip>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {shown.length === 0 ? (
                <EmptyState
                  icon={<Inbox aria-hidden className={dsIcon.lg} />}
                  title="Nothing under this filter"
                  description="The records still exist — switch the filter to see them. A count that reads zero here never means a notification was deleted."
                />
              ) : (
                shown.map((entry) => (
                  <NotificationRow
                    key={entry.notificationId}
                    entry={entry}
                    nowIso={nowIso}
                    onRead={() =>
                      issue(entry.state === "unread" ? "notification-read" : "notification-unread", entry)}
                    onSnooze={() => issue("notification-snooze", entry)}
                    onOpen={() => {
                      if (entry.link === undefined) return;
                      onOpenRun(entry.link.runId);
                      setOpen(false);
                    }}
                  />
                ))
              )}
            </div>

            <footer
              className={cn(
                "border-t border-[color:var(--ds-border)] bg-[var(--ds-surface-2)] px-[var(--ds-space-cozy)] py-[var(--ds-space-base)]",
                dsText.meta,
                "text-[color:var(--ds-fg-muted)]",
              )}
            >
              Failed · gate · parked · repeating · storage ping. A clean finish is inbox-only. A notification is a durable
              record first and a desktop delivery second — a failed delivery still leaves an unread item here.
            </footer>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}

function NotificationRow({
  entry,
  nowIso,
  onRead,
  onSnooze,
  onOpen,
}: {
  entry: NotificationRowWire;
  nowIso: string;
  onRead: () => void;
  onSnooze: () => void;
  onOpen: () => void;
}) {
  const spec = SEVERITY_TONE[entry.severity];
  const Icon = spec.icon;
  const unread = entry.state === "unread";
  const snoozing = entry.state === "snoozed";
  const badges =
    entry.triggerLabel !== undefined
    || entry.delivery !== undefined
    || (entry.count !== undefined && entry.count > 1)
    || entry.desktopDelivered === false;

  return (
    <article
      className={cn(
        "flex flex-col gap-[var(--ds-space-tight)] border-b border-[color:var(--ds-border-subtle)] px-[var(--ds-space-cozy)] py-[var(--ds-space-base)]",
        snoozing && "opacity-60",
      )}
    >
      <div className="flex min-w-0 items-center gap-[var(--ds-space-snug)]">
        {unread && <span aria-label="unread" className="size-1.5 shrink-0 rounded-full bg-[var(--ds-accent)]" />}
        <Icon
          aria-hidden
          className={cn(
            dsIcon.md,
            "shrink-0",
            entry.severity === "error" ? "text-[color:var(--ds-danger)]" : "text-[color:var(--ds-fg-muted)]",
          )}
        />
        <span
          className={cn(
            dsText.ui,
            "min-w-0 flex-1 truncate",
            unread ? "font-semibold text-[color:var(--ds-fg)]" : "text-[color:var(--ds-fg-secondary)]",
          )}
        >
          {entry.title}
        </span>
        <MetaLine
          className="shrink-0"
          items={[`${fmtElapsed(elapsedSecondsBetween(entry.occurredAt, nowIso))} ago`]}
        />
      </div>

      {entry.body !== undefined && (
        <p className={cn(dsText.body, "text-[color:var(--ds-fg-muted)]")}>{entry.body}</p>
      )}

      {badges && (
        <div className="flex flex-wrap items-center gap-[var(--ds-space-tight)]">
          {entry.triggerLabel !== undefined && <Badge tone={spec.badge}>{entry.triggerLabel}</Badge>}
          {entry.delivery !== undefined && (
            <Badge tone={entry.delivery === "ping" ? "info" : "neutral"}>
              {entry.delivery === "ping" ? "Ping" : "Inbox only"}
            </Badge>
          )}
          {entry.count !== undefined && entry.count > 1 && (
            <Chip label="repeats">{`+${entry.count - 1} more like this`}</Chip>
          )}
          {entry.desktopDelivered === false && (
            <Badge
              tone="warning"
              title="The desktop notification never appeared. The record is here anyway — that is the point of durability."
            >
              delivery failed
            </Badge>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-[var(--ds-space-tight)]">
        {entry.link !== undefined && (
          <Button size="sm" variant="secondary" onClick={onOpen}>
            {entry.link.label}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          icon={unread ? <MailOpen aria-hidden className={dsIcon.sm} /> : <Mail aria-hidden className={dsIcon.sm} />}
          onClick={onRead}
        >
          {unread ? "Mark read" : "Mark unread"}
        </Button>
        {/* THE UN-SNOOZE ARM KEEPS ITS PLACE AND SAYS WHY IT CANNOT FIRE. The
            kernel serves `notification-snooze` and no inverse, so a live
            Un-snooze here would 422 on click. Hiding the control instead —
            what this surface used to do — moves every button beside it the
            moment a row snoozes. */}
        <Button
          size="sm"
          variant="ghost"
          icon={<Clock aria-hidden className={dsIcon.sm} />}
          disabled={snoozing}
          title={snoozing ? "This build serves no un-snooze command; the snooze expires on its own" : undefined}
          onClick={onSnooze}
        >
          {snoozing ? "Un-snooze" : "Snooze 1h"}
        </Button>
      </div>
    </article>
  );
}

/* ── shortcuts ───────────────────────────────────────────────────────────── */

/**
 * The Top Bar's route to the keyboard flow. A Popover is the sanctioned home
 * for something that has to be REACHABLE rather than visible: it opens on
 * click, so pointer, touch and keyboard all get to it, unlike the hover-only
 * tooltip DESIGN.md forbids for anything load-bearing.
 *
 * IT IS NO LONGER MOUNTED IN THE TOP BAR. The demo deleted the keyboard glyph
 * on the operator's own instruction — *"the keyboard icon will be removed from
 * there since we already have help in settings"* — and a second door to a
 * reference page is not discoverability, it is a second thing to maintain. The
 * component stays here, exported and whole, for the Settings → Help group and
 * the global `?` binding that own it next; deleting it would throw away a
 * ported surface to re-port it a slice later.
 */
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

const SHELL_VIEWS: readonly ShellView[] = ["queue", "archive", "explorer", "activity"];

/**
 * One bordered container, four segments — the same shape the Status Bar's
 * `All` / `Needs you` composite uses, because both answer "which of these am I
 * looking at" rather than "do this".
 */
function ShellViewSwitcher({
  view,
  onView,
}: {
  view: ShellView;
  onView: (view: ShellView) => void;
}): ReactElement {
  return (
    <div
      className={cn(
        "inline-flex shrink-0 border p-[var(--ds-space-hair)]",
        dsRadius.md,
        dsBorder.base,
        "bg-[var(--ds-surface-2)]",
      )}
    >
      {SHELL_VIEWS.map((candidate) => (
        <button
          key={candidate}
          type="button"
          aria-pressed={view === candidate}
          onClick={() => onView(candidate)}
          className={cn(
            "inline-flex cursor-pointer items-center px-[var(--ds-space-base)]",
            "h-[var(--ds-h-sm)]",
            dsRadius.sm,
            dsText.meta,
            dsFocus,
            dsMotion.fast,
            view === candidate
              ? "bg-[var(--ds-surface-3)] font-semibold text-[color:var(--ds-fg)]"
              : "font-medium text-[color:var(--ds-fg-muted)] hover:text-[color:var(--ds-fg)]",
          )}
        >
          {SHELL_VIEW_LABEL[candidate]}
        </button>
      ))}
    </div>
  );
}

/* ── the bar ─────────────────────────────────────────────────────────────── */

/**
 * The Top Bar.
 */
export function TopBar({
  notifications,
  actorId,
  preflight,
  onPreflightRerun,
  storage,
  settingsSections,
  settingsOpen,
  onSettingsOpen,
  day,
  today,
  monthCounts,
  onDay,
  theme,
  onToggleTheme,
  nav,
  view,
  onView,
  catalogOpen,
  onOpenCatalog,
  daySurfaces,
  workflowLabelOf,
  onOpenRun,
}: {
  notifications: readonly NotificationRowWire[];
  actorId: string;
  /**
   * The doctor's served checks (doc 13 §3.1). Absent on every build today —
   * `FrontendBootstrapWireSchema#preflight` is declared-unserved — and its
   * absence is what keeps the stethoscope off the bar entirely.
   */
  preflight?: readonly PreflightCheckWire[];
  /** the paired doctor-rerun command, unserved with the summary itself */
  onPreflightRerun?: () => void;
  /** the bootstrap's storage health summary — the gear's attention dot (2i-D) */
  storage: StorageHealthSummary;
  settingsSections: readonly SettingsSection[];
  /**
   * The Settings dialog is CONTROLLED by the app: the storage banner above
   * every view opens the same dialog this gear does, and two triggers cannot
   * share a state the dialog holds privately.
   */
  settingsOpen: boolean;
  onSettingsOpen: (open: boolean) => void;
  /** the day partition the whole app is reading */
  day: string;
  today: string;
  monthCounts: readonly DayCountWire[];
  onDay: (day: string) => void;
  theme: DemoTheme;
  onToggleTheme: () => void;
  nav: NavControls;
  /** which product view owns the main region — the switcher's pressed segment */
  view: ShellView;
  onView: (view: ShellView) => void;
  /**
   * The UI catalog is REFERENCE scaffolding, and the demo puts exactly that
   * kind of surface behind a quiet glyph in this cluster (`DemoSurfacesPopover`)
   * rather than in the product switcher beside Archive and Activity. It keeps
   * that treatment here: one quiet icon, pressed while it owns the region.
   */
  catalogOpen: boolean;
  onOpenCatalog: () => void;
  /** the whole day's projection — what the search control finds over */
  daySurfaces: readonly QueueSurfaceWire[];
  workflowLabelOf: (workflowId: string) => string;
  onOpenRun: (runId: string) => void;
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

      {/* Product navigation sits beside the history pair: both are ways of
          changing WHERE YOU ARE, and the switcher is the deliberate one. */}
      <NavHistoryControls nav={nav} />

      <ShellViewSwitcher view={view} onView={onView} />

      {/* Search takes the bar's slack (`ml-auto flex-1`, capped at 240px), which
          is what pins the date navigator and the icon cluster to the right edge
          without a spacer div. The date here IS the day the queue reads. */}
      <DaySearchControl
        surfaces={daySurfaces}
        day={day}
        workflowLabelOf={workflowLabelOf}
        onOpenRun={onOpenRun}
      />

      <DateNav day={day} today={today} monthCounts={monthCounts} onDay={onDay} />

      <span className="flex shrink-0 items-center gap-[var(--ds-space-hair)]">
        {/* Preflight, on screen at all times rather than three clicks inside a
            page of preferences. Its glyph carries the worst verdict — and it is
            absent entirely while nothing serves the checks, because an
            indicator that reports on nothing reports a pass. */}
        {preflight !== undefined && <PreflightPopover checks={preflight} onRerun={onPreflightRerun} />}
        <NotificationBell notifications={notifications} actorId={actorId} onOpenRun={onOpenRun} />
        {/* THE KEYBOARD GLYPH IS GONE. Operator, on the demo: *"the keyboard
            icon will be removed from there since we already have help in
            settings."* `ShortcutsPopover` above is unchanged and keeps its one
            home — the global binding, and the Settings → Help group that lands
            with it. A second door to a reference page is not discoverability. */}
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
        {/* The quiet door to reference scaffolding, in the demo's own slot and
            with its own glyph. The LABEL stays "UI catalog" — the surface
            behind it IS the catalog (D177), not the demo's synthetic-data
            switch — so the deviation is one word, on record. */}
        <IconButton
          size="sm"
          label="UI catalog"
          aria-pressed={catalogOpen}
          onClick={onOpenCatalog}
          icon={<FlaskConical aria-hidden className={dsIcon.md} />}
          className={cn(catalogOpen && "bg-[var(--ds-surface-3)] text-[color:var(--ds-fg)]")}
        />
        {/* The gear opens Settings. It sits last, as in the demo. */}
        <SettingsControl
          storage={storage}
          sections={settingsSections}
          open={settingsOpen}
          onOpenChange={onSettingsOpen}
        />
      </span>
    </header>
  );
}
