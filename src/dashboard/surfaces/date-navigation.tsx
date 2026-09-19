import type { CalendarWire } from "../../domain/dashboard/calendar.js";
import type { AsyncResource } from "../state/async-resource.js";
import { useCalendar } from "../state/use-calendar.js";
import {
Calendar,
ChevronLeft,
ChevronRight
} from "lucide-react";
import { type ReactElement,useLayoutEffect,useMemo,useRef,useState } from "react";
import { Button,CountBadge,IconButton,Popover,PopoverContent,PopoverTrigger,Tooltip,dsBorder,dsFocus,dsIcon,dsMotion,dsRadius,dsText } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { type DayCountWire,WEEKDAY_HEADS,buildCalendarMonth,monthLabel,monthOfDay,moveCalendarFocus,calendarTabStop,shiftMonth } from "./date-navigation-model.js";
import {
dayLabelWithToday,
plural
} from "./format.js";
import { SEGMENTED_FRAME } from "./top-bar-layout-model.js";


function DateCalendar({
  day,
  today,
  month,
  setMonth,
  resource,
  followingToday,
  onRetry,
  onToday,
  onPick,
}: {
  day: string;
  today: string;
  month: string;
  setMonth: (month: string) => void;
  resource: AsyncResource<CalendarWire>;
  followingToday: boolean;
  onRetry: () => void;
  onToday: () => void;
  onPick: (day: string) => void;
}) {
  const counts = resource.state === "loaded" ? resource.value.monthCounts : NO_COUNTS;
  const cells = useMemo(() => buildCalendarMonth(month, counts, today), [month, counts, today]);
  const previous = month > "0000-01" ? shiftMonth(month, -1) : undefined;
  const next = month < monthOfDay(today) ? shiftMonth(month, 1) : undefined;
  const [focusedDay, setFocusedDay] = useState<string>();
  const focus = calendarTabStop(cells, focusedDay, day);
  const gridRef = useRef<HTMLDivElement>(null);
  const todayRef = useRef<HTMLButtonElement>(null);
  const gridOwnedFocus = useRef(false);
  // Restore the roving stop when new availability disables the focused cell.
  useLayoutEffect(() => {
    if (gridOwnedFocus.current) {
      const button = gridRef.current?.querySelector<HTMLButtonElement>('[tabindex="0"]');
      (button ?? todayRef.current)?.focus();
    }
  }, [cells, focus]);
  const moveTo = (index: number): void => {
    const cell = cells[index];
    if (cell === undefined || !cell.available) return;
    setFocusedDay(cell.day);
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
              ? `The tracker holds nothing before ${monthLabel(month)}`
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
              ? `The tracker holds nothing after ${monthLabel(month)}`
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
        onFocusCapture={() => { gridOwnedFocus.current = true; }}
        onBlurCapture={(event) => { if (event.relatedTarget !== null && !event.currentTarget.contains(event.relatedTarget)) gridOwnedFocus.current = false; }}
        aria-label="Pick a day"
        onKeyDown={(event) => {
          const to = moveCalendarFocus(cells, focus, event.key);
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
              onFocus={() => setFocusedDay(cell.day)}
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
      {resource.state === "failed" && <div role="alert" className={dsText.meta}>{resource.error.message} <Button size="sm" variant="secondary" onClick={onRetry}>Retry calendar</Button></div>}
      <div className={cn("flex items-center border-t pt-[var(--ds-space-snug)]", dsBorder.subtle)}>
        <Button
          size="sm"
          variant="secondary"
          ref={todayRef}
          disabled={followingToday && day === today && month === monthOfDay(today)}
          onClick={() => {
            setMonth(monthOfDay(today));
            onToday();
          }}
        >
          Today
        </Button>
        <span className={cn(dsText.meta, "ml-auto text-[color:var(--ds-fg-muted)]")}>
          {resource.state === "failed" ? "Calendar unavailable" : resource.state === "loaded" ? `${counts.length} days this month` : "Loading calendar…"}
        </span>
      </div>
    </div>
  );
}


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


const NO_COUNTS: readonly DayCountWire[] = Object.freeze([]);

/** Chronological navigation comes from the calendar; the badge comes from the matching day stream. */
export function DateNav({ day, today, monthCounts, onDay, onToday, followingToday = false,
  dateError, calendarRevision, dayState = "loaded" }: {
  day: string; today: string; monthCounts: readonly DayCountWire[]; onDay: (day: string) => void;
  onToday: () => void; followingToday?: boolean; dateError?: string; calendarRevision?: object;
  dayState?: "loaded" | "loading" | "failed";
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [viewedMonth, setViewedMonth] = useState(() => monthOfDay(dateError === undefined ? day : today));
  const month = open ? viewedMonth : monthOfDay(dateError === undefined ? day : today);
  const [attempt, setAttempt] = useState(0);
  const resource = useCalendar(month, dateError === undefined ? day : undefined, today, calendarRevision, attempt);
  const older = resource.state === "loaded" ? resource.value.previousDay ?? undefined : undefined;
  const newer = resource.state === "loaded" ? resource.value.nextDay ?? undefined : undefined;
  const count = dayState === "loaded" ? monthCounts.find(entry => entry.day === day)?.count ?? 0 : undefined;
  const countLabel = count === undefined ? dayState === "failed" ? "queue unavailable" : "loading queue" : plural(count, "row");
  if (dateError !== undefined) return <Button size="sm" variant="secondary" onClick={onToday} title={dateError}>Today</Button>;

  return (
    <span className={cn(DATE_NAV_FRAME, dsMotion.base, "hover:border-[color:var(--ds-border-strong)]")}>
      <DateStep
        label={resource.state !== "loaded" ? resource.state === "failed" ? "Calendar unavailable" : "Loading calendar" : older === undefined ? "No earlier day in the tracker" : `Previous day — ${dayLabelWithToday(older, today)}`}
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
      <Popover open={open} onOpenChange={(next) => {
        if (next) setViewedMonth(monthOfDay(day));
        setOpen(next);
        // Outside pointer dismissal runs before the browser's default focus action.
        if (!next) requestAnimationFrame(() => triggerRef.current?.focus());
      }}>
        <Tooltip
          content={`${countLabel} on this day${resource.state === "failed" ? " · Calendar unavailable" : resource.state === "loading" ? " · Loading calendar" : ""}`}
          side="bottom"
        >
        <PopoverTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            aria-label={`Pick a day — showing ${dayLabelWithToday(day, today)}, ${countLabel}`}
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
            {count === undefined ? <span className={dsText.meta}>{dayState === "failed" ? "Unavailable" : "Loading…"}</span> : <CountBadge value={count} tone={day === today ? "info" : "neutral"} />}
          </button>
        </PopoverTrigger>
        </Tooltip>
        <PopoverContent title="Pick a day" hideTitle width="md" align="center" side="bottom">
          <DateCalendar
            day={day}
            today={today}
            month={month}
            setMonth={setViewedMonth}
            resource={resource}
            followingToday={followingToday}
            onRetry={() => setAttempt(value => value + 1)}
            onToday={() => { setOpen(false); onToday(); }}
            onPick={(next) => {
              setOpen(false);
              if (next !== day) onDay(next);
            }}
          />
        </PopoverContent>
      </Popover>
      <DateStep
        label={resource.state !== "loaded" ? resource.state === "failed" ? "Calendar unavailable" : "Loading calendar" : newer === undefined ? "Today is the newest day" : `Next day — ${dayLabelWithToday(newer, today)}`}
        disabled={newer === undefined}
        onClick={() => {
          if (newer !== undefined) onDay(newer);
        }}
        icon={<ChevronRight aria-hidden className={dsIcon.md} />}
      />
    </span>
  );
}
