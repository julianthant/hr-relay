import type { CalendarWire } from "../../domain/dashboard/calendar.js";
import type { AsyncResource } from "../state/async-resource.js";
import { useCalendar } from "../state/use-calendar.js";
import { Calendar as HeroCalendar } from "@heroui/react";
import { parseDate } from "@internationalized/date";
import {
Calendar,
ChevronLeft,
ChevronRight
} from "lucide-react";
import { type ReactElement,useMemo,useRef,useState } from "react";
import { Button,CountBadge,Popover,PopoverContent,PopoverTrigger,Tooltip,dsBorder,dsFocus,dsIcon,dsMotion,dsRadius,dsText } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { type DayCountWire,monthOfDay } from "./date-navigation-model.js";
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
  const countByDay = useMemo(() => new Map<string, number>(counts.map(entry => [entry.day, entry.count])), [counts]);
  const [focusedDay, setFocusedDay] = useState<string>();
  const calendarFocus = parseDate(focusedDay?.startsWith(month)
    ? focusedDay
    : day.startsWith(month) ? day : `${month}-15`);

  return (
    <div className="flex flex-col gap-[var(--ds-space-snug)]">
      <HeroCalendar
        aria-label="Pick a day"
        className="ds-hero-calendar"
        value={parseDate(day)}
        onChange={next => { if (next !== null) onPick(next.toString()); }}
        focusedValue={calendarFocus}
        onFocusChange={next => {
          const focused = next.toString();
          setFocusedDay(focused);
          const focusedMonth = monthOfDay(focused);
          if (focusedMonth !== month) setMonth(focusedMonth);
        }}
        minValue={parseDate("0001-01-01")}
        maxValue={parseDate(today)}
        isDateUnavailable={date => !countByDay.has(date.toString())}
      >
        <HeroCalendar.Header>
          <HeroCalendar.NavButton slot="previous" aria-label="Previous month" />
          <HeroCalendar.YearPickerTrigger>
            <HeroCalendar.YearPickerTriggerHeading />
            <HeroCalendar.YearPickerTriggerIndicator />
          </HeroCalendar.YearPickerTrigger>
          <HeroCalendar.NavButton slot="next" aria-label="Next month" />
        </HeroCalendar.Header>
        <HeroCalendar.Grid>
          <HeroCalendar.GridHeader>
            {weekday => <HeroCalendar.HeaderCell>{weekday}</HeroCalendar.HeaderCell>}
          </HeroCalendar.GridHeader>
          <HeroCalendar.GridBody>
            {date => <HeroCalendar.Cell
              date={date}
              data-demo-day={date.toString()}
              aria-label={`${dayLabelWithToday(date.toString(), today)} — ${countByDay.has(date.toString()) ? plural(countByDay.get(date.toString()) ?? 0, "row") : "the tracker holds no rows"}`}
            >
              {({ formattedDate }) => <>
                {formattedDate}
                {countByDay.has(date.toString()) && <HeroCalendar.CellIndicator className={countByDay.get(date.toString()) ? "bg-[var(--ds-accent-mark)]" : "bg-[var(--ds-fg-faint)]"} />}
              </>}
            </HeroCalendar.Cell>}
          </HeroCalendar.GridBody>
        </HeroCalendar.Grid>
        <HeroCalendar.YearPickerGrid>
          <HeroCalendar.YearPickerGridBody>
            {({ year }) => <HeroCalendar.YearPickerCell year={year} />}
          </HeroCalendar.YearPickerGridBody>
        </HeroCalendar.YearPickerGrid>
      </HeroCalendar>

      {/* TODAY IN ONE ACTION, from anywhere in the calendar. It moves the month
          AND the day, so a picker parked three months out is one press from
          live rather than three. */}
      {resource.state === "failed" && <div role="alert" className={dsText.meta}>{resource.error.message} <Button size="sm" variant="secondary" onClick={onRetry}>Retry calendar</Button></div>}
      <div className={cn("flex items-center border-t pt-[var(--ds-space-snug)]", dsBorder.subtle)}>
        <Button
          size="sm"
          variant="secondary"
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
