import { useState } from "react";
import { ArrowUpRight, FileText, UserRound } from "lucide-react";
import { Badge, Button, dsFocus, Tab, TabList, TabPanel, Tabs } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { LogPanel } from "./log-panel.js";
import { LogFeed } from "./log-feed.js";
import { LogTimeline } from "./logs/log-timeline.js";
import { mockNeedsReview, mockRunLog, mockRunStatus, type MockRun } from "./workflow-mock-model.js";
import { reviewCanApprove, reviewRecords, type ReviewRecord } from "./workflow-review-model.js";
import { WorkflowMockReview } from "./workflow-review.js";

export function WorkflowMockQueue({ label, runs, selected, onSelect }: {
  label: string; runs: readonly MockRun[]; selected?: string; onSelect: (id: string) => void;
}) {
  const roots = runs.filter(run => !run.parentId || !runs.some(parent => parent.id === run.parentId));
  const row = (run: MockRun) => <button type="button" onClick={() => onSelect(run.id)} aria-pressed={selected === run.id}
    className={cn("flex w-full items-start gap-3 rounded-lg p-3 text-left hover:bg-ui-hover", dsFocus, selected === run.id && "bg-ui-selected")}>
    {run.role === "preparation" ? <FileText aria-hidden className="mt-0.5 size-4 shrink-0 text-ui-muted" /> : <UserRound aria-hidden className="mt-0.5 size-4 shrink-0 text-ui-muted" />}
    <span className="min-w-0 flex-1"><span className="block truncate text-body font-medium">{run.subject}</span><span className="mt-1 block text-caption text-ui-muted">{run.sourceId ? "Rerun" : run.parentId ? run.parentWorkflowId === "oath-upload" ? "Oath Upload signer" : "Linked person run" : run.role === "preparation" ? "PDF preparation" : "Fictional run"}</span></span>
    <span className={cn("shrink-0 text-caption", run.discarded ? "text-ui-muted" : mockNeedsReview(run) ? "text-ui-warning" : "text-ui-positive")}>{mockRunStatus(run)}</span>
  </button>;
  return <section aria-label={`${label} queue`} className="min-h-0 flex-1 overflow-y-auto bg-ui-panel p-3">
    <header className="mb-3 flex items-center justify-between gap-2"><h2 className="m-0 text-section font-medium">{label}</h2><Badge tone="neutral">Preview</Badge></header>
    <ul className="m-0 flex list-none flex-col gap-2 p-0">{roots.map(run => <li key={run.id} className="overflow-hidden rounded-lg border border-ui-stroke bg-ui-table">
      {row(run)}{runs.filter(child => child.parentId === run.id).map(child => <div key={child.id} className="border-t border-ui-stroke pl-4">{row(child)}</div>)}
    </li>)}</ul>{runs.length === 0 && <p className="text-body text-ui-muted">No runs match this filter.</p>}
  </section>;
}

export function WorkflowMockLog({ run, runs, onRerun, onApprove, onChange, onDiscard, onSelect }: {
  run: MockRun; runs: readonly MockRun[]; onRerun: () => void; onApprove: () => void;
  onChange: (records: readonly ReviewRecord[]) => void; onDiscard: () => void; onSelect: (id: string) => void;
}) {
  const [tab, setTab] = useState("logs");
  const { steps, timeline } = mockRunLog(run);
  const count = reviewRecords(run).filter(reviewCanApprove).length;
  const hasRecords = run.draft.method === "pdf" || run.role === "person";
  const linked = runs.filter(item => item.parentId === run.id || item.id === run.parentId);
  const fields = steps.flatMap(step => step.entries.flatMap(entry => entry.kind === "fields" ? entry.fields : []));
  const result = fields.filter((field, index) => fields.findIndex(item => item.label === field.label) === index);
  return <Tabs value={tab} onValueChange={setTab} className="min-h-0 flex-1">
    <LogPanel title={run.title} steps={steps} timeline={timeline} status={<Badge tone="neutral">Preview · {mockRunStatus(run)}</Badge>} toolbar={<span className="flex gap-2">
      {mockNeedsReview(run) && run.workflowId !== "ocr" && <><Button size="sm" variant="primary" disabled={count === 0} onClick={onApprove}>Approve records</Button><Button size="sm" onClick={onDiscard}>Discard</Button></>}
      {run.workflowId !== "i9-lookup" && run.role !== "person" && <Button size="sm" onClick={onRerun}>Rerun</Button>}
    </span>} navigation={<TabList label="Workflow run views"><Tab value="logs">Logs</Tab><Tab value="result">Result</Tab>{hasRecords && <Tab value="records" count={reviewRecords(run).length}>Records</Tab>}{linked.length > 0 && <Tab value="linked" count={linked.length}>Linked runs</Tab>}</TabList>}
      content={<><TabPanel value="logs" className="flex flex-col overflow-hidden"><LogFeed steps={steps} navigation={jump => <LogTimeline stages={timeline} onJump={jump} />} /></TabPanel>
        <TabPanel value="result" className="p-4"><p className="mb-4 mt-0 text-caption text-ui-muted">Fictional {run.draft.dryRun ? "rehearsal" : "result"} · no external system contacted.</p><dl className="m-0">{result.map(field => <div key={field.label} className="grid grid-cols-[minmax(9rem,1fr)_minmax(0,1fr)] gap-4 border-b border-ui-stroke py-3"><dt className="text-body text-ui-muted">{field.label}</dt><dd className="m-0 break-words text-body">{field.value}</dd></div>)}</dl></TabPanel>
        {hasRecords && <TabPanel value="records"><WorkflowMockReview run={run} onChange={onChange} /></TabPanel>}
        {linked.length > 0 && <TabPanel value="linked" className="p-4"><p className="mb-4 mt-0 text-caption text-ui-muted">{run.workflowId === "oath-upload" ? "Each signer is an independent Oath Signature run. The ticket starts only after every signer succeeds." : "Approved records have separate per-person outcomes."}</p><ul className="m-0 list-none p-0">{linked.map(item => <li key={item.id} className="border-b border-ui-stroke"><button type="button" onClick={() => onSelect(item.id)} className={cn("flex w-full items-center gap-3 py-3 text-left text-body hover:text-ui-info", dsFocus)}><span className="min-w-0 flex-1">{item.title}</span><span className="text-caption text-ui-muted">{mockRunStatus(item)}</span><ArrowUpRight aria-hidden className="size-4" /></button></li>)}</ul></TabPanel>}
      </>} />
  </Tabs>;
}
