import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import type { TimelinePageRequestSchema, TimelineEventRecord, TimelineRepository } from "../../../models/events/timeline.js";
export interface TimelineLine {
  readonly file: { readonly stream: "spans" | "notes"; readonly workflow: string; readonly date: string; readonly path: string };
  readonly lineNumber: number;
  readonly text: string;
}
export interface TimelineCursor {
  readonly bytesConsumed: number;
  readonly linesConsumed: number;
}


/** Shared cursor paging for BFF, scenarios and recovery, under one read snapshot. */
export function readTimelineRecords(repository: Pick<TimelineRepository, "withReadSnapshot" | "highWaterMark" | "page">, after = 0, runId?: string,
  spanTypes?: Parameters<TimelineRepository["page"]>[0]["spanTypes"]) {
  return repository.withReadSnapshot(() => {
    const through = repository.highWaterMark();
    if (through < after) throw new Error("timeline-cursor-reset-required");
    const records: TimelineEventRecord[] = [];
    let cursor = after;
    for (;;) {
      const page = repository.page({ after: cursor, through, limit: 500, ...(runId === undefined ? {} : { runId }),
        ...(spanTypes === undefined ? {} : { spanTypes }) });
      records.push(...page);
      const last = page.at(-1);
      if (last === undefined || page.length < 500) break;
      cursor = last.cursor;
    }
    return { records, cursor: through };
  });
}

export function readDashboardLogPage(
  repository: Pick<TimelineRepository, "withReadSnapshot" | "highWaterMark" | "page">,
  request: ReturnType<typeof TimelinePageRequestSchema.parse>, pages: number,
) {
  return repository.withReadSnapshot(() => {
    const highWaterMark = repository.highWaterMark();
    const through = Math.min(request.through ?? highWaterMark, highWaterMark);
    if (request.after > through) throw new Error("timeline-diagnostic-cursor-out-of-range");
    const records: TimelineEventRecord[] = [];
    let nextCursor = request.after;
    for (let page = 0; page < pages; page += 1) {
      const scanned = repository.page({ ...request, after: nextCursor, through });
      records.push(...scanned);
      nextCursor = scanned.at(-1)?.cursor ?? through;
      if (nextCursor === through) break;
    }
    return { records, after: request.after, nextCursor, through, highWaterMark, hasMore: nextCursor < through };
  });
}

export function timelineSpanLocation(record: TimelineEventRecord): TimelineLine {
  if (record.payload.kind !== "span") throw new Error("timeline-span-location-kind");
  return { file: { stream: "spans", workflow: record.workflow!, date: record.retentionDate,
    path: `timeline:${record.eventId}` }, lineNumber: record.cursor,
    text: canonicalJsonStringify(record.payload.event) };
}

export function timelineNoteLocation(record: TimelineEventRecord): TimelineLine {
  if (record.payload.kind !== "note") throw new Error("timeline-note-location-kind");
  return { file: { stream: "notes", workflow: record.workflow!, date: record.retentionDate,
    path: `timeline:${record.eventId}` }, lineNumber: record.cursor,
    text: canonicalJsonStringify(record.payload.note) };
}
