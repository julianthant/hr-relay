import { Calendar as HeroCalendar, DateField, DatePicker, Label } from "@heroui/react";
import { parseDate, type CalendarDate } from "@internationalized/date";
import { useState } from "react";
import { cn } from "../lib/utils.js";
import { Input } from "./primitives-form.js";
import { Popover, PopoverContent, PopoverTrigger } from "./primitives-overlay.js";
import { dsFocus, dsFocusWithin, dsLayer, dsText } from "./tokens.js";

function dateValue(value: string | undefined): CalendarDate | null {
  if (value === undefined || value === "") return null;
  try {
    return parseDate(value);
  } catch {
    return null;
  }
}

function textDateValue(value: string): CalendarDate | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u.exec(value);
  if (match === null) return null;
  const [, month, day, year] = match;
  return dateValue(`${year}-${month?.padStart(2, "0")}-${day?.padStart(2, "0")}`);
}

/** The calendar used by every ordinary date field in the dashboard. */
export function DateInput({ label, value, onChange, min, max, inline = false, className, textEntry = false, textDateFormat = "M/D/YYYY", disabled = false, required = false, onOpenChange }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  inline?: boolean;
  className?: string;
  /** Keep the text draft intact while offering the shared calendar. */
  textEntry?: boolean;
  textDateFormat?: "M/D/YYYY" | "MM/DD/YYYY";
  disabled?: boolean;
  required?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const selected = textEntry ? textDateValue(value) : dateValue(value);
  const setOpen = (open: boolean) => { setCalendarOpen(open); if (!open) setYearPickerOpen(false); onOpenChange?.(open); };
  const setDate = (date: CalendarDate | null) => {
    onChange(date === null ? "" : textEntry ? `${textDateFormat === "MM/DD/YYYY" ? String(date.month).padStart(2, "0") : String(date.month)}/${textDateFormat === "MM/DD/YYYY" ? String(date.day).padStart(2, "0") : String(date.day)}/${String(date.year)}` : date.toString());
    if (calendarOpen) setOpen(false);
  };
  return (
    <Popover open={calendarOpen} onOpenChange={setOpen}>
    <DatePicker
      isOpen={calendarOpen}
      onOpenChange={setOpen}
      value={selected}
      onChange={setDate}
      minValue={dateValue(min) ?? undefined}
      maxValue={dateValue(max) ?? undefined}
      isInvalid={value !== "" && selected === null}
      isDisabled={disabled}
      isRequired={required}
      className={cn("ds-date-picker min-w-0", inline && "ds-date-picker--inline", textEntry && "ds-date-picker--text", className)}
    >
      <Label className={cn("ds-date-label", dsText.meta, "whitespace-nowrap font-medium text-[color:var(--ds-fg-secondary)]", textEntry && "sr-only")}>{label}</Label>
      <DateField.Group className={cn(
        "h-[var(--ds-h-md)] min-w-0 rounded-[var(--ds-radius-md)] border",
        "border-[color:var(--ds-control-border)] bg-[var(--ds-surface-2)] text-[color:var(--ds-fg)]",
        "hover:border-[color:var(--ds-border-loud)]",
        dsFocus,
        textEntry && dsFocusWithin,
        textEntry && "ds-date-text-group",
      )}>
        {textEntry && <Input type="text" inputMode="numeric" placeholder={textDateFormat} aria-label={label} required={required} disabled={disabled} value={value} onChange={event => onChange(event.target.value)} className="ds-date-text-input" />}
        {!textEntry && <DateField.Input className={cn(dsText.ui, "min-w-0 px-[var(--ds-space-base)]")}>
          {segment => <DateField.Segment segment={segment} />}
        </DateField.Input>}
        <DateField.Suffix>
          <PopoverTrigger asChild>
          <DatePicker.Trigger aria-label={`Choose ${label.toLowerCase()}${textEntry ? "" : " date"}`} className={dsFocus}>
            <DatePicker.TriggerIndicator />
          </DatePicker.Trigger>
          </PopoverTrigger>
        </DateField.Suffix>
      </DateField.Group>
      <PopoverContent title={`Choose ${label.toLowerCase()}${textEntry ? "" : " date"}`} hideTitle hideClose className={cn("ds-date-popover w-auto [&>div]:p-0", dsLayer.modal)}>
        <HeroCalendar aria-label={`Choose ${label.toLowerCase()}${textEntry ? "" : " date"}`} className="ds-hero-calendar" isYearPickerOpen={yearPickerOpen} onYearPickerOpenChange={setYearPickerOpen}>
          <HeroCalendar.Header>
            <HeroCalendar.NavButton className="text-foreground" slot="previous" />
            <HeroCalendar.YearPickerTrigger className="w-full justify-center">
              <HeroCalendar.YearPickerTriggerHeading className="text-foreground" />
              <HeroCalendar.YearPickerTriggerIndicator className="text-foreground" />
            </HeroCalendar.YearPickerTrigger>
            <HeroCalendar.NavButton className="text-foreground" slot="next" />
          </HeroCalendar.Header>
          <HeroCalendar.Grid>
            <HeroCalendar.GridHeader>
              {day => <HeroCalendar.HeaderCell>{day}</HeroCalendar.HeaderCell>}
            </HeroCalendar.GridHeader>
            <HeroCalendar.GridBody>
              {date => <HeroCalendar.Cell date={date} />}
            </HeroCalendar.GridBody>
          </HeroCalendar.Grid>
          {yearPickerOpen && <HeroCalendar.YearPickerGrid>
            <HeroCalendar.YearPickerGridBody>
              {({ year }) => <HeroCalendar.YearPickerCell year={year} />}
            </HeroCalendar.YearPickerGridBody>
          </HeroCalendar.YearPickerGrid>}
        </HeroCalendar>
      </PopoverContent>
    </DatePicker>
    </Popover>
  );
}
