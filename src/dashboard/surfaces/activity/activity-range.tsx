import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { RangeCalendar } from "@heroui/react";
import { parseDate } from "@internationalized/date";
import { Button, Popover, PopoverContent, PopoverTrigger } from "../../ds/ui.js";
import { activityCompactRangeLabel, applyActivityRangeDraft, type ActivityDateRange, type ActivityRangeDraft } from "../activity-model.js";

export function ActivityRange({ range, today, open, onOpenChange, onApply }: { range: ActivityDateRange; today: string; open: boolean; onOpenChange: (open: boolean) => void; onApply: (range: ActivityDateRange) => void }) {
  const [draft, setDraft] = useState<ActivityRangeDraft>({ from: range.from, to: range.to });
  const [yearPicker, setYearPicker] = useState(false);
  const anchor = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const focusFrame = useRef<number | undefined>(undefined);
  useEffect(() => () => { if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current); }, []);
  const result = applyActivityRangeDraft(draft);
  const changeOpen = (next: boolean) => {
    if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current);
    if (!next) focusFrame.current = requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
    if (next) setDraft({ from: range.from, to: range.to });
    setYearPicker(false); anchor.current = false; onOpenChange(next);
  };
  const beginSelection = (target: EventTarget | null) => {
    if (!(target instanceof Element) || !target.closest(".range-calendar__cell")) return;
    if (!anchor.current) { setDraft({ from: null, to: null }); anchor.current = true; }
    else anchor.current = false;
  };
  return <Popover open={open} onOpenChange={changeOpen}>
    <PopoverTrigger asChild><Button ref={trigger} size="toolbar" variant="ghost" aria-label={`Select report dates: ${activityCompactRangeLabel(range)}`} icon={<CalendarDays aria-hidden className="size-3.5" />}><span className="tabular-nums">{activityCompactRangeLabel(range)}</span><ChevronDown aria-hidden className="size-3" /></Button></PopoverTrigger>
    <PopoverContent title="Select report dates" hideTitle align="start" width="md" className="ui-theme-scope ds-date-popover activity-range-popover bg-ui-panel font-ui text-ui-primary [--ds-activity-calendar-endpoint-bg:var(--ui-info)] [--ds-activity-calendar-endpoint-fg:var(--ui-panel)] [--ds-activity-calendar-endpoint-hover:var(--ui-info)] [--ds-activity-calendar-range-bg:var(--ui-hover)] [--ds-activity-calendar-range-hover:var(--ui-table)] [--ds-activity-calendar-focus:var(--ui-info)]">
      <div onPointerDownCapture={event => beginSelection(event.target)} onKeyDownCapture={event => { if ((event.key === "Enter" || event.key === " ") && !event.repeat) beginSelection(event.target); }}>
        <RangeCalendar aria-label="Choose report date range" className="ds-hero-calendar activity-range-calendar" defaultFocusedValue={parseDate(range.to)} isYearPickerOpen={yearPicker} onYearPickerOpenChange={setYearPicker} value={result.state === "ready" ? { start: parseDate(result.model.selection.from), end: parseDate(result.model.selection.to) } : null} onChange={dates => { if (dates) { setDraft({ from: dates.start.toString(), to: dates.end.toString() }); anchor.current = false; } }}>
          <RangeCalendar.Header><RangeCalendar.NavButton slot="previous" aria-label="Previous month" /><RangeCalendar.YearPickerTrigger className="h-8 min-h-8 w-full justify-center"><RangeCalendar.YearPickerTriggerHeading /><RangeCalendar.YearPickerTriggerIndicator /></RangeCalendar.YearPickerTrigger><RangeCalendar.NavButton slot="next" aria-label="Next month" /></RangeCalendar.Header>
          <RangeCalendar.Grid><RangeCalendar.GridHeader>{day => <RangeCalendar.HeaderCell>{day}</RangeCalendar.HeaderCell>}</RangeCalendar.GridHeader><RangeCalendar.GridBody>{date => <RangeCalendar.Cell date={date} className={date.toString() === today ? "activity-range-calendar-report-today" : undefined} />}</RangeCalendar.GridBody></RangeCalendar.Grid>
          {yearPicker && <RangeCalendar.YearPickerGrid><RangeCalendar.YearPickerGridBody>{({ year }) => <RangeCalendar.YearPickerCell year={year} />}</RangeCalendar.YearPickerGridBody></RangeCalendar.YearPickerGrid>}
        </RangeCalendar>
      </div>
      <div className="mt-3 flex justify-end gap-2 border-t border-ui-stroke pt-3"><Button variant="secondary" onClick={() => changeOpen(false)}>Cancel</Button><Button className="activity-range-apply" disabled={result.state !== "ready"} onClick={() => { if (result.state === "ready") { onApply(result.model.selection); changeOpen(false); } }}>Apply range</Button></div>
    </PopoverContent>
  </Popover>;
}
