/**
 * The two JSONL event streams on disk (doc 03 §2.1): `spans/` and `notes/`
 * under the config-resolved state root, one file per `<workflow>-<date>`,
 * `O_APPEND` single-line writes, append-at-now partitioning, and the D86
 * 30-day prune. The ledger is deliberately NOT here — it has its own
 * serialized outbox projector (doc 09) and is never pruned.
 */
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { Clock } from "../../domain/clock.js";
import { localDatePart } from "../../domain/clock.js";

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
  const retentionDays = z.number().int().positive().parse(input.retentionDays ?? 30);
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
