import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, ZoomIn, ZoomOut, Maximize } from "lucide-react";
import { Badge, Button, Checkbox, Field, IconButton, Input, Select, dsFocus } from "../ds/ui.js";
import { cn } from "../lib/utils.js";
import { addMockReviewRecord, reviewCanApprove, reviewIsReadOnly, reviewName, reviewRecords, seedReviewRecords, editReviewRecord, REVIEW_RELATIONSHIPS, type ReviewField, type ReviewRecord } from "./workflow-review-model.js";
import { reviewFieldGroups, type ReviewSourcePage } from "./workflow-review-source-model.js";
import type { MockRun } from "./workflow-mock-model.js";

export function WorkflowMockReview({ run, sourcePages, onChange, onApprove, onDiscard, onRestore }: {
  run: MockRun; onChange: (records: readonly ReviewRecord[]) => void; onApprove?: () => void; onDiscard?: () => void; onRestore: () => void;
  sourcePages?: Readonly<Record<string, readonly ReviewSourcePage[]>>;
}) {
  const records = reviewRecords(run);
  const [activeId, setActiveId] = useState(records[0]?.id);
  const [sourceIndex, setSourceIndex] = useState(0);
  const [zoom, setZoom] = useState(0);
  const [imageError, setImageError] = useState(false);
  const identityInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);
  const { workflowId, draft } = run;
  const originals = useMemo(() => seedReviewRecords({ workflowId, draft }), [workflowId, draft]);
  const record = records.find(item => item.id === activeId);
  const original = originals.find(item => item.id === record?.id);
  const pages = record ? sourcePages?.[record.id] ?? [] : [];
  const source = pages[sourceIndex];
  const readOnly = reviewIsReadOnly(run);
  const count = records.filter(reviewCanApprove).length;
  const update = (key: string, value: string) => onChange(records.map(item => item.id === record?.id ? editReviewRecord(item, key, value) : item));
  const renderField = (item: ReviewField) => {
    const changed = original?.fields.find(field => field.key === item.key)?.value !== item.value;
    if (readOnly || item.readOnly) return <dl key={item.key} className="m-0 min-w-0"><dt className="text-caption text-ui-muted">{item.label}</dt><dd className="m-0 mt-1 break-words text-body">{item.kind === "boolean" ? item.value === "true" ? "Yes" : "No" : item.value || "—"}</dd></dl>;
    if (item.kind === "boolean") return <div key={item.key} className="col-span-full flex min-h-8 items-center"><Checkbox label={item.label} checked={item.value === "true"} onCheckedChange={value => update(item.key, String(value === true))} /></div>;
    return <Field key={item.key} label={<span className="inline-flex flex-wrap items-center gap-x-2">{item.label}{changed && original && <span className="text-caption font-normal text-ui-info">Edited</span>}</span>}>
      {item.kind === "relationship" ? <Select aria-label={item.label} value={item.value} onChange={event => update(item.key, event.target.value)}>{!REVIEW_RELATIONSHIPS.includes(item.value) && <option value={item.value}>{item.value || "Unspecified"}</option>}{REVIEW_RELATIONSHIPS.map(value => <option key={value} value={value}>{value}</option>)}</Select> : <Input ref={item.key === "employeeId" ? identityInput : undefined} aria-label={item.label} name={item.key} spellCheck={item.key === "employeeId" ? false : undefined} type="text" value={item.value} onChange={event => update(item.key, event.target.value)} />}
    </Field>;
  };
  if (records.length === 0) return <section aria-label="OCR records" className="flex min-h-0 min-w-0 flex-1 flex-col">
    <h3 ref={heading} data-ocr-review-heading tabIndex={-1} className="sr-only">OCR records</h3>
    <div role="status" className="flex flex-1 items-center justify-center p-5 text-body text-ui-muted">No records extracted</div>
    {(onApprove || run.discarded) && <footer className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-ui-stroke bg-ui-table px-4 py-3">
      <Button onClick={run.discarded ? onRestore : onDiscard}>{run.discarded ? "Undo discard" : "Discard"}</Button>
      {onApprove && <Button variant="primary" disabled>Approve records</Button>}
    </footer>}
  </section>;
  if (!record) throw new Error(`MOCK_REVIEW_RECORD_MISSING: ${activeId}`);
  return <section aria-label="OCR records" className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,3fr)_minmax(0,2fr)] text-ui-primary">
    <section aria-label="Source PDF" className="relative flex min-h-0 min-w-0 flex-col border-r border-ui-stroke bg-ui-table">
      <div role="toolbar" aria-label="PDF controls" className="absolute bottom-3 left-1/2 z-10 flex max-w-full -translate-x-1/2 items-center gap-1 rounded-lg border border-ui-stroke bg-ui-panel p-1 shadow-sm">
          {pages.length > 1 ? <Select aria-label="Source page" value={String(sourceIndex)} onChange={event => { setSourceIndex(Number(event.target.value)); setImageError(false); }} className="w-24 min-w-0">{pages.map((page, index) => <option key={page.page} value={index}>Page {page.page}</option>)}</Select> : <span className="whitespace-nowrap px-2 text-caption text-ui-muted">{source ? `Page ${source.page}` : "No source page"}</span>}
          <IconButton size="sm" variant="ghost" label="Zoom out" icon={<ZoomOut aria-hidden className="size-4" />} disabled={!source || zoom === 0 || zoom <= 50} onClick={() => setZoom(Math.max(50, zoom - 25))} />
          <IconButton size="sm" variant="ghost" label="Zoom in" icon={<ZoomIn aria-hidden className="size-4" />} disabled={!source || zoom >= 200} onClick={() => setZoom(zoom === 0 ? 100 : Math.min(200, zoom + 25))} />
          <IconButton size="sm" variant="ghost" label="Fit page" icon={<Maximize aria-hidden className="size-4" />} disabled={!source || zoom === 0} onClick={() => setZoom(0)} />
      </div>
      <div tabIndex={0} aria-label="PDF page image" className={cn("min-h-0 flex-1 overflow-auto p-3 pb-16", dsFocus)}>
        {source && !imageError ? <img src={source.imageUrl} alt={`Source page ${source.page} of ${run.subject}`} loading="eager" className="block h-auto max-w-none border border-ui-stroke" style={{ width: zoom === 0 ? "100%" : `${612 * zoom / 100}px` }} onError={() => setImageError(true)} /> : <p role="status" className="text-body text-ui-muted">{imageError ? "Source page unavailable" : "No source page for this record"}</p>}
      </div>
    </section>
    <div className="@container/record flex min-h-0 min-w-0 flex-col">
      <header className="shrink-0 space-y-2 px-3 py-3">
        <div className="flex items-center gap-2"><h3 ref={heading} data-ocr-review-heading tabIndex={-1} className={cn("m-0 min-w-0 flex-1 break-words rounded-sm text-body font-medium", dsFocus)}>{reviewName(record)}</h3>{!readOnly ? <IconButton size="sm" variant="ghost" label="Add record" icon={<Plus aria-hidden className="size-4" />} onClick={() => {
          const next = addMockReviewRecord(records); onChange(next); setActiveId(next[next.length - 1].id); setSourceIndex(0); setZoom(0); setImageError(false);
          requestAnimationFrame(() => identityInput.current?.focus());
        }} /> : <Badge tone={run.approved ? "success" : "neutral"}>{run.discarded ? "Discarded" : record.selected ? "Approved" : "Excluded"}</Badge>}</div>
        {records.length > 1 && <Select aria-label="Record" value={record.id} onChange={event => { setActiveId(event.target.value); setSourceIndex(0); setZoom(0); setImageError(false); }}>{records.map(item => <option key={item.id} value={item.id}>{reviewName(item)}{item.id.startsWith("manual-") ? " · Added" : ` · Page ${item.page}`}</option>)}</Select>}
        <div className="flex items-center justify-between gap-2"><Checkbox label={`Include ${reviewName(record)}`} checked={record.selected} disabled={readOnly || record.unknown} onCheckedChange={selected => onChange(records.map(item => item.id === record.id ? { ...item, selected: selected === true } : item))} /><span className="shrink-0 text-caption text-ui-muted">{records.length} {records.length === 1 ? "record" : "records"}</span></div>
      </header>
      <section aria-label={`Record ${record.id}`} className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto px-3 pb-3">
        {record.warnings.length > 0 && <div role="status" className="rounded-md border border-ui-stroke bg-ui-table px-3 py-2">{record.warnings.map(warning => <p key={warning} className="m-0 text-caption text-ui-warning">{warning}</p>)}</div>}
        {reviewFieldGroups(record).map(group => <section key={group.title}><h4 className="mb-2 mt-0 text-caption font-medium text-ui-muted">{group.title}</h4><div className="grid grid-cols-1 gap-2 @min-[18rem]/record:grid-cols-2">{group.fields.map(renderField)}</div></section>)}
        {onApprove && record.selected && !reviewCanApprove(record) && <p role="status" className="m-0 text-caption text-ui-warning">Enter an Employee ID of at least five digits to approve this record.</p>}
      </section>
      {(onApprove || run.discarded) && <footer className="shrink-0 space-y-2 border-t border-ui-stroke bg-ui-table px-3 py-3">
        {onApprove && <span className="block text-caption text-ui-muted">{count} selected for approval</span>}
        <div className="flex flex-wrap justify-end gap-2"><Button size="sm" onClick={run.discarded ? onRestore : onDiscard}>{run.discarded ? "Undo discard" : "Discard"}</Button>
          {onApprove && <Button size="sm" variant="primary" disabled={count === 0} onClick={() => { onApprove(); requestAnimationFrame(() => heading.current?.focus()); }}>Approve records</Button>}
        </div>
      </footer>}
    </div>
  </section>;
}
