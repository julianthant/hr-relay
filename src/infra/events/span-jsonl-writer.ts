/**
 * The JSONL span writer — the concrete `SpanEmitter` the executor is handed
 * (doc 03 §1.1, §2.1). Direct `O_APPEND` to `spans/<workflow>-<date>.jsonl`;
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
 * - **`span.patched` keys.** An identity key is refused by the schema itself;
 *   a key the workflow's descriptor `details` list does not declare throws
 *   with the offending key and workflow named.
 *
 * The optional `onEvent` hook runs strictly AFTER the line is durable — that
 * ordering is doc 03 §2's "JSONL append first, projection applies after".
 */
import { z } from "zod";
import type { Clock } from "../../domain/clock.js";
import { localDatePart } from "../../domain/clock.js";
import { SpanEventWireSchema, type SpanEventWire } from "../../events/types.js";
import { appendEventStreamLine } from "./jsonl-streams.js";

export interface SpanJsonlWriterDeps {
  readonly stateRoot: string;
  readonly clock: Clock;
  /** The writer owns the process-level field (doc 03 §1.1); injectable for tests. */
  readonly pid?: number;
  /**
   * The workflow's declared patchable detail keys. Returning `undefined`
   * means the workflow is unknown here — a patch for it fails loud.
   */
  readonly declaredDetails: (workflow: string) => ReadonlySet<string> | undefined;
  /** Post-append projection feed; never called for an event that did not land on disk. */
  readonly onEvent?: (event: SpanEventWire) => void;
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
      return;
    }
    if (event.t === "span.patched") {
      const declared = deps.declaredDetails(event.workflow);
      if (declared === undefined) {
        throw new Error(`span.patched for unknown workflow ${event.workflow}; no descriptor declares its details`);
      }
      for (const update of event.updates) {
        if (!declared.has(update.key)) {
          throw new Error(
            `span.patched key ${update.key} is not declared in ${event.workflow}'s details list; declare it or drop the patch`,
          );
        }
      }
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
      deps.onEvent?.(parsed);
    },
  });
}
