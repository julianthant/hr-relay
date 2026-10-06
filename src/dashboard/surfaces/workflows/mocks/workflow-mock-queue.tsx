import { useMemo, useRef, useState } from "react";
import { ArrowUpRight, GitBranch, ListChecks } from "lucide-react";
import { Button, Dialog, DialogContent, DialogBody, DialogFooter, IconButton, Popover, PopoverContent, PopoverTrigger, dsFocus } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";
import { LogPanel } from "../../run-detail/log-panel.js";
import { queueRunHeader } from "../../run-detail/run-header-model.js";
import { mockApprovalError, mockNeedsReview, mockQueueStatus, mockRunLog, mockRunStatus, type MockRun } from "./workflow-mock-model.js";
import { mockWorkflow } from "./workflow-mock-catalog.js";
import { mockQueueId, mockQueueSurface, mockQueueSurfaces } from "./workflow-queue-model.js";
import { QueuePanel, type QueueFilterScope } from "../../queue/queue.js";
import type { QueueSortKey } from "../../queue/queue-model.js";
import { StatusBadge } from "../../shared/status/status.js";
import { dsStatusOf } from "../../shared/status/status-model.js";
import { reviewRecords, seedReviewRecords, type ReviewRecord } from "./workflow-review-model.js";
import { reviewSourcePages } from "./workflow-review-source-model.js";
import { WorkflowMockReview } from "./workflow-review.js";
import { documentSourcePages } from "./workflow-document-model.js";
import { mockDeletionIds } from "./workflow-mock-model.js";

export function WorkflowMockQueue({ label, runs, allRuns, selected, onSelect, onRetry, onDelete, day, nowIso, sort, filter }: {
  label: string; runs: readonly MockRun[]; selected?: string; onSelect: (id: string) => void;
  day: string; nowIso: string; sort: QueueSortKey; filter?: QueueFilterScope;
  allRuns: readonly MockRun[]; onRetry: (id: string) => void; onDelete: (ids: readonly string[]) => void;
}) {
  const [pendingDelete, setPendingDelete] = useState<MockRun>();
  const queueRoot = useRef<HTMLDivElement>(null);
  const deleted = useRef(false);
  const deleteLauncher = useRef<HTMLElement | null>(null);
  const surfaces = useMemo(() => mockQueueSurfaces(runs, day), [runs, day]);
  const ids = useMemo(() => new Map(runs.map(run => [mockQueueId(run.id), run.id])), [runs]);
  const focusRemainingRow = () => {
    const target = queueRoot.current?.querySelector<HTMLElement>("[data-demo-row-id]") ?? queueRoot.current?.querySelector<HTMLElement>('[aria-label="Queue"]');
    if (target) { if (!target.hasAttribute("tabindex")) target.tabIndex = -1; target.focus(); }
  };
  return <div ref={queueRoot} className="flex min-h-0 min-w-0 flex-1 flex-col [&>section]:flex-1"><QueuePanel surfaces={surfaces} panelLabel={label} header={false} day={day} sort={sort} filter={filter}
    state={{ selectedRunId: selected ? mockQueueId(selected) : undefined, openWells: new Set(), panelWorkflowId: runs[0]?.workflowId, nowIso }}
    handlers={{ onSelect: id => {
      const target = ids.get(id);
      if (!target) throw new Error(`MOCK_QUEUE_RUN_UNKNOWN: ${id}`);
      onSelect(target);
    }, onPreviewAction: (action, targets) => {
      const id = ids.get(targets[0]);
      const run = allRuns.find(item => item.id === id);
      if (!run) throw new Error("MOCK_QUEUE_ACTION_TARGET_MISSING");
      if (action === "retry") onRetry(run.id);
      else if (action === "delete") { deleteLauncher.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setPendingDelete(run); }
    } }} workflowLabelOf={id => mockWorkflow(id).label} />
    <Dialog open={!!pendingDelete} onOpenChange={open => { if (!open) setPendingDelete(undefined); }}>
      <DialogContent title={`Delete ${pendingDelete?.subject ?? "run"}?`} size="sm" onCloseAutoFocus={event => {
        event.preventDefault();
        if (!deleted.current) { deleteLauncher.current?.focus(); return; }
        deleted.current = false;
        focusRemainingRow();
      }}>
        <DialogBody>{pendingDelete && <p className="m-0 text-body text-ui-secondary">Remove this run and {mockDeletionIds(allRuns, pendingDelete.id).length - 1} linked runs from the queue.</p>}</DialogBody>
        <DialogFooter><Button variant="muted" onClick={() => setPendingDelete(undefined)}>Cancel</Button><Button variant="danger" onClick={() => { if (!pendingDelete) return; deleted.current = true; onDelete(mockDeletionIds(allRuns, pendingDelete.id)); setPendingDelete(undefined); }}>Delete</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}

export function WorkflowMockLog({ run, runs, onRerun, onApprove, onChange, onDiscard, onRestore, onSelect, reviewOpen, onReviewOpenChange, day, nowIso }: {
  run: MockRun; runs: readonly MockRun[]; onRerun: () => void; onApprove: () => void;
  onChange: (records: readonly ReviewRecord[]) => void; onDiscard: () => void; onRestore: () => void; onSelect: (id: string) => void;
  reviewOpen?: boolean; onReviewOpenChange?: (open: boolean) => void;
  day: string; nowIso: string;
}) {
  const [localReviewOpen, setLocalReviewOpen] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);
  const hasRecords = run.workflowId === "ocr";
  const recordsVisible = hasRecords && (reviewOpen ?? localReviewOpen);
  const setRecordsVisible = onReviewOpenChange ?? setLocalReviewOpen;
  const { workflowId, draft } = run;
  const surface = useMemo(() => mockQueueSurface(run, day), [run, day]);
  const sourcePages = useMemo(() => {
    if (!hasRecords) return {};
    const originals = seedReviewRecords({ workflowId, draft });
    return Object.fromEntries(reviewRecords(run).map(record => {
      const original = originals.find(item => item.id === record.id) ?? originals[0];
      if (!original) throw new Error("MOCK_REVIEW_SHAPE_MISSING");
      return [record.id, documentSourcePages(draft, original) ?? reviewSourcePages(original)];
    }));
  }, [hasRecords, workflowId, draft, run]);
  const { steps, timeline } = recordsVisible ? { steps: [], timeline: [] } : mockRunLog(run);
  const linked = runs.filter(item => item.parentId === run.id || item.id === run.parentId || item.id === run.sourceId || item.id === run.ocrRunId || item.ocrRunId === run.id);
  return <LogPanel title={run.subject} steps={steps} timeline={timeline} context={queueRunHeader(surface, mockWorkflow(run.workflowId).label, nowIso)}
      onReview={hasRecords ? () => setRecordsVisible(true) : undefined}
      status={<StatusBadge status={dsStatusOf(mockQueueStatus(run))} presentation="queue" />}
      toolbar={<span className="flex items-center gap-2">
        {hasRecords && <Button size="sm" variant={recordsVisible ? "secondary" : "outline"} aria-pressed={recordsVisible} aria-controls={recordsVisible ? `records-${mockQueueId(run.id)}` : undefined} icon={<ListChecks aria-hidden className="size-4" />} onClick={() => setRecordsVisible(!recordsVisible)}>Records {reviewRecords(run).length}</Button>}
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
      content={recordsVisible ? <div id={`records-${mockQueueId(run.id)}`} className="flex min-h-0 min-w-0 flex-1">
        <WorkflowMockReview key={run.id} approvalError={mockApprovalError(run)} run={run} sourcePages={sourcePages} onChange={onChange} onApprove={mockNeedsReview(run) ? onApprove : undefined} onDiscard={mockNeedsReview(run) ? onDiscard : undefined} onRestore={onRestore} />
      </div> : undefined} />;
}
