
import { z } from "zod";
import type { Clock } from "../../../rules/time/clock.js";
import { localDatePart } from "../../../rules/time/clock.js";
import { SpanEventWireSchema, type SpanEventWire } from "../../../models/events/types.js";
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
