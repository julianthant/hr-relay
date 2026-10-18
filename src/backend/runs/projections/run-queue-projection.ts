import { titleCasePersonName } from "../../../models/fields/cell-coercion.js";
import type { WorkerSlotRecord } from "../../../models/run/worker-slot.js";
import { displayScalar } from "../queries/data.js";
import type { WorkerBrowserObservation, WorkerControlRecord } from "../../../models/run/worker-control.js";
import type { RunRecordService } from "../lifecycle/run-record-service.js";
import { canonicalRunChildren, listCanonicalRuns } from "../queries/canonical-runs.js";
import { notificationDisplayContext } from "../queries/notification-display.js";
import type { RunTimelineEvidenceSource } from "../queries/run-timeline-compatibility.js";
import { retainedRunProtectedBindings } from "../../../models/write-safety/protected-input.js";
import { deriveEvidenceEntryId, evidenceEntryRef } from "../../../models/trust/evidence-identity.js";

import { z } from "zod";
import { workflowPlanning, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import type { Clock } from "../../../rules/time/clock.js";
import { localDatePart } from "../../../rules/time/clock.js";
import {
  DashboardDayWireSchema,
  notificationWireOf,
  notificationSourceEventOf,
  QueueSurfaceWireSchema,
  TERMINAL_QUEUE_STATUSES,
  type DashboardDayWire,
  type QueueSurfaceWire,
} from "../../../models/dashboard/projection.js";
import {
  ACTIVITY_SAMPLE_LIMIT,
  ActivityReportWireSchema,
  type ActivityLedgerBlock,
  type ActivityReportWire,
  type ActivityWorkflowTotal,
} from "../../../models/dashboard/activity.js";
import { DashboardDayPatchSchema } from "../../../models/dashboard/subscription.js";
import {
  PositiveIntSchema,
  EidSchema,
  LOCAL_OPERATOR_ACTOR_ID,
  ProjectionCursorSchema,
  type Fingerprint,
} from "../../../rules/identity/ids.js";
import { NotificationRecordSchema } from "../../../models/notifications/notifications.js";
import type { RunRecord } from "../../../models/run/record.js";
import type { RunSummary } from "../../../models/run/summary.js";
import {
  projectReceiptForOperator,
  type OperatorReceiptProjection,
  type RunEvidenceReceipt,
} from "../../../models/trust/evidence.js";
import {
  projectFailureForOperator,
  type FailureRecord,
} from "../../../models/trust/failure.js";
import { SpanEventWireSchema, type RunQueuedWire, type SpanEventWire } from "../../../models/events/types.js";
import type { RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import { isLiveWorker, type WorkerLeaseRecord } from "../../../models/run/worker.js";
import type { RunSessionRecord } from "../../../models/run/session.js";
import type { WorkerPoolRecord } from "../../../models/run/worker-pool.js";
import { queueRowActions } from "./queue-row-actions.js";
import { allowsSubjectIdentity, resolveResultTitle, verifiedResultDisplayValue, resolveSubjectTitle } from "./run-subject-title.js";
import { workerCardOf, type WorkerBrowserFold } from "./worker-cards.js";
import type { TimelineLine } from "../../storage/events/timeline-reader.js";
import type { TimelineRepository } from "../../../models/events/timeline.js";
import { readTimelineRecords, timelineSpanLocation } from "../../storage/events/timeline-reader.js";
import { browserSessionOfSpanPath, nodeIdOfTaskSpanPath } from "../lifecycle/support.js";
import { deriveRunStatus, foldCategoryState, panelKindOf, taskStateOf, type TaskExecutionState } from "../lifecycle/run-status.js";
import { ProjectionDegradedError } from "../commands/refusals.js";

/* ── the in-memory evidence fold shape ─ */

const TaskSpanFoldSchema = z.strictObject({
  nativeEventId: z.uuid().optional(),
  // Include the attempt in span identity; retries share node IDs but not executions.
  attempt: z.number().int().positive(),
  spanPath: z.string().min(1),
  name: z.string().min(1),
  startedAt: z.iso.datetime({ offset: true }).optional(),
  endedAt: z.iso.datetime({ offset: true }).optional(),
  outcome: z.enum(["done", "failed", "cancelled", "discarded", "skipped", "interrupted", "superseded"]).optional(),

  notRunReason: z.enum(["condition-false", "branch-not-selected", "operator-asserted", "step-omitted"]).optional(),
});

const RunFoldRecordSchema = z.strictObject({
  queued: z.custom<RunQueuedWire>((value) => SpanEventWireSchema.parse(value) !== undefined),
  attempt: z.number().int().positive(),
  claimedBy: z.string().min(1).optional(),
  requeues: z.number().int().nonnegative(),
  taskSpans: z.array(TaskSpanFoldSchema),
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
  currentRunId?: string;
  // Delete closed sessions from held-browser state; a closed session is not an owned browser.
  browsers: Map<string, WorkerBrowserFold>;
  eventCount: number;
}

/* ── dependencies ────────────────────────────────────────────────────────── */

// Production summaries share the authority snapshot; fixture readers may omit this port.
export interface ServedSummaryQueries {
  withSnapshot<T>(read: () => T): T;
  queue(input: { fromDay: string; toDay: string; limit: number; topLevel: boolean; after?: { localDay: string; runId: string } }): {
    items: readonly { runId: string; localDay: string; shape: string; title: string; status: QueueSurfaceWire["status"]; children: readonly { runId: string }[] }[];
    next: { localDay: string; runId: string } | null;
  };
  itemAttempts(day: string, items: readonly { workflowId: string; itemId: string }[]): readonly RunRecord[];
  activity(from: string, to: string): ActivityReportWire;
}

export interface RunQueueProjectionDeps {
  readonly timeline: TimelineRepository;
  readonly reader: Pick<RunRecordService, "read" | "list" | "withRunTreeSnapshot"> & { readonly summaries?: ServedSummaryQueries };
  readonly stateRoot: string;
  readonly clock: Clock;
  readonly appVersion: string;
  /** One fingerprint over the registered descriptor set — ref workflow-model's skew tripwire. */
  readonly descriptorSetHash: Fingerprint;
  // Activity write-ledger totals come from their separate durable authority, never inferred task spans.
  readonly ledger: {
    foldActivityRange(from: string, to: string): ActivityLedgerBlock;
  };
  /** Narrow authority read view; the projection never mutates authority. */
  readonly authority: {
    /** Durable inbox rows served by day. */
    listNotifications(actorId: string): readonly z.infer<typeof NotificationRecordSchema>[];
    latestNotificationSource?(notificationId: string): { actorId: string; notificationId: string; event: unknown; adopted: boolean } | undefined;
    listNotificationCheckpoints(workflowId: string, itemId: string, nodeId: string, attempt: number): readonly RunCheckpointRecord[];
    listCheckpoints: RunTimelineEvidenceSource["authority"]["listCheckpoints"];
    listGateResults: RunTimelineEvidenceSource["authority"]["listGateResults"];

    listWorkerSlots?(): readonly WorkerSlotRecord[];
    listWorkerRuns?(workerId: string): readonly RunRecord[];
    workerOwnerAlive?(lease: WorkerLeaseRecord): boolean;
    listLiveWorkerLeases(): readonly WorkerLeaseRecord[];
    getWorkerLease(workerId: string): WorkerLeaseRecord | undefined;
    workerBrowsers?(workerId: string): readonly WorkerBrowserObservation[];
    workerControls?(): readonly WorkerControlRecord[];
    ownsWorker?(lease: WorkerLeaseRecord): boolean;

    listWorkerPools(): readonly WorkerPoolRecord[];
    listRunBatches(): readonly RunSessionRecord[];
    getRunBatch(batchId: string): RunSessionRecord | undefined;

    getFailure(failureId: string): FailureRecord | undefined;
    // A complete projector rebuild reads authority and spans; spans alone cannot reconstruct live state.
    getReceipt(runId: string): RunEvidenceReceipt | undefined;

    canonicalPerson?(runId: string): RunSummary["person"];

    latestCheckpoint(
      workflowId: string,
      itemId: string,
      nodeId: string,
    ): RunCheckpointRecord | undefined;
  };
  readonly descriptors: { resolve(workflowId: string): AnyWorkflowDescriptor | undefined };

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

type ProjectedRunLogEvent = Extract<SpanEventWire, { t: "data.observed" | "transaction.fenced" }>;

export interface ProjectedRunLogEntry {
  readonly line: TimelineLine;
  readonly event: ProjectedRunLogEvent;
  /** Append-fold revision within this projection generation. */
  readonly revision: number;
}

export interface ProjectedRunLogSnapshot {
  readonly projectionGeneration: number;
  readonly snapshotRevision: number;
  readonly entries: readonly ProjectedRunLogEntry[];
}

interface CanonicalProjectionSnapshot {
  readonly runs: readonly RunRecord[];
  readonly byId: ReadonlyMap<string, RunRecord>;
  readonly children: ReadonlyMap<string, readonly RunRecord[]>;
}

/** A synchronous operation can render several rows from one canonical membership read. */
export interface RunQueueReadSnapshot {
  readonly runs: readonly RunRecord[];
  surfaces(runIds: readonly string[]): readonly QueueSurfaceWire[];
}


/* ── helpers ─────────────────────────────────────────────────────────────── */

function surfaceKindOf(shape: RunQueuedWire["shape"]): "single" | "preview" | "operation" | "member" {
  if (shape === "operation") return "operation";
  if (shape === "operation-member") return "member";
  return shape;
}


// Read the receipt once per surface; facts and warnings must share one receipt verdict.
type ReceiptView = OperatorReceiptProjection;

type WarningVerdict =
  | { kind: "not-terminal"; status: QueueSurfaceWire["status"] }
  | { kind: "unread" }
  | { kind: "withheld"; reason: string }
  | { kind: "none" }
  | { kind: "present"; count: number; first: string };

// Activity uses the receipt verdict from the surface fold so its aggregate cannot disagree with the row.
interface SurfaceFold {
  readonly surface: QueueSurfaceWire;
  readonly warningVerdict: WarningVerdict;
}


const ACTIVITY_STATUS_BUCKET = {
  done: "completion",
  failed: "failed",
  cancelled: "cancelled",
  partial: "partial",
  queued: "open",
  running: "open",
  cancelling: "open",
  blocked: "open",
  "awaiting-approval": "open",
} as const satisfies Record<QueueSurfaceWire["status"], string>;

type ActivityWorkflowCounts = Omit<ActivityWorkflowTotal, "workflowId" | "registration">;

function emptyActivityWorkflowCounts(): ActivityWorkflowCounts {
  return {
    runs: 0,
    completion: { readBack: 0, warnings: 0, warningsUnknown: 0 },
    failed: 0,
    cancelled: 0,
    partial: 0,
    open: 0,
  };
}

// Individual pseudonyms and generations stay in authority; publish aggregate evidence only.
function activityPeopleOf(personRows: readonly RunRecord[], read: ((runId:string)=>RunSummary["person"]) | undefined) {
  const identities=personRows.map(run=>read?.(run.envelope.runId) ?? {state:"unavailable" as const,reason:"canonical-result-reader-unavailable"});
  const available=identities.filter(row=>row.state==="available"),unavailableRows=identities.length-available.length;
  if(unavailableRows!==0)return {state:"absent" as const,evidenceRows:available.length,unavailableRows,
    reason:`${String(unavailableRows)} of ${String(personRows.length)} current Separations run/member rows lack validated canonical identity; distinct people is unavailable`};
  return {state:"present" as const,distinct:new Set(available.map(row=>row.identity)).size,evidenceRows:available.length};
}


const MEMBER_PREVIEW_LIMIT = 3;


interface LinkedRunView {
  readonly runId: string;
  readonly partitionDay: string;
  readonly workflowId: string;
  readonly label: string;
  readonly panelKind: "run" | "member" | "group";
  readonly status: string;
}


// Exclude heartbeat timestamps and versions to avoid republishing each beat; served versions are not the CAS basis.
function workerLeaseFingerprintOf(leases: ReadonlyMap<string, WorkerLeaseRecord>): string {
  const facts = [...leases.values()]
    .sort((a, b) => a.workerId.localeCompare(b.workerId))
    .map((lease) => ({
      workerId: lease.workerId,
      workflow: lease.workflow,
      leaseGeneration: lease.leaseGeneration,
      controlRevision: lease.controlRevision,
      processId: lease.processId,
      browserSystems: lease.browserSystems ?? null,
      directive: lease.control.directive,
      lifecycle: lifecycleCardFactsOf(lease.lifecycle),
    }));
  return JSON.stringify(facts);
}

/** The lifecycle arm's card-drawn fields — every arm named, so a new arm is a type error here. */
function lifecycleCardFactsOf(lifecycle: WorkerLeaseRecord["lifecycle"]): Record<string, string> {
  switch (lifecycle.state) {
    case "starting":
      return { state: lifecycle.state, startedAt: lifecycle.startedAt };
    case "idle":
    case "stopping":
      return { state: lifecycle.state, startedAt: lifecycle.startedAt };
    case "waiting":
      return { state: lifecycle.state, startedAt: lifecycle.startedAt, activity: lifecycle.activity, ...(lifecycle.runId === undefined ? {} : { runId: lifecycle.runId }) };
    case "busy":
      return { state: lifecycle.state, startedAt: lifecycle.startedAt, runId: lifecycle.runId };
    case "paused":
      return { state: lifecycle.state, startedAt: lifecycle.startedAt, pausedAt: lifecycle.pausedAt };
    case "stopped":
      return {
        state: lifecycle.state,
        startedAt: lifecycle.startedAt,
        stoppedAt: lifecycle.stoppedAt,
        reason: lifecycle.reason,
      };
  }
}

/* ── the projection ──────────────────────────────────────────────────────── */

export class RunQueueProjection {
  readonly #deps: RunQueueProjectionDeps;
  readonly #rows = new Map<string, RunFoldRecord>();
  readonly #workers = new Map<string, WorkerFold>();
  readonly #runLogs = new Map<string, ProjectedRunLogEntry[]>();
  readonly #listeners = new Set<(change: RunQueueProjectionChange) => void>();
  readonly #notifiedStatus = new Map<string, string>();

  #timelineCursor = 0;

  #workerAuthorityFingerprint: string;
  #publishedBatchVersions: ReadonlyMap<string, number> = new Map();
  #cursorValue = 0;
  #generationValue: number;
  #health: RunQueueProjectionHealth = { state: "live" };

  constructor(deps: RunQueueProjectionDeps) {
    this.#deps = deps;
    this.#generationValue = Math.max(1, Math.trunc(deps.clock.nowMs()));
    this.#workerAuthorityFingerprint = this.#captureSharedAuthorityFingerprint();
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

  // Index logs by durable ingestion order, never by run-instant file partitions.
  runLogSnapshot(runId: string): ProjectedRunLogSnapshot {
    if (this.#health.state === "degraded") {
      throw new ProjectionDegradedError(
        `the run/queue projection is degraded and refuses to serve observed logs: ${this.#health.lastError ?? "unknown"}`,
      );
    }
    const entries = this.#runLogs.get(runId) ?? [];
    return Object.freeze({
      projectionGeneration: this.#generationValue,
      snapshotRevision: entries.at(-1)?.revision ?? 0,
      entries: Object.freeze([...entries]),
    });
  }


  apply(event: SpanEventWire): void {
    try {
      const affected = this.#fold(event);
      this.#cursorValue += 1;
      this.#notify(affected);
    } catch (error) {
      this.#degrade(`projection apply failed for ${event.t}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }


  ingestFromTimeline(): void {
    // While degraded, recovery belongs to the scheduled rebuild alone — it
    // re-reads the whole stream and resets these cursors.
    if (this.#health.state === "degraded") return;
    try {
      const tail = readTimelineRecords(this.#deps.timeline, this.#timelineCursor);
      this.#timelineCursor = tail.cursor;
      if (tail.records.length === 0) return;
      const events = tail.records.filter((record) => record.payload.kind === "span")
        .map((record) => ({ event: SpanEventWireSchema.parse(record.payload.kind === "span" ? record.payload.event : undefined), line: timelineSpanLocation(record) }));
      const snapshot = this.#canonicalSnapshot();
      for (const { event, line } of events) {
        const affected = this.#fold(event, line);
        this.#cursorValue += 1;
        this.#recordRunLog(event, line);
        this.#notify(affected, snapshot);
      }
    } catch (error) {
      this.#degrade(`timeline ingest failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Reconcile live leases independently of span ingestion; lifecycle changes need not emit spans.
  reconcileWorkerAuthority(): void {
    if (this.#health.state === "degraded") return;
    try {
      const fingerprint = this.#captureSharedAuthorityFingerprint();
      if (fingerprint === this.#workerAuthorityFingerprint) return;
      this.#workerAuthorityFingerprint = fingerprint;
      this.#cursorValue += 1;
      this.#notify({ runIds: [], workerChanged: true });
    } catch (error) {
      this.#degrade(`worker lease reconcile failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }


  #degrade(lastError: string): void {
    this.#health = { state: "degraded", lastError };
    const schedule = this.#deps.scheduleRebuild ?? ((rebuild: () => void): void => rebuild());
    schedule(() => this.rebuildFromTimeline());
  }


  #recordRunLog(event: SpanEventWire, line: TimelineLine): void {
    if (event.t !== "data.observed" && event.t !== "transaction.fenced") return;
    const entries = this.#runLogs.get(event.runId) ?? [];
    if (!this.#runLogs.has(event.runId)) this.#runLogs.set(event.runId, entries);
    entries.push(Object.freeze({ event, line, revision: this.#cursorValue }));
  }

  /** Rebuild derived views from a consistent SQLite timeline snapshot. */
  rebuildFromTimeline(): void {
    try {
      const whole = readTimelineRecords(this.#deps.timeline);
      const events = whole.records.filter((record) => record.payload.kind === "span")
        .map((record) => ({ event: SpanEventWireSchema.parse(record.payload.kind === "span" ? record.payload.event : undefined), line: timelineSpanLocation(record) }))
        .sort((left, right) => left.event.ts.localeCompare(right.event.ts) || left.line.lineNumber - right.line.lineNumber);
      this.#rows.clear();
      this.#workers.clear();
      this.#runLogs.clear();
      this.#notifiedStatus.clear();
      this.#cursorValue = 0;
      for (const { event, line } of events) {
        this.#fold(event, line);
        this.#cursorValue += 1;
        this.#recordRunLog(event, line);
      }
      // The tail resumes from exactly what this rebuild consumed — set
      // together with `live` so the two ingest paths can never overlap.
      this.#timelineCursor = whole.cursor;
      this.#generationValue = Math.max(this.#generationValue + 1, Math.trunc(this.#deps.clock.nowMs()));
      this.#cursorValue = Math.max(1, this.#cursorValue);
      this.#health = { state: "live" };
      this.#workerAuthorityFingerprint = this.#captureSharedAuthorityFingerprint();
      const change: RunQueueProjectionChange = { kind: "generation", cursor: this.cursor() };
      for (const listener of this.#listeners) listener(change);
    } catch (error) {
      this.#health = {
        state: "degraded",
        lastError: `timeline rebuild failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }


  refreshRun(runId: string): void {
    this.#cursorValue += 1;
    this.#notify({ runIds: [runId], workerChanged: false });
  }


  queueSurface(runId: string): QueueSurfaceWire | undefined {
    const existence = this.#deps.reader.read(runId);
    if (existence.state !== "present" || existence.disposition !== "live") return undefined;
    return this.queueSurfaces([runId])[0];
  }

  /** Bulk frozen-member reads share one canonical enumeration. */
  queueSurfaces(runIds: readonly string[]): readonly QueueSurfaceWire[] {
    return this.captureQueueSnapshot().surfaces(runIds);
  }

  captureQueueSnapshot(selectedRuns?: readonly RunRecord[]): RunQueueReadSnapshot {
    const snapshot = selectedRuns === undefined ? this.#canonicalSnapshot() : { runs: selectedRuns, byId: new Map(selectedRuns.map(run => [run.envelope.runId, run])), children: canonicalRunChildren(selectedRuns) };
    return Object.freeze({
      runs: snapshot.runs,
      surfaces: (runIds: readonly string[]) => runIds.flatMap((runId) => {
        const run = snapshot.byId.get(runId);
        return run === undefined ? [] : [this.#surface(this.#rows.get(runId), run, snapshot.children.get(runId) ?? [])];
      }),
    });
  }

  #canonicalSnapshot(): CanonicalProjectionSnapshot {
    const runs = listCanonicalRuns(this.#deps.reader, "live");
    return { runs, byId: new Map(runs.map((run) => [run.envelope.runId, run])), children: canonicalRunChildren(runs) };
  }

  /* ── folding ───────────────────────────────────────────────────────────── */

  #row(runId: string, eventType: string): RunFoldRecord {
    const row = this.#rows.get(runId);
    if (row === undefined) {
      throw new Error(`${eventType} names run ${runId}, which has no run.queued span in the fold`);
    }
    return row;
  }

  #fold(event: SpanEventWire, line?: TimelineLine): { runIds: readonly string[]; workerChanged: boolean } {
    if (event.t === "run.queued") {
      if (this.#rows.has(event.runId)) {
        throw new Error(`run.queued replayed for ${event.runId}; identity attributes are write-once`);
      }
      this.#rows.set(event.runId, RunFoldRecordSchema.parse({
        queued: event,
        attempt: event.attempt,
        requeues: 0,
        taskSpans: [],
        openGates: [],
        resolvedGates: [],
        memberRunIds: [],
        lastEventAt: event.ts,
        eventCount: 1,
      }));
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
          ...(line === undefined ? {} : { nativeEventId: line.file.path.replace(/^timeline:/u, "") }),
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
        this.#workers.set(event.workerId, {
          workerId: event.workerId,
          startedAt: event.ts,
          browsers: new Map(),
          eventCount: 1,
        });
        return { runIds: [], workerChanged: true };
      }
      const worker = this.#workers.get(event.workerId)
        ?? { workerId: event.workerId, startedAt: event.ts, browsers: new Map(), eventCount: 0 };
      this.#workers.set(event.workerId, worker);

      const session = browserSessionOfSpanPath(event.spanPath, event.system);
      worker.browsers.set(session.sessionId, { ...session, openedAt: event.ts });
      worker.eventCount += 1;
      return { runIds: [], workerChanged: true };
    }

    // A preview event is transaction detail, not a task settlement.
    if (event.t === "transaction.previewed") return { runIds: [], workerChanged: false };


    if (event.t === "transaction.fenced") return { runIds: [], workerChanged: false };


    if (event.t === "data.observed") return { runIds: [], workerChanged: false };

    // span.ended
    if (event.kind === "task") {
      const row = this.#row(event.runId, event.t);
      // A close binds to the last still-open occurrence at its identity.
      let span: z.infer<typeof TaskSpanFoldSchema> | undefined;
      for (let index = row.taskSpans.length - 1; index >= 0; index -= 1) {
        const candidate = row.taskSpans[index];
        if (candidate === undefined) continue;
        if (candidate.attempt !== event.attempt || candidate.spanPath !== event.spanPath) continue;
        if (candidate.endedAt !== undefined) continue;
        span = candidate;
        break;
      }
      if (span === undefined) {

        span = {
          ...(line === undefined ? {} : { nativeEventId: line.file.path.replace(/^timeline:/u, "") }),
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

      else worker.browsers.delete(browserSessionOfSpanPath(event.spanPath).sessionId);
      worker.eventCount += 1;
    }
    return { runIds: [], workerChanged: true };
  }

  // Row patches carry no count tuples; count changes require a snapshot.
  #notify(affected: { runIds: readonly string[]; workerChanged: boolean }, snapshot = this.#canonicalSnapshot()): void {
    const changes: RunQueueProjectionChange[] = [];
    let snapshotNeeded = affected.workerChanged;
    let batchPresentationChanged = false;
    const { byId, children } = snapshot;
    for (const runId of affected.runIds) {
      const row = this.#rows.get(runId);
      const authority = byId.get(runId);
      const previousStatus = this.#notifiedStatus.get(runId);

      if (authority === undefined) {
        if (previousStatus !== undefined) {
          this.#notifiedStatus.delete(runId);
          snapshotNeeded = true;
        }
        continue;
      }
      const day = localDatePart(new Date(authority.envelope.enqueuedAt));
      const replacement = this.#surface(row, authority, children.get(runId) ?? []);
      const batch = replacement.session;
      if (batch.state === "present" && batch.presentation !== undefined
        && this.#publishedBatchVersions.get(batch.sessionId) !== batch.presentation.version) {
        // A row refresh can beat the poll. Its batch facts must move together
        // for all members, never leak a new revision through one row patch.
        batchPresentationChanged = true;
        snapshotNeeded = true;
      }
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
    if (snapshotNeeded) this.#workerAuthorityFingerprint = this.#captureSharedAuthorityFingerprint(snapshot.runs);
    if (snapshotNeeded) changes.push({ kind: "snapshot", cursor: this.cursor() });
    const publications: readonly RunQueueProjectionChange[] = batchPresentationChanged
      ? [{ kind: "snapshot", cursor: this.cursor() }]
      : changes;
    for (const change of publications) {
      for (const listener of this.#listeners) listener(change);
    }
  }


  #ownerFact(lease: WorkerLeaseRecord) {
    if (!isLiveWorker(lease)) return { state: "stopped" } as const;
    try {
      return this.#deps.authority.workerOwnerAlive?.(lease) === true ? { state: "alive" } as const
        : { state: "unavailable", reason: "Worker process custody is unavailable." } as const;
    } catch (error) {
      return { state: "unavailable", reason: error instanceof Error ? error.message : "Worker process custody could not be verified." } as const;
    }
  }

  #cardLeases(): ReadonlyMap<string, WorkerLeaseRecord> {
    const leases = new Map<string, WorkerLeaseRecord>();
    for (const lease of this.#deps.authority.listLiveWorkerLeases()) leases.set(lease.workerId, lease);
    for (const workerId of this.#workers.keys()) {
      if (leases.has(workerId)) continue;
      const settled = this.#deps.authority.getWorkerLease(workerId);
      if (settled !== undefined) leases.set(workerId, settled);
    }
    return leases;
  }

  /** Capture shared authority at a snapshot/reconcile boundary, including the batch revisions row patches may expose. */
  #captureSharedAuthorityFingerprint(canonicalRuns = listCanonicalRuns(this.#deps.reader, "live")): string {
    const pools = this.#deps.authority.listWorkerPools().map((pool) => ({
      workflowId: pool.workflow,
      desiredWorkers: pool.desiredWorkers,
      version: pool.version,
      plannedBy: pool.plannedBy,
      plannedAt: pool.plannedAt,
    }));
    const batches = this.#deps.authority.listRunBatches().map(({ sessionId, version }) => ({ sessionId, version })).sort((a, b) => a.sessionId.localeCompare(b.sessionId));
    const runs = canonicalRuns.map((run) => ({
      envelope: run.envelope, displayName: run.displayName, runNumber: run.runNumber,
      sessionId: run.sessionId, appVersion: run.appVersion,
      lifecycle: run.lifecycle.state === "claimed" || run.lifecycle.state === "validating" || run.lifecycle.state === "running"
        ? { ...run.lifecycle, heartbeatAt: undefined } : run.lifecycle,
      cancelRequested: run.cancelRequested,
    }));
    const leases = this.#cardLeases();
    const controlFacts = [...leases.values()].map(lease => ({ workerId: lease.workerId, owned: this.#deps.authority.ownsWorker?.(lease), custody: this.#ownerFact(lease), browsers: this.#deps.authority.workerBrowsers?.(lease.workerId) }));
    const fingerprint = JSON.stringify({ members: this.#deps.authority.listWorkerSlots?.(), leases: workerLeaseFingerprintOf(leases), pools, batches, runs, controlFacts, controls: this.#deps.authority.workerControls?.() });
    this.#publishedBatchVersions = new Map(batches.map(({ sessionId, version }) => [sessionId, version]));
    return fingerprint;
  }

  /* ── the authority join ────────────────────────────────────────────────── */

  #status(authority: RunRecord): z.infer<typeof QueueSurfaceWireSchema>["status"] {
    return deriveRunStatus(authority);
  }


  #endedAt(
    authority: RunRecord,
    status: QueueSurfaceWire["status"],
  ): { state: "present"; value: string } | { state: "absent"; reason: string } {
    return TERMINAL_QUEUE_STATUSES.has(status) && authority.lifecycle.state === "terminal"
      ? { state: "present", value: authority.lifecycle.endedAt }
      : { state: "absent", reason: `run is ${status} and has not ended` };
  }

  // Measure waiting from the gate record, never the last task span.
  #gateOpenedAt(
    row: RunFoldRecord | undefined,
    authority: RunRecord,
    status: QueueSurfaceWire["status"],
  ): { state: "present"; value: string } | { state: "absent"; reason: string } {
    if (status !== "awaiting-approval") {
      return { state: "absent", reason: `run is ${status} and is not waiting on a gate` };
    }
    const open = row?.openGates.find((gate) => authority.lifecycle.state === "parked-gate" && gate.gate === authority.lifecycle.gateId);
    if (open !== undefined) return { state: "present", value: open.openedAt };
    if (authority.lifecycle.state === "parked-gate") {
      return { state: "present", value: authority.lifecycle.parkedAt };
    }
    return {
      state: "absent",
      reason: "run reads awaiting-approval but neither an open gate span nor a parked-gate lifecycle dates the gate",
    };
  }


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
    return { state: "present", value: projectFailureForOperator(failure, retainedRunProtectedBindings(authority).length > 0).summary };
  }


  #warningVerdict(status: QueueSurfaceWire["status"], receipt: ReceiptView | undefined): WarningVerdict {
    if (!TERMINAL_QUEUE_STATUSES.has(status)) return { kind: "not-terminal", status };
    if (receipt === undefined) return { kind: "unread" };
    const first = receipt.value.warnings[0];
    if (first === undefined) return { kind: "none" };
    return { kind: "present", count: receipt.value.warnings.length, first: first.summary };
  }

  #warnings(
    verdict: WarningVerdict,
  ): { state: "present"; count: number; first: string } | { state: "absent"; reason: string } {
    switch (verdict.kind) {
      case "not-terminal":
        return { state: "absent", reason: `run is ${verdict.status} and has not produced a terminal result` };
      case "unread":
        return {
          state: "absent",
          reason: "no evidence receipt has been derived for this run, so its warning set is unknown",
        };
      case "withheld":
        return { state: "absent", reason: verdict.reason };
      case "none":
        return { state: "absent", reason: "this run's evidence receipt records no warning" };
      case "present":
        return { state: "present", count: verdict.count, first: verdict.first };
    }
  }


  #subjectTitle(workflowId: string, authority: RunRecord): string | undefined {
    return resolveSubjectTitle(
      this.#deps.descriptors.resolve(workflowId)?.subjectProjection,
      { workflowId, itemId: authority.envelope.itemId },
      this.#deps.authority,
    );
  }

  #resultSubtitle(run: RunRecord, descriptor: AnyWorkflowDescriptor, receipt: ReceiptView | undefined, fieldPath: string): QueueSurfaceWire["subtitle"] {
    const absent = { state: "absent", reason: "this run has no resolved EID available for its subtitle" } as const;
    if (receipt === undefined || !allowsSubjectIdentity(run, descriptor)) return absent;
    const raw = verifiedResultDisplayValue(run, receipt.value, fieldPath, "subtitle");
    if (raw === undefined) return absent;
    const eid = EidSchema.nullable().parse(raw);
    return eid === null ? absent : { state: "present", value: eid };
  }

  #resultOutcome(run: RunRecord, receipt: ReceiptView | undefined, projection: AnyWorkflowDescriptor["outcomeProjection"]): QueueSurfaceWire["outcome"] {
    if (projection === undefined || receipt === undefined
      || run.lifecycle.state !== "terminal" || run.lifecycle.outcome !== "done") return undefined;
    const value = receipt.value;
    if (value.runId !== run.envelope.runId || value.traceId !== run.envelope.traceId || value.attempt !== run.envelope.attempt
      || value.workflowId !== run.envelope.workflow || value.descriptorFingerprint !== run.envelope.contractFingerprint
      || value.configFingerprint !== run.envelope.configFingerprint) throw new ProjectionDegradedError("result-outcome-receipt-identity-mismatch");
    const verification = value.verification.find(entry => entry.id === deriveEvidenceEntryId(value.receiptId, "verification", "completion.terminal-result"));
    if (verification?.obligation !== "completion.terminal-result" || verification.verdict !== "verified") return undefined;
    const fact = value.output.find(entry => entry.id === deriveEvidenceEntryId(value.receiptId, "output", projection.fieldPath));
    if (fact?.state !== "satisfied" || fact.value.state !== "allowed") return undefined;
    const raw = fact.value.rawValue === undefined ? fact.value.value : fact.value.rawValue;
    const outcome = projection.cases.find(entry => entry.value === raw);
    if (outcome === undefined) throw new ProjectionDegradedError("result-outcome-value-undeclared");
    return { label: outcome.label, tone: outcome.tone };
  }

  #pipeline(row: RunFoldRecord | undefined, workflow: string, runTerminal: boolean): QueueSurfaceWire["pipeline"] {
    if (row === undefined) return [];
    const descriptor = this.#deps.descriptors.resolve(workflow);
    const spanByNode = new Map<string, z.infer<typeof TaskSpanFoldSchema>>();

    const executionsByNode = new Map<string, z.infer<typeof TaskSpanFoldSchema>[]>();
    for (const span of row.taskSpans) {
      const nodeId = nodeIdOfTaskSpanPath(span.spanPath);
      if (nodeId !== undefined) spanByNode.set(nodeId, span);
      const key = nodeId ?? span.name;
      const bucket = executionsByNode.get(key);
      if (bucket === undefined) executionsByNode.set(key, [span]);
      else bucket.push(span);
    }
    const stepState = (
      span: z.infer<typeof TaskSpanFoldSchema> | undefined,
    ): "pending" | TaskExecutionState => (span === undefined ? "pending" : taskStateOf(span.outcome));

    const stepMeasurement = (nodeId: string): { durationMs?: number; executions?: number } => {
      const executions = executionsByNode.get(nodeId) ?? [];
      let ms = 0;
      let measured = false;
      for (const span of executions) {
        if (span.startedAt === undefined || span.endedAt === undefined) continue;
        const started = Date.parse(span.startedAt);
        const ended = Date.parse(span.endedAt);
        if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) continue;
        ms += ended - started;
        measured = true;
      }
      return {
        ...(measured ? { durationMs: ms } : {}),
        ...(executions.length >= 2 ? { executions: executions.length } : {}),
      };
    };
    if (descriptor === undefined) {
      // Without a descriptor, render only observed nodes; never invent a pipeline.
      const observed = new Map<string, { label: string; span: z.infer<typeof TaskSpanFoldSchema> }>();
      for (const span of row.taskSpans) {
        observed.set(nodeIdOfTaskSpanPath(span.spanPath) ?? span.name, { label: span.name, span });
      }
      return [...observed].map(([id, { label, span }]) => {
        const { durationMs, executions } = stepMeasurement(id);
        return {
          id,
          label,
          state: stepState(span),
          ...(durationMs === undefined ? {} : { durationSec: Math.round(durationMs / 1000) }),
          ...(executions === undefined ? {} : { executions }),
        };
      });
    }
    return descriptor.timeline.map((category) => {
      const states = category.nodes.map(({ id }) => {
        const nodeId = String(id);
        if (row.openGates.some((gate) => gate.gate === nodeId)) return "blocked";
        if (row.resolvedGates.some((gate) => gate.gate === nodeId)) return "done";
        return stepState(spanByNode.get(nodeId));
      });
      const measurements = category.nodes.map(({ id }) => stepMeasurement(String(id)));
      const measured = measurements.filter((entry) => entry.durationMs !== undefined);
      const executionCounts = measurements.flatMap((entry) => entry.executions === undefined ? [] : [entry.executions]);
      const executions = executionCounts.length === 0 ? undefined : Math.max(...executionCounts);
      const durationMs = measured.reduce((sum, entry) => {
        if (entry.durationMs === undefined) throw new Error("run-pipeline: measured duration is unavailable");
        return sum + entry.durationMs;
      }, 0);
      return {
        id: String(category.key),
        label: category.label,
        state: foldCategoryState(states, runTerminal),
        ...(measured.length > 0 ? { durationSec: Math.round(durationMs / 1000) } : {}),
        ...(executions === undefined ? {} : { executions }),
      };
    });
  }


  #runNumber(authority: RunRecord): { state: "present"; value: number } | { state: "absent"; reason: string } {
    return authority.runNumber === undefined
      ? { state: "absent", reason: "workflow ordinal was not recorded at enqueue" }
      : { state: "present", value: authority.runNumber };
  }


  #session(authority: RunRecord): QueueSurfaceWire["session"] {
    if (authority.sessionId === undefined) return { state: "absent", reason: "no session grouping was recorded for this run or its retry source" };
    const batch = this.#deps.authority.getRunBatch(authority.sessionId);
    if (batch === undefined || batch.workflow !== authority.envelope.workflow) throw new Error(`workflow batch ${authority.sessionId} is missing or belongs to another workflow`);
    return { state: "present", sessionId: batch.sessionId,
      origin: batch.origin,
      presentation: { groupInQueue: batch.groupInQueue, version: PositiveIntSchema.parse(batch.version), startedAt: batch.startedAt } };
  }


  #containment(queued: RunRecord["envelope"]): "root" | "member" | "linked" {
    if (queued.parent === undefined) return "root";
    return queued.shape === "operation-member" ? "member" : "linked";
  }


  #linkedRuns(children: readonly RunRecord[]): readonly LinkedRunView[] {
    return children.filter((child) => child.envelope.shape !== "operation-member").map((child) => ({
      runId: child.envelope.runId,
      partitionDay: localDatePart(new Date(child.envelope.enqueuedAt)),
      workflowId: child.envelope.workflow,
      label: this.#deps.descriptors.resolve(child.envelope.workflow)?.label ?? child.envelope.workflow,
      panelKind: panelKindOf(child.envelope.shape),
      status: this.#status(child),
    }));
  }


  #memberPreview(
    members: readonly RunRecord[],
  ): { state: "present"; value: string } | { state: "absent"; reason: string } {
    if (members.length === 0) return { state: "absent", reason: "this group has fanned out to no members yet" };
    const shown = members.slice(0, MEMBER_PREVIEW_LIMIT).map((member) => {
      const descriptor = this.#deps.descriptors.resolve(member.envelope.workflow);
      const receipt = this.#deps.authority.getReceipt(member.envelope.runId);
      return (descriptor === undefined ? undefined : resolveResultTitle(descriptor, member, receipt))
        ?? this.#subjectTitle(member.envelope.workflow, member)
        ?? this.#rows.get(member.envelope.runId)?.queued.title ?? member.envelope.runId;
    });
    const remaining = members.length - shown.length;
    return { state: "present", value: remaining > 0 ? `${shown.join(", ")} +${String(remaining)} more` : shown.join(", ") };
  }

  #facts(
    authority: RunRecord,
    descriptor: AnyWorkflowDescriptor | undefined,
    status: QueueSurfaceWire["status"],
    receipt: ReceiptView | undefined,
  ): QueueSurfaceWire["facts"] {
    if (!TERMINAL_QUEUE_STATUSES.has(status)) return { state: "absent", reason: `run is ${status} and has not produced a terminal result` };
    if (receipt === undefined) return { state: "absent", reason: "no evidence receipt has been derived for this run, so its outputs are unknown" };
    if (descriptor === undefined || descriptor.details.length === 0) {
      if (receipt.value.output.length === 0) return { state: "absent", reason: "this run's evidence receipt records no output fact" };
      return { state: "absent", reason: descriptor === undefined
        ? "this workflow's detail declaration is unavailable" : "this workflow declares no detail fields" };
    }
    const value = receipt.value;
    const run = authority.envelope;
    if (value.runId !== run.runId || value.traceId !== run.traceId || value.attempt !== run.attempt
      || value.workflowId !== run.workflow || value.descriptorFingerprint !== run.contractFingerprint
      || value.configFingerprint !== run.configFingerprint) throw new ProjectionDegradedError("detail-receipt-identity-mismatch");
    const factValue = (source: Readonly<{ nodeId: string; fieldPath: string }> | Readonly<{ kind: "result"; fieldPath: string }>) => {
      const node = "nodeId" in source;
      const obligation = node ? `node.${source.nodeId}` : "completion.terminal-result";
      const verification = value.verification.find(entry => entry.id === deriveEvidenceEntryId(value.receiptId, "verification", obligation));
      const factId = deriveEvidenceEntryId(value.receiptId, node ? "observation" : "output", node ? `${source.nodeId}.${source.fieldPath}` : source.fieldPath);
      const fact = (node ? value.observations : value.output).find(entry => entry.id === factId);
      if (verification?.obligation !== obligation || verification.verdict !== "verified" || !verification.evidence.includes(evidenceEntryRef(factId))
        || fact?.state !== "satisfied" || fact.value.state !== "allowed") return undefined;
      return fact.value.rawValue === undefined ? fact.value.value : fact.value.rawValue;
    };
    const inputValue = (path: string): unknown => {
      let current: unknown = descriptor.canonicalInput.parse(authority.input.parsed.value);
      for (const segment of path.split(".")) {
        if (typeof current !== "object" || current === null || Array.isArray(current) || !Object.hasOwn(current, segment)) {
          throw new ProjectionDegradedError("detail-input-condition-path-unavailable");
        }
        current = Reflect.get(current, segment);
      }
      return current;
    };
    const chips: { label: string; value: string }[] = [];
    for (const detail of descriptor.details) {
      if (detail.display === "badge") continue;
      if (detail.when !== undefined) {
        const condition = detail.when.source.kind === "input" ? inputValue(detail.when.source.fieldPath)
          : factValue({ kind: "result", fieldPath: detail.when.source.fieldPath });
        if (condition === undefined) return { state: "absent", reason: `detail ${detail.key} has no verified condition value` };
        if (condition !== detail.when.equals) continue;
      }
      const source = detail.source;
      const resolved = "kind" in source && source.kind === "input-title"
        ? workflowPlanning(descriptor).title(authority.input.parsed.value) : factValue(source);
      if (resolved === undefined) return { state: "absent", reason: `detail ${detail.key} has no verified value` };
      if (resolved === null || typeof resolved === "string" && resolved.trim() === "") continue;
      if (detail.display === "person-name") {
        if (typeof resolved !== "string") throw new ProjectionDegradedError("detail-person-name-invalid");
        chips.push({ label: detail.label, value: titleCasePersonName(resolved) });
        continue;
      }
      chips.push({ label: detail.label, value: typeof resolved === "object" ? JSON.stringify(resolved) : displayScalar(resolved) });
    }
    return chips.length === 0 ? { state: "absent", reason: "this run has no applicable detail values" } : { state: "present", value: chips };
  }

  #surfaceFold(row: RunFoldRecord | undefined, authority: RunRecord, children: readonly RunRecord[]): SurfaceFold {
    const queued = authority.envelope;
    const shape = queued.shape;
    const status = this.#status(authority);
    // Nonterminal rows read no receipt; terminal facts and warnings share one read.
    const storedReceipt = TERMINAL_QUEUE_STATUSES.has(status)
      ? this.#deps.authority.getReceipt(queued.runId)
      : undefined;
    const receipt = storedReceipt === undefined ? undefined : projectReceiptForOperator(storedReceipt);
    const warningVerdict = this.#warningVerdict(status, receipt);
    const descriptor = this.#deps.descriptors.resolve(queued.workflow);

    const members = children.filter((member) => member.envelope.shape === "operation-member");
    const memberChildIds = members.map((member) => member.envelope.runId);
    const failedTerminalMembers = members.filter((member) => member.lifecycle.state === "terminal" && member.lifecycle.outcome === "failed");
    const terminalMembers = members.filter((member) => member.lifecycle.state === "terminal");
    const displayName: QueueSurfaceWire["displayName"] = authority.displayName === undefined
      ? { state: "absent", reason: "the operator has not renamed this run" }
      : retainedRunProtectedBindings(authority).length > 0
        ? { state: "absent", reason: "the operator's display name is withheld because this run carries protected input" }
        : { state: "present", value: authority.displayName };
    const base = {
      runId: queued.runId,
      itemId: queued.itemId,
      workflowId: queued.workflow,
      traceId: queued.traceId,
      attempt: queued.attempt,
      lineage: queued.parent?.runId === undefined
        ? { state: "root" }
        : { state: "child", parentRunId: queued.parent?.runId },
      ...(row === undefined ? {} : { actorId: row.queued.actorId }),
      // Use the enqueued app build; the serving build cannot describe when this run began.
      appVersion: authority.appVersion === undefined
        ? { state: "absent", reason: "app build was not recorded at enqueue" }
        : { state: "present", value: authority.appVersion },
      descriptorVersion: authority.envelope.descriptorVersion,
      descriptorHash: queued.contractFingerprint,
      configFingerprint: queued.configFingerprint,
      resolvedInstances: Object.entries(queued.resolvedInstance).map(([system, instance]) => ({ system, instance })),

      dryRun: authority.envelope.dryRun,

      priority: authority.envelope.priority,
      runNumber: this.#runNumber(authority),
      session: this.#session(authority),
      containment: this.#containment(queued),
      linkedRuns: this.#linkedRuns(children),
      startedAt: queued.enqueuedAt,
      updatedAt: authority.updatedAt,
      endedAt: this.#endedAt(authority, status),
      gateOpenedAt: this.#gateOpenedAt(row, authority, status),

      title: (descriptor === undefined ? undefined : resolveResultTitle(descriptor, authority, receipt?.value))
        ?? this.#subjectTitle(queued.workflow, authority) ?? row?.queued.title ?? queued.runId,
      displayName,
      subtitle: descriptor?.subtitleProjection !== undefined ? this.#resultSubtitle(authority, descriptor, receipt, descriptor.subtitleProjection.fieldPath) : row?.queued.subtitle === undefined || (authority.input.parsed.protectedBindings === undefined
        && authority.input.parsed.value !== null && typeof authority.input.parsed.value === "object"
        && Object.hasOwn(authority.input.parsed.value, "timekeeperName"))
        ? { state: "absent", reason: "the start plan proposed no subtitle" }
        : { state: "present", value: row?.queued.subtitle },
      outcome: this.#resultOutcome(authority, receipt, descriptor?.outcomeProjection),
      facts: this.#facts(authority, descriptor, status, receipt),
      status,
      liveMessage: this.#liveMessage(authority, status),
      warnings: this.#warnings(warningVerdict),
      pipeline: this.#pipeline(row, queued.workflow, authority.lifecycle.state === "terminal"),
      panelKind: panelKindOf(shape),
      availableSections: [
        "logs",
        "context-data",
        "context-attempts",
        ...(authority.lifecycle.state === "terminal" && authority.lifecycle.outcome === "failed" ? ["failure"] : []),
      ],

      actions: queueRowActions(descriptor?.actions, {
        status,
        rowRevision: authority.version,
        dryRun: authority.envelope.dryRun,
        isChild: authority.envelope.parent !== undefined,
        parkedWrite: authority.lifecycle.state === "parked-write",

        memberCount: shape === "operation" ? memberChildIds.length : 0,
        isMember: shape === "operation-member",
        named: authority.displayName !== undefined,

        hasReviewPanel: descriptor?.capabilities?.review ?? false,
      }),
      rowRevision: authority.version,
    };
    if (shape === "operation") {
      return {
        warningVerdict,
        surface: QueueSurfaceWireSchema.parse({
          ...base,
          surfaceKind: "operation",
          memberRunIds: memberChildIds,
          memberRollup: {
            total: memberChildIds.length,
            terminal: terminalMembers.length,
            failed: failedTerminalMembers.length,
          },
          memberPreview: this.#memberPreview(members),
        }),
      };
    }
    return {
      warningVerdict,
      surface: QueueSurfaceWireSchema.parse({ ...base, surfaceKind: surfaceKindOf(shape) }),
    };
  }

  #surface(row: RunFoldRecord | undefined, authority: RunRecord, children: readonly RunRecord[]): QueueSurfaceWire {
    return this.#surfaceFold(row, authority, children).surface;
  }



  buildDashboardDayWire(day: string): DashboardDayWire {
    const summaries = this.#deps.reader.summaries;
    return summaries === undefined ? this.#buildDashboardDayWire(day)
      : summaries.withSnapshot(() => this.#buildDashboardDayWire(day));
  }

  #buildDashboardDayWire(day: string): DashboardDayWire {
    if (this.#health.state === "degraded") {
      throw new ProjectionDegradedError(`the run/queue projection is degraded and refuses to serve counts: ${this.#health.lastError ?? "unknown"}`);
    }
    const parsedDay = z.iso.date().parse(day);
    const surfaces: QueueSurfaceWire[] = [];
    let fixtureRuns: readonly RunRecord[] | undefined;
    const monthPrefix = parsedDay.slice(0, 7);
    const monthCounts = new Map<string, number>();
    const summaries = this.#deps.reader.summaries;
    if (summaries !== undefined) {
      let after: { localDay: string; runId: string } | undefined;
      const readLive = (runId: string): RunRecord => {
        const existence = this.#deps.reader.read(runId);
        if (existence.state !== "present" || existence.disposition !== "live") {
          throw new ProjectionDegradedError("run-summary-source-missing");
        }
        return existence.run;
      };
      do {
        const page = summaries.queue({ fromDay: `${monthPrefix}-01`, toDay: new Date(Date.UTC(Number(parsedDay.slice(0, 4)), Number(parsedDay.slice(5, 7)), 0)).toISOString().slice(0, 10), limit: 500,
          topLevel: false, ...(after === undefined ? {} : { after }) });
        for (const summary of page.items) {
          if (summary.shape !== "operation-member") monthCounts.set(summary.localDay, (monthCounts.get(summary.localDay) ?? 0) + 1);
          if (summary.localDay !== parsedDay) continue;
          const authority = readLive(summary.runId);
          const surface = this.#surface(this.#rows.get(summary.runId), authority, summary.children.map(child => readLive(child.runId)));
          if (surface.status !== summary.status) throw new ProjectionDegradedError("run-summary-status-stale");
          surfaces.push(surface);
        }
        after = page.next ?? undefined;
      } while (after !== undefined);
    } else {
      // Explicit fixture-only compatibility. Production composition always supplies summaries.
      const runs = listCanonicalRuns(this.#deps.reader, "live");
      fixtureRuns = runs;
      const children = canonicalRunChildren(runs);
      for (const authority of runs) {
        const row = this.#rows.get(authority.envelope.runId);
        const rowDay = localDatePart(new Date(authority.envelope.enqueuedAt));
        if (rowDay.startsWith(monthPrefix) && authority.envelope.shape !== "operation-member") {
          monthCounts.set(rowDay, (monthCounts.get(rowDay) ?? 0) + 1);
        }
        if (rowDay !== parsedDay) continue;
        surfaces.push(this.#surface(row, authority, children.get(authority.envelope.runId) ?? []));
      }
    }
    const itemKey = (workflowId: string, itemId: string) => JSON.stringify([workflowId, itemId]);
    const visibleItems = new Map(surfaces.map(surface => [itemKey(surface.workflowId, surface.itemId),
      { workflowId: surface.workflowId, itemId: surface.itemId }]));
    const attempts = visibleItems.size === 0 ? [] : summaries === undefined ? fixtureRuns?.filter(candidate =>
      localDatePart(new Date(candidate.envelope.enqueuedAt)) === parsedDay)
      : summaries.itemAttempts(parsedDay, [...visibleItems.values()]);
    if (attempts === undefined) throw new ProjectionDegradedError("queue-attempt-history-unavailable");
    const surfaceByRunId = new Map(surfaces.map(surface => [surface.runId, surface]));
    const attemptHistory = attempts.map(candidate => {
      const envelope = candidate.envelope;
      const surface = surfaceByRunId.get(envelope.runId);
      if (surface === undefined || localDatePart(new Date(envelope.enqueuedAt)) !== parsedDay
        || surface.workflowId !== envelope.workflow || surface.itemId !== envelope.itemId
        || surface.attempt !== envelope.attempt || Number(surface.rowRevision) !== Number(candidate.version)) {
        throw new ProjectionDegradedError("queue-attempt-history-membership-mismatch");
      }
      return { runId: surface.runId, startedAt: surface.startedAt, endedAt: surface.endedAt };
    });
    const priorityOrder = (priority: "interactive" | "bulk"): number => (priority === "interactive" ? 0 : 1);
    surfaces.sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority) || a.startedAt.localeCompare(b.startedAt) || a.runId.localeCompare(b.runId));


    const countable = surfaces.filter((surface) => surface.surfaceKind !== "member");
    const workflowCounts = new Map<string, number>();
    const statusCounts = new Map<string, number>();

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


    let members: readonly WorkerSlotRecord[] | undefined;
    let workerOperations: readonly WorkerControlRecord[] | undefined;
    let workerAuthority: DashboardDayWire["workerAuthority"];
    const workerCards: DashboardDayWire["workerCards"] = [];
    try {
      members = this.#deps.authority.listWorkerSlots?.().filter(member => member.retiredAt === null);
      workerOperations = this.#deps.authority.workerControls?.();
      workerAuthority = members !== undefined && workerOperations !== undefined ? { state: "present", members: [...members] }
        : { state: "unavailable", members: [...(members ?? [])], reason: "Worker membership or operation authority is unavailable." };
    } catch (error) {
      workerAuthority = { state: "unavailable", members: [...(members ?? [])],
        reason: error instanceof Error ? error.message : "Worker authority could not be verified." };
    }
    for (const member of members ?? []) {
      try {
        const lease = this.#deps.authority.getWorkerLease(member.workerId);
        if (lease === undefined) throw new Error("worker-lifetime-unavailable");
        if (this.#deps.authority.listWorkerRuns === undefined) throw new Error("worker-run-authority-unavailable");
        const active = this.#deps.authority.listWorkerRuns(member.workerId);
        const heldRunId = "runId" in lease.lifecycle ? lease.lifecycle.runId : undefined;
        const runIds = new Set<string>();
        for (const run of active) {
          const read = this.#deps.reader.read(run.envelope.runId);
          if (runIds.has(run.envelope.runId) || !("workerId" in run.lifecycle) || run.lifecycle.workerId !== member.workerId
            || run.envelope.workflow !== member.workflow || run.lifecycle.workerLifetime?.membershipRevision !== member.membershipRevision
            || run.lifecycle.workerLifetime.leaseGeneration !== lease.leaseGeneration
            || read.state !== "present" || read.disposition !== "live" || read.run.envelope.runId !== run.envelope.runId
            || read.run.envelope.workflow !== run.envelope.workflow || read.run.envelope.attempt !== run.envelope.attempt
            || read.run.claimGeneration !== run.claimGeneration || !("workerId" in read.run.lifecycle)
            || read.run.lifecycle.workerId !== member.workerId || read.run.lifecycle.state !== run.lifecycle.state
            || read.run.lifecycle.claimedAt !== run.lifecycle.claimedAt
            || read.run.lifecycle.workerLifetime?.membershipRevision !== member.membershipRevision
            || read.run.lifecycle.workerLifetime.leaseGeneration !== lease.leaseGeneration) {
            throw new Error("worker-current-run-authority-unavailable");
          }
          runIds.add(run.envelope.runId);
        }
        if (active.length !== (heldRunId === undefined ? 0 : 1) || active.some(run => run.envelope.runId !== heldRunId)) {
          throw new Error("worker-current-run-authority-unavailable");
        }
        const fold = this.#workers.get(lease.workerId);
        workerCards.push(workerCardOf({ lease, member, ownerAlive: this.#ownerFact(lease).state === "alive",
          observations: this.#deps.authority.workerBrowsers?.(lease.workerId), operations: workerOperations,
          owned: this.#deps.authority.ownsWorker?.(lease),
          fold: fold === undefined ? undefined : { revision: fold.eventCount, browsers: [...fold.browsers.values()] },
          resolveRun: runId => {
            const read = this.#deps.reader.read(runId);
            return read.state === "present" && read.disposition === "live" ? read.run : undefined;
          },
        }));
      } catch (error) {
        workerAuthority = { state: "unavailable", members: [...(members ?? [])],
          reason: error instanceof Error ? error.message : "Worker authority could not be verified." };
      }
    }

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
      attemptHistory,
      workerCards,
      workerAuthority,
      workerOperations: workerOperations ?? [],

      workerPools: this.#deps.authority.listWorkerPools().map((pool) => ({
        workflowId: pool.workflow,
        desiredWorkers: pool.desiredWorkers,
        version: pool.version,
        plannedBy: pool.plannedBy,
        plannedAt: pool.plannedAt,
      })),
      notifications: this.#deps.authority.listNotifications(LOCAL_OPERATOR_ACTOR_ID)
        .map((record) => notificationWireOf(record, this.#deps.clock.nowMs(), notificationDisplayContext(record, {
          read: id => this.#deps.reader.read(id),
          descriptor: id => this.#deps.descriptors.resolve(id),
          presentation: this.#deps,
          checkpoints: { listByAttempt: (workflowId, itemId, nodeId, attempt) => this.#deps.authority.listNotificationCheckpoints(workflowId, itemId, nodeId, attempt) },
        }), notificationSourceEventOf(record, this.#deps.authority.latestNotificationSource?.(record.notificationId))))
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || String(a.notificationId).localeCompare(String(b.notificationId))),
    });
  }


  buildActivityReportWire(from: string, to: string): ActivityReportWire {
    if (this.#deps.reader.summaries !== undefined) return this.#deps.reader.summaries.activity(from, to);
    if (this.#health.state === "degraded") {
      throw new ProjectionDegradedError(
        `the run/queue projection is degraded and refuses to serve activity aggregates: ${this.#health.lastError ?? "unknown"}`,
      );
    }
    const start = z.iso.date().parse(from);
    const end = z.iso.date().parse(to);
    if (start > end) throw new Error(`activity range ${start}..${end} ends before it starts`);

    const inRange: { day: string; fold: SurfaceFold; authority: RunRecord }[] = [];
    const personRows: RunRecord[] = [];
    const runs = listCanonicalRuns(this.#deps.reader, "live");
    const children = canonicalRunChildren(runs);
    for (const authority of runs) {
      const row = this.#rows.get(authority.envelope.runId);
      const day = localDatePart(new Date(authority.envelope.enqueuedAt));
      if (day < start || day > end) continue;

      if (authority.envelope.shape !== "operation" && authority.envelope.workflow === "separations") personRows.push(authority);
      // Member containment, applied once: a member counted inside its
      // operation's rollup is not counted again at top level.
      if (authority.envelope.shape === "operation-member") continue;
      inRange.push({ day, fold: this.#surfaceFold(row, authority, children.get(authority.envelope.runId) ?? []), authority });
    }

    const people = activityPeopleOf(
      personRows,
      this.#deps.authority.canonicalPerson === undefined ? undefined : (runId) => this.#deps.authority.canonicalPerson!(runId),
    );

    const days = new Map<string, number>();
    const workflows = new Map<string, ActivityWorkflowCounts>();
    const statuses = new Map<string, { runs: number; sample: string[] }>();
    const outcomes = new Map<string, number>();
    const failures = new Map<string, { runs: number; transient: number; sample: string[] }>();
    const measured: { runId: string; ms: number }[] = [];

    const completion = { readBack: 0, warnings: 0, warningsUnknown: 0 };
    let unmeasured = 0;
    let terminalRuns = 0;

    for (const { day, fold: { surface, warningVerdict }, authority } of inRange) {
      days.set(day, (days.get(day) ?? 0) + 1);
      const counts = workflows.get(surface.workflowId) ?? emptyActivityWorkflowCounts();
      counts.runs += 1;
      workflows.set(surface.workflowId, counts);

      const statusBucket = statuses.get(surface.status) ?? { runs: 0, sample: [] };
      statusBucket.runs += 1;
      // The Who sample is for work the operator can still act on; a terminal
      // bucket carries none, which the wire's own refinement then enforces.
      if (
        !TERMINAL_QUEUE_STATUSES.has(surface.status)
        && statusBucket.sample.length < ACTIVITY_SAMPLE_LIMIT
      ) {
        statusBucket.sample.push(surface.runId);
      }
      statuses.set(surface.status, statusBucket);

      const axis = ACTIVITY_STATUS_BUCKET[surface.status];
      if (axis !== "completion") {
        counts[axis] += 1;
      } else {
        // An unread receipt remains unread; it cannot count as a receipt with no warnings.
        const arm = warningVerdict.kind === "present"
          ? "warnings"
          : warningVerdict.kind === "none"
            ? "readBack"
            : "warningsUnknown";
        counts.completion[arm] += 1;
        completion[arm] += 1;
      }

      if (authority.lifecycle.state !== "terminal") continue;
      terminalRuns += 1;
      outcomes.set(authority.lifecycle.outcome, (outcomes.get(authority.lifecycle.outcome) ?? 0) + 1);
      // A terminal row without an end instant has unknown duration, never a growing elapsed value.
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
      if (bucket.sample.length < ACTIVITY_SAMPLE_LIMIT) bucket.sample.push(surface.runId);
      failures.set(failure.code, bucket);
    }

    const categories = new Map<string, number>();
    let unregisteredCategoryRuns = 0;
    const workflowTotals = [...workflows.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([workflowId, counts]) => {
      const descriptor = this.#deps.descriptors.resolve(workflowId);
      if (descriptor === undefined) {
        unregisteredCategoryRuns += counts.runs;
        return {
          ...counts,
          workflowId,
          registration: {
            state: "unregistered",
            reason: `workflow ${workflowId} is no longer registered; its label and category are unavailable`,
          },
        };
      }
      categories.set(descriptor.category, (categories.get(descriptor.category) ?? 0) + counts.runs);
      return {
        ...counts,
        workflowId,
        registration: {
          state: "registered",
          label: descriptor.label,
          code: descriptor.code,
          categoryId: descriptor.category,
        },
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
      people,
      completion,
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
      statuses: [...statuses.entries()].sort(([a], [b]) => a.localeCompare(b))
        .map(([status, bucket]) => ({ status, runs: bucket.runs, sample: bucket.sample })),
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

      ledger: this.#deps.ledger.foldActivityRange(start, end),
    });
  }
}

export function createRunQueueProjection(deps: RunQueueProjectionDeps): RunQueueProjection {
  return new RunQueueProjection(deps);
}
