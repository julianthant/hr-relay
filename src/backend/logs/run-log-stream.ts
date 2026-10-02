import { NoteWireSchema } from "../../models/events/types.js";
import type { ConfirmedActionEvent } from "../../models/events/confirmed-action.js";
import type { RunRecord } from "../../models/run/record.js";
import { runNotePartitionScope, runRecordNoteScopeInstants } from "../../models/run/note-scope.js";
import { readEventStreamLinesFrom,
  type EventStreamFileCursor, type EventStreamLine } from "../storage/events/jsonl-streams.js";

function confirmedOf(line: EventStreamLine): ConfirmedActionEvent | undefined {
  let note: ReturnType<typeof NoteWireSchema.parse>;
  try { note = NoteWireSchema.parse(JSON.parse(line.text)); }
  catch (cause) { throw new Error(`run-log-line-invalid:${line.file.path}:${String(line.lineNumber)}`, { cause }); }
  if (note.workflow !== line.file.workflow) throw new Error(`run-log-partition-owner-mismatch:${line.file.path}:${String(line.lineNumber)}`);
  const event = note.confirmedAction;
  if (event !== undefined && event.eventId !== `${event.workerStreamId}/${String(event.sequence)}`) {
    throw new Error(`run-log-stream-identity-mismatch:${line.file.path}:${String(line.lineNumber)}`);
  }
  return event;
}

export interface RunLogTail {
  readonly events: readonly ConfirmedActionEvent[];
  readonly cursors: ReadonlyMap<string, EventStreamFileCursor>;
  readonly pruned: boolean;
  readonly parsedLines: number;
  readonly bytesRead: number;
  readonly hasMore: boolean;
}

/** The same notes authority serves one scoped history read and incremental complete-line recovery. */
export function createRunLogStreamStore(stateRoot: string,
  readFrom: typeof readEventStreamLinesFrom = readEventStreamLinesFrom): Readonly<{
  tail(cursors: ReadonlyMap<string, EventStreamFileCursor>): RunLogTail;
  snapshot(authority: RunRecord): Readonly<{ events: readonly ConfirmedActionEvent[]; hasEarlier: boolean; parsedLines: number }>;
}> {
  return Object.freeze({
    tail(cursors) {
      const result = readFrom(stateRoot, "notes", cursors, undefined,
        { maxBytes: 256 * 1024, maxLines: 200 });
      const events = result.lines.flatMap(line => {
        const event = confirmedOf(line);
        return event === undefined ? [] : [event];
      });
      return { events, cursors: result.cursors,
        pruned: [...cursors.keys()].some(path => !result.cursors.has(path)),
        parsedLines: result.lines.length, bytesRead: result.bytesRead ?? 0,
        hasMore: result.hasMore ?? false };
    },
    snapshot(authority) {
      const runId = authority.envelope.runId;
      const scope = runNotePartitionScope({ runId, workflow: authority.envelope.workflow,
        instants: runRecordNoteScopeInstants(authority) });
      const events: ConfirmedActionEvent[] = [];
      let eventCount = 0;
      let cursors: ReadonlyMap<string, EventStreamFileCursor> = new Map();
      let parsedLines = 0;
      for (let page = 0; page < 256; page++) {
        const batch = readFrom(stateRoot, "notes", cursors, scope,
          { maxBytes: 256 * 1024, maxLines: 200 });
        cursors = batch.cursors;
        parsedLines += batch.lines.length;
        for (const line of batch.lines) {
          const event = confirmedOf(line);
          if (event === undefined || event.action.runId !== runId) continue;
          if (event.traceId !== authority.envelope.traceId || event.action.attempt > authority.envelope.attempt
            || event.action.definitionFingerprint !== authority.envelope.contractFingerprint) {
            throw new Error(`run-log-history-owner-mismatch:${line.file.path}:${String(line.lineNumber)}`);
          }
          eventCount++;
          events.push(event);
          if (events.length > 200) events.shift();
        }
        if (!batch.hasMore) return { events, hasEarlier: eventCount > 200, parsedLines };
      }
      throw new Error("run-log-snapshot-scan-bound-exceeded");
    },
  });
}
