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
import { memo, useMemo, useRef, useState, type ReactElement } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock,
  Inbox,
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
  Refusal,
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

import { systemClock } from "../../domain/clock.js";
import type { CrossDateSearchResult } from "../../domain/dashboard/search.js";
import { settleCommandResult } from "../app/command-result.js";
import { useDashboardClient } from "../state/client-context.js";
import { DaySearchControl } from "./day-search.js";
import type { QueueSurfaceWire } from "./queue-model.js";
import {
  dayLabelWithToday,
  elapsedSecondsBetween,
  fmtClock,
  fmtElapsed,
  plural,
} from "./format.js";
import { SettingsGear } from "./settings.js";
import { type StorageHealthSummary } from "./settings-model.js";
import {
  type DayCountWire,
  NOTIFICATION_FILTERS,
  type NotificationFilterKey,
  type NotificationRowWire,
  type OrdinaryNotificationRowWire,
  type PreflightCheckWire,
  type PreflightVerdict,
  SHELL_VIEWS,
  SHELL_VIEW_LABEL,
  type ShellView,
  type ShellViewSelection,
  WEEKDAY_HEADS,
  buildCalendarMonth,
  monthLabel,
  monthOfDay,
  moveCalendarFocus,
  notificationInboxView,
  preflightVerdict,
  servedDays,
  shiftMonth,
} from "./top-bar-model.js";

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
 * THE ONE FRAME EVERY SEGMENTED COMPOSITE ON THIS BAR WEARS (2026-09-01).
 *
 * The bar used to paint three heights in a 44px band — the view switcher at
 * 30, the search field at 28, the date navigator at 24 — because the switcher
 * carried `p-hair` and a border AROUND segments that carried their own
 * `h-sm`, which is the growth DESIGN.md's layout rules name: *"a control that
 * WRAPS others takes the height itself and its segments fill it with
 * `h-full`."* The wrapper takes `--ds-h-md` here and every segment is
 * `h-full`, so the composite cannot grow by its own padding again, and the
 * three center controls land on one line.
 *
 * It is `--ds-border` on the recessed plane deliberately: the search field
 * reads the same pair, so a boxed field beside a boxed stepper reads as a pair
 * of peers rather than as one drawn control beside three loose glyphs.
 */
const SEGMENTED_FRAME = cn(
  "inline-flex shrink-0 items-center border p-[var(--ds-space-hair)]",
  dsSize.hMd,
  dsRadius.md,
  dsBorder.base,
  "bg-[var(--ds-surface-2)]",
);

const DATE_NAV_FRAME = cn(SEGMENTED_FRAME, "gap-[var(--ds-space-hair)]");

/**
 * One arrow of the date stepper. It is a plain button rather than an
 * `IconButton` for the reason the switcher's segments are: `IconButton` is a
 * SQUARE at a fixed `size-*`, and a segment that carries its own height is
 * exactly what made this composite 4px short of its neighbours. The two
 * things `IconButton` guarantees — an accessible name and a hover title —
 * are carried explicitly here, because losing them is the only real cost.
 */
function DateStep({
  label,
  icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: ReactElement;
  disabled: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-full w-[var(--ds-h-sm)] shrink-0 cursor-pointer items-center justify-center",
        dsRadius.sm,
        dsFocus,
        dsMotion.fast,
        "text-[color:var(--ds-fg-muted)]",
        "hover:bg-[var(--ds-surface-3)] hover:text-[color:var(--ds-fg)] active:translate-y-px",
        "disabled:pointer-events-none disabled:opacity-45",
      )}
    >
      {icon}
    </button>
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
    <span className={cn(DATE_NAV_FRAME, dsMotion.base, "hover:border-[color:var(--ds-border-strong)]")}>
      <DateStep
        label={older === undefined ? "No earlier day in the tracker" : `Previous day — ${dayLabelWithToday(older, today)}`}
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
              // The middle segment. `h-full` and no border of its own: the frame
              // above owns the height and the hairline, which is the rule a
              // segmented composite is written to (DESIGN.md, layout rules).
              "inline-flex h-full cursor-pointer items-center",
              "gap-[var(--ds-space-snug)] px-[var(--ds-space-snug)]",
              dsRadius.sm,
              dsText.ui,
              dsFocus,
              dsMotion.fast,
              "text-[color:var(--ds-fg)] hover:bg-[var(--ds-surface-3)] active:translate-y-px",
              "data-[state=open]:bg-[var(--ds-surface-selected)]",
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
      <DateStep
        label={newer === undefined ? "Today is the newest day" : `Next day — ${dayLabelWithToday(newer, today)}`}
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
  "Doctor never blocks a run. It tells you what will fail before you spend a Duo prompt finding out. A failing check beside a workflow you are not running today is information, not an error.";

/**
 * THE DOCTOR, as a standing indicator rather than a Settings section.
 *
 * It was a read-only panel plus a "Run doctor again" button with no `onClick`,
 * filed under a page of preferences — so the one thing it is for (knowing what
 * will fail BEFORE you spend a Duo prompt finding out) was three clicks away
 * from where a run is started. Here it is always on screen and its glyph
 * carries the worst verdict of the set.
 *
 * It mounts only when the bootstrap document serves `preflight`
 * (`FrontendBootstrapWireSchema#preflight`, ref frontend-backend-integration
 * §3.1). The current composition always serves its retained report; the
 * optional arm preserves read-forward compatibility with an older producer.
 * No served checks means no stethoscope: a green glyph over checks nobody ran
 * would be a pass verdict the server never made. The strict rerun route is
 * live; this screen keeps its button disabled until DCC3 supplies the typed
 * caller, and names the missing screen control rather than denying the route.
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
              ? "Preflight: every check passes"
              : `Preflight: ${failing} failing, ${warning} warning`
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
            title={onRerun === undefined
              ? "Current doctor results are available here; rerun is not available from this screen yet"
              : undefined}
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

/**
 * The row facts ref dashboard-surfaces §2.6 deliberately keeps OFF the notification wire.
 *
 * The demo's row carries a body sentence, a trigger label, a ping/inbox
 * routing verdict, a dedupe count and an OS-delivery flag. This wire carries
 * none of them ON PURPOSE — §2.6's trigger union is ids, closed codes and
 * counts with no free-text field, which is the only way "notification text
 * carries no captured form contents" is enforceable at all (D138).
 *
 * So the markup below ports the demo whole and every one of those arms renders
 * ONLY when its field is present. None of THESE is, so a row is dot · glyph ·
 * title · age · actions — the honest shape of what the server actually said.
 * This is an on-record deviation from the demo, not a placeholder: nothing
 * here invents a body, a delivery verdict, or a repeat count.
 *
 * D262 moved ONE of them onto the wire, and only one: the row's `link`. It is
 * an id, not prose — the same line §2.6 draws inside the trigger union — and a
 * needs-you alert whose only affordance is "mark read" is an alert nobody can
 * act on.
 */
/**
 * The button's word, per link kind. It lives here rather than on the wire
 * because it is UI copy about a destination this surface owns; the SERVER says
 * which run, never what to call the trip.
 */
const NOTIFICATION_LINK_LABEL: Record<"run" | "failure", string> = {
  run: "Open run",
  failure: "Open failure",
};

/**
 * Severity's PAIR — the badge tone and the glyph — off one table, so a row can
 * never carry a red siren beside a neutral badge. The wire's three arms line up
 * with the demo's three: `error` is its `critical`, `warning` its `attention`.
 */
const SEVERITY_TONE: Record<
  OrdinaryNotificationRowWire["severity"],
  { badge: "danger" | "warning" | "neutral"; icon: typeof Siren }
> = {
  error: { badge: "danger", icon: Siren },
  warning: { badge: "warning", icon: TriangleAlert },
  info: { badge: "neutral", icon: Inbox },
};

/**
 * 2i-B: the inbox bell over ref dashboard-surfaces §2.6's durable rows, in the demo's own
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
  nowIso,
  onOpenRun,
}: {
  notifications: readonly NotificationRowWire[];
  actorId: string;
  /**
   * The app's ONE live instant (D256), passed in rather than read here. A
   * notification's age is a fact about a served instant, so it must be
   * measured against the clock every other served instant on this screen is
   * measured against — never against this browser's own wall clock.
   */
  nowIso: string;
  onOpenRun: (runId: string) => void;
}) {
  const client = useDashboardClient();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<NotificationFilterKey>("all");
  const [commandError, setCommandError] = useState<string | null>(null);
  const { pinned, shown, counts, empty, unread, critical } = notificationInboxView(notifications, filter);

  const issue = (
    type: "notification-read" | "notification-unread" | "notification-snooze",
    entry: OrdinaryNotificationRowWire,
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
      // D253 — a notification row carries its own `revision`, so a bell action
      // races the fold that marks the row unread again. Branching on `rejected`
      // alone swallowed that CAS refusal: the control did nothing and said
      // nothing, which reads as a broken button rather than a stale view.
      const settlement = settleCommandResult(result);
      if (settlement.kind === "refused") setCommandError(settlement.problem);
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
          "relative flex touch-manipulation items-center justify-center rounded-[var(--ds-radius-md)] p-[var(--ds-space-snug)] text-[color:var(--ds-fg-muted)] max-sm:min-h-11 max-sm:min-w-11 max-sm:p-0",
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

            <div
              data-notification-filters
              className="flex shrink-0 flex-wrap items-center gap-[var(--ds-space-tight)] border-b border-[color:var(--ds-border)] bg-[var(--ds-surface-overlay)] px-[var(--ds-space-cozy)] py-[var(--ds-space-base)]"
            >
              {NOTIFICATION_FILTERS.map((entry) => (
                <Chip
                  key={entry.key}
                  selected={filter === entry.key}
                  onSelect={() => setFilter(entry.key)}
                  tone="neutral"
                  className="touch-manipulation max-sm:min-h-11"
                >
                  {`${entry.label} ${counts[entry.key]}`}
                </Chip>
              ))}
            </div>

            <div data-notification-scroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {/* Permanent safety rows share the bounded content scroller with
                  ordinary rows. Six gaps cannot push the filters or the rest
                  of the inbox beyond the viewport; every row remains reachable. */}
              {pinned.length > 0 && (
                <section aria-label="Pinned safety notices">
                  {pinned.map((entry) => (
                    <div
                      key={entry.notificationId}
                      data-backfill-gap="pinned"
                      className="border-b border-[color:var(--ds-border)] p-[var(--ds-space-cozy)]"
                    >
                      <Refusal
                        title={entry.title}
                        code="event-stream-history-gap"
                        meta={[`${fmtElapsed(elapsedSecondsBetween(entry.occurredAt, nowIso))} ago`, "pinned"]}
                      >
                        <span className="flex flex-col gap-[var(--ds-space-tight)]">
                          <span>
                            The dashboard could not backfill part of the event stream. Resnapshot and reconcile the
                            affected work before relying on dashboard history.
                          </span>
                          <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>
                            This safety record cannot be filtered, marked read, snoozed or dismissed. A reconnect does
                            not clear it.
                          </span>
                        </span>
                      </Refusal>
                    </div>
                  ))}
                </section>
              )}

              {empty ? (
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
  entry: OrdinaryNotificationRowWire;
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
            {NOTIFICATION_LINK_LABEL[entry.link.kind]}
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

/*
 * ── shortcuts ────────────────────────────────────────────────────────────────
 *
 * `ShortcutsPopover` STOOD HERE and is gone (D274 item 5). It had zero callers
 * and was kept, in its own words, "for the Settings → Help group and the global
 * `?` binding that own it next". The Settings → Help group now exists and
 * renders the one registry through `DemoShortcutsLegend` directly, at reading
 * size with its scopes named; the `?` binding is not ruled and the ratified
 * option explicitly rejected restoring a second top-bar door. Its stated future
 * arrived and did not want it, so keeping it would be two operator-facing
 * renderings of one registry with only one of them ever on screen — the exact
 * shape the shortcuts module warns about.
 */

/**
 * One bordered container, four segments — the same shape the Status Bar's
 * `All` / `Needs you` composite uses, because both answer "which of these am I
 * looking at" rather than "do this".
 */
function ShellViewSwitcher({
  view,
  onView,
}: {
  view: ShellViewSelection;
  onView: (view: ShellView) => void;
}): ReactElement {
  return (
    <div className={SEGMENTED_FRAME}>
      {SHELL_VIEWS.map((candidate) => (
        <button
          key={candidate}
          type="button"
          aria-pressed={view === candidate}
          onClick={() => onView(candidate)}
          className={cn(
            "inline-flex h-full cursor-pointer items-center px-[var(--ds-space-base)]",
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
/**
 * D4 (Track D, ref frontend-backend-integration §7.4; audit finding P1) — this
 * panel is `memo`'d, and every prop it takes is stable or primitive at the one
 * place that renders it (`app/dashboard-app.tsx`;
 * `dashboard-memo-prop-stability` refuses an inline object, array, arrow or
 * call in any of its prop slots, because ONE of those turns this wrapper into
 * pure overhead).
 *
 * The bar takes `nowIso` — the app's live instant (D256) — so like the queue
 * it redraws once a second by design; `memo` removes the re-renders BETWEEN
 * ticks, which is every command dispatch, every dialog, every run-detail
 * section fetch and every SSE patch that does not move the day's rows.
 */
export const TopBar = memo(function TopBar({
  notifications,
  actorId,
  nowIso,
  preflight,
  onPreflightRerun,
  storage,
  settingsOpen,
  onOpenSettings,
  day,
  today,
  monthCounts,
  onDay,
  theme,
  onToggleTheme,
  nav,
  view,
  onView,
  daySurfaces,
  workflowLabelOf,
  onOpenRun,
  onOpenCrossDateResult,
}: {
  notifications: readonly NotificationRowWire[];
  actorId: string;
  /**
   * The app's ONE live instant (D256) — the same value the queue rows, the
   * gate pill and the session footer date themselves from. The bell used to
   * read `systemClock.now()` here, which put a SECOND clock on one screen: a
   * browser whose wall clock is off would have aged a notification against an
   * instant no served fact was measured with.
   */
  nowIso: string;
  /**
   * The doctor's retained served report (ref frontend-backend-integration
   * §3.1). The current dashboard supplies it; optionality preserves an older
   * producer's honest absence, which keeps the stethoscope off the bar.
   */
  preflight?: readonly PreflightCheckWire[];
  /** The served rerun route's typed caller; DCC3 still owns this screen control. */
  onPreflightRerun?: () => void;
  /** the bootstrap's storage health summary — the gear's attention dot (2i-D) */
  storage: StorageHealthSummary;
  /**
   * Whether the Settings TAKEOVER owns the main region (D272 item 1). The gear
   * only reports and requests: the page is a route, so the app owns the state
   * and the bar reads it — the storage banner above every view opens the same
   * page this gear does, and the served section list travels with the page
   * rather than through the bar that never renders it.
   */
  settingsOpen: boolean;
  onOpenSettings: () => void;
  /** the day partition the whole app is reading */
  day: string;
  today: string;
  monthCounts: readonly DayCountWire[];
  onDay: (day: string) => void;
  theme: DemoTheme;
  onToggleTheme: () => void;
  nav: NavControls;
  /**
   * Which product view owns the main region — the switcher's pressed segment,
   * or `"none"` when the takeover on screen is one the switcher does not name
   * (Settings, intake, the catalog). See `app/url-state.ts`'s `shellViewOf`.
   */
  view: ShellViewSelection;
  onView: (view: ShellView) => void;
  /** the whole day's projection — what the search control finds over */
  daySurfaces: readonly QueueSurfaceWire[];
  workflowLabelOf: (workflowId: string) => string;
  onOpenRun: (runId: string) => void;
  onOpenCrossDateResult: (result: CrossDateSearchResult) => void;
}) {
  return (
    <header
      className={cn(
        "flex shrink-0 items-center border-b",
        dsSize.hTopbar,
        dsBorder.base,
        dsSurface.card,
        "gap-[var(--ds-space-cozy)] px-[var(--ds-shell-inset)] max-sm:gap-[var(--ds-space-tight)] max-sm:px-[var(--ds-space-base)]",
        "max-sm:overflow-x-auto max-sm:overscroll-contain",
      )}
    >
      {/* The app's name is the page's ONE h1. It reads at `dsText.ui` like the
          chrome it is — heading LEVEL is the document outline, not a type size. */}
      <div className="flex shrink-0 items-center gap-[var(--ds-space-base)] max-sm:order-1">
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
      <span className="max-sm:order-3 max-sm:flex sm:contents">
        <NavHistoryControls nav={nav} />
      </span>

      <span className="max-sm:order-4 max-sm:flex sm:contents">
        <ShellViewSwitcher view={view} onView={onView} />
      </span>

      {/* SEARCH AND THE DATE ARE ONE GROUP, and the group takes the bar's whole
          slack (2026-09-01). They used to be two `sm:contents` spans carrying
          an `ml-auto` EACH — the search's and the icon cluster's — and two
          `ml-auto`s do not stack, they SPLIT the free space: at 1440 that left
          the pair beached 212px short of the icons, in the middle of nowhere.
          One `flex-1 justify-end` group instead, so the bar has the two anchors
          it reads as: identity and where-you-are on the left, what you are
          looking at and the quiet tools on the right. The date here IS the day
          the queue reads. */}
      <span
        className={cn(
          "flex min-w-0 flex-1 items-center justify-end",
          "gap-[var(--ds-space-snug)]",
          "max-sm:order-5 max-sm:flex-none",
        )}
      >
        <DaySearchControl
          surfaces={daySurfaces}
          day={day}
          workflowLabelOf={workflowLabelOf}
          onOpenRun={onOpenRun}
          onOpenCrossDateResult={onOpenCrossDateResult}
        />
        <DateNav day={day} today={today} monthCounts={monthCounts} onDay={onDay} />
      </span>

      <span className="flex shrink-0 items-center gap-[var(--ds-space-hair)] max-sm:order-2">
        {/* Preflight stays on screen whenever bootstrap serves its retained
            report, rather than three clicks inside a page of preferences. Its
            glyph carries the worst verdict. Only an older producer's honest
            absence removes it, because an indicator over no report would
            invent a pass. */}
        {preflight !== undefined && <PreflightPopover checks={preflight} onRerun={onPreflightRerun} />}
        <NotificationBell notifications={notifications} actorId={actorId} nowIso={nowIso} onOpenRun={onOpenRun} />
        {/* THE KEYBOARD GLYPH IS GONE. Operator, on the demo: *"the keyboard
            icon will be removed from there since we already have help in
            settings."* The destination that instruction traded it for now
            exists: the gear → Settings → Help → Keyboard (D274 item 5), which
            renders the one registry through `DemoShortcutsLegend` directly.
            Restoring the glyph was option C and was rejected — it reverses the
            stated reason it was removed. */}
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
        {/* THE CATALOG GLYPH IS GONE from the bar by operator decision — the
            UI catalog stays reachable through its URL route (`?catalog=`),
            which is what the parity lane already drives. */}
        {/* The gear opens Settings. It sits last, as in the demo. */}
        <SettingsGear storage={storage} open={settingsOpen} onOpen={onOpenSettings} />
      </span>
    </header>
  );
});
