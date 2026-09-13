import {
Calendar,
ChevronLeft,
ChevronRight
} from "lucide-react";
import { type ReactElement,useMemo,useRef,useState } from "react";
import { Button,CountBadge,IconButton,Popover,PopoverContent,PopoverTrigger,Tooltip,dsBorder,dsFocus,dsIcon,dsMotion,dsRadius,dsText } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { type DayCountWire,WEEKDAY_HEADS,buildCalendarMonth,monthLabel,monthOfDay,moveCalendarFocus,servedDays,shiftMonth } from "./date-navigation-model.js";
import {
dayLabelWithToday,
plural
} from "./format.js";
import { SEGMENTED_FRAME } from "./top-bar-layout-model.js";


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
