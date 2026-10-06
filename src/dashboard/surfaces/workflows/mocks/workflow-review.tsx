import { displayExtractedDate } from "../../../lib/date-format.js";
import { useViewState } from "../../../app/navigation/view-route-model.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, ZoomIn, ZoomOut, Maximize } from "lucide-react";
import { Badge, Button, Card, CardBody, Checkbox, Field, IconButton, Input, Select, Skeleton, Textarea, dsFocus } from "../../../ds/ui.js";
import { LoadingRegion } from "../../shared/loading/loading.js";
import { cn } from "../../../lib/utils.js";
import { addMockReviewRecord, reviewCanApprove, reviewIsReadOnly, reviewName, reviewRecords, seedReviewRecords, editReviewRecord, REVIEW_RELATIONSHIPS, type ReviewField, type ReviewRecord } from "./workflow-review-model.js";
import { reviewFieldBlocks, reviewFieldGroups, reviewFieldPresentation, type ReviewSourcePage } from "./workflow-review-source-model.js";
import type { MockRun } from "./workflow-mock-model.js";

function ReviewSourcePreview({ recordId, subject, pages }: { recordId: string; subject: string; pages: readonly ReviewSourcePage[] }) {
  const [reviewPages, setReviewPages] = useViewState("reviewPages", {});
  const sourceIndex = reviewPages[recordId] ?? 0;
  const setSourceIndex = (index: number) => setReviewPages(current => ({ ...current, [recordId]: index }));
  const [zoom, setZoom] = useState(100);
  const [aspectRatio, setAspectRatio] = useState(612 / 792);
  const [imageError, setImageError] = useState(false);
  const [loadedImage, setLoadedImage] = useState<string>();
  const imageViewport = useRef<HTMLDivElement>(null);
  const source = pages[sourceIndex];
  const fitPage = () => { setZoom(100); imageViewport.current?.scrollTo({ left: 0, top: 0 }); };
  const available = Boolean(source && !imageError);
  const loading = available && loadedImage !== source.imageUrl;
  return <section aria-label="Source PDF" className="min-w-0 border-r border-ui-stroke bg-ui-table p-3">
    <div className="mb-2 flex flex-wrap items-center gap-2">
      {source && <div className="min-w-0 flex-1">{pages.length > 1 ? <Select aria-label="Source page" value={String(sourceIndex)} onChange={event => { setSourceIndex(Number(event.target.value)); setImageError(false); fitPage(); }} className="w-44 max-w-full">{pages.map((page, index) => <option key={page.page} value={index}>{page.label ?? `Page ${page.page}`}</option>)}</Select> : <span className="text-caption text-ui-muted">Page {source.page}</span>}</div>}
      <div role="toolbar" aria-label="PDF controls" className="ml-auto flex shrink-0 items-center gap-1">
        <IconButton size="sm" variant="ghost" label="Zoom out" icon={<ZoomOut aria-hidden className="size-4" />} disabled={!available || loading || zoom <= 50} onClick={() => setZoom(Math.max(50, zoom - 25))} />
        <IconButton size="sm" variant="ghost" label="Zoom in" icon={<ZoomIn aria-hidden className="size-4" />} disabled={!available || loading || zoom >= 200} onClick={() => setZoom(Math.min(200, zoom + 25))} />
        <IconButton size="sm" variant="ghost" label="Fit page" icon={<Maximize aria-hidden className="size-4" />} disabled={!available || loading || zoom === 100} onClick={fitPage} />
      </div>
    </div>
    <div data-review-preview className="relative min-w-0" style={{ aspectRatio }}>
      <div ref={imageViewport} tabIndex={0} aria-label="PDF page image" className={cn("absolute inset-0 overflow-auto rounded-sm border border-ui-stroke", dsFocus)}>
        {available ? <img src={source.imageUrl} alt={`Source page ${source.page} of ${subject}`} loading="lazy" className="mx-auto block h-auto max-w-none" style={{ width: `${zoom}%` }} onLoad={event => { setAspectRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight); setLoadedImage(source.imageUrl); }} onError={() => setImageError(true)} /> : <p role="status" className="m-0 p-3 text-body text-ui-muted">{imageError ? "Source page unavailable" : "No source page for this record"}</p>}
        {loading && <LoadingRegion label="Loading source PDF" className="absolute inset-0"><Skeleton className="h-full w-full rounded-none" /></LoadingRegion>}
      </div>
    </div>
  </section>;
}

function ReviewRecordCard({ run, record, original, pages, onChange, onFocus }: {
  run: MockRun; record: ReviewRecord; original?: ReviewRecord; pages: readonly ReviewSourcePage[];
  onChange: (record: ReviewRecord) => void; onFocus: () => void;
}) {
  const readOnly = reviewIsReadOnly(run);
  const update = (key: string, value: string) => onChange(editReviewRecord(record, key, value));
  const renderField = (item: ReviewField) => {
    const { wide, multiline } = reviewFieldPresentation(item);
    const changed = original?.fields.find(field => field.key === item.key)?.value !== item.value;
    if (readOnly || item.readOnly) return <dl key={item.key} className={cn("m-0 min-w-0", wide && "col-span-full")}><dt className="text-caption text-ui-muted">{item.label}</dt><dd className="m-0 mt-1 whitespace-pre-wrap break-words text-body">{item.kind === "boolean" ? item.value === "true" ? "Yes" : "No" : (item.kind === "date" ? displayExtractedDate(item.value) : item.value) || "—"}</dd></dl>;
    if (item.kind === "boolean") return <Checkbox key={item.key} label={item.label} checked={item.value === "true"} onCheckedChange={value => update(item.key, String(value === true))} />;
    return <Field key={item.key} className={wide ? "col-span-full" : undefined} label={<span className="inline-flex flex-wrap items-center gap-x-2">{item.label}{changed && original && <span className="text-caption font-normal text-ui-info">Edited</span>}</span>}>
      {item.kind === "relationship" ? <Select aria-label={item.label} value={item.value} onChange={event => update(item.key, event.target.value)}>{!REVIEW_RELATIONSHIPS.includes(item.value) && <option value={item.value}>{item.value || "Unspecified"}</option>}{REVIEW_RELATIONSHIPS.map(value => <option key={value} value={value}>{value}</option>)}</Select> : multiline ? <Textarea aria-label={item.label} name={item.key} rows={2} value={item.value} onChange={event => update(item.key, event.target.value)} /> : <Input aria-label={item.label} name={item.key} spellCheck={item.key === "employeeId" ? false : undefined} type="text" placeholder={item.kind === "date" ? "MM/DD/YYYY" : undefined} value={item.kind === "date" ? displayExtractedDate(item.value) : item.value} onChange={event => update(item.key, event.target.value)} />}
    </Field>;
  };
  return <section aria-label={`Record ${record.id}`} data-review-record-id={record.id} onFocusCapture={onFocus} className="grid min-w-0 grid-cols-[minmax(0,3fr)_minmax(0,2fr)] overflow-hidden rounded-lg border border-ui-stroke bg-ui-panel">
    <ReviewSourcePreview recordId={record.id} subject={run.subject} pages={pages} />
    <div data-review-fields className="@container/record min-w-0 space-y-3 bg-ui-table p-3">
      <Card role="group" aria-label="Record selection">
        <CardBody className="space-y-2 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Checkbox className="min-w-0 flex-1" label={<><span className="sr-only">Include </span><span data-ocr-review-heading role="heading" aria-level={3} tabIndex={-1} className={cn("inline-block min-w-0 break-words rounded-sm text-body font-medium", dsFocus)}>{reviewName(record)}</span></>} checked={record.selected} disabled={readOnly || record.unknown} onCheckedChange={selected => onChange({ ...record, selected: selected === true })} />
            {readOnly && <Badge tone={run.approved ? "success" : "neutral"}>{run.discarded ? "Discarded" : record.selected ? "Approved" : "Excluded"}</Badge>}
          </div>
          {record.warnings.length > 0 && <div role="status">{record.warnings.map(warning => <p key={warning} className="m-0 text-caption text-ui-warning">{warning}</p>)}</div>}
          {!readOnly && record.selected && !reviewCanApprove(record) && <p role="status" className="m-0 text-caption text-ui-warning">Enter an Employee ID of at least five digits to approve this record.</p>}
        </CardBody>
      </Card>
      {reviewFieldGroups(record).map(group => <section key={group.fields[0].key}><h4 className="mb-2 mt-0 text-body font-medium">{group.title}</h4><Card role="group" aria-label={group.title}><CardBody className="p-3"><div className="grid grid-cols-1 gap-2 @min-[16rem]/record:grid-cols-2">{reviewFieldBlocks(group.fields).map(block => block[0].kind === "boolean" ? <div key={block[0].key} className="col-span-full flex flex-wrap items-center gap-x-4 gap-y-2 py-1">{block.map(renderField)}</div> : renderField(block[0]))}</div></CardBody></Card></section>)}
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
