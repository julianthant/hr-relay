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
 * claims, task spans, gates, ends) folded incrementally, joined per-run
 * against SQLite AUTHORITY facts (lifecycle for parked/terminal/hidden,
 * `version` as the row's CAS revision). The folded rows are persisted to the
 * rebuildable `runs_view` projection table; deleting that table loses nothing
 * — `rebuildFromJsonl` is the `rebuild-from-native-jsonl` recovery class.
 *
 * Failure policy (doc 03 §2.3): JSONL append happens BEFORE `apply` is ever
 * called; a failing apply marks the projection degraded and schedules a
 * guarded rebuild — it never throws into the emitting workflow path. A
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
  QueueSurfaceWireSchema,
  type DashboardDayWire,
  type QueueSurfaceWire,
} from "../../../domain/dashboard/projection.js";
import { DashboardDayPatchSchema } from "../../../domain/dashboard/subscription.js";
import {
  FingerprintSchema,
  ProjectionCursorSchema,
  type Fingerprint,
} from "../../../domain/ids.js";
import type { RunRecord } from "../../../domain/run/record.js";
import { deriveSchemaHash } from "../../../domain/schema-bound-value.js";
import { sha256Hex } from "../../../domain/sha256.js";
import { SpanEventWireSchema, type RunQueuedWire, type SpanEventWire } from "../../../events/types.js";
import type { ProjectionRepositories } from "../../../infra/sqlite/authority-database.js";
import { readEventStreamLines } from "../../../infra/events/jsonl-streams.js";

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
  readonly authority: { getRun(runId: string): RunRecord | undefined };
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
   * Incremental ingest — called AFTER the JSONL append. Never throws: a fold
   * failure degrades the projection and schedules the guarded rebuild
   * instead of blocking the workflow that emitted the span.
   */
  apply(event: SpanEventWire): void {
    try {
      const affected = this.#fold(event);
      this.#cursorValue += 1;
      this.#persist(affected.runIds);
      this.#notify(affected);
    } catch (error) {
      this.#health = {
        state: "degraded",
        lastError: `projection apply failed for ${event.t}: ${error instanceof Error ? error.message : String(error)}`,
      };
      const schedule = this.#deps.scheduleRebuild ?? ((rebuild: () => void): void => rebuild());
      schedule(() => this.rebuildFromJsonl());
    }
  }

  /** The `rebuild-from-native-jsonl` recovery class: clear, re-read, re-fold. */
  rebuildFromJsonl(): void {
    try {
      const lines = readEventStreamLines(this.#deps.stateRoot, "spans");
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
      events.sort((a, b) => a.ts.localeCompare(b.ts));
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
      if (authority.hidden) {
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
      appVersion: this.#deps.appVersion,
      descriptorHash: queued.contractFingerprint,
      configFingerprint: queued.configFingerprint,
      resolvedInstances: Object.entries(queued.resolvedInstance).map(([system, instance]) => ({ system, instance })),
      startedAt: queued.ts,
      updatedAt: authority.updatedAt,
      title: authority.displayName ?? queued.title,
      subtitle: queued.subtitle === undefined
        ? { state: "absent", reason: "the start plan proposed no subtitle" }
        : { state: "present", value: queued.subtitle },
      status,
      liveMessage: { state: "absent", reason: "live messages ride the notes projection, which lands after 1g" },
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
    for (const surface of countable) {
      workflowCounts.set(surface.workflowId, (workflowCounts.get(surface.workflowId) ?? 0) + 1);
      statusCounts.set(surface.status, (statusCounts.get(surface.status) ?? 0) + 1);
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
        .map(([workflowId, count]) => ({ workflowId, count })),
      statusCounts: [...statusCounts.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([statusKey, count]) => ({ status: statusKey, count })),
      queueSurfaces: surfaces,
      workerCards,
      notifications: [],
    });
  }
}

export function createRunQueueProjection(deps: RunQueueProjectionDeps): RunQueueProjection {
  return new RunQueueProjection(deps);
}
