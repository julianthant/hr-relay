import { I18nProvider } from "react-aria-components/I18nProvider";
import { Calendar as HeroCalendar, DateField, DatePicker as HeroDatePicker, Label, RangeCalendar as HeroRangeCalendar } from "@heroui/react";
import { parseDate, type CalendarDate } from "@internationalized/date";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "../../lib/utils.js";
import { Input } from "./primitives-form.js";
import { Popover, PopoverAnchor, PopoverContent } from "./primitives-overlay.js";
import { dsLayer } from "../theme/tokens.js";

function dateValue(value: string | undefined): CalendarDate | null {
  if (value === undefined || value === "") return null;
  try { return parseDate(value); } catch { return null; }
}

function textDateValue(value: string): CalendarDate | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u.exec(value);
  if (match === null) return null;
  const [, month, day, year] = match;
  return dateValue(`${year}-${month?.padStart(2, "0")}-${day?.padStart(2, "0")}`);
}

export function Calendar({ label, value, onChange, minValue, maxValue, autoFocus }: {
  label: string; value?: CalendarDate | null; onChange?: (date: CalendarDate) => void;
  minValue?: CalendarDate; maxValue?: CalendarDate; autoFocus?: boolean;
}) {
  return <HeroCalendar aria-label={label} className="ds-calendar" {...(autoFocus !== undefined ? { autoFocus } : {})}
    {...(value !== undefined ? { value } : {})} {...(onChange ? { onChange } : {})}
    {...(minValue ? { minValue } : {})} {...(maxValue ? { maxValue } : {})}>
    <HeroCalendar.Header>
      <HeroCalendar.YearPickerTrigger>
        <HeroCalendar.YearPickerTriggerHeading />
        <HeroCalendar.YearPickerTriggerIndicator />
      </HeroCalendar.YearPickerTrigger>
      <HeroCalendar.NavButton slot="previous" aria-label="Previous month" />
      <HeroCalendar.NavButton slot="next" aria-label="Next month" />
    </HeroCalendar.Header>
    <HeroCalendar.Grid>
      <HeroCalendar.GridHeader>{day => <HeroCalendar.HeaderCell>{day}</HeroCalendar.HeaderCell>}</HeroCalendar.GridHeader>
      <HeroCalendar.GridBody>{date => <HeroCalendar.Cell date={date} />}</HeroCalendar.GridBody>
    </HeroCalendar.Grid>
    <HeroCalendar.YearPickerGrid>
      <HeroCalendar.YearPickerGridBody>{({ year }) => <HeroCalendar.YearPickerCell year={year} />}</HeroCalendar.YearPickerGridBody>
    </HeroCalendar.YearPickerGrid>
  </HeroCalendar>;
}

/** HeroUI owns the fields and calendar; Radix preserves focus inside existing dialogs. */
export function DateInput({ name, label, value, onChange, min, max, inline = false, className, textEntry = false, textDateFormat = "MM/DD/YYYY", valueFormat = textEntry ? "us" : "iso", disabled = false, required = false, onOpenChange, hideLabel = false, triggerLabel, footer }: {
  name?: string; label: string; value: string; onChange: (value: string) => void; min?: string; max?: string;
  inline?: boolean; className?: string; textEntry?: boolean; textDateFormat?: "M/D/YYYY" | "MM/DD/YYYY"; valueFormat?: "iso" | "us";
  disabled?: boolean; required?: boolean; onOpenChange?: (open: boolean) => void;
  hideLabel?: boolean; triggerLabel?: string; footer?: ReactNode | ((choose: (value: string) => void) => ReactNode);
}) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  const calendarTrigger = useRef<HTMLButtonElement | null>(null);
  const focusFrame = useRef<number | undefined>(undefined);
  const id = useId();
  useEffect(() => () => { if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current); }, []);
  const selected = valueFormat === "us" ? textDateValue(value) : dateValue(value);
  const pickerLabel = triggerLabel ?? `Choose ${label.toLowerCase()}${textEntry || /date$/iu.test(label) ? "" : " date"}`;
  const setOpen = (open: boolean) => {
    if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current);
    if (!open) focusFrame.current = requestAnimationFrame(() => calendarTrigger.current?.focus({ preventScroll: true }));
    setCalendarOpen(open); onOpenChange?.(open);
  };
  const setDate = (date: CalendarDate | null) => {
    onChange(date === null ? "" : valueFormat === "us" ? `${textDateFormat === "MM/DD/YYYY" ? String(date.month).padStart(2, "0") : String(date.month)}/${textDateFormat === "MM/DD/YYYY" ? String(date.day).padStart(2, "0") : String(date.day)}/${String(date.year)}` : date.toString());
    if (calendarOpen) setOpen(false);
  };
  return <I18nProvider locale="en-US"><Popover open={calendarOpen} onOpenChange={setOpen}><PopoverAnchor asChild><HeroDatePicker isOpen={calendarOpen} onOpenChange={setOpen}
    shouldForceLeadingZeros name={textEntry ? undefined : name} value={selected} onChange={setDate} minValue={dateValue(min) ?? undefined} maxValue={dateValue(max) ?? undefined}
    isInvalid={(value !== "" && selected === null) || undefined} isDisabled={disabled} isRequired={required}
    className={cn("ds-date-picker min-w-0", inline && "ds-date-picker--inline", textEntry && "ds-date-picker--text", className)}>
    <Label className={cn("ds-date-label", (textEntry || hideLabel) && "sr-only")}>{label}</Label>
    <DateField.Group fullWidth className={textEntry ? "ds-date-text-group" : undefined}>
      {textEntry ? <Input name={name} autoComplete="off" type="text" inputMode="numeric" placeholder={textDateFormat} aria-label={label} required={required} disabled={disabled} value={value} onChange={event => onChange(event.target.value)} className="ds-date-text-input" /> : <DateField.Input>{segment => <DateField.Segment segment={segment} />}</DateField.Input>}
      <DateField.Suffix><HeroDatePicker.Trigger ref={calendarTrigger} aria-label={pickerLabel} aria-controls={calendarOpen ? id : undefined}><HeroDatePicker.TriggerIndicator /></HeroDatePicker.Trigger></DateField.Suffix>
    </DateField.Group>
    </HeroDatePicker></PopoverAnchor>
    <PopoverContent id={id} title={pickerLabel} hideTitle hideClose align={hideLabel ? "end" : "start"} className={cn("date-picker__popover ds-calendar-popover !w-auto !max-w-[calc(100vw-24px)] [&>div]:p-0", dsLayer.modal)}>
      <Calendar label={pickerLabel} value={selected} onChange={setDate} minValue={dateValue(min) ?? undefined} maxValue={dateValue(max) ?? undefined} autoFocus />
      {typeof footer === "function" ? footer(next => setDate(dateValue(next))) : footer}
    </PopoverContent>
  </Popover></I18nProvider>;
}

/** Every range uses the documented two-month RangeCalendar composition. */
export function RangeCalendar({ label, value, onChange, focusedValue, minValue, maxValue, disabled }: {
  label: string; value: { start: CalendarDate; end: CalendarDate } | null;
  onChange: (value: { start: CalendarDate; end: CalendarDate }) => void;
  focusedValue?: CalendarDate; minValue?: CalendarDate; maxValue?: CalendarDate; disabled?: boolean;
}) {
  return <HeroRangeCalendar aria-label={label} className="ds-calendar ds-range-calendar"
    autoFocus
    visibleDuration={{ months: 2 }} pageBehavior="single" value={value} onChange={onChange}
    defaultFocusedValue={focusedValue} minValue={minValue} maxValue={maxValue} isDisabled={disabled}>
    <div className="mx-auto flex w-max gap-8">{[0, 1].map(offset => <div className="w-64" key={offset}>
      <HeroRangeCalendar.Header>
        {offset === 0 ? <HeroRangeCalendar.NavButton slot="previous" aria-label="Previous month" /> : <div className="size-6" aria-hidden />}
        <HeroRangeCalendar.Heading className="flex-none" offset={{ months: offset }} />
        {offset === 1 ? <HeroRangeCalendar.NavButton slot="next" aria-label="Next month" /> : <div className="size-6" aria-hidden />}
      </HeroRangeCalendar.Header>
      <HeroRangeCalendar.Grid offset={{ months: offset }}>
        <HeroRangeCalendar.GridHeader>{day => <HeroRangeCalendar.HeaderCell>{day}</HeroRangeCalendar.HeaderCell>}</HeroRangeCalendar.GridHeader>
        <HeroRangeCalendar.GridBody>{date => <HeroRangeCalendar.Cell date={date} />}</HeroRangeCalendar.GridBody>
      </HeroRangeCalendar.Grid>
    </div>)}</div>
  </HeroRangeCalendar>;
}

export function DateRangeInput({ label, value, onChange, onEdit, fromLabel = "Start", toLabel = "End", variant = "field", className, min, max, disabled = false, groupLabel, hideEndpointLabels = false }: {
  label: string; value: { from: string; to: string }; onChange: (value: { from: string; to: string }) => void;
  /** Reports a direct endpoint edit even when its draft cannot yet be applied. */
  onEdit?: () => void;
  fromLabel?: string; toLabel?: string; variant?: "field" | "toolbar"; className?: string;
  min?: string; max?: string; disabled?: boolean; groupLabel?: string; hideEndpointLabels?: boolean;
}) {
  const [open, setOpen] = useState<"from" | "to" | null>(null);
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft({ from: value.from, to: value.to }); }, [value.from, value.to]);
  const opener = useRef<HTMLElement | null>(null);
  const focusFrame = useRef<number | undefined>(undefined);
  const id = useId();
  useEffect(() => () => { if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current); }, []);
  const changeOpen = (next: "from" | "to" | null) => {
    if (focusFrame.current !== undefined) cancelAnimationFrame(focusFrame.current);
    if (!next) focusFrame.current = requestAnimationFrame(() => opener.current?.focus({ preventScroll: true }));
    setOpen(next);
  };
  const from = dateValue(draft.from), to = dateValue(draft.to);
  const minimum = dateValue(min), maximum = dateValue(max);
  const invalid = (from !== null && to !== null && from.compare(to) > 0) || [from, to].some(date => date !== null && ((minimum !== null && date.compare(minimum) < 0) || (maximum !== null && date.compare(maximum) > 0)));
  const changeEndpoint = (key: "from" | "to", date: CalendarDate | null) => {
    onEdit?.();
    const next = { ...draft, [key]: date?.toString() ?? "" };
    setDraft(next);
    const start = dateValue(next.from), end = dateValue(next.to);
    if (variant === "toolbar" && (!start || !end)) return;
    if (start && end && start.compare(end) > 0) return;
    if ([start, end].some(day => day !== null && ((minimum !== null && day.compare(minimum) < 0) || (maximum !== null && day.compare(maximum) > 0)))) return;
    onChange(next);
  };
  const selected = from && to && from.compare(to) <= 0 ? { start: from, end: to } : null;
  return <I18nProvider locale="en-US"><Popover open={open !== null} onOpenChange={next => { if (!next) changeOpen(null); }}><PopoverAnchor asChild><div role="group" aria-label={groupLabel ?? label} className={cn("ds-date-range flex min-w-0 items-end gap-2", className)}>
      {([ ["from", fromLabel, from], ["to", toLabel, to] ] as const).map(([key, endpointLabel, endpoint]) => {
        return <HeroDatePicker key={key} className={cn("ds-date-picker min-w-0 flex-1", variant === "toolbar" && "ds-date-picker--toolbar")} isOpen={open === key} onOpenChange={next => {
          if (next && document.activeElement instanceof HTMLElement) opener.current = document.activeElement;
          changeOpen(next ? key : null);
        }}
          shouldForceLeadingZeros value={endpoint} isDisabled={disabled} isRequired={variant === "toolbar"} isInvalid={invalid || (draft[key] !== "" && endpoint === null) || undefined}
          minValue={key === "to" ? from ?? minimum ?? undefined : minimum ?? undefined} maxValue={key === "from" ? to ?? maximum ?? undefined : maximum ?? undefined}
          onChange={date => changeEndpoint(key, date)}>
          <Label className={cn("ds-date-label", variant === "toolbar" && "sr-only")}>{endpointLabel}</Label>
          <DateField.Group fullWidth>
            {variant === "toolbar" && !hideEndpointLabels && <DateField.Prefix><span className="text-ui-muted">{endpointLabel}</span></DateField.Prefix>}
            <DateField.Input>{segment => <DateField.Segment segment={segment} />}</DateField.Input>
            <DateField.Suffix><HeroDatePicker.Trigger aria-label={`Choose ${endpointLabel.toLowerCase()} date range`} aria-controls={open !== null ? id : undefined}
              onClick={event => { if (event.currentTarget instanceof HTMLButtonElement) opener.current = event.currentTarget; }}><HeroDatePicker.TriggerIndicator /></HeroDatePicker.Trigger></DateField.Suffix>
          </DateField.Group>
        </HeroDatePicker>;
      })}
    </div></PopoverAnchor>
    <PopoverContent id={id} title={label} hideTitle hideClose align="center" className={cn("date-picker__popover ds-calendar-popover !w-auto !max-w-[calc(100vw-24px)] [&>div]:p-0", dsLayer.modal)}>
      <RangeCalendar label={label} value={selected} focusedValue={from ?? to ?? undefined} minValue={dateValue(min) ?? undefined} maxValue={dateValue(max) ?? undefined} disabled={disabled}
        onChange={dates => { const next = { from: dates.start.toString(), to: dates.end.toString() }; setDraft(next); onChange(next); changeOpen(null); }} />
    </PopoverContent>
  </Popover></I18nProvider>;
}
