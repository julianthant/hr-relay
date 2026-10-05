import { useMemo, useState } from "react";
import { ArrowUpRight, GitBranch, ListChecks } from "lucide-react";
import { Button, IconButton, Popover, PopoverContent, PopoverTrigger, dsFocus, Drawer, DrawerContent, DrawerTrigger } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { LogPanel } from "./log-panel.js";
import { LogFeed } from "./log-feed.js";
import { LogTimeline } from "./logs/log-timeline.js";
import { mockNeedsReview, mockQueueStatus, mockRunLog, mockRunStatus, type MockRun } from "./workflow-mock-model.js";
import { mockWorkflow } from "./workflow-mock-catalog.js";
import { mockQueueId, mockQueueSurfaces } from "./workflow-queue-model.js";
import { QueuePanel, type QueueFilterScope } from "./queue.js";
import type { QueueSortKey } from "./queue-model.js";
import { StatusBadge } from "./status.js";
import { dsStatusOf } from "./status-model.js";
import { reviewRecords, type ReviewRecord } from "./workflow-review-model.js";
import { WorkflowMockReview } from "./workflow-review.js";

export function WorkflowMockQueue({ label, runs, selected, onSelect, day, nowIso, sort, filter }: {
  label: string; runs: readonly MockRun[]; selected?: string; onSelect: (id: string) => void;
  day: string; nowIso: string; sort: QueueSortKey; filter?: QueueFilterScope;
}) {
  const surfaces = useMemo(() => mockQueueSurfaces(runs, day), [runs, day]);
  const ids = useMemo(() => new Map(runs.map(run => [mockQueueId(run.id), run.id])), [runs]);
  return <QueuePanel surfaces={surfaces} panelLabel={label} day={day} sort={sort} filter={filter}
    state={{ selectedRunId: selected ? mockQueueId(selected) : undefined, openWells: new Set(), panelWorkflowId: runs[0]?.workflowId, nowIso }}
    handlers={{ onSelect: id => {
      const target = ids.get(id);
      if (!target) throw new Error(`MOCK_QUEUE_RUN_UNKNOWN: ${id}`);
      onSelect(target);
    } }} workflowLabelOf={id => mockWorkflow(id).label} />;
}

export function WorkflowMockLog({ run, runs, onRerun, onApprove, onChange, onDiscard, onRestore, onSelect }: {
  run: MockRun; runs: readonly MockRun[]; onRerun: () => void; onApprove: () => void;
  onChange: (records: readonly ReviewRecord[]) => void; onDiscard: () => void; onRestore: () => void; onSelect: (id: string) => void;
}) {
  const [reviewOpen, setReviewOpen] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);
  const { steps, timeline } = mockRunLog(run);
  const hasRecords = run.workflowId === "ocr";
  const linked = runs.filter(item => item.parentId === run.id || item.id === run.parentId || item.id === run.sourceId || item.id === run.ocrRunId || item.ocrRunId === run.id);
  return <Drawer open={reviewOpen} onOpenChange={setReviewOpen}>
    <LogPanel title={run.title} steps={steps} timeline={timeline}
      status={<StatusBadge status={dsStatusOf(mockQueueStatus(run))} presentation="queue" />}
      toolbar={<span className="flex items-center gap-2">
        {hasRecords && <DrawerTrigger asChild><Button size="sm" icon={<ListChecks aria-hidden className="size-4" />}>{mockNeedsReview(run) ? "Review records" : "Records"} {reviewRecords(run).length}</Button></DrawerTrigger>}
        {run.workflowId !== "ocr" && run.ocrRunId && <Button size="sm" onClick={() => onSelect(run.ocrRunId!)}>Open OCR</Button>}
        {!["i9-lookup", "ocr"].includes(run.workflowId) && run.role !== "person" && <Button size="sm" onClick={onRerun}>Rerun</Button>}
        {linked.length > 0 && <Popover open={linksOpen} onOpenChange={setLinksOpen}>
          <PopoverTrigger asChild><IconButton size="sm" variant="outline" label={`Linked runs (${linked.length})`} icon={<GitBranch aria-hidden className="size-4" />} /></PopoverTrigger>
          <PopoverContent title="Linked runs" align="end" width="md">
            <ul className="m-0 list-none space-y-1 p-0">{linked.map(item => <li key={item.id}>
              <button type="button" onClick={() => { setLinksOpen(false); onSelect(item.id); }} className={cn("flex min-h-10 w-full items-center gap-3 rounded-md px-2 py-2 text-left text-body hover:bg-ui-hover", dsFocus)}>
                <span className="min-w-0 flex-1"><span className="block text-ui-primary">{item.subject}</span><span className="block text-caption text-ui-muted">{item.id === run.parentId ? "Parent" : item.id === run.sourceId ? "Rerun source" : mockWorkflow(item.workflowId).label} · {mockRunStatus(item)}</span></span>
                <ArrowUpRight aria-hidden className="size-4 shrink-0 text-ui-muted" />
              </button>
            </li>)}</ul>
          </PopoverContent>
        </Popover>}
      </span>}
      content={<LogFeed steps={steps} navigation={jump => <LogTimeline stages={timeline} onJump={jump} />} />} />
    {hasRecords && <DrawerContent title="OCR records" description={run.subject} size="min(56rem, calc(100vw - var(--ds-space-section)))" className="ds-body-scope ds-body-overlay ui-theme-scope">
      <WorkflowMockReview run={run} onChange={onChange} onApprove={mockNeedsReview(run) ? onApprove : undefined} onDiscard={mockNeedsReview(run) ? onDiscard : undefined} onRestore={onRestore} />
    </DrawerContent>}
  </Drawer>;
}
