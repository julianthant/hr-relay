import { Calendar as HeroCalendar, DateField, DatePicker, Label } from "@heroui/react";
import { parseDate, type CalendarDate } from "@internationalized/date";
import { useState } from "react";
import { cn } from "../lib/utils.js";
import { Input } from "./primitives-form.js";
import { dsElev, dsFocus, dsFocusWithin, dsLayer, dsText } from "./tokens.js";

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
export function DateInput({ label, value, onChange, min, max, inline = false, className, textEntry = false, disabled = false, required = false, onOpenChange }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  inline?: boolean;
  className?: string;
  /** Keep an M/D/YYYY text draft intact while offering the shared calendar. */
  textEntry?: boolean;
  disabled?: boolean;
  required?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  const selected = textEntry ? textDateValue(value) : dateValue(value);
  return (
    <DatePicker
      onOpenChange={open => { if (!open) setYearPickerOpen(false); onOpenChange?.(open); }}
      value={selected}
      onChange={date => onChange(date === null ? "" : textEntry ? `${String(date.month)}/${String(date.day)}/${String(date.year)}` : date.toString())}
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
        {textEntry && <Input type="text" inputMode="numeric" placeholder="M/D/YYYY" aria-label={label} required={required} disabled={disabled} value={value} onChange={event => onChange(event.target.value)} className="ds-date-text-input" />}
        {!textEntry && <DateField.Input className={cn(dsText.ui, "min-w-0 px-[var(--ds-space-base)]")}>
          {segment => <DateField.Segment segment={segment} />}
        </DateField.Input>}
        <DateField.Suffix>
          <DatePicker.Trigger aria-label={`Choose ${label.toLowerCase()}${textEntry ? "" : " date"}`} className={dsFocus}>
            <DatePicker.TriggerIndicator />
          </DatePicker.Trigger>
        </DateField.Suffix>
      </DateField.Group>
      <DatePicker.Popover className={cn("ds-date-popover", dsElev.mid, dsLayer.menu)}>
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
      </DatePicker.Popover>
    </DatePicker>
  );
}
