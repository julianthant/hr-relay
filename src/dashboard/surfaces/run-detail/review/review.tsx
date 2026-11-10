import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { ZoomIn, ZoomOut, Maximize, Minimize } from "lucide-react";
import type { DelegatedRecordRef } from "../../../../models/workflow/delegated-record.js";
import { useDashboardClient, useDashboardCommandBinding } from "../../../state/client-context.js";
import { useOcrReviewEditor } from "../../../state/review-wiring-adapter.js";
import { useViewState } from "../../../app/navigation/view-route-model.js";
import type { LogSelection } from "../logs/log-selection-model.js";
import { Badge, Button, Card, CardBody, Checkbox, Field, IconButton, Input, Select, Skeleton, Textarea, dsFocus, Notice } from "../../../ds/ui.js";
import { LogSkeleton, LoadingRegion } from "../../shared/loading/loading.js";
import { cn } from "../../../lib/utils.js";
import { displayExtractedDate } from "../../../lib/date-format.js";
import { ReviewEscape } from "./review-escape.js";
import { ocrReviewCards } from "./review-model.js";
import { reviewFieldBlocks, reviewFieldGroups, reviewFieldPresentation, REVIEW_RELATIONSHIPS, type RecordReviewProps, type ReviewField, type ReviewRecordView, type ReviewSourcePage } from "./review-record-model.js";

export function RunReview({ selection, focus }: { selection: LogSelection; focus?: DelegatedRecordRef }) {
  const client = useDashboardClient();
  const binding = useDashboardCommandBinding();
  const resource = useOcrReviewEditor(client, selection, binding);
  const cards = useMemo(() => resource.page?.ocr === undefined ? undefined : ocrReviewCards(resource.page, (runId, revision, page) => client.ocrSourcePageUrl(runId, revision, page), resource.drafts, resource.includes), [resource.page, client, resource.drafts, resource.includes]);
  const missing = focus !== undefined && cards !== undefined
    && (focus.runId !== selection.row.runId || !cards.some(card => card.record.id === focus.recordId));
  if (resource.page !== undefined && resource.page.ocr === undefined) return <Notice sticky tone="danger" title="Review unavailable" description="OCR review authority is unavailable." />;
  if (missing) return <Notice tone="danger" title="Record unavailable" description="Not part of this review." />;
  if (cards === undefined) return resource.state === "failed" ? <Notice tone="danger" title="Review unavailable" description={resource.error} /> : <LogSkeleton />;
  const review = resource.page?.ocr;
  const discarded = resource.discarded;
  const selected = review?.revision.records.filter(record => (resource.includes[record.recordId] ?? !record.discarded));
  const ready = selected?.filter(record => record.assertedEid !== null && record.fields.blockingPaths.length === 0).length ?? 0;
  return <>
    {resource.state === "failed" ? <Notice tone="danger" title="Review unavailable" description={resource.error} /> : resource.state === "loading" ? <Badge tone="neutral">Refreshing</Badge> : undefined}
    {resource.feedback && <Notice sticky tone="warning" title="Review changes" description={resource.feedback} />}
    {resource.feedback && (resource.check ?? resource.reload) && <Button variant="secondary" className="self-start" onClick={resource.check ?? resource.reload}>{resource.check ? "Check result" : "Discard local changes"}</Button>}
    <RecordReview runId={selection.row.runId} subject={selection.row.title} cards={cards.map(card => ({ ...card,
      disposition: resource.readOnly ? card.disposition : discarded ? { label: "Discarded", tone: "neutral" } : undefined }))} readOnly={resource.readOnly || discarded}
      disabled={resource.disabled} actionsDisabled={resource.actionsDisabled} discarded={discarded} selectedCount={ready} focusId={focus?.recordId}
      onEditField={resource.edit} onCommit={resource.flush} onChange={record => {
        const current = cards.find(card => card.record.id === record.id)?.record;
        if (record.manualEntry && current !== undefined && record.page !== current.page) resource.edit(record.id, "sourcePage", String(record.page));
        else resource.include([{ id: record.id, selected: record.selected }]);
      }}
      onApprove={review?.approval === undefined ? undefined : resource.approve}
      approvalError={ready !== selected?.length ? "Resolve the selected records before approval." : undefined}
      onDiscard={resource.readOnly ? undefined : () => resource.include(cards.filter(card => card.record.selected).map(card => ({ id: card.record.id, selected: false })), true)}
      onRestore={resource.readOnly ? undefined : resource.restore} />
  </>;
}

function ReviewSourcePreview({ recordId, subject, pages, recordPage, onPageChange, fullscreen = false, onFullscreenChange }: { recordId: string; subject: string; pages: readonly ReviewSourcePage[]; recordPage: number; onPageChange?: (page: number) => void; fullscreen?: boolean; onFullscreenChange?: (fullscreen: boolean) => void }) {
  const [reviewPages, setReviewPages] = useViewState("reviewPages", {});
  const sourceIndex = reviewPages[recordId] ?? Math.max(0, pages.findIndex(page => page.page === recordPage));
  const setSourceIndex = (index: number) => setReviewPages(current => ({ ...current, [recordId]: index }));
  const [zoom, setZoom] = useState(100);
  const [aspectRatio, setAspectRatio] = useState(612 / 792);
  const [failedImage, setFailedImage] = useState<string>();
  const [loadedImage, setLoadedImage] = useState<string>();
  const imageViewport = useRef<HTMLDivElement>(null);
  const source = pages[sourceIndex];
  const imageError = source !== undefined && failedImage === source.imageUrl;
  const fitPage = () => { setZoom(100); imageViewport.current?.scrollTo({ left: 0, top: 0 }); };
  const available = Boolean(source && !imageError);
  const loading = available && loadedImage !== source.imageUrl;
  return <section aria-label="Source PDF" data-review-fullscreen={fullscreen || undefined} className={cn("min-w-0 bg-ui-table p-3", fullscreen ? "flex min-h-0 flex-1 flex-col" : "border-r border-ui-stroke")}>
    <div className="mb-2 flex flex-wrap items-center gap-2">
      {source && <div className="min-w-0 flex-1">{pages.length > 1 ? <Select aria-label="Source page" value={String(sourceIndex)} onChange={event => { setSourceIndex(Number(event.target.value)); onPageChange?.(pages[Number(event.target.value)].page); setFailedImage(undefined); fitPage(); }} className="w-44 max-w-full">{pages.map((page, index) => <option key={page.page} value={index}>{page.label ?? `Page ${page.page}`}</option>)}</Select> : <span className="text-caption text-ui-muted">Page {source.page}</span>}</div>}
      <div role="toolbar" aria-label="PDF controls" className="ml-auto flex shrink-0 items-center gap-1">
        <IconButton variant="ghost" label="Zoom out" icon={<ZoomOut aria-hidden className="size-4" />} disabled={!available || loading || zoom <= 50} onClick={() => setZoom(Math.max(50, zoom - 25))} />
        <IconButton variant="ghost" label="Zoom in" icon={<ZoomIn aria-hidden className="size-4" />} disabled={!available || loading || zoom >= 200} onClick={() => setZoom(Math.min(200, zoom + 25))} />
        {onFullscreenChange && <IconButton variant="ghost" label={fullscreen ? "Exit full screen" : "Full screen"} icon={fullscreen ? <Minimize aria-hidden className="size-4" /> : <Maximize aria-hidden className="size-4" />} onClick={() => onFullscreenChange(!fullscreen)} />}
      </div>
    </div>
    <div data-review-preview className={cn("relative min-w-0", fullscreen && "min-h-0 flex-1")} style={fullscreen ? undefined : { aspectRatio }}>
      <div ref={imageViewport} tabIndex={0} aria-label="PDF page image" className={cn("absolute inset-0 overflow-auto rounded-sm border border-ui-stroke", dsFocus)}>
        {available ? <img src={source.imageUrl} alt={`Source page ${source.page} of ${subject}`} loading="lazy" className="mx-auto block max-w-none" style={fullscreen ? { height: `${zoom}%`, width: "auto" } : { width: `${zoom}%`, height: "auto" }} onLoad={event => { setAspectRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight); setLoadedImage(source.imageUrl); }} onError={() => setFailedImage(source.imageUrl)} /> : <p role="status" className="m-0 p-3 text-body text-ui-muted">{imageError ? "Source page unavailable" : "No source page for this record"}</p>}
        {loading && <LoadingRegion label="Loading source PDF" className="absolute inset-0"><Skeleton className="h-full w-full rounded-none" /></LoadingRegion>}
      </div>
    </div>
  </section>;
}

function ReviewRecordCard({ runId, subject, record, name, original, pages, readOnly, disabled, selectionDisabled, disposition, approvalError, onChange, onEditField, onFocus, onFullscreen }: {
  runId: string; subject: string; record: ReviewRecordView; name: string; original?: ReviewRecordView; pages: readonly ReviewSourcePage[];
  readOnly: boolean; disabled?: boolean; selectionDisabled?: boolean; disposition?: Readonly<{ label: string; tone: "success" | "neutral" }>;
  approvalError?: string; onChange?: (record: ReviewRecordView) => void; onEditField?: (key: string, value: string) => void; onFocus?: () => void; onFullscreen?: () => void;
}) {
  const update = (key: string, value: string) => onEditField?.(key, value);
  const renderField = (item: ReviewField) => {
    const { wide, multiline } = reviewFieldPresentation(item);
    const changed = original?.fields.find(field => field.key === item.key)?.value !== item.value;
    if (readOnly || item.readOnly) return <dl key={item.key} className={cn("m-0 min-w-0", wide && "col-span-full")}><dt className="text-caption text-ui-muted">{item.label}</dt><dd className="m-0 mt-1 whitespace-pre-wrap break-words text-body">{item.kind === "boolean" ? item.value === "true" ? "Yes" : item.value === "false" ? "No" : item.value || "—" : (item.kind === "date" ? displayExtractedDate(item.value) : item.value) || "—"}</dd></dl>;
    if (item.kind === "boolean") return <Checkbox disabled={disabled} key={item.key} label={item.label} checked={item.value === "true" ? true : item.value === "false" ? false : "indeterminate"} onCheckedChange={value => update(item.key, String(value === true))} />;
    return <Field key={item.key} className={wide ? "col-span-full" : undefined} label={<span className="inline-flex flex-wrap items-center gap-x-2">{item.label}{changed && original && <span className="text-caption font-normal text-ui-info">Edited</span>}</span>}>
      {record.manualEntry && /^section[12]$/u.test(item.key) ? <Select disabled={disabled} aria-label={item.label} value={item.value} onChange={event => update(item.key, event.target.value)}>{Array.from({ length: record.sourcePageCount ?? 1 }, (_, index) => <option key={index + 1} value={index + 1}>Page {index + 1}</option>)}</Select> : item.kind === "relationship" ? <Select disabled={disabled} aria-label={item.label} value={item.value} onChange={event => update(item.key, event.target.value)}>{!REVIEW_RELATIONSHIPS.includes(item.value) && <option value={item.value}>{item.value || "Unspecified"}</option>}{REVIEW_RELATIONSHIPS.map(value => <option key={value} value={value}>{value}</option>)}</Select> : multiline ? <Textarea disabled={disabled} aria-label={item.label} name={item.key} rows={2} value={item.value} onChange={event => update(item.key, event.target.value)} /> : <Input disabled={disabled} aria-label={item.label} name={item.key} spellCheck={item.key === "employeeId" ? false : undefined} type="text" placeholder={item.kind === "date" ? "MM/DD/YYYY" : undefined} value={item.kind === "date" ? displayExtractedDate(item.value) : item.value} onChange={event => update(item.key, event.target.value)} />}
    </Field>;
  };
  return <section aria-label={`Record ${record.id}`} data-review-record-id={record.id} onFocusCapture={onFocus} className="grid min-w-0 grid-cols-[minmax(0,3fr)_minmax(0,2fr)] overflow-hidden rounded-lg border border-ui-stroke bg-ui-panel">
    <ReviewSourcePreview key={JSON.stringify([runId, pages.map(page => page.identity ?? page.imageUrl)])} recordId={`${runId}:${record.id}`} subject={subject} pages={pages} recordPage={record.page} onPageChange={record.manualEntry && !readOnly && record.kind !== "i9" ? page => onChange?.({ ...record, page }) : undefined} onFullscreenChange={onFullscreen && (() => onFullscreen())} />
    <div data-review-fields className="@container/record min-w-0 space-y-3 bg-ui-table p-3">
      <Card role="group" aria-label="Record selection">
        <CardBody className="space-y-2 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Checkbox className="min-w-0 flex-1" label={<><span className="sr-only">Include </span><span data-ocr-review-heading role="heading" aria-level={3} tabIndex={-1} className={cn("inline-block min-w-0 break-words rounded-sm text-body font-medium", dsFocus)}>{name}</span></>} checked={record.selected} disabled={disabled || selectionDisabled || readOnly || record.unknown} onCheckedChange={selected => onChange?.({ ...record, selected: selected === true })} />
            {disposition && <Badge tone={disposition.tone}>{disposition.label}</Badge>}
          </div>
          {record.warnings.length > 0 && <div role="status">{record.warnings.map(warning => <p key={warning} className="m-0 text-caption text-ui-warning">{warning}</p>)}</div>}
          {!readOnly && record.selected && approvalError !== undefined && <p role="status" className="m-0 text-caption text-ui-warning">{approvalError}</p>}
        </CardBody>
      </Card>
      {reviewFieldGroups(record).map(group => <section key={group.fields[0].key}><h4 className="mb-2 mt-0 text-body font-medium">{group.title}</h4><Card role="group" aria-label={group.title}><CardBody className="p-3"><div className="grid grid-cols-1 gap-2 @min-[16rem]/record:grid-cols-2">{reviewFieldBlocks(group.fields).map(block => block[0].kind === "boolean" ? <div key={block[0].key} className="col-span-full flex flex-wrap items-center gap-x-4 gap-y-2 py-1">{block.map(renderField)}</div> : renderField(block[0]))}</div></CardBody></Card></section>)}
    </div>
  </section>;
}

export function RecordReview({ runId, subject, cards, readOnly, discarded, selectedCount: count, disabled, actionsDisabled, focusId: requestedFocus,
  approvalError, onEditField, onCommit, onChange, onApprove, onDiscard, onRestore }: RecordReviewProps) {
  const records = cards.map(card => card.record);
  const body = useRef<HTMLDivElement>(null);
  const focusId = useRef(records[0]?.id);
  const focusRecord = (id: string | undefined, selector: string, preventScroll = false) => {
    const card = [...body.current?.querySelectorAll<HTMLElement>("[data-review-record-id]") ?? []].find(node => node.dataset.reviewRecordId === id);
    card?.querySelector<HTMLElement>(selector)?.focus({ preventScroll });
  };
  const focused = useRef<string>(undefined);
  const escape = useContext(ReviewEscape);
  const [fullscreenId, setFullscreenId] = useState<string>();
  const fullscreen = cards.find(card => card.record.id === fullscreenId);
  const lastFullscreen = useRef<string>(undefined);
  useEffect(() => {
    if (escape === undefined) return;
    escape.current = fullscreen === undefined ? undefined : () => setFullscreenId(undefined);
    return () => { escape.current = undefined; };
  }, [escape, fullscreen]);
  useEffect(() => {
    if (fullscreenId !== undefined) lastFullscreen.current = fullscreenId;
    const frame = requestAnimationFrame(() => {
      if (fullscreenId !== undefined) body.current?.parentElement?.querySelector<HTMLElement>('[data-review-fullscreen] button[aria-label="Exit full screen"]')?.focus();
      else if (lastFullscreen.current !== undefined) focusRecord(lastFullscreen.current, 'button[aria-label="Full screen"]', true);
    });
    return () => cancelAnimationFrame(frame);
  }, [fullscreenId]);
  useEffect(() => {
    const id = requestedFocus ?? cards[0]?.record.id;
    const owner = JSON.stringify([runId, id]);
    if (focused.current === owner) return;
    const frame = requestAnimationFrame(() => {
      focusRecord(id, "[data-ocr-review-heading]", requestedFocus === undefined);
      focused.current = owner;
    });
    return () => cancelAnimationFrame(frame);
  }, [runId, requestedFocus, cards]);
  return <section aria-label="OCR records" onBlurCapture={event => {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) onCommit?.();
  }} onKeyDown={event => {
    if (!discarded || disabled || actionsDisabled || onRestore === undefined || event.defaultPrevented || event.repeat || event.altKey || event.shiftKey
      || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z"
      || (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]'))) return;
    event.preventDefault();
    onRestore();
    requestAnimationFrame(() => focusRecord(focusId.current, "[data-ocr-review-heading]", true));
  }} className="flex min-h-0 min-w-0 flex-1 flex-col text-ui-primary">
    {fullscreen && <ReviewSourcePreview key={`full:${fullscreen.record.id}`} recordId={`${runId}:${fullscreen.record.id}`} subject={subject} pages={fullscreen.pages} recordPage={fullscreen.record.page} fullscreen onFullscreenChange={() => setFullscreenId(undefined)}
      onPageChange={fullscreen.record.manualEntry && !readOnly && fullscreen.record.kind !== "i9" ? page => onChange?.({ ...fullscreen.record, page }) : undefined} />}
    <div ref={body} aria-label="Record review cards" tabIndex={0} className={cn("min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto p-3", dsFocus, fullscreen && "hidden")}>
      {records.length === 0 ? <div role="status" className="flex h-full items-center justify-center text-body text-ui-muted">No records extracted</div> : cards.map(card => <ReviewRecordCard key={card.record.id} runId={runId} subject={subject} {...card} readOnly={readOnly} disabled={disabled} selectionDisabled={actionsDisabled}
        onFocus={() => { focusId.current = card.record.id; }} onFullscreen={() => setFullscreenId(card.record.id)} onEditField={(key, value) => onEditField?.(card.record.id, key, value)} onChange={onChange} />)}
    </div>
    {(onApprove || onDiscard) && !discarded && !fullscreen && <footer className="flex shrink-0 flex-wrap items-center gap-3 border-t border-ui-stroke bg-ui-table px-3 py-3">
      {onApprove && <div className="min-w-0 flex-1 text-caption"><span className="text-ui-muted">{count} selected for approval</span>{approvalError && <p role="status" className="m-0 mt-1 text-ui-warning">{approvalError}</p>}</div>}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        {onDiscard && !discarded && <Button disabled={disabled || actionsDisabled} onClick={() => {
          onDiscard(); requestAnimationFrame(() => focusRecord(focusId.current, "[data-ocr-review-heading]", true));
        }}>Discard</Button>}
        {onApprove && <Button variant="primary" disabled={actionsDisabled || disabled || count === 0 || Boolean(approvalError)} onClick={() => { onApprove(); requestAnimationFrame(() => focusRecord(focusId.current, "[data-ocr-review-heading]", true)); }}>Approve records</Button>}
      </div>
    </footer>}
  </section>;
}
