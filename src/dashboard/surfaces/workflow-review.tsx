import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, ZoomIn, ZoomOut, Maximize } from "lucide-react";
import { Badge, Button, Checkbox, Field, IconButton, Input, Select, dsFocus } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { addMockReviewRecord, reviewCanApprove, reviewIsReadOnly, reviewName, reviewRecords, seedReviewRecords, editReviewRecord, REVIEW_RELATIONSHIPS, type ReviewField, type ReviewRecord } from "./workflow-review-model.js";
import { reviewFieldGroups, type ReviewSourcePage } from "./workflow-review-source-model.js";
import type { MockRun } from "./workflow-mock-model.js";

function ReviewRecordCard({ run, record, original, pages, onChange, onFocus }: {
  run: MockRun; record: ReviewRecord; original?: ReviewRecord; pages: readonly ReviewSourcePage[];
  onChange: (record: ReviewRecord) => void; onFocus: () => void;
}) {
  const [sourceIndex, setSourceIndex] = useState(0);
  const [zoom, setZoom] = useState(0);
  const [imageError, setImageError] = useState(false);
  const source = pages[sourceIndex];
  const readOnly = reviewIsReadOnly(run);
  const update = (key: string, value: string) => onChange(editReviewRecord(record, key, value));
  const renderField = (item: ReviewField) => {
    const changed = original?.fields.find(field => field.key === item.key)?.value !== item.value;
    if (readOnly || item.readOnly) return <dl key={item.key} className="m-0 min-w-0"><dt className="text-caption text-ui-muted">{item.label}</dt><dd className="m-0 mt-1 break-words text-body">{item.kind === "boolean" ? item.value === "true" ? "Yes" : "No" : item.value || "—"}</dd></dl>;
    if (item.kind === "boolean") return <div key={item.key} className="col-span-full flex min-h-8 items-center"><Checkbox label={item.label} checked={item.value === "true"} onCheckedChange={value => update(item.key, String(value === true))} /></div>;
    return <Field key={item.key} label={<span className="inline-flex flex-wrap items-center gap-x-2">{item.label}{changed && original && <span className="text-caption font-normal text-ui-info">Edited</span>}</span>}>
      {item.kind === "relationship" ? <Select aria-label={item.label} value={item.value} onChange={event => update(item.key, event.target.value)}>{!REVIEW_RELATIONSHIPS.includes(item.value) && <option value={item.value}>{item.value || "Unspecified"}</option>}{REVIEW_RELATIONSHIPS.map(value => <option key={value} value={value}>{value}</option>)}</Select> : <Input aria-label={item.label} name={item.key} spellCheck={item.key === "employeeId" ? false : undefined} type="text" value={item.value} onChange={event => update(item.key, event.target.value)} />}
    </Field>;
  };
  return <section aria-label={`Record ${record.id}`} data-review-record-id={record.id} onFocusCapture={onFocus} className="grid min-w-0 grid-cols-[minmax(0,3fr)_minmax(0,2fr)] rounded-lg border border-ui-stroke bg-ui-panel">
    <section aria-label="Source PDF" className="relative flex min-w-0 flex-col rounded-l-lg border-r border-ui-stroke bg-ui-table p-3">
      <div tabIndex={0} aria-label="PDF page image" className={cn("min-w-0 overflow-x-auto pb-14", dsFocus)}>
        {source && !imageError ? <img src={source.imageUrl} alt={`Source page ${source.page} of ${run.subject}`} loading="lazy" className="block h-auto max-w-none border border-ui-stroke" style={{ width: zoom === 0 ? "100%" : `${612 * zoom / 100}px` }} onError={() => setImageError(true)} /> : <p role="status" className="text-body text-ui-muted">{imageError ? "Source page unavailable" : "No source page for this record"}</p>}
      </div>
      <div role="toolbar" aria-label="PDF controls" className="sticky bottom-3 z-10 mx-auto -mt-12 flex max-w-full items-center gap-1 rounded-lg border border-ui-stroke bg-ui-panel p-1 shadow-sm">
        {pages.length > 1 ? <Select aria-label="Source page" value={String(sourceIndex)} onChange={event => { setSourceIndex(Number(event.target.value)); setImageError(false); }} className={cn("min-w-0", record.kind === "i9" ? "w-40" : "w-24")}>{pages.map((page, index) => <option key={page.page} value={index}>{page.label ?? `Page ${page.page}`}</option>)}</Select> : <span className="whitespace-nowrap px-2 text-caption text-ui-muted">{source ? `Page ${source.page}` : "No source page"}</span>}
        <IconButton size="sm" variant="ghost" label="Zoom out" icon={<ZoomOut aria-hidden className="size-4" />} disabled={!source || zoom === 0 || zoom <= 50} onClick={() => setZoom(Math.max(50, zoom - 25))} />
        <IconButton size="sm" variant="ghost" label="Zoom in" icon={<ZoomIn aria-hidden className="size-4" />} disabled={!source || zoom >= 200} onClick={() => setZoom(zoom === 0 ? 100 : Math.min(200, zoom + 25))} />
        <IconButton size="sm" variant="ghost" label="Fit page" icon={<Maximize aria-hidden className="size-4" />} disabled={!source || zoom === 0} onClick={() => setZoom(0)} />
      </div>
    </section>
    <div data-review-fields className="@container/record min-w-0 space-y-4 p-3">
      <header className="space-y-2">
        <div className="flex items-center gap-2"><h3 data-ocr-review-heading tabIndex={-1} className={cn("m-0 min-w-0 flex-1 break-words rounded-sm text-body font-medium", dsFocus)}>{reviewName(record)}</h3>{readOnly && <Badge tone={run.approved ? "success" : "neutral"}>{run.discarded ? "Discarded" : record.selected ? "Approved" : "Excluded"}</Badge>}</div>
        <Checkbox label={`Include ${reviewName(record)}`} checked={record.selected} disabled={readOnly || record.unknown} onCheckedChange={selected => onChange({ ...record, selected: selected === true })} />
      </header>
      {record.warnings.length > 0 && <div role="status" className="rounded-md border border-ui-stroke bg-ui-table px-3 py-2">{record.warnings.map(warning => <p key={warning} className="m-0 text-caption text-ui-warning">{warning}</p>)}</div>}
      {reviewFieldGroups(record).map(group => <section key={group.title}><h4 className="mb-2 mt-0 text-caption font-medium text-ui-muted">{group.title}</h4><div className="grid grid-cols-1 gap-2 @min-[16rem]/record:grid-cols-2">{group.fields.map(renderField)}</div></section>)}
      {!readOnly && record.selected && !reviewCanApprove(record) && <p role="status" className="m-0 text-caption text-ui-warning">Enter an Employee ID of at least five digits to approve this record.</p>}
    </div>
  </section>;
}

export function WorkflowMockReview({ run, sourcePages, onChange, onApprove, onDiscard, onRestore }: {
  run: MockRun; onChange: (records: readonly ReviewRecord[]) => void; onApprove?: () => void; onDiscard?: () => void; onRestore: () => void;
  sourcePages?: Readonly<Record<string, readonly ReviewSourcePage[]>>;
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
  return <section aria-label="OCR records" className="flex min-h-0 min-w-0 flex-1 flex-col text-ui-primary">
    <div ref={body} aria-label="Record review cards" tabIndex={0} className={cn("min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto p-3", dsFocus)}>
      {records.length === 0 ? <div role="status" className="flex h-full items-center justify-center text-body text-ui-muted">No records extracted</div> : records.map(record => <ReviewRecordCard key={record.id} run={run} record={record} original={originals.find(item => item.id === record.id)} pages={sourcePages?.[record.id] ?? []} onFocus={() => { focusId.current = record.id; }} onChange={updated => onChange(records.map(item => item.id === updated.id ? updated : item))} />)}
    </div>
    {(onApprove || run.discarded) && <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-ui-stroke bg-ui-table px-3 py-3">
      {onApprove && <span className="text-caption text-ui-muted">{count} selected for approval</span>}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {!readOnly && records.length > 0 && <Button size="sm" icon={<Plus aria-hidden className="size-4" />} onClick={() => {
          const next = addMockReviewRecord(records); onChange(next); focusId.current = next[next.length - 1].id;
          requestAnimationFrame(() => focusRecord(focusId.current, 'input[name="employeeId"]'));
        }}>Add record</Button>}
        <Button size="sm" onClick={run.discarded ? onRestore : onDiscard}>{run.discarded ? "Undo discard" : "Discard"}</Button>
        {onApprove && <Button size="sm" variant="primary" disabled={count === 0} onClick={() => { onApprove(); requestAnimationFrame(() => focusRecord(focusId.current, "[data-ocr-review-heading]", true)); }}>Approve records</Button>}
      </div>
    </footer>}
  </section>;
}
