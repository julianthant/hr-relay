import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../lib/utils.js";
import { dsText } from "./tokens.js";
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
      <DropdownMenuTrigger asChild><Button id={id} disabled={disabled} aria-label={`${selected.label} ${label}`} className="w-full justify-between">
        <span className="min-w-0 flex-1 truncate text-left">{selected.label}</span><ChevronDown aria-hidden data-icon="inline-end" />
      </Button></DropdownMenuTrigger>
      <DropdownMenuContent aria-label={label} className="w-[var(--radix-dropdown-menu-trigger-width)]">
        <DropdownMenuGroup><DropdownMenuRadioGroup value={value} onValueChange={next => { onChange(next); setOpen(false); }}>
          {options.map(option => <DropdownMenuRadioItem key={option.value} value={option.value} aria-label={option.label} aria-description={option.description}>
            <span className="flex min-w-0 flex-col gap-0.5"><span>{option.label}</span>{option.description && <span className="text-caption text-ui-muted">{option.description}</span>}</span>
          </DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup></DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>;
}

/** Compact mutually exclusive options; arrow keys follow the selected radio. */
export function SegmentedChoice<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void;
}) {
  const name = useId();
  return <fieldset className="min-w-0"><legend className={cn(dsText.meta, "mb-[var(--ds-space-tight)] font-medium text-[color:var(--ds-fg-secondary)]")}>{label}</legend>
    <div className="flex rounded-[var(--ds-radius-md)] border border-[color:var(--ds-control-border)] bg-ui-canvas p-[3px]">
      {options.map(option => <label key={option.value} className="relative min-w-0 flex-1 cursor-pointer">
        <input type="radio" name={`${label}-${name}`} value={option.value} checked={option.value === value} onChange={() => onChange(option.value)} className="peer sr-only" />
        <span className={cn("block rounded-[var(--ds-radius-sm)] px-[var(--ds-space-base)] py-[5px] text-center text-[color:var(--ds-fg-muted)] peer-checked:bg-ui-hover peer-checked:font-semibold peer-checked:text-[color:var(--ds-fg)] peer-focus-visible:outline-2 peer-focus-visible:outline-[color:var(--ds-accent)]", dsText.body)}>{option.label}</span>
      </label>)}
    </div>
  </fieldset>;
}
