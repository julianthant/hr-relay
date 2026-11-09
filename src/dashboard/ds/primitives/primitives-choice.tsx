import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils.js";
import { dsIcon, dsText } from "../theme/tokens.js";
import { Button } from "./primitives-core.js";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "./dropdown-menu.js";

/** Shared value picker with library-owned keyboard and focus behavior. */
export function ChoicePicker({ label, value, options, onChange, disabled, hideLabel = false, className }: {
  label: string;
  value: string;
  options: readonly { value: string; label: string; description?: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
  hideLabel?: boolean;
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const selected = options.find(option => option.value === value);
  if (!selected) throw new Error("CHOICE_PICKER_VALUE_UNAVAILABLE");
  return <div className={cn("ds-choice-picker flex min-w-0 flex-col gap-[var(--ds-space-tight)]", className)}>
    <label htmlFor={id} data-slot="label" className={cn(dsText.meta, "font-medium text-[color:var(--ds-fg-secondary)]", hideLabel && "sr-only")}>{label}</label>
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild><Button id={id} disabled={disabled} aria-label={`${selected.label} ${label}`} className="ds-menu-trigger w-full justify-between">
        <span className="min-w-0 flex-1 truncate text-left">{selected.label}</span><ChevronDown aria-hidden data-icon="inline-end" className={cn(dsIcon.md, "shrink-0")} />
      </Button></DropdownMenuTrigger>
      <DropdownMenuContent aria-label={label} className="w-[var(--anchor-width)]">
        <DropdownMenuGroup><DropdownMenuRadioGroup value={value} onValueChange={next => { onChange(next); setOpen(false); }}>
          {options.map(option => <DropdownMenuRadioItem key={option.value} value={option.value} aria-label={option.label} aria-description={option.description}>
            <span className="flex min-w-0 flex-col gap-0.5"><span>{option.label}</span>{option.description && <span className="text-caption text-ui-muted">{option.description}</span>}</span>
          </DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup></DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}

/** Compact two-way switch: a soft grey pill with one raised thumb that slides to the selected side (no slide under reduced motion). Arrow keys follow the selected radio. `hideLabel` keeps the legend for screen readers when a Field names it. */
export function SegmentedChoice<T extends string>({ label, value, options, onChange, hideLabel = false }: {
  label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void; hideLabel?: boolean;
}) {
  const name = useId();
  const selected = options.findIndex(option => option.value === value);
  return <fieldset className="min-w-0"><legend className={cn(dsText.meta, "mb-[var(--ds-space-tight)] font-medium text-[color:var(--ds-fg-secondary)]", hideLabel && "sr-only")}>{label}</legend>
    <div className="ds-segment relative flex h-[var(--ds-h-md)] rounded-full border border-[color:var(--ds-border-subtle)] bg-[var(--ds-segment-track)] p-[2px]">
      {selected >= 0 && <span aria-hidden className="pointer-events-none absolute inset-y-[2px] left-[2px] rounded-full bg-[var(--ds-segment-thumb)] shadow-[0_1px_2px_rgb(0_0_0/0.14)] transition-transform duration-[180ms] ease-out motion-reduce:transition-none"
        style={{ width: `calc((100% - 4px) / ${options.length})`, transform: `translateX(${selected * 100}%)` }} />}
      {options.map(option => <label key={option.value} className="relative z-10 min-w-0 flex-1 cursor-pointer">
        <input type="radio" name={`${label}-${name}`} value={option.value} checked={option.value === value} onChange={() => onChange(option.value)} className="peer sr-only" />
        <span className="flex h-full items-center justify-center rounded-full px-4 text-center text-[13px] leading-none text-[color:var(--ds-fg-secondary)] transition-colors duration-[180ms] ease-out peer-checked:text-[color:var(--ds-fg)] peer-focus-visible:outline-2 peer-focus-visible:outline-[color:var(--ds-accent)] motion-reduce:transition-none">{option.label}</span>
      </label>)}
    </div>
  </fieldset>;
}
