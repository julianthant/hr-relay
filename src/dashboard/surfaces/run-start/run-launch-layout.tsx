import type { ReactNode } from "react";
import { SegmentedChoice, Switch } from "../../ds/ui.js";
import { RunList, RunListRow } from "../../ds/primitives/run-list.js";

export function RunOptionsLayout({ flags, priority, onPriorityChange, browserMode, onBrowserModeChange }: {
  flags: ReactNode; priority: "interactive" | "bulk";
  onPriorityChange: (value: "interactive" | "bulk") => void;
  browserMode: "headed" | "headless"; onBrowserModeChange: (value: "headed" | "headless") => void;
}) {
  return <RunList title="Run">
    {flags}
    <RunListRow title="Priority" description="Runs before bulk batches."><Switch hideLabel label="Priority" checked={priority === "interactive"} onCheckedChange={value => onPriorityChange(value ? "interactive" : "bulk")} className="!min-h-0 !w-auto !py-0" /></RunListRow>
    <RunListRow title="Browser" description="Hidden runs in the background."><div className="w-[var(--ds-w-body-control)]"><SegmentedChoice hideLabel label="Browser mode" value={browserMode} onChange={onBrowserModeChange} options={[{ value: "headed", label: "Visible" }, { value: "headless", label: "Hidden" }]} /></div></RunListRow>
  </RunList>;
}
