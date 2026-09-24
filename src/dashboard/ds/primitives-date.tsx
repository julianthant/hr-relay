import { Calendar as HeroCalendar, DateField, DatePicker, Label } from "@heroui/react";
import { parseDate, type CalendarDate } from "@internationalized/date";
import { cn } from "../lib/utils.js";
import { dsElev, dsFocus, dsLayer, dsText } from "./tokens.js";

function dateValue(value: string | undefined): CalendarDate | null {
  if (value === undefined || value === "") return null;
  try {
    return parseDate(value);
  } catch {
    return null;
  }
}

/** The calendar used by every ordinary date field in the dashboard. */
export function DateInput({ label, value, onChange, min, max, inline = false, className }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  inline?: boolean;
  className?: string;
}) {
  return (
    <DatePicker
      value={dateValue(value)}
      onChange={date => onChange(date?.toString() ?? "")}
      minValue={dateValue(min) ?? undefined}
      maxValue={dateValue(max) ?? undefined}
      isInvalid={value !== "" && dateValue(value) === null}
      className={cn("ds-date-picker min-w-0", inline && "ds-date-picker--inline", className)}
    >
      <Label className={cn(dsText.meta, "whitespace-nowrap font-medium text-[color:var(--ds-fg-secondary)]")}>{label}</Label>
      <DateField.Group className={cn(
        "h-[var(--ds-h-md)] min-w-0 rounded-[var(--ds-radius-md)] border",
        "border-[color:var(--ds-control-border)] bg-[var(--ds-surface-2)] text-[color:var(--ds-fg)]",
        "hover:border-[color:var(--ds-border-loud)]",
        dsFocus,
      )}>
        <DateField.Input className={cn(dsText.ui, "min-w-0 px-[var(--ds-space-base)]")}>
          {segment => <DateField.Segment segment={segment} />}
        </DateField.Input>
        <DateField.Suffix>
          <DatePicker.Trigger aria-label={`Choose ${label.toLowerCase()} date`} className={dsFocus}>
            <DatePicker.TriggerIndicator />
          </DatePicker.Trigger>
        </DateField.Suffix>
      </DateField.Group>
      <DatePicker.Popover className={cn("ds-date-popover", dsElev.mid, dsLayer.menu)}>
        <HeroCalendar aria-label={`Choose ${label.toLowerCase()} date`} className="ds-hero-calendar">
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
          <HeroCalendar.YearPickerGrid>
            <HeroCalendar.YearPickerGridBody>
              {({ year }) => <HeroCalendar.YearPickerCell year={year} />}
            </HeroCalendar.YearPickerGridBody>
          </HeroCalendar.YearPickerGrid>
        </HeroCalendar>
      </DatePicker.Popover>
    </DatePicker>
  );
}
