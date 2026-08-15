/**
 * The two JSONL event streams on disk (doc 03 §2.1): `spans/` and `notes/`
 * under the config-resolved state root, one file per `<workflow>-<date>`,
 * `O_APPEND` single-line writes, append-at-now partitioning, and the D86
 * 30-day prune. The ledger is deliberately NOT here — it has its own
 * serialized outbox projector (doc 09) and is never pruned.
 */
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Clock } from "../../domain/clock.js";
import { localDatePart } from "../../domain/clock.js";
import { EVENT_STREAM_RETENTION_DAYS } from "../../domain/archive/retention.js";

export const EVENT_STREAMS = ["spans", "notes"] as const;
export type EventStream = (typeof EVENT_STREAMS)[number];

const STREAM_FILE_PATTERN = /^([a-z0-9]+(?:-[a-z0-9]+)*)-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const DateOnlySchema = z.iso.date();

export function eventStreamFileName(workflow: string, date: string): string {
  return `${workflow}-${DateOnlySchema.parse(date)}.jsonl`;
}

export function eventStreamDirectory(stateRoot: string, stream: EventStream): string {
  return join(stateRoot, stream);
}

/**
 * One event, one line, one `O_APPEND` write. The handle is opened per append —
 * these are low-volume files and a held handle would complicate prune — and
 * closed even when the write throws.
 */
export function appendEventStreamLine(
  stateRoot: string,
  stream: EventStream,
  workflow: string,
  date: string,
  line: string,
): void {
  if (line.includes("\n")) {
    throw new Error(`refusing to append a multi-line record to ${stream}/${workflow}-${date}: JSONL is one line per event`);
  }
  const directory = eventStreamDirectory(stateRoot, stream);
  mkdirSync(directory, { recursive: true });
  const handle = openSync(join(directory, eventStreamFileName(workflow, date)), "a");
  try {
    writeSync(handle, `${line}\n`);
  } finally {
    closeSync(handle);
  }
}

export interface EventStreamFile {
  readonly stream: EventStream;
  readonly workflow: string;
  readonly date: string;
  readonly path: string;
}

/**
 * Every file in a stream directory, sorted by (date, workflow) so a replay
 * folds days in order. A file that does not match `<workflow>-<date>.jsonl`
 * is a corruption of an owned directory and fails loud — skipping it would
 * silently exclude events from every rebuild that follows.
 */
export function listEventStreamFiles(stateRoot: string, stream: EventStream): readonly EventStreamFile[] {
  const directory = eventStreamDirectory(stateRoot, stream);
  if (!existsSync(directory)) return [];
  const files: EventStreamFile[] = [];
  for (const name of readdirSync(directory)) {
    const match = STREAM_FILE_PATTERN.exec(name);
    if (match === null) {
      throw new Error(`${stream}/ contains ${name}, which is not a <workflow>-<date>.jsonl stream file; refusing to enumerate around it`);
    }
    files.push({ stream, workflow: match[1], date: match[2], path: join(directory, name) });
  }
  return files.sort((a, b) => (a.date === b.date ? a.workflow.localeCompare(b.workflow) : a.date.localeCompare(b.date)));
}

export interface EventStreamLine {
  readonly file: EventStreamFile;
  readonly lineNumber: number;
  readonly text: string;
}

/** Every non-empty line of a stream, in (date, workflow, line) order. */
export function readEventStreamLines(stateRoot: string, stream: EventStream): readonly EventStreamLine[] {
  const lines: EventStreamLine[] = [];
  for (const file of listEventStreamFiles(stateRoot, stream)) {
    const rows = readFileSync(file.path, "utf8").split("\n");
    for (const [index, text] of rows.entries()) {
      if (text === "") continue;
      lines.push({ file, lineNumber: index + 1, text });
    }
  }
  return lines;
}

export interface EventStreamFileCursor {
  /** Bytes consumed so far — always ending exactly at a newline (or 0). */
  readonly bytesConsumed: number;
  /** Newline-terminated lines consumed — the base `lineNumber` continues from. */
  readonly linesConsumed: number;
}

export interface EventStreamTailResult {
  readonly lines: readonly EventStreamLine[];
  /** The resume state: one entry per currently-listed stream file, keyed by path. */
  readonly cursors: ReadonlyMap<string, EventStreamFileCursor>;
}

/**
 * Cursor-based read — the offset-aware half of the D218 cross-process tailer.
 * Returns every COMPLETE line appended since `cursors`, in the same
 * (date, workflow, line) order as `readEventStreamLines`, plus the cursors to
 * resume from. Three properties are load-bearing:
 *
 * - A trailing line whose newline has not landed is NOT consumed: another
 *   process may be mid-append, and parsing half a record would report real
 *   history as corrupt. The returned cursor stops at the last newline, so the
 *   torn tail is read whole on a later call.
 * - A file SHORTER than its cursor fails loud. These streams are append-only,
 *   so a shrink is truncation of history, never a state to read around.
 * - A file the directory no longer lists (the D86 prune) simply leaves the
 *   result cursors; a file the cursors have never seen (day roll, new
 *   workflow) is read from byte 0.
 */
export function readEventStreamLinesFrom(
  stateRoot: string,
  stream: EventStream,
  cursors: ReadonlyMap<string, EventStreamFileCursor>,
): EventStreamTailResult {
  const lines: EventStreamLine[] = [];
  const nextCursors = new Map<string, EventStreamFileCursor>();
  for (const file of listEventStreamFiles(stateRoot, stream)) {
    const cursor = cursors.get(file.path) ?? { bytesConsumed: 0, linesConsumed: 0 };
    const size = statSync(file.path).size;
    if (size < cursor.bytesConsumed) {
      throw new Error(
        `${file.path} shrank from ${String(cursor.bytesConsumed)} to ${String(size)} bytes; `
        + "an append-only stream file was truncated and this tail refuses to guess what survived",
      );
    }
    if (size === cursor.bytesConsumed) {
      nextCursors.set(file.path, cursor);
      continue;
    }
    const chunk = Buffer.alloc(size - cursor.bytesConsumed);
    const handle = openSync(file.path, "r");
    try {
      let filled = 0;
      while (filled < chunk.length) {
        const got = readSync(handle, chunk, filled, chunk.length - filled, cursor.bytesConsumed + filled);
        if (got === 0) {
          throw new Error(
            `${file.path} ended ${String(chunk.length - filled)} bytes before its just-observed size; `
            + "an append-only stream file was truncated mid-read",
          );
        }
        filled += got;
      }
    } finally {
      closeSync(handle);
    }
    // A `\n` is a single byte and no UTF-8 continuation byte can equal it, so
    // splitting on the raw byte before decoding cannot cut a character.
    const lastNewline = chunk.lastIndexOf(0x0a);
    if (lastNewline === -1) {
      nextCursors.set(file.path, cursor);
      continue;
    }
    const segments = chunk.subarray(0, lastNewline + 1).toString("utf8").split("\n");
    segments.pop(); // the empty segment after the final consumed newline
    for (const [index, text] of segments.entries()) {
      if (text === "") continue;
      lines.push({ file, lineNumber: cursor.linesConsumed + index + 1, text });
    }
    nextCursors.set(file.path, {
      bytesConsumed: cursor.bytesConsumed + lastNewline + 1,
      linesConsumed: cursor.linesConsumed + segments.length,
    });
  }
  return Object.freeze({ lines: Object.freeze(lines), cursors: nextCursors });
}

export interface PruneReport {
  readonly cutoffDate: string;
  readonly removed: readonly string[];
}

/**
 * D86: `spans/` and `notes/` prune at 30 days, by file date. The ledger is
 * exempt by construction — this function can only see the two event streams.
 */
export function pruneEventStreams(input: Readonly<{
  stateRoot: string;
  clock: Clock;
  retentionDays?: number;
}>): PruneReport {
  // ONE constant: the Archive's retention block computes its purge instants
  // from the same number, so the date a surface shows and the date this sweep
  // acts on cannot drift apart.
  const retentionDays = z.number().int().positive().parse(input.retentionDays ?? EVENT_STREAM_RETENTION_DAYS);
  const cutoff = new Date(input.clock.now().getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const cutoffDate = localDatePart(cutoff);
  const removed: string[] = [];
  for (const stream of EVENT_STREAMS) {
    for (const file of listEventStreamFiles(input.stateRoot, stream)) {
      if (file.date < cutoffDate) {
        unlinkSync(file.path);
        removed.push(file.path);
      }
    }
  }
  return Object.freeze({ cutoffDate, removed: Object.freeze(removed) });
}
