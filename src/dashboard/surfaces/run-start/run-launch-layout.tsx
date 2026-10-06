import type { ReactNode } from "react";
import { SegmentedChoice } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";

export function RunOptionsLayout({ flags, children, priority, onPriorityChange, browserMode, onBrowserModeChange, fixedFacts }: {
  flags: ReactNode; children?: ReactNode; priority: "interactive" | "bulk";
  onPriorityChange: (value: "interactive" | "bulk") => void;
  browserMode: "headed" | "headless"; onBrowserModeChange: (value: "headed" | "headless") => void;
  fixedFacts?: ReactNode;
}) {
  return <section aria-label="Options" className="launch-options flex flex-col">
    <div className="launch-flags">{flags}</div>
    {children}
    <div className="launch-options-grid">
      <div><SegmentedChoice label="Priority" value={priority} onChange={onPriorityChange} options={[{ value: "interactive", label: "Interactive" }, { value: "bulk", label: "Bulk" }]} /><p className="mt-[5px] text-caption text-ui-muted">Interactive: work you’re waiting on. Bulk: background batches; interactive runs take priority.</p></div>
      <div><SegmentedChoice label="Browser mode" value={browserMode} onChange={onBrowserModeChange} options={[{ value: "headed", label: "Headed" }, { value: "headless", label: "Headless" }]} /><p className="mt-[5px] text-caption text-ui-muted">{browserMode === "headed" ? "Open visible browser windows." : "Run browsers in the background."}</p></div>
    </div>
    {fixedFacts && <div className="launch-fixed-facts">{fixedFacts}</div>}
  </section>;
}

export function RunStepsList({ children }: { children: ReactNode }) {
  return <ul className="m-0 list-none overflow-hidden rounded-[var(--ds-radius-lg)] border border-[color:var(--ds-border)] divide-y divide-[color:var(--ds-border)] p-0">{children}</ul>;
}

export function RunConfirmLayout({ count, flags, description, facts, children }: {
  count: number; flags?: ReactNode; description: string;
  facts: readonly { key: string; value: string }[]; children?: ReactNode;
}) {
  return <section aria-label="Confirm" className="flex flex-col gap-[var(--ds-space-cozy)]">
    <div className="rounded-[7px] border border-ui-stroke bg-ui-table p-[14px]">
      <div className="flex items-center justify-between gap-3"><h4 id="run-start-confirm" className="text-body font-semibold">{count} {count === 1 ? "run" : "runs"} ready to queue</h4>{flags}</div>
      <p className="mt-[6px] text-body text-ui-secondary">{description}</p>
    </div>
    <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-5 gap-y-[11px] text-body">
      {facts.map(({ key, value }) => <div key={key} className="contents"><dt className="text-ui-muted">{key}</dt><dd className={cn("min-w-0 break-words", (key === "Input" || key === "Source") && "font-mono")}>{value}</dd></div>)}
    </dl>
    {children}
  </section>;
}
