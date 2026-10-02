import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
import type { TimelineEventRecord, TimelineRepository } from "../../../domain/events/timeline.js";
import type { EventStreamLine } from "./jsonl-streams.js";

/** Shared cursor paging for BFF, scenarios and recovery, under one read snapshot. */
export function readTimelineRecords(repository: TimelineRepository, after = 0, runId?: string) {
  return repository.withReadSnapshot(() => {
    const through = repository.highWaterMark();
    if (through < after) throw new Error("timeline-cursor-reset-required");
    const records: TimelineEventRecord[] = [];
    let cursor = after;
    for (;;) {
      const page = repository.page({ after: cursor, through, limit: 500, ...(runId === undefined ? {} : { runId }) });
      records.push(...page);
      const last = page.at(-1);
      if (last === undefined || page.length < 500) break;
      cursor = last.cursor;
    }
    return { records, cursor: through };
  });
}

/**
 * The logs reader shares its location carrier with the unchanged notes stream.
 * A timeline address is an event identity, never a filename to open or tail.
 */
export function timelineSpanLocation(record: TimelineEventRecord): EventStreamLine {
  if (record.payload.kind !== "span") throw new Error("timeline-span-location-kind");
  return { file: { stream: "spans", workflow: record.workflow, date: record.retentionDate,
    path: `timeline:${record.eventId}` }, lineNumber: record.cursor,
    text: canonicalJsonStringify(record.payload.event) };
}
