import { TimelineEventRecordSchema, type TimelineEventRecord, type TimelineRepository } from "../../../../src/models/events/timeline.js";
export function debugTimelineFixture() {
  const records: TimelineEventRecord[] = [];
  const repository: TimelineRepository = { withReadSnapshot: read => read(),
    append(input) { const record = TimelineEventRecordSchema.parse({ ...(input as object), cursor: records.length + 1 });
      const existing = records.find(row => row.eventId === record.eventId);
      if (existing !== undefined) return { state: "existing", record: existing };
      records.push(record); return { state: "inserted", record }; },
    get: id => records.find(row => row.eventId === id), page: () => records, highWaterMark: () => records.length, pruneBefore: () => 0, confirmedActionHeads: () => [], lastWorkerClaim: () => undefined };
  return { records, repository };
}
