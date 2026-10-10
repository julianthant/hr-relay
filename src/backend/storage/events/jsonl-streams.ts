
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, statSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Clock } from "../../../rules/time/clock.js";
import { localDatePart } from "../../../rules/time/clock.js";
import { EVENT_STREAM_RETENTION_DAYS } from "../../../models/events/retention.js";

export const EVENT_STREAMS = ["spans", "notes"] as const;
export type EventStream = (typeof EVENT_STREAMS)[number];
const EventStreamSchema = z.enum(EVENT_STREAMS);

const STREAM_FILE_PATTERN = /^([a-z0-9]+(?:-[a-z0-9]+)*)-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const DateOnlySchema = z.iso.date();

export function eventStreamFileName(workflow: string, date: string): string {
  return `${workflow}-${DateOnlySchema.parse(date)}.jsonl`;
}

export function eventStreamDirectory(stateRoot: string, stream: EventStream): string {
  return join(stateRoot, EventStreamSchema.parse(stream));
}


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

function readWholeFiles(files: readonly EventStreamFile[]): readonly EventStreamLine[] {
  const lines: EventStreamLine[] = [];
  for (const file of files) {
    const rows = readFileSync(file.path, "utf8").split("\n");
    for (const [index, text] of rows.entries()) {
      if (text === "") continue;
      lines.push({ file, lineNumber: index + 1, text });
    }
  }
  return lines;
}

/** Every non-empty line of a stream, in (date, workflow, line) order. */
export function readEventStreamLines(stateRoot: string, stream: EventStream): readonly EventStreamLine[] {
  return readWholeFiles(listEventStreamFiles(stateRoot, stream));
}


export interface EventStreamScope {
  readonly workflow: string;
  /** Inclusive `YYYY-MM-DD` lower bound on the partition date. */
  readonly fromDate: string;
  /** Inclusive `YYYY-MM-DD` upper bound on the partition date. */
  readonly toDate: string;
}

const WORKFLOW_SEGMENT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** The files `readScopedEventStreamLines` would open, without reading them. */
export function scopedEventStreamFiles(
  stateRoot: string,
  stream: EventStream,
  scope: EventStreamScope,
): readonly EventStreamFile[] {
  const fromDate = DateOnlySchema.parse(scope.fromDate);
  const toDate = DateOnlySchema.parse(scope.toDate);
  if (fromDate > toDate) {
    throw new Error(
      `refusing to scope ${stream}/ to ${scope.workflow} over ${fromDate}..${toDate}: the range is inverted, `
      + "and an empty scope would report a run's own lines as absent",
    );
  }
  if (!WORKFLOW_SEGMENT_PATTERN.test(scope.workflow)) {
    throw new Error(
      `refusing to scope ${stream}/ to workflow ${scope.workflow}: no ${stream} partition file can carry that `
      + "id, so the scope would silently select nothing",
    );
  }
  return listEventStreamFiles(stateRoot, stream).filter(
    (file) => file.workflow === scope.workflow && file.date >= fromDate && file.date <= toDate,
  );
}


export function readScopedEventStreamLines(
  stateRoot: string,
  stream: EventStream,
  scope: EventStreamScope,
): readonly EventStreamLine[] {
  return readWholeFiles(scopedEventStreamFiles(stateRoot, stream, scope));
}

export interface EventStreamFileCursor {
  /** Bytes consumed so far — always ending exactly at a newline (or 0). */
  readonly bytesConsumed: number;
  /** Newline-terminated lines consumed — the base `lineNumber` continues from. */
  readonly linesConsumed: number;
  /** Size of an incomplete trailing line already inspected without consuming it. */
  readonly partialBytesObserved?: number;
}

export interface EventStreamTailResult {
  readonly lines: readonly EventStreamLine[];
  /** The resume state: one entry per currently-listed stream file, keyed by path. */
  readonly cursors: ReadonlyMap<string, EventStreamFileCursor>;
  readonly hasMore?: boolean;
  readonly bytesRead?: number;
}

export interface EventStreamTailIo {
  list(stateRoot: string, stream: EventStream, scope?: EventStreamScope): readonly EventStreamFile[];
  size(file: EventStreamFile): number;
  read(file: EventStreamFile, start: number, length: number): Buffer;
}

const FILE_TAIL_IO: EventStreamTailIo = {
  list: (stateRoot, stream, scope) => scope === undefined ? listEventStreamFiles(stateRoot, stream)
    : scopedEventStreamFiles(stateRoot, stream, scope),
  size: file => statSync(file.path).size,
  read: (file, start, length) => {
    const chunk = Buffer.alloc(length);
    const handle = openSync(file.path, "r");
    try {
      let filled = 0;
      while (filled < chunk.length) {
        const got = readSync(handle, chunk, filled, chunk.length - filled, start + filled);
        if (got === 0) throw new Error(`${file.path} ended ${String(chunk.length - filled)} bytes before its just-observed size`);
        filled += got;
      }
    } finally { closeSync(handle); }
    return chunk;
  },
};


export function readEventStreamLinesFrom(
  stateRoot: string,
  stream: EventStream,
  cursors: ReadonlyMap<string, EventStreamFileCursor>,
  scope?: EventStreamScope,
  limits?: Readonly<{ maxBytes: number; maxLines: number }>,
  io: EventStreamTailIo = FILE_TAIL_IO,
): EventStreamTailResult {
  const maxBytes = limits?.maxBytes ?? Number.MAX_SAFE_INTEGER;
  const maxLines = limits?.maxLines ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || !Number.isSafeInteger(maxLines) || maxLines < 1) {
    throw new Error("event-stream-tail-limits-invalid");
  }
  const lines: EventStreamLine[] = [];
  const nextCursors = new Map<string, EventStreamFileCursor>();
  let bytesRead = 0;
  let consumedLines = 0;
  let hasMore = false;
  for (const file of io.list(stateRoot, stream, scope)) {
    const cursor = cursors.get(file.path) ?? { bytesConsumed: 0, linesConsumed: 0 };
    nextCursors.set(file.path, cursor);
    const size = io.size(file);
    if (size < (cursor.partialBytesObserved ?? cursor.bytesConsumed)) {
      throw new Error(
        `${file.path} shrank from ${String(cursor.partialBytesObserved ?? cursor.bytesConsumed)} to ${String(size)} bytes; `
        + "an append-only stream file was truncated and this tail refuses to guess what survived",
      );
    }
    if (size === cursor.bytesConsumed || size === cursor.partialBytesObserved) {
      continue;
    }
    if (bytesRead >= maxBytes || consumedLines >= maxLines) { hasMore = true; continue; }
    const remainingBudget = maxBytes - bytesRead;
    if (remainingBudget < maxBytes && size - cursor.bytesConsumed > remainingBudget) {
      hasMore = true;
      continue;
    }
    const requestedLength = Math.min(size - cursor.bytesConsumed, remainingBudget);
    const chunk = io.read(file, cursor.bytesConsumed, requestedLength);
    if (chunk.length !== requestedLength) throw new Error(`${file.path} ended before its just-observed size; an append-only stream file was truncated mid-read`);
    bytesRead += chunk.length;
    // A `\n` is a single byte and no UTF-8 continuation byte can equal it, so
    // splitting on the raw byte before decoding cannot cut a character.
    const lastNewline = chunk.lastIndexOf(0x0a);
    if (lastNewline === -1) {
      if (chunk.length === maxBytes) throw new Error(`${file.path} has a JSONL line beyond the bounded tail read`);
      nextCursors.set(file.path, { ...cursor, partialBytesObserved: size });
      continue;
    }
    let prefixEnd = lastNewline + 1;
    let newlines = 0;
    for (let index = 0; index <= lastNewline; index++) {
      if (chunk[index] !== 0x0a) continue;
      newlines++;
      if (newlines === maxLines - consumedLines) {
        prefixEnd = index + 1;
        if (index < lastNewline || cursor.bytesConsumed + prefixEnd < size) hasMore = true;
        break;
      }
    }
    const segments = chunk.subarray(0, prefixEnd).toString("utf8").split("\n");
    segments.pop(); // the empty segment after the final consumed newline
    for (const [index, text] of segments.entries()) {
      if (text === "") continue;
      lines.push({ file, lineNumber: cursor.linesConsumed + index + 1, text });
    }
    nextCursors.set(file.path, {
      bytesConsumed: cursor.bytesConsumed + prefixEnd,
      linesConsumed: cursor.linesConsumed + segments.length,
      ...(prefixEnd === lastNewline + 1 && cursor.bytesConsumed + chunk.length === size
        && lastNewline < chunk.length - 1 ? { partialBytesObserved: size } : {}),
    });
    consumedLines += segments.length;
    if (cursor.bytesConsumed + chunk.length < size) hasMore = true;
  }
  return Object.freeze({ lines: Object.freeze(lines), cursors: nextCursors, hasMore, bytesRead });
}

export interface PruneReport {
  readonly cutoffDate: string;
  readonly removed: readonly string[];
}


export function pruneEventStreams(input: Readonly<{
  stateRoot: string;
  clock: Clock;
  retentionDays?: number;
  streams?: readonly EventStream[];
}>): PruneReport {

  const retentionDays = z.number().int().positive().parse(input.retentionDays ?? EVENT_STREAM_RETENTION_DAYS);
  const cutoff = new Date(input.clock.now().getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const cutoffDate = localDatePart(cutoff);
  const removed: string[] = [];
  const streams = z.array(EventStreamSchema).parse(input.streams ?? EVENT_STREAMS);
  for (const stream of streams) {
    for (const file of listEventStreamFiles(input.stateRoot, stream)) {
      if (file.date < cutoffDate) {
        unlinkSync(file.path);
        removed.push(file.path);
      }
    }
  }
  return Object.freeze({ cutoffDate, removed: Object.freeze(removed) });
}

/** One bounded partition slice for exact provenance lookup; never reads a whole history. */
export function readEventStreamSlice(
  file: EventStreamFile,
  cursor: EventStreamFileCursor,
  limit = 200,
): EventStreamTailResult {
  if (!Number.isSafeInteger(cursor.bytesConsumed) || cursor.bytesConsumed < 0
    || !Number.isSafeInteger(cursor.linesConsumed) || cursor.linesConsumed < 0
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error("operation-source-invalid-cursor");
  const handle = openSync(file.path, "r");
  try {
    const size = statSync(file.path).size;
    if (cursor.bytesConsumed > size) throw new Error("operation-source-history-truncated");
    if (cursor.bytesConsumed > 0) {
      const boundary = Buffer.alloc(1);
      readSync(handle, boundary, 0, 1, cursor.bytesConsumed - 1);
      if (boundary[0] !== 10) throw new Error("operation-source-cursor-not-line-boundary");
    }
    const chunk = Buffer.alloc(Math.min(size - cursor.bytesConsumed, 256 * 1024));
    const filled = readSync(handle, chunk, 0, chunk.length, cursor.bytesConsumed);
    const lines: EventStreamLine[] = [];
    let offset = 0;
    let count = 0;
    while (count < limit) {
      const end = chunk.indexOf(10, offset);
      if (end < 0 || end >= filled) break;
      const text = chunk.subarray(offset, end).toString("utf8");
      count += 1;
      if (text !== "") lines.push({ file, lineNumber: cursor.linesConsumed + count, text });
      offset = end + 1;
    }
    if (count < limit && offset < filled && cursor.bytesConsumed + filled === size) throw new Error("operation-source-incomplete-tail");
    if (offset === 0 && filled === chunk.length && chunk.length === 256 * 1024) throw new Error("operation-source-line-exceeds-bound");
    return {
      lines,
      cursors: new Map([[file.path, { bytesConsumed: cursor.bytesConsumed + offset, linesConsumed: cursor.linesConsumed + count }]]),
    };
  } finally { closeSync(handle); }
}
