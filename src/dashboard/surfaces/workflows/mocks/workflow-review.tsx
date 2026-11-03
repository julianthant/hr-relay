import { useEffect, useMemo, useRef } from "react";
import { Plus } from "lucide-react";
import { Button, dsFocus } from "../../../ds/ui.js";
import { cn } from "../../../lib/utils.js";
import { addMockReviewRecord, reviewCanApprove, reviewApprovalError, reviewIsReadOnly, reviewName, reviewRecords, seedReviewRecords, editReviewRecord, type ReviewRecord } from "./workflow-review-model.js";
import { ReviewRecordCard } from "../../run-detail/review/review-record.js";
import type { ReviewSourcePage } from "../../run-detail/review/review-record-model.js";
import type { MockRun } from "./workflow-mock-model.js";

export function WorkflowMockReview({ run, sourcePages, approvalError, onChange, onApprove, onDiscard, onRestore }: {
  run: MockRun; onChange: (records: readonly ReviewRecord[]) => void; onApprove?: () => void; onDiscard?: () => void; onRestore: () => void;
  sourcePages?: Readonly<Record<string, readonly ReviewSourcePage[]>>; approvalError?: string;
}) {
  const records = reviewRecords(run);
  const body = useRef<HTMLDivElement>(null);
  const focusId = useRef(records[0]?.id);
  const focusRecord = (id: string | undefined, selector: string, preventScroll = false) => {
    const card = [...body.current?.querySelectorAll<HTMLElement>("[data-review-record-id]") ?? []].find(node => node.dataset.reviewRecordId === id);
    card?.querySelector<HTMLElement>(selector)?.focus({ preventScroll });
  };
  useEffect(() => {
    const frame = requestAnimationFrame(() => body.current?.querySelector<HTMLElement>("[data-ocr-review-heading]")?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);
  const { workflowId, draft } = run;
  const originals = useMemo(() => seedReviewRecords({ workflowId, draft }), [workflowId, draft]);
  const readOnly = reviewIsReadOnly(run);
  const count = records.filter(reviewCanApprove).length;
  return <section aria-label="OCR records" onKeyDown={event => {
    if (!run.discarded || event.defaultPrevented || event.repeat || event.altKey || event.shiftKey
      || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z"
      || (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]'))) return;
    event.preventDefault();
    onRestore();
    requestAnimationFrame(() => focusRecord(focusId.current, "[data-ocr-review-heading]", true));
  }} className="flex min-h-0 min-w-0 flex-1 flex-col text-ui-primary">
    <div ref={body} aria-label="Record review cards" tabIndex={0} className={cn("min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto p-3", dsFocus)}>
      {records.length === 0 ? <div role="status" className="flex h-full items-center justify-center text-body text-ui-muted">No records extracted</div> : records.map(record => <ReviewRecordCard key={record.id} runId={run.id} subject={run.subject} record={record} name={reviewName(record)} original={originals.find(item => item.id === record.id)} pages={sourcePages?.[record.id] ?? []} readOnly={readOnly} disposition={readOnly ? { tone: run.approved ? "success" : "neutral", label: run.discarded ? "Discarded" : record.selected ? "Approved" : "Excluded" } : undefined} approvalError={reviewApprovalError(record)} onFocus={() => { focusId.current = record.id; }} onEditField={(key, value) => onChange(records.map(item => item.id === record.id ? editReviewRecord(record, key, value) : item))} onChange={updated => onChange(records.map(item => item.id === updated.id ? { ...record, ...updated } : item))} />)}
    </div>
    {(onApprove || onDiscard) && !run.discarded && <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-ui-stroke bg-ui-table px-3 py-3">
      {onApprove && <div className="min-w-0 flex-1 text-caption"><span className="text-ui-muted">{count} selected for approval</span>{approvalError && <p role="status" className="m-0 mt-1 text-ui-warning">{approvalError}</p>}</div>}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {!readOnly && records.length > 0 && <Button size="sm" icon={<Plus aria-hidden className="size-4" />} onClick={() => {
          const next = addMockReviewRecord(records); onChange(next); focusId.current = next[next.length - 1].id;
          requestAnimationFrame(() => focusRecord(focusId.current, 'input[name="employeeId"]'));
        }}>Add record</Button>}
        {onDiscard && !run.discarded && <Button size="sm" onClick={() => {
          onDiscard(); requestAnimationFrame(() => focusRecord(focusId.current, "[data-ocr-review-heading]", true));
        }}>Discard</Button>}
        {onApprove && <Button size="sm" variant="primary" disabled={count === 0 || Boolean(approvalError)} onClick={() => { onApprove(); requestAnimationFrame(() => focusRecord(focusId.current, "[data-ocr-review-heading]", true)); }}>Approve records</Button>}
      </div>
    </footer>}
  </section>;
}
