import type { ConfirmedActionEvent } from "../../models/events/confirmed-action.js";
import type { RunRecord } from "../../models/run/record.js";
import type { TimelineRepository, TimelineEventRecord } from "../../models/events/timeline.js";
import type { TimelineCursor } from "../storage/events/timeline-reader.js";

export interface RunLogTail {
  readonly events: readonly ConfirmedActionEvent[];
  readonly cursors: ReadonlyMap<string, TimelineCursor>;
  readonly pruned: boolean;
  readonly parsedLines: number;
  readonly bytesRead: number;
  readonly hasMore: boolean;
}

function confirmedOf(record: TimelineEventRecord): ConfirmedActionEvent | undefined {
  if (record.payload.kind !== "note") return undefined;
  const event = record.payload.note.confirmedAction;
  if (event !== undefined && event.eventId !== `${event.workerStreamId}/${String(event.sequence)}`) {
    throw new Error("run-log-stream-identity-mismatch");
  }
  return event;
}

export function createRunLogStreamStore(repository: TimelineRepository) {
  return Object.freeze({
    tail(cursors: ReadonlyMap<string, TimelineCursor>): RunLogTail {
      return repository.withReadSnapshot(() => {
        const after = cursors.get("timeline")?.linesConsumed ?? 0;
        const through = repository.highWaterMark();
        if (after > through) throw new Error("run-log-cursor-reset-required");
        const records = repository.page({ after, through, limit: 200 });
        const cursor = records.at(-1)?.cursor ?? through;
        return { events: records.flatMap(record => { const event = confirmedOf(record); return event === undefined ? [] : [event]; }),
          cursors: new Map([["timeline", { linesConsumed: cursor, bytesConsumed: 0 }]]),
          pruned: false, parsedLines: records.length,
          bytesRead: records.reduce((sum, record) => sum + Buffer.byteLength(JSON.stringify(record)), 0),
          hasMore: cursor < through };
      });
    },
    snapshot(authority: RunRecord) {
      return repository.withReadSnapshot(() => {
        const runId = authority.envelope.runId;
        const through = repository.highWaterMark();
        let cursor = 0, eventCount = 0, parsedLines = 0;
        const events: ConfirmedActionEvent[] = [];
        for (;;) {
          const records = repository.page({ after: cursor, through, runId, limit: 200 });
          parsedLines += records.length;
          for (const record of records) {
            const event = confirmedOf(record);
            if (event === undefined) continue;
            if (event.action.runId !== runId || event.traceId !== authority.envelope.traceId
              || event.action.attempt > authority.envelope.attempt
              || event.action.definitionFingerprint !== authority.envelope.contractFingerprint) {
              throw new Error("run-log-history-owner-mismatch");
            }
            eventCount++;
            events.push(event);
            if (events.length > 200) events.shift();
          }
          const last = records.at(-1);
          if (last === undefined || records.length < 200) return { events, hasEarlier: eventCount > 200, parsedLines };
          cursor = last.cursor;
        }
      });
    },
  });
}
