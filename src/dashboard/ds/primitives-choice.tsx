import { useId, useState } from "react";
import { ListBox } from "@heroui/react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../lib/utils.js";
import { dsFocus, dsLayer, dsRadius, dsText } from "./tokens.js";
import { Popover, PopoverContent, PopoverTrigger } from "./primitives-overlay.js";

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
    <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><button id={id} type="button" disabled={disabled} aria-label={`${selected.label} ${label}`} aria-haspopup="listbox"
      onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); } }}
      className={cn("flex h-[var(--ds-h-md)] min-h-0 w-full min-w-0 items-center justify-between gap-[var(--ds-space-base)] border border-[color:var(--ds-control-border)] bg-ui-field px-[var(--ds-space-base)] py-0 text-[color:var(--ds-fg)] disabled:opacity-50", dsText.body, dsRadius.md, dsFocus)}>
      <span className={cn("flex min-w-0 flex-1 items-center truncate", dsText.body)}>{selected.label}</span>
      <ChevronDown aria-hidden className="size-4 shrink-0 text-[color:var(--ds-fg-muted)]" />
    </button></PopoverTrigger>
    <PopoverContent title={label} hideTitle hideClose className={cn("ds-choice-popover w-[var(--radix-popover-trigger-width)] [&>div]:p-1", dsLayer.modal)}>
      <ListBox aria-label={label} autoFocus selectionMode="single" selectionBehavior="replace" disallowEmptySelection selectedKeys={[value]}
        onSelectionChange={keys => { if (keys !== "all") { const key = keys.values().next().value; if (typeof key === "string") { onChange(key); setOpen(false); } } }}
        className="max-h-64 overflow-y-auto outline-none">
        {options.map(option => <ListBox.Item id={option.value} key={option.value} textValue={option.label} aria-label={option.label} aria-description={option.description} onAction={() => { onChange(option.value); setOpen(false); }}
          className={cn("group flex min-h-0 cursor-pointer items-center gap-[var(--ds-space-base)] rounded-[var(--ds-radius-sm)] px-[var(--ds-space-base)] py-[var(--ds-space-snug)] text-[color:var(--ds-fg)] outline-none data-[focused]:bg-[var(--ds-surface-3)] data-[selected]:bg-[var(--ds-accent-quiet)]", dsText.body)}>
          <span className="min-w-0 flex-1"><span className="block">{option.label}</span>{option.description && <span className={cn(dsText.meta, "text-[color:var(--ds-fg-muted)]")}>{option.description}</span>}</span>
          <Check aria-hidden className="size-4 shrink-0 opacity-0 group-data-[selected]:opacity-100" />
        </ListBox.Item>)}
      </ListBox>
    </PopoverContent>
    </Popover>
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
