import { useEffect, useMemo, useRef } from "react";
import type { DelegatedRecordRef } from "../../../../models/workflow/delegated-record.js";
import { useDashboardClient, useDashboardCommandBinding } from "../../../state/client-context.js";
import { useRunReview } from "../../../state/review-wiring-adapter.js";
import type { LogSelection } from "../logs/log-selection-model.js";
import { Banner, Badge, dsFocus } from "../../../ds/ui.js";
import { LogSkeleton } from "../../shared/loading/loading.js";
import { cn } from "../../../lib/utils.js";
import { ReviewRecordCard } from "./review-record.js";
import { ocrReviewCards } from "./review-model.js";

export function RunReview({ selection, focus }: { selection: LogSelection; focus?: DelegatedRecordRef }) {
  const client = useDashboardClient();
  const binding = useDashboardCommandBinding();
  const resource = useRunReview(client, selection, binding);
  const body = useRef<HTMLDivElement>(null);
  const focused = useRef<string>(undefined);
  const cards = useMemo(() => resource.page?.ocr === undefined ? undefined : ocrReviewCards(resource.page, (runId, revision, page) => client.ocrSourcePageUrl(runId, revision, page)), [resource.page, client]);
  const missing = focus !== undefined && cards !== undefined
    && (focus.runId !== selection.row.runId || !cards.some(card => card.record.id === focus.recordId));
  useEffect(() => {
    if (cards === undefined || missing) return;
    const id = focus?.recordId ?? cards[0]?.record.id;
    const key = JSON.stringify([selection.row.runId, id]);
    if (focused.current === key) return;
    const frame = requestAnimationFrame(() => {
      const card = [...body.current?.querySelectorAll<HTMLElement>("[data-review-record-id]") ?? []].find(node => node.dataset.reviewRecordId === id);
      const heading = card?.querySelector<HTMLElement>("[data-ocr-review-heading]");
      if (heading !== undefined && heading !== null) { heading.focus({ preventScroll: focus === undefined }); focused.current = key; }
    });
    return () => cancelAnimationFrame(frame);
  }, [cards, focus, missing, selection.row.runId]);
  if (resource.page !== undefined && resource.page.ocr === undefined) return <Banner tone="danger" title="Review unavailable">OCR review authority is unavailable.</Banner>;
  if (missing) return <Banner tone="danger" title="Record unavailable">The selected record does not belong to this review.</Banner>;
  if (cards === undefined) return resource.state === "failed" ? <Banner tone="danger" title="Review unavailable">{resource.error}</Banner> : <LogSkeleton />;
  return <section aria-label="OCR records" className="flex min-h-0 min-w-0 flex-1 flex-col text-ui-primary">
    {resource.state === "failed" ? <Banner tone="danger" title="Review unavailable">{resource.error}</Banner> : resource.state === "loading" ? <Badge tone="neutral">Refreshing</Badge> : undefined}
    <div ref={body} aria-label="Record review cards" tabIndex={0} className={cn("min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto p-3", dsFocus)}>
      {cards.length === 0 ? <div role="status" className="flex h-full items-center justify-center text-body text-ui-muted">No records extracted</div> : cards.map(card => <ReviewRecordCard key={card.record.id} runId={selection.row.runId} subject={selection.row.title} {...card} readOnly />)}
    </div>
  </section>;
}
