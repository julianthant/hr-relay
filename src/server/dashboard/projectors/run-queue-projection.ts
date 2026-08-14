/**
 * THE run/queue projection — the single server-side read model every surface
 * renders (doc 03 §2.2/§2.3, D81 §10.1).
 *
 * Workflow Panel badges, Status Bar pills, and Queue Panel rows are three
 * renderings of ONE payload: `buildDashboardDayWire` derives the queue
 * surfaces once and then computes `workflowCounts`, `statusCounts`, and
 * `monthCounts` from that same in-memory array — a count literally cannot
 * take a second path because no second aggregation function exists.
 *
 * Sources, in the doc's arrow direction: the spans JSONL stream (identity,
 * claims, task spans, gates, ends) consumed FROM DISK (D218) — a boot
 * `rebuildFromJsonl` folds the whole history, and `ingestFromDisk` tails the
 * files by byte cursor for everything appended after, by ANY process. The
 * worker emits its task spans from its own OS process, so disk is the one
 * place every span exists; an in-process emit hook covered only this
 * process's half and served an empty timeline for every run enqueued after
 * boot. The fold is joined per-run against SQLite AUTHORITY facts (lifecycle
 * for parked/terminal/hidden, `version` as the row's CAS revision). The
 * folded rows are persisted to the rebuildable `runs_view` projection table;
 * deleting that table loses nothing — `rebuildFromJsonl` is the
 * `rebuild-from-native-jsonl` recovery class.
 *
 * Failure policy (doc 03 §2.3): JSONL append happens BEFORE any fold sees the
 * event — structurally, because the fold only reads the file. A failing fold
 * or an unparsable tailed line marks the projection degraded and schedules a
 * guarded rebuild — never a skip, and never a throw into the emitting path. A
 * rebuild that itself fails leaves the projection loudly degraded (health
 * carries the exact error); it never serves a half-folded day as healthy.
 *
 * Closed vocabulary mappings this projector owns (noted, not silent):
 * - run outcome → queue status: `done→done`, `failed→failed`,
 *   `cancelled|discarded|superseded→cancelled`; `interrupted` maps to
 *   `blocked` (the run stopped without a settled verdict — doc-09 recovery
 *   will requeue or settle it; calling it cancelled or failed would claim a
 *   verdict nobody reached).
 * - task outcome → pipeline state: `done→done`, `failed→failed`,
 *   `skipped→skipped`, `cancelled→blocked` (the landed 1b pipeline enum has
 *   no `cancelled`; `blocked` is "stopped incomplete", the nearest state that
 *   does not claim success or failure).
 */
import { z } from "zod";
import type { AnyWorkflowDescriptor } from "../../../base/workflow.js";
import { descriptorRuntimeNodes } from "../../../base/workflow.js";
import type { Clock } from "../../../domain/clock.js";
import { localDatePart } from "../../../domain/clock.js";
import {
  DashboardDayWireSchema,
  notificationWireOf,
  QueueSurfaceWireSchema,
  TERMINAL_QUEUE_STATUSES,
  type DashboardDayWire,
  type QueueSurfaceWire,
} from "../../../domain/dashboard/projection.js";
import {
  ActivityReportWireSchema,
  type ActivityReportWire,
} from "../../../domain/dashboard/activity.js";
import { DashboardDayPatchSchema } from "../../../domain/dashboard/subscription.js";
import {
  FingerprintSchema,
  LOCAL_OPERATOR_ACTOR_ID,
  ProjectionCursorSchema,
  type Fingerprint,
} from "../../../domain/ids.js";
import { NotificationRecordSchema } from "../../../domain/notifications.js";
import type { RunRecord } from "../../../domain/run/record.js";
import type { RunEvidenceReceipt } from "../../../domain/trust/evidence.js";
import type { FailureRecord } from "../../../domain/trust/failure.js";
import { deriveSchemaHash } from "../../../domain/schema-bound-value.js";
import { sha256Hex } from "../../../domain/sha256.js";
import { SpanEventWireSchema, type RunQueuedWire, type SpanEventWire } from "../../../events/types.js";
import type { ProjectionRepositories } from "../../../infra/sqlite/authority-database.js";
import { readEventStreamLinesFrom, type EventStreamFileCursor, type EventStreamLine } from "../../../infra/events/jsonl-streams.js";

/* ── the persisted fold shape (internal, versioned by its own schema hash) ─ */

const TaskSpanFoldSchema = z.strictObject({
  /**
   * Span identity is `(runId, attempt, spanPath)` (doc 03 §1.1), and the
   * attempt is load-bearing HERE: `<trace>/<node>#<taskAttempt>` repeats
   * verbatim when a later RUN attempt re-runs the same node, so folding on
   * the path alone made attempt 2's start collide with attempt 1's entry —
   * the earlier chip took the later outcome and the current one never
   * received an end, leaving a terminal run rendering a step as `active`.
   */
  attempt: z.number().int().positive(),
  spanPath: z.string().min(1),
  name: z.string().min(1),
  startedAt: z.iso.datetime({ offset: true }).optional(),
  endedAt: z.iso.datetime({ offset: true }).optional(),
  outcome: z.enum(["done", "failed", "cancelled", "discarded", "skipped", "interrupted", "superseded"]).optional(),
  /**
   * The executor's recorded skip reason, folded verbatim. Absent means the
   * span carried none — the run-detail timeline then says exactly that rather
   * than choosing a likely one.
   */
  notRunReason: z.enum(["condition-false", "branch-not-selected"]).optional(),
});

const RunFoldRecordSchema = z.strictObject({
  queued: z.custom<RunQueuedWire>((value) => SpanEventWireSchema.parse(value) !== undefined),
  attempt: z.number().int().positive(),
  claimedBy: z.string().min(1).optional(),
  requeues: z.number().int().nonnegative(),
  taskSpans: z.array(TaskSpanFoldSchema),
  details: z.record(z.string(), z.unknown()),
  openGates: z.array(z.strictObject({ gate: z.string().min(1), openedAt: z.iso.datetime({ offset: true }) })),
  resolvedGates: z.array(z.strictObject({
    gate: z.string().min(1),
    resolutionKey: z.string().min(1),
    resultHash: z.string().min(1),
    resolvedAt: z.iso.datetime({ offset: true }),
  })),
  ended: z.strictObject({
    outcome: z.enum(["done", "failed", "cancelled", "discarded", "interrupted", "superseded"]),
    endedAt: z.iso.datetime({ offset: true }),
    failureId: z.string().min(1).optional(),
  }).optional(),
  memberRunIds: z.array(z.string().min(1)),
  lastEventAt: z.iso.datetime({ offset: true }),
  eventCount: z.number().int().positive(),
});
export type RunFoldRecord = z.infer<typeof RunFoldRecordSchema>;

interface WorkerFold {
  workerId: string;
  startedAt: string;
  endedAt?: string;
  system?: string;
  currentRunId?: string;
  eventCount: number;
}

/* ── dependencies ────────────────────────────────────────────────────────── */

export interface RunQueueProjectionDeps {
  readonly stateRoot: string;
  readonly clock: Clock;
  readonly appVersion: string;
  /** One fingerprint over the registered descriptor set — doc 02's skew tripwire. */
  readonly descriptorSetHash: Fingerprint;
  /** Narrow authority read view; the projection never mutates authority. */
  readonly authority: {
    getRun(runId: string): RunRecord | undefined;
    /** 2i-B: the durable inbox rows the day wire serves. */
    listNotifications(actorId: string): readonly z.infer<typeof NotificationRecordSchema>[];
    /**
     * D179/D80: whether a version bump has archived this run. Doc 03 §10.1 is
     * explicit that archived rows are excluded ONCE, inside the projection,
     * alongside hidden rows and member containment — so an archived run leaves
     * the queue, the workflow badge, the status pill, the month calendar and
     * the Activity report at the same instant, by construction.
     */
    isArchived(runId: string): boolean;
    /** D180: the failure breakdown the Activity report aggregates. */
    getFailure(failureId: string): FailureRecord | undefined;
    /**
     * The run's ALREADY-DERIVED evidence receipt, for the `△ N` warning count
     * (D22/D126). Deliberately a plain lookup and never `ensureReceipt`: D141
     * makes derivation an on-demand act that PERSISTS a row, and a read model
     * that wrote authority as a side effect of rendering a queue would be a
     * projection deciding when a durable record exists. A run whose receipt
     * has not been derived yet serves an absent warning count naming exactly
     * that, which is the honest answer rather than a fabricated zero.
     */
    getReceipt(runId: string): RunEvidenceReceipt | undefined;
  };
  readonly descriptors: { resolve(workflowId: string): AnyWorkflowDescriptor | undefined };
  /** The rebuildable projection tables (doc 03 §2.3). */
  readonly projectionStore: {
    withProjectionTransaction<Result>(work: (repositories: ProjectionRepositories) => Result): Result;
  };
  /**
   * How a guarded rebuild is scheduled after an apply failure. The default
   * runs it immediately; tests inject a collector to observe scheduling.
   */
  readonly scheduleRebuild?: (rebuild: () => void) => void;
}

export type RunQueueProjectionChange =
  | { readonly kind: "patch"; readonly cursor: string; readonly day: string; readonly patch: z.infer<typeof DashboardDayPatchSchema> }
  | { readonly kind: "snapshot"; readonly cursor: string }
  | { readonly kind: "generation"; readonly cursor: string };

export interface RunQueueProjectionHealth {
  readonly state: "live" | "degraded";
  readonly lastError?: string;
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

function deterministicProjectionKey(runId: string): Fingerprint {
  return FingerprintSchema.parse(sha256Hex(`hrauto:runs-view-key:v1\0${runId}`));
}

function surfaceKindOf(shape: RunQueuedWire["shape"]): "single" | "preview" | "operation" | "member" {
  if (shape === "operation") return "operation";
  if (shape === "operation-member") return "member";
  return shape;
}

function panelKindOf(shape: RunQueuedWire["shape"]): "run" | "member" | "group" {
  if (shape === "operation") return "group";
  if (shape === "operation-member") return "member";
  return "run";
}

const RUN_OUTCOME_STATUS = {
  done: "done",
  failed: "failed",
  cancelled: "cancelled",
  discarded: "cancelled",
  superseded: "cancelled",
  interrupted: "blocked",
} as const;

const TASK_OUTCOME_PIPELINE = {
  done: "done",
  failed: "failed",
  skipped: "skipped",
  cancelled: "blocked",
  discarded: "blocked",
  interrupted: "blocked",
  superseded: "blocked",
} as const;

function nodeIdOfTaskSpanPath(spanPath: string): string | undefined {
  const segment = spanPath.split("/").at(-1);
  if (segment === undefined || !segment.includes("#")) return undefined;
  return segment.slice(0, segment.lastIndexOf("#"));
}

/* ── the projection ──────────────────────────────────────────────────────── */

export class RunQueueProjection {
  readonly #deps: RunQueueProjectionDeps;
  readonly #rows = new Map<string, RunFoldRecord>();
  readonly #workers = new Map<string, WorkerFold>();
  readonly #listeners = new Set<(change: RunQueueProjectionChange) => void>();
  readonly #notifiedStatus = new Map<string, string>();
  readonly #foldSchemaHash: Fingerprint;
  /**
   * The D218 tail state: how far into each `spans/` file this projection has
   * folded, in bytes-through-the-last-newline. Seeded by `rebuildFromJsonl`
   * (so a rebuild and the tail can never double-fold a line) and advanced
   * only by `ingestFromDisk`.
   */
  #spanCursors: ReadonlyMap<string, EventStreamFileCursor> = new Map();
  #cursorValue = 0;
  #generationValue: number;
  #health: RunQueueProjectionHealth = { state: "live" };

  constructor(deps: RunQueueProjectionDeps) {
    this.#deps = deps;
    this.#generationValue = Math.max(1, Math.trunc(deps.clock.nowMs()));
    this.#foldSchemaHash = deriveSchemaHash(RunFoldRecordSchema, "output");
  }

  onChange(listener: (change: RunQueueProjectionChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  health(): RunQueueProjectionHealth {
    return this.#health;
  }

  generation(): number {
    return this.#generationValue;
  }

  descriptorSetHash(): Fingerprint {
    return this.#deps.descriptorSetHash;
  }

  cursor(): string {
    return ProjectionCursorSchema.parse(`pc:${String(Math.max(1, this.#cursorValue))}`);
  }

  runFold(runId: string): RunFoldRecord | undefined {
    return this.#rows.get(runId);
  }

  /**
   * Fold ONE already-durable event. Never throws: a fold failure degrades the
   * projection and schedules the guarded rebuild instead of blocking the
   * caller. Production ingest reaches this fold only through `ingestFromDisk`
   * / `rebuildFromJsonl` (D218) — the emitting process may be a DIFFERENT OS
   * process, so an in-process call can never be the live feed.
   */
  apply(event: SpanEventWire): void {
    try {
      const affected = this.#fold(event);
      this.#cursorValue += 1;
      this.#persist(affected.runIds);
      this.#notify(affected);
    } catch (error) {
      this.#degrade(`projection apply failed for ${event.t}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * The cross-process tail (D218): fold every COMPLETE span line any process
   * appended since the last read. The boot rebuild seeds the byte cursors, so
   * a line folds exactly once — this projection's own emissions included. An
   * unparsable or unfoldable line degrades and schedules the guarded rebuild,
   * never a skip; a torn trailing line stays on disk until its newline lands.
   */
  ingestFromDisk(): void {
    // While degraded, recovery belongs to the scheduled rebuild alone — it
    // re-reads the whole stream and resets these cursors.
    if (this.#health.state === "degraded") return;
    try {
      const tail = readEventStreamLinesFrom(this.#deps.stateRoot, "spans", this.#spanCursors);
      this.#spanCursors = tail.cursors;
      if (tail.lines.length === 0) return;
      const events = this.#parseSpanLines(tail.lines);
      for (const event of events) {
        const affected = this.#fold(event);
        this.#cursorValue += 1;
        this.#persist(affected.runIds);
        this.#notify(affected);
      }
    } catch (error) {
      this.#degrade(`span tail ingest failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Doc 03 §2.3's failure policy, shared by every ingest path: degraded
   * health carrying the exact error, plus the guarded rebuild.
   */
  #degrade(lastError: string): void {
    this.#health = { state: "degraded", lastError };
    const schedule = this.#deps.scheduleRebuild ?? ((rebuild: () => void): void => rebuild());
    schedule(() => this.rebuildFromJsonl());
  }

  /**
   * Parse + order a batch of stream lines the way the rebuild always has: a
   * corrupt line refuses by file:line, and events sort by their own instant —
   * per-run order still comes from each file's append order, since the sort
   * is stable and one run's spans ride one workflow's files.
   */
  #parseSpanLines(lines: readonly EventStreamLine[]): readonly SpanEventWire[] {
    const events = lines.map((line) => {
      try {
        return SpanEventWireSchema.parse(JSON.parse(line.text));
      } catch (error) {
        throw new Error(
          `corrupt span line ${line.file.path}:${String(line.lineNumber)}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    });
    return events.sort((a, b) => a.ts.localeCompare(b.ts));
  }

  /** The `rebuild-from-native-jsonl` recovery class: clear, re-read, re-fold. */
  rebuildFromJsonl(): void {
    try {
      const whole = readEventStreamLinesFrom(this.#deps.stateRoot, "spans", new Map());
      const events = this.#parseSpanLines(whole.lines);
      this.#rows.clear();
      this.#workers.clear();
      this.#notifiedStatus.clear();
      const touched = new Set<string>();
      for (const event of events) {
        for (const runId of this.#fold(event).runIds) touched.add(runId);
      }
      this.#deps.projectionStore.withProjectionTransaction((repositories) => {
        repositories.runsView.clear();
        return undefined;
      });
      this.#persist([...touched]);
      // The tail resumes from exactly what this rebuild consumed — set
      // together with `live` so the two ingest paths can never overlap.
      this.#spanCursors = whole.cursors;
      this.#generationValue = Math.max(this.#generationValue + 1, Math.trunc(this.#deps.clock.nowMs()));
      this.#cursorValue = 1;
      this.#health = { state: "live" };
      const change: RunQueueProjectionChange = { kind: "generation", cursor: this.cursor() };
      for (const listener of this.#listeners) listener(change);
    } catch (error) {
      this.#health = {
        state: "degraded",
        lastError: `rebuild-from-native-jsonl failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Re-read one run's AUTHORITY facts after a command that emits no span
   * (hide/unhide/rename/bump/cancel). The surface is rebuilt from the same
   * fold + authority join every other path uses — this is a refresh trigger,
   * not a second projection.
   */
  refreshRun(runId: string): void {
    const row = this.#rows.get(runId);
    if (row === undefined) return;
    this.#cursorValue += 1;
    this.#notify({ runIds: [runId], workerChanged: false });
  }

  /**
   * ONE run's queue row, rendered by the same `#surface` every payload uses.
   * D179's archive freezes this exact value, so an archived row and the live
   * row it replaced are the same bytes — not a second derivation that could
   * disagree with the row the operator was looking at.
   */
  queueSurface(runId: string): QueueSurfaceWire | undefined {
    const row = this.#rows.get(runId);
    if (row === undefined) return undefined;
    return this.#surface(row, this.#authorityRun(runId));
  }

  /* ── folding ───────────────────────────────────────────────────────────── */

  #row(runId: string, eventType: string): RunFoldRecord {
    const row = this.#rows.get(runId);
    if (row === undefined) {
      throw new Error(`${eventType} names run ${runId}, which has no run.queued span in the fold`);
    }
    return row;
  }

  #fold(event: SpanEventWire): { runIds: readonly string[]; workerChanged: boolean } {
    if (event.t === "run.queued") {
      if (this.#rows.has(event.runId)) {
        throw new Error(`run.queued replayed for ${event.runId}; identity attributes are write-once`);
      }
      this.#rows.set(event.runId, {
        queued: event,
        attempt: event.attempt,
        requeues: 0,
        taskSpans: [],
        details: {},
        openGates: [],
        resolvedGates: [],
        memberRunIds: [],
        lastEventAt: event.ts,
        eventCount: 1,
      });
      const affected = [event.runId];
      if (event.parentRunId !== undefined) {
        const parent = this.#rows.get(event.parentRunId);
        if (parent !== undefined && !parent.memberRunIds.includes(event.runId)) {
          parent.memberRunIds.push(event.runId);
          affected.push(event.parentRunId);
        }
      }
      return { runIds: affected, workerChanged: false };
    }

    if (event.t === "run.claimed") {
      const row = this.#row(event.runId, event.t);
      row.claimedBy = event.workerId;
      row.attempt = event.attempt;
      row.lastEventAt = event.ts;
      row.eventCount += 1;
      const worker = this.#workers.get(event.workerId);
      if (worker !== undefined) {
        worker.currentRunId = event.runId;
        worker.eventCount += 1;
      }
      return { runIds: [event.runId], workerChanged: worker !== undefined };
    }

    if (event.t === "run.requeued") {
      const row = this.#row(event.runId, event.t);
      const worker = row.claimedBy === undefined ? undefined : this.#workers.get(row.claimedBy);
      if (worker?.currentRunId === event.runId) {
        delete worker.currentRunId;
        worker.eventCount += 1;
      }
      delete row.claimedBy;
      row.attempt = event.nextAttempt;
      row.requeues += 1;
      row.lastEventAt = event.ts;
      row.eventCount += 1;
      return { runIds: [event.runId], workerChanged: worker !== undefined };
    }

    if (event.t === "span.patched") {
      const row = this.#row(event.runId, event.t);
      for (const update of event.updates) row.details[update.key] = update.value;
      row.lastEventAt = event.ts;
      row.eventCount += 1;
      return { runIds: [event.runId], workerChanged: false };
    }

    if (event.t === "gate.opened") {
      const row = this.#row(event.runId, event.t);
      row.openGates.push({ gate: event.gate, openedAt: event.ts });
      row.lastEventAt = event.ts;
      row.eventCount += 1;
      return { runIds: [event.runId], workerChanged: false };
    }

    if (event.t === "gate.resolved") {
      const row = this.#row(event.runId, event.t);
      row.openGates = row.openGates.filter(({ gate }) => gate !== event.gate);
      row.resolvedGates.push({
        gate: event.gate,
        resolutionKey: event.resolutionKey,
        resultHash: event.resultHash,
        resolvedAt: event.ts,
      });
      row.lastEventAt = event.ts;
      row.eventCount += 1;
      return { runIds: [event.runId], workerChanged: false };
    }

    if (event.t === "span.started") {
      if (event.kind === "task") {
        const row = this.#row(event.runId, event.t);
        row.taskSpans.push({
          attempt: event.attempt,
          spanPath: event.spanPath,
          name: event.name,
          startedAt: event.ts,
        });
        row.lastEventAt = event.ts;
        row.eventCount += 1;
        return { runIds: [event.runId], workerChanged: false };
      }
      if (event.kind === "worker") {
        this.#workers.set(event.workerId, { workerId: event.workerId, startedAt: event.ts, eventCount: 1 });
        return { runIds: [], workerChanged: true };
      }
      const worker = this.#workers.get(event.workerId)
        ?? { workerId: event.workerId, startedAt: event.ts, eventCount: 0 };
      this.#workers.set(event.workerId, worker);
      if (event.system !== undefined) worker.system = event.system;
      worker.eventCount += 1;
      return { runIds: [], workerChanged: true };
    }

    /**
     * D210 — `transaction.previewed`. The JSONL stream carries it (doc 01 §6.2)
     * and this projection has no arm that could render it without lying: the
     * queue row's vocabulary is task spans and terminal outcomes, and a preview
     * is neither. It is deliberately IGNORED here rather than folded into a
     * `span.ended` it is not, and the operator-facing truth is carried by the
     * evidence receipt, which refuses `verified-done` for a previewed run and
     * names the preview as a load-bearing uncertainty. Surfacing it on the queue
     * row is a wire + UI change this slice does not own; §9.9's carry-forward
     * names it.
     */
    if (event.t === "transaction.previewed") return { runIds: [], workerChanged: false };

    // span.ended
    if (event.kind === "task") {
      const row = this.#row(event.runId, event.t);
      let span = row.taskSpans.find((candidate) =>
        candidate.attempt === event.attempt && candidate.spanPath === event.spanPath);
      if (span === undefined) {
        // A restart may close a span an earlier process opened; the open time
        // is genuinely unknown and stays absent rather than being invented.
        span = {
          attempt: event.attempt,
          spanPath: event.spanPath,
          name: nodeIdOfTaskSpanPath(event.spanPath) ?? event.spanPath,
        };
        row.taskSpans.push(span);
      }
      span.endedAt = event.ts;
      span.outcome = event.outcome;
      if (event.notRunReason !== undefined) span.notRunReason = event.notRunReason;
      row.lastEventAt = event.ts;
      row.eventCount += 1;
      return { runIds: [event.runId], workerChanged: false };
    }
    if (event.kind === "run") {
      const row = this.#row(event.runId, event.t);
      if (event.outcome === "skipped") {
        throw new Error(`run span ${event.runId} ended as skipped; skipped is a task-span outcome`);
      }
      row.ended = {
        outcome: event.outcome,
        endedAt: event.ts,
        ...(event.failureId === undefined ? {} : { failureId: event.failureId }),
      };
      row.lastEventAt = event.ts;
      row.eventCount += 1;
      let workerChanged = false;
      for (const worker of this.#workers.values()) {
        if (worker.currentRunId === event.runId) {
          delete worker.currentRunId;
          worker.eventCount += 1;
          workerChanged = true;
        }
      }
      return { runIds: [event.runId], workerChanged };
    }
    // worker / browser span end
    const worker = this.#workers.get(event.workerId);
    if (worker !== undefined) {
      if (event.kind === "worker") worker.endedAt = event.ts;
      worker.eventCount += 1;
    }
    return { runIds: [], workerChanged: true };
  }

  #persist(runIds: readonly string[]): void {
    if (runIds.length === 0) return;
    this.#deps.projectionStore.withProjectionTransaction((repositories) => {
      for (const runId of runIds) {
        const row = this.#rows.get(runId);
        if (row === undefined) continue;
        repositories.runsView.upsert({
          projectionKey: deterministicProjectionKey(runId),
          payload: { schemaHash: this.#foldSchemaHash, value: RunFoldRecordSchema.parse(row) },
          updatedAt: this.#deps.clock.now().toISOString(),
        });
      }
      return undefined;
    });
  }

  /**
   * The landed 1b patch union replaces queue surfaces but carries no count
   * tuples, and D81 forbids the client from re-deriving a count. So a change
   * is a PATCH only when it is provably count-neutral — a member surface
   * (contained in its parent's rollup, never counted), or a top-level surface
   * whose status did not move. Everything count-bearing (a new run, a status
   * transition, a hide) becomes a fresh SNAPSHOT, which is why the client's
   * "snapshot + any valid patch sequence equals a fresh snapshot" invariant
   * holds exactly instead of approximately.
   */
  #notify(affected: { runIds: readonly string[]; workerChanged: boolean }): void {
    const changes: RunQueueProjectionChange[] = [];
    let snapshotNeeded = affected.workerChanged;
    for (const runId of affected.runIds) {
      const row = this.#rows.get(runId);
      if (row === undefined) continue;
      const day = localDatePart(new Date(row.queued.ts));
      const authority = this.#authorityRun(runId);
      const previousStatus = this.#notifiedStatus.get(runId);
      // Archiving is count-bearing exactly like hiding: the row leaves the
      // payload, so the client is handed a fresh snapshot rather than a patch
      // that could only describe a row that is no longer there.
      if (authority.hidden || this.#deps.authority.isArchived(runId)) {
        if (previousStatus !== undefined) {
          this.#notifiedStatus.delete(runId);
          snapshotNeeded = true;
        }
        continue;
      }
      const replacement = this.#surface(row, authority);
      const countNeutral = replacement.surfaceKind === "member"
        ? previousStatus !== undefined
        : previousStatus === replacement.status;
      this.#notifiedStatus.set(runId, replacement.status);
      if (!countNeutral) {
        snapshotNeeded = true;
        continue;
      }
      changes.push({
        kind: "patch",
        cursor: this.cursor(),
        day,
        patch: DashboardDayPatchSchema.parse({
          operation: "replace-queue-surface",
          target: { runId, rowRevision: replacement.rowRevision },
          replacement,
        }),
      });
    }
    if (snapshotNeeded) changes.push({ kind: "snapshot", cursor: this.cursor() });
    for (const change of changes) {
      for (const listener of this.#listeners) listener(change);
    }
  }

  /* ── the authority join ────────────────────────────────────────────────── */

  #authorityRun(runId: string): RunRecord {
    const record = this.#deps.authority.getRun(runId);
    if (record === undefined) {
      throw new Error(
        `run ${runId} exists in the span stream but not in authority; the projection refuses to render an unaccounted run`,
      );
    }
    return record;
  }

  #status(row: RunFoldRecord, authority: RunRecord): z.infer<typeof QueueSurfaceWireSchema>["status"] {
    const { lifecycle } = authority;
    if (lifecycle.state === "terminal") return RUN_OUTCOME_STATUS[lifecycle.outcome];
    if (row.ended !== undefined) return RUN_OUTCOME_STATUS[row.ended.outcome];
    if (lifecycle.state === "parked-write") return "blocked";
    if (lifecycle.state === "parked-gate" || row.openGates.length > 0) return "awaiting-approval";
    if (lifecycle.state === "claimed" || lifecycle.state === "validating" || lifecycle.state === "running") return "running";
    if (row.claimedBy !== undefined) return "running";
    return "queued";
  }

  /**
   * D124: the terminal instant a finished row's duration is measured against.
   *
   * Authority is preferred because the terminal-authority contract writes
   * `lifecycle.endedAt` as the commit marker; the run's own `span.ended` is
   * the fallback for a row whose status came from the span stream while
   * authority had not settled yet. When neither exists the row says so — a
   * terminal run with no end instant is a real (if rare) state, and naming it
   * is the only honest option. The client never fills the gap with `now`.
   */
  #endedAt(
    row: RunFoldRecord,
    authority: RunRecord,
    status: QueueSurfaceWire["status"],
  ): { state: "present"; value: string } | { state: "absent"; reason: string } {
    if (!TERMINAL_QUEUE_STATUSES.has(status)) {
      return { state: "absent", reason: `run is ${status} and has not ended` };
    }
    const { lifecycle } = authority;
    if (lifecycle.state === "terminal") return { state: "present", value: lifecycle.endedAt };
    if (row.ended !== undefined) return { state: "present", value: row.ended.endedAt };
    return {
      state: "absent",
      reason: `run reads ${status} but neither authority nor its run span recorded an end instant`,
    };
  }

  /**
   * D12: when the OPEN gate opened, for the row's `Waiting on you · 10m`.
   *
   * Sourced from the GATE'S OWN RECORD — the `gate.opened` span the executor
   * emits, which is exactly what the run-detail decision notice reads, so the
   * two surfaces cannot date one gate two ways. `updatedAt` is never a source:
   * it moves on every patch and would report an aging gate as young, which is
   * the one direction this fact may never err in.
   *
   * Authority's `lifecycle.parkedAt` is the FALLBACK rather than the preferred
   * value, which inverts `#endedAt`'s ordering on purpose. The executor emits
   * `gate.opened`, then releases the browser session, THEN transitions to
   * `parked-gate` — so `parkedAt` is the LATER of the two instants by however
   * long a session close takes, and preferring it would systematically shave
   * that off every gate's age.
   */
  #gateOpenedAt(
    row: RunFoldRecord,
    authority: RunRecord,
    status: QueueSurfaceWire["status"],
  ): { state: "present"; value: string } | { state: "absent"; reason: string } {
    if (status !== "awaiting-approval") {
      return { state: "absent", reason: `run is ${status} and is not waiting on a gate` };
    }
    const open = row.openGates.at(-1);
    if (open !== undefined) return { state: "present", value: open.openedAt };
    if (authority.lifecycle.state === "parked-gate") {
      return { state: "present", value: authority.lifecycle.parkedAt };
    }
    return {
      state: "absent",
      reason: "run reads awaiting-approval but neither an open gate span nor a parked-gate lifecycle dates the gate",
    };
  }

  /**
   * D13: a failed row says WHY on the card, in the failure record's own words.
   *
   * The summary is mirrored VERBATIM — D13 is explicit that a parent mirrors
   * its child's error rather than composing one, and "never 'Unknown error'"
   * is the same rule stated for the substitution this projector must not make.
   * Every other status carries a named absence: no producer authors a live
   * progress sentence on this wire, and inventing one for a running run would
   * be narration the run never emitted.
   *
   * A terminal-failed run whose failure record authority does not hold serves
   * a NAMED absence rather than throwing. `buildActivityReportWire` throws on
   * the same hole because a breakdown with a gap in it is a wrong aggregate;
   * here the same hole would degrade the ONE projection every surface renders,
   * so the row states the missing record by id — and the queue's ⓘ popover
   * prints exactly that reason, which puts the hole in front of the operator
   * instead of behind an outage.
   */
  #liveMessage(
    authority: RunRecord,
    status: QueueSurfaceWire["status"],
  ): { state: "present"; value: string } | { state: "absent"; reason: string } {
    const { lifecycle } = authority;
    if (lifecycle.state !== "terminal" || lifecycle.outcome !== "failed") {
      if (status === "failed") {
        return {
          state: "absent",
          reason: "the run span reports a failure authority has not settled, so no failure record exists to mirror",
        };
      }
      return TERMINAL_QUEUE_STATUSES.has(status)
        ? { state: "absent", reason: `run settled ${status}; only a failed run carries an error sentence` }
        : { state: "absent", reason: `run is ${status}; no producer authors a live progress sentence on this wire` };
    }
    const { failureId } = lifecycle;
    if (failureId === undefined) {
      return { state: "absent", reason: "run settled failed without a structured failure record" };
    }
    const failure = this.#deps.authority.getFailure(failureId);
    if (failure === undefined) {
      return {
        state: "absent",
        reason: `run settled failed against failure ${failureId}, which authority does not hold`,
      };
    }
    return { state: "present", value: failure.summary };
  }

  /**
   * D22/D126: the REAL warning count behind the `△ N` chip, plus the first
   * warning's own sentence for its title.
   *
   * The warning set lives on the run's evidence receipt (doc 12's uncertainty
   * evidence) — the terminal result record stores the workflow's declared
   * result and knows nothing about uncertainty. The read is a plain lookup of
   * an already-derived receipt: deriving one here would make rendering a queue
   * write authority (D141), and this projection never mutates authority.
   *
   * Three distinct absences, never collapsed into a zero: the run has not
   * settled, no receipt has been derived, or the receipt records no warning.
   */
  #warnings(
    runId: string,
    status: QueueSurfaceWire["status"],
  ): { state: "present"; count: number; first: string } | { state: "absent"; reason: string } {
    if (!TERMINAL_QUEUE_STATUSES.has(status)) {
      return { state: "absent", reason: `run is ${status} and has not produced a terminal result` };
    }
    const receipt = this.#deps.authority.getReceipt(runId);
    if (receipt === undefined) {
      return {
        state: "absent",
        reason: "no evidence receipt has been derived for this run, so its warning set is unknown",
      };
    }
    const first = receipt.warnings[0];
    if (first === undefined) {
      return { state: "absent", reason: "this run's evidence receipt records no warning" };
    }
    return { state: "present", count: receipt.warnings.length, first: first.summary };
  }

  #pipeline(row: RunFoldRecord): QueueSurfaceWire["pipeline"] {
    const descriptor = this.#deps.descriptors.resolve(row.queued.workflow);
    const spanByNode = new Map<string, z.infer<typeof TaskSpanFoldSchema>>();
    for (const span of row.taskSpans) {
      const nodeId = nodeIdOfTaskSpanPath(span.spanPath);
      if (nodeId !== undefined) spanByNode.set(nodeId, span);
    }
    const stepState = (span: z.infer<typeof TaskSpanFoldSchema> | undefined): "pending" | "active" | "done" | "failed" | "skipped" | "blocked" => {
      if (span === undefined) return "pending";
      if (span.outcome === undefined) return "active";
      return TASK_OUTCOME_PIPELINE[span.outcome];
    };
    if (descriptor === undefined) {
      // No registered descriptor (e.g. a replayed historical workflow): the
      // pipeline shows exactly the observed nodes, never an invented step
      // list. One node still renders ONE chip — a node re-run under a later
      // run attempt repeats its span path, and two chips for one step would
      // show the same node in two states at once.
      const observed = new Map<string, { label: string; span: z.infer<typeof TaskSpanFoldSchema> }>();
      for (const span of row.taskSpans) {
        observed.set(nodeIdOfTaskSpanPath(span.spanPath) ?? span.name, { label: span.name, span });
      }
      return [...observed].map(([id, { label, span }]) => ({ id, label, state: stepState(span) }));
    }
    return descriptorRuntimeNodes(descriptor)
      .filter((node) => node.kind === "task" || node.kind === "transaction" || node.kind === "child-run")
      .map((node) => ({
        id: String(node.id),
        label: String(node.id),
        state: stepState(spanByNode.get(String(node.id))),
      }));
  }

  #surface(row: RunFoldRecord, authority: RunRecord): QueueSurfaceWire {
    const { queued } = row;
    const shape = queued.shape;
    const status = this.#status(row, authority);
    const failedTerminalMembers = row.memberRunIds.filter((memberId) => {
      const member = this.#rows.get(memberId);
      return member?.ended?.outcome === "failed";
    });
    const terminalMembers = row.memberRunIds.filter((memberId) => this.#rows.get(memberId)?.ended !== undefined);
    const base = {
      runId: queued.runId,
      itemId: queued.itemId,
      workflowId: queued.workflow,
      traceId: queued.traceId,
      attempt: row.attempt,
      lineage: queued.parentRunId === undefined
        ? { state: "root" }
        : { state: "child", parentRunId: queued.parentRunId },
      actorId: queued.actorId,
      /**
       * D179: the build THIS RUN was enqueued under, read from authority.
       * Serving `deps.appVersion` here made every row claim the build that
       * was serving the page, so the run-detail "served by a different app
       * build" comparison could never fire. A run enqueued before the stamp
       * existed reports its absence with the reason; it is never back-filled.
       */
      appVersion: authority.appVersion === undefined
        ? { state: "absent", reason: "enqueued before runs stamped their app build (D179)" }
        : { state: "present", value: authority.appVersion },
      descriptorVersion: authority.envelope.descriptorVersion,
      descriptorHash: queued.contractFingerprint,
      configFingerprint: queued.configFingerprint,
      resolvedInstances: Object.entries(queued.resolvedInstance).map(([system, instance]) => ({ system, instance })),
      /**
       * D6: the flag's one home is the run envelope, so the row reads it from
       * AUTHORITY rather than from the `run.queued` span's copy of it. The two
       * agree by construction, and when they could not, the durable record is
       * the one that decided whether the write kernel was allowed to commit.
       */
      dryRun: authority.envelope.dryRun,
      startedAt: queued.ts,
      updatedAt: authority.updatedAt,
      endedAt: this.#endedAt(row, authority, status),
      gateOpenedAt: this.#gateOpenedAt(row, authority, status),
      title: authority.displayName ?? queued.title,
      subtitle: queued.subtitle === undefined
        ? { state: "absent", reason: "the start plan proposed no subtitle" }
        : { state: "present", value: queued.subtitle },
      status,
      liveMessage: this.#liveMessage(authority, status),
      warnings: this.#warnings(queued.runId, status),
      pipeline: this.#pipeline(row),
      panelKind: panelKindOf(shape),
      availableSections: [
        "logs",
        "context-data",
        "context-attempts",
        ...(authority.lifecycle.state === "terminal" && authority.lifecycle.outcome === "failed" ? ["failure"] : []),
      ],
      rowRevision: authority.version,
    };
    if (shape === "operation") {
      return QueueSurfaceWireSchema.parse({
        ...base,
        surfaceKind: "operation",
        memberRunIds: row.memberRunIds,
        memberRollup: {
          total: row.memberRunIds.length,
          terminal: terminalMembers.length,
          failed: failedTerminalMembers.length,
        },
      });
    }
    return QueueSurfaceWireSchema.parse({ ...base, surfaceKind: surfaceKindOf(shape) });
  }

  /* ── THE payload (D81) ─────────────────────────────────────────────────── */

  buildDashboardDayWire(day: string): DashboardDayWire {
    if (this.#health.state === "degraded") {
      throw new Error(`the run/queue projection is degraded and refuses to serve counts: ${this.#health.lastError ?? "unknown"}`);
    }
    const parsedDay = z.iso.date().parse(day);
    const surfaces: QueueSurfaceWire[] = [];
    const monthPrefix = parsedDay.slice(0, 7);
    const monthCounts = new Map<string, number>();
    for (const row of this.#rows.values()) {
      const rowDay = localDatePart(new Date(row.queued.ts));
      const authority = this.#authorityRun(row.queued.runId);
      if (authority.hidden) continue;
      // D80: a prior-version run has left every active surface. It is excluded
      // here — before the month count, before the day filter, before the row
      // is pushed — so no count can disagree about whether it is still live.
      if (this.#deps.authority.isArchived(row.queued.runId)) continue;
      const countsAtTopLevel = row.queued.shape !== "operation-member";
      if (rowDay.startsWith(monthPrefix) && countsAtTopLevel) {
        monthCounts.set(rowDay, (monthCounts.get(rowDay) ?? 0) + 1);
      }
      if (rowDay !== parsedDay) continue;
      surfaces.push(this.#surface(row, authority));
    }
    surfaces.sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.runId.localeCompare(b.runId));

    /**
     * D81: every count below derives from `surfaces` — the exact array the
     * Queue Panel renders. Delegated members are contained in their
     * operation's rollup and therefore excluded from top-level counts, once,
     * here, for every surface at the same time.
     */
    const countable = surfaces.filter((surface) => surface.surfaceKind !== "member");
    const workflowCounts = new Map<string, number>();
    const statusCounts = new Map<string, number>();
    /**
     * The status dimension of the SAME fold — one increment per surface, in
     * this loop, beside the two totals it must agree with. The Workflow
     * Panel's `active │ all` column and the Status Bar's workflow-scoped pills
     * (R4-1) read it; a client-side fold over `queueSurfaces` would be the
     * second count path D81 exists to delete.
     */
    const workflowStatusCounts = new Map<string, Map<string, number>>();
    for (const surface of countable) {
      workflowCounts.set(surface.workflowId, (workflowCounts.get(surface.workflowId) ?? 0) + 1);
      statusCounts.set(surface.status, (statusCounts.get(surface.status) ?? 0) + 1);
      let byStatus = workflowStatusCounts.get(surface.workflowId);
      if (byStatus === undefined) {
        byStatus = new Map<string, number>();
        workflowStatusCounts.set(surface.workflowId, byStatus);
      }
      byStatus.set(surface.status, (byStatus.get(surface.status) ?? 0) + 1);
    }

    const workerCards = [...this.#workers.values()]
      .filter((worker) => worker.system !== undefined)
      .sort((a, b) => a.workerId.localeCompare(b.workerId))
      .map((worker) => {
        const currentRow = worker.currentRunId === undefined ? undefined : this.#rows.get(worker.currentRunId);
        return {
          workerId: worker.workerId,
          system: worker.system,
          state: worker.endedAt !== undefined ? "stopped" : currentRow !== undefined ? "working" : "idle",
          currentRun: currentRow === undefined
            ? { state: "absent", reason: worker.endedAt !== undefined ? "worker stopped" : "no claimed run" }
            : { state: "present", runId: currentRow.queued.runId, traceId: currentRow.queued.traceId },
          revision: worker.eventCount,
        };
      });

    return DashboardDayWireSchema.parse({
      day: parsedDay,
      descriptorHash: this.#deps.descriptorSetHash,
      projectionGeneration: this.#generationValue,
      snapshotCursor: this.cursor(),
      monthCounts: [...monthCounts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([value, count]) => ({ day: value, count })),
      workflowCounts: [...workflowCounts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([workflowId, count]) => ({
          workflowId,
          count,
          statusCounts: [...(workflowStatusCounts.get(workflowId) ?? new Map<string, number>()).entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([statusKey, statusTotal]) => ({ status: statusKey, count: statusTotal })),
        })),
      statusCounts: [...statusCounts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([statusKey, count]) => ({ status: statusKey, count })),
      queueSurfaces: surfaces,
      workerCards,
      notifications: this.#deps.authority.listNotifications(LOCAL_OPERATOR_ACTOR_ID)
        .map((record) => notificationWireOf(record, this.#deps.clock.nowMs()))
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || String(a.notificationId).localeCompare(String(b.notificationId))),
    });
  }

  /**
   * The Activity report (D180, doc 13 §5/§6.7) — a range rendering of the SAME
   * surfaces `buildDashboardDayWire` renders. It lives on this class, and not
   * in a query module, because doc 13 §8 guard #4 names Activity aggregates
   * explicitly: a report that summed rows a second way could disagree with the
   * day it summarises, which is the exact count/badge divergence D81 exists to
   * make unrepresentable. Hidden rows, archived rows and member containment
   * are already applied here, once, for every surface.
   */
  buildActivityReportWire(from: string, to: string): ActivityReportWire {
    if (this.#health.state === "degraded") {
      throw new Error(
        `the run/queue projection is degraded and refuses to serve activity aggregates: ${this.#health.lastError ?? "unknown"}`,
      );
    }
    const start = z.iso.date().parse(from);
    const end = z.iso.date().parse(to);
    if (start > end) throw new Error(`activity range ${start}..${end} ends before it starts`);

    const inRange: { day: string; surface: QueueSurfaceWire; authority: RunRecord }[] = [];
    for (const row of this.#rows.values()) {
      const day = localDatePart(new Date(row.queued.ts));
      if (day < start || day > end) continue;
      const authority = this.#authorityRun(row.queued.runId);
      if (authority.hidden) continue;
      if (this.#deps.authority.isArchived(row.queued.runId)) continue;
      // Member containment, applied once: a member counted inside its
      // operation's rollup is not counted again at top level.
      if (row.queued.shape === "operation-member") continue;
      inRange.push({ day, surface: this.#surface(row, authority), authority });
    }

    const days = new Map<string, number>();
    const workflows = new Map<string, number>();
    const statuses = new Map<string, number>();
    const outcomes = new Map<string, number>();
    const failures = new Map<string, { runs: number; transient: number; sample: string[] }>();
    const measured: { runId: string; ms: number }[] = [];
    let unmeasured = 0;
    let terminalRuns = 0;

    for (const { day, surface, authority } of inRange) {
      days.set(day, (days.get(day) ?? 0) + 1);
      workflows.set(surface.workflowId, (workflows.get(surface.workflowId) ?? 0) + 1);
      statuses.set(surface.status, (statuses.get(surface.status) ?? 0) + 1);
      if (authority.lifecycle.state !== "terminal") continue;
      terminalRuns += 1;
      outcomes.set(authority.lifecycle.outcome, (outcomes.get(authority.lifecycle.outcome) ?? 0) + 1);
      // D124: a terminal row with no end instant has an UNKNOWN duration. It
      // is counted as unknown, never as `now − startedAt`, because that number
      // grows every time the report is refreshed.
      if (surface.endedAt.state === "present") {
        measured.push({
          runId: surface.runId,
          ms: Math.max(0, Date.parse(surface.endedAt.value) - Date.parse(surface.startedAt)),
        });
      } else {
        unmeasured += 1;
      }
      const { failureId } = authority.lifecycle;
      if (failureId === undefined) continue;
      const failure = this.#deps.authority.getFailure(failureId);
      if (failure === undefined) {
        throw new Error(
          `run ${surface.runId} settled failed against failure ${failureId}, which authority does not hold; `
          + "refusing to report a failure breakdown with a hole in it",
        );
      }
      const bucket = failures.get(failure.code) ?? { runs: 0, transient: 0, sample: [] };
      bucket.runs += 1;
      if (failure.transient) bucket.transient += 1;
      if (bucket.sample.length < 5) bucket.sample.push(surface.runId);
      failures.set(failure.code, bucket);
    }

    const categories = new Map<string, number>();
    let unregisteredCategoryRuns = 0;
    const workflowTotals = [...workflows.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([workflowId, runs]) => {
      const descriptor = this.#deps.descriptors.resolve(workflowId);
      if (descriptor === undefined) {
        unregisteredCategoryRuns += runs;
        return {
          workflowId,
          registration: {
            state: "unregistered",
            reason: `workflow ${workflowId} is no longer registered; its label and category are unavailable`,
          },
          runs,
        };
      }
      categories.set(descriptor.category, (categories.get(descriptor.category) ?? 0) + runs);
      return {
        workflowId,
        registration: { state: "registered", label: descriptor.label, categoryId: descriptor.category },
        runs,
      };
    });

    const sorted = [...measured].sort((a, b) => a.ms - b.ms);
    const longest = sorted.at(-1);
    const median = sorted.length === 0 ? undefined : sorted[Math.floor((sorted.length - 1) / 2)];

    return ActivityReportWireSchema.parse({
      wireVersion: 1,
      from: start,
      to: end,
      generatedAt: this.#deps.clock.now().toISOString(),
      totalRuns: inRange.length,
      terminalRuns,
      inFlightRuns: inRange.length - terminalRuns,
      days: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, runs]) => ({ day, runs })),
      workflows: workflowTotals,
      categories: [
        ...[...categories.entries()].sort(([a], [b]) => a.localeCompare(b))
          .map(([categoryId, runs]) => ({ category: { state: "registered", categoryId }, runs })),
        ...(unregisteredCategoryRuns === 0 ? [] : [{
          category: { state: "unregistered", reason: "the workflows behind these runs are no longer registered" },
          runs: unregisteredCategoryRuns,
        }]),
      ],
      statuses: [...statuses.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([status, runs]) => ({ status, runs })),
      outcomes: [...outcomes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([outcome, runs]) => ({ outcome, runs })),
      failures: [...failures.entries()].sort(([a], [b]) => a.localeCompare(b))
        .map(([code, bucket]) => ({ code, runs: bucket.runs, transient: bucket.transient, sample: bucket.sample })),
      durations: {
        measuredRuns: measured.length,
        unmeasuredRuns: unmeasured,
        medianMs: median === undefined
          ? { state: "absent", reason: "no terminal run in range carries both a start and an end instant" }
          : { state: "present", value: median.ms },
        longestMs: longest === undefined
          ? { state: "absent", reason: "no terminal run in range carries both a start and an end instant" }
          : { state: "present", value: longest.ms, runId: longest.runId },
        totalMs: measured.reduce((total, entry) => total + entry.ms, 0),
      },
    });
  }
}

export function createRunQueueProjection(deps: RunQueueProjectionDeps): RunQueueProjection {
  return new RunQueueProjection(deps);
}
