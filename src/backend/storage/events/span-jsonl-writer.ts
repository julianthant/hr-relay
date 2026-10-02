/**
 * The JSONL span writer — the concrete `SpanEmitter` the executor is handed
 * (ref dashboard-surfaces §1.1, §2.1). Direct `O_APPEND` to `spans/<workflow>-<date>.jsonl`;
 * NOT SQLite — only the ledger and the write-committed terminal span ride the
 * SQLite outbox, and both already landed in 1c.
 *
 * Enforcement lives HERE, at emit, not in a projector that could only notice
 * after the fact:
 *
 * - **Identity write-once.** A second `run.queued` for the same
 *   `(runId, attempt, spanPath)` throws; so does re-opening or re-ending any
 *   span identity this process already opened/ended. (A span opened by an
 *   earlier process may legitimately be ENDED here after a restart, so a
 *   close without a locally-seen open is allowed — refusing it would make
 *   every recovery emit-path throw.)
 * D254 retired the `span.patched` arm from the wire union, and with it this
 * writer's declared-detail-key enforcement and its `declaredDetails` dep: the
 * channel had no production emitter, so the enforcement guarded a shape
 * nothing could write. A `span.patched` event now fails
 * `SpanEventWireSchema.parse` here, before any byte reaches disk.
 *
 * This writer feeds NO projection (D218). The run/queue projection consumes
 * the stream FROM DISK with an offset-aware tailer, because the emitting
 * process is not necessarily the serving process — the worker is its own OS
 * process, so an in-process post-append hook could only ever cover one
 * emitter's half of the stream. "JSONL append first, projection applies
 * after" (ref dashboard-surfaces §2.3) is therefore structural: the projection can only see
 * what already landed.
 */
import { z } from "zod";
import type { Clock } from "../../../domain/clock.js";
import { localDatePart } from "../../../domain/clock.js";
import { SpanEventWireSchema, type SpanEventWire } from "../../../events/types.js";
import { appendEventStreamLine } from "./jsonl-streams.js";

export interface SpanJsonlWriterDeps {
  readonly stateRoot: string;
  readonly clock: Clock;
  /** The writer owns the process-level field (ref dashboard-surfaces §1.1); injectable for tests. */
  readonly pid?: number;
}

export interface SpanJsonlWriter {
  emit(event: unknown): void;
}

function runIdentityKey(event: Readonly<{ runId: string; attempt: number; spanPath: string }>): string {
  return `run:${event.runId}#${String(event.attempt)}#${event.spanPath}`;
}

function workerIdentityKey(event: Readonly<{ workerId: string; spanPath: string }>): string {
  return `worker:${event.workerId}#${event.spanPath}`;
}

export function createSpanJsonlWriter(deps: SpanJsonlWriterDeps): SpanJsonlWriter {
  const pid = z.number().int().positive().parse(deps.pid ?? process.pid);
  const queued = new Set<string>();
  const opened = new Set<string>();
  const ended = new Set<string>();

  function enforceIdentity(event: SpanEventWire): void {
    if (event.t === "run.queued") {
      const key = runIdentityKey(event);
      if (queued.has(key)) {
        throw new Error(`run.queued identity ${key} was already written; identity attributes are write-once`);
      }
      queued.add(key);
      opened.add(key);
      return;
    }
    if (event.t === "span.started") {
      const key = event.kind === "task" ? runIdentityKey(event) : workerIdentityKey(event);
      if (opened.has(key)) {
        throw new Error(`span ${key} was already opened; a span opens exactly once per identity`);
      }
      opened.add(key);
      return;
    }
    if (event.t === "span.ended") {
      const key = event.kind === "task" || event.kind === "run" ? runIdentityKey(event) : workerIdentityKey(event);
      if (ended.has(key)) {
        throw new Error(`span ${key} was already ended; a span closes exactly once per identity`);
      }
      ended.add(key);
    }
  }

  return Object.freeze({
    emit(event: unknown): void {
      const parsed = SpanEventWireSchema.parse({ ...z.record(z.string(), z.unknown()).parse(event), pid });
      enforceIdentity(parsed);
      appendEventStreamLine(
        deps.stateRoot,
        "spans",
        parsed.workflow,
        localDatePart(deps.clock.now()),
        JSON.stringify(parsed),
      );
    },
  });
}
