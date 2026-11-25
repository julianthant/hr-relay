import type { ReactNode } from "react";
import { SegmentedChoice, Switch, dsFg, dsText } from "../../ds/ui.js";
import { RunList, RunListRow } from "../../ds/primitives/run-list.js";
import { cn } from "../../lib/utils.js";

/** A row's choice. While a start is out it draws the chosen value as plain text: the pill has no switched-off look. */
export function RunChoice<T extends string>({ locked, label, value, options, onChange }: {
  locked: boolean; label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void;
}) {
  return <div className="flex w-[var(--ds-w-body-control)] justify-end">{locked
    ? <span data-run-choice={label} className={cn("flex h-[var(--ds-h-md)] items-center justify-end", dsText.body, dsFg.base)}>{options.find(option => option.value === value)?.label}</span>
    : <SegmentedChoice hideLabel label={label} value={value} onChange={onChange} options={options} />}</div>;
}

export function RunOptionsLayout({ flags, locked = false, priority, onPriorityChange, browserMode, onBrowserModeChange }: {
  flags: ReactNode; locked?: boolean; priority: "interactive" | "bulk";
  onPriorityChange: (value: "interactive" | "bulk") => void;
  browserMode: "headed" | "headless"; onBrowserModeChange: (value: "headed" | "headless") => void;
}) {
  return <RunList title="Options">
    {flags}
    <RunListRow title="Priority" description="Runs before bulk batches."><Switch hideLabel disabled={locked} label="Priority" checked={priority === "interactive"} onCheckedChange={value => onPriorityChange(value ? "interactive" : "bulk")} className="!min-h-0 !w-auto !py-0" /></RunListRow>
    <RunListRow title="Browser" description="Hidden runs in the background."><RunChoice locked={locked} label="Browser mode" value={browserMode} onChange={onBrowserModeChange} options={[{ value: "headed", label: "Visible" }, { value: "headless", label: "Hidden" }]} /></RunListRow>
  </RunList>;
}
