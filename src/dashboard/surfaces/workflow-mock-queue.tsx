import { Badge, Button, dsFocus } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { LogPanel } from "./log-panel.js";
import { mockNeedsReview, mockRunLog, mockRunStatus, type MockRun } from "./workflow-mock-model.js";

export function WorkflowMockQueue({ label, runs, selected, onSelect }: {
  label: string; runs: readonly MockRun[]; selected?: string; onSelect: (id: string) => void;
}) {
  return <section aria-label={`${label} queue`} className="min-h-0 flex-1 overflow-y-auto bg-ui-panel p-3">
    <header className="mb-3 flex items-center justify-between gap-2"><h2 className="m-0 text-section font-medium">{label}</h2><Badge tone="neutral">Preview</Badge></header>
    <ul className="m-0 flex list-none flex-col gap-2 p-0">{runs.map(run => <li key={run.id}><button type="button"
      onClick={() => onSelect(run.id)} aria-pressed={selected === run.id}
      className={cn("flex w-full items-start justify-between gap-3 rounded-xl border border-ui-stroke bg-ui-table p-3 text-left hover:border-ui-stroke-control", dsFocus, selected === run.id && "border-ui-info")}>
      <span className="min-w-0"><span className="block truncate text-body font-medium">{run.subject}</span><span className="mt-1 block text-caption text-ui-muted">{run.sourceId ? "Rerun" : run.parentId ? "Oath Upload signer" : "Fictional run"}</span></span><span className={cn("shrink-0 text-caption", mockNeedsReview(run) ? "text-ui-warning" : "text-ui-positive")}>{mockRunStatus(run)}</span>
    </button></li>)}</ul>
    {runs.length === 0 && <p className="text-body text-ui-muted">No runs match this filter.</p>}
  </section>;
}

export function WorkflowMockLog({ run, onRerun, onApprove }: { run: MockRun; onRerun: () => void; onApprove: () => void }) {
  const { steps, timeline } = mockRunLog(run);
  return <LogPanel title={run.title} steps={steps} timeline={timeline} status={<Badge tone="neutral">Preview · {mockRunStatus(run)}</Badge>} toolbar={<span className="flex gap-2">
    {mockNeedsReview(run) && run.workflowId !== "ocr" && <Button size="sm" variant="primary" onClick={onApprove}>Approve records</Button>}
    {run.workflowId !== "i9-lookup" && <Button size="sm" onClick={onRerun}>Rerun</Button>}
  </span>} />;
}
