import { operatorFailureSentence } from "../../../models/failures/error-catalog.js";
import { activityTypicalTime, successfulActivityTiming } from "../queries/activity-timing.js";
import { createActivityAnalytics, failureStepOfTaskSpans } from "../queries/activity-analytics.js";
import { isQueueMember, isQueueTopLevel, type QueueParent } from "../../../models/dashboard/queue-parent.js";
import { titleCasePersonName } from "../../../models/fields/cell-coercion.js";
import { workerPoolMember, type WorkerSlotRecord } from "../../../models/run/worker-slot.js";
import { displayScalar } from "../queries/data.js";
import type { WorkerMemberView } from "../../runtime/workers/worker-pool.js";
import type { RunRecordService } from "../lifecycle/run-record-service.js";
import { canonicalRunChildren, listCanonicalRuns } from "../queries/canonical-runs.js";
import { notificationDisplayContext } from "../queries/notification-display.js";
import type { CommandRequest } from "../../../rules/commands/commands.js";
import { assertRunTimelineCompatible, type RunTimelineEvidenceSource } from "../queries/run-timeline-compatibility.js";
import { retainedRunProtectedBindings } from "../../../models/write-safety/protected-input.js";
import { deriveEvidenceEntryId, evidenceEntryRef } from "../../../models/trust/evidence-identity.js";

import { z } from "zod";
import { descriptorRuntimeNodes, workflowPlanning, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import type { Clock } from "../../../rules/time/clock.js";
import { localDatePart } from "../../../rules/time/clock.js";
import {
  DashboardDayWireSchema,
  WorkerCardUnavailableReasonSchema,
  notificationWireOf,
  notificationSourceEventOf,
  QUEUE_NOT_STARTING_NO_WORKER,
  QueueSurfaceWireSchema,
  TERMINAL_QUEUE_STATUSES,
  type DashboardDayWire,
  type QueueSurfaceWire,
  type QueueRecordMembers,
} from "../../../models/dashboard/projection.js";
import {
  ACTIVITY_MEDIAN_ABSENT_REASON,
  ACTIVITY_SAMPLE_LIMIT,
  ActivityReportWireSchema,
  activityMedian,
  type ActivityLedgerBlock,
  type ActivityReportWire,
  type ActivityWorkflowTotal,
} from "../../../models/dashboard/activity.js";
import { DashboardDayPatchSchema } from "../../../models/dashboard/subscription.js";
import {
  PositiveIntSchema,
  LocalDateSchema,
  EidSchema,
  LOCAL_OPERATOR_ACTOR_ID,
  ProjectionCursorSchema,
  type Fingerprint,
} from "../../../rules/identity/ids.js";
import { NotificationRecordSchema } from "../../../models/notifications/notifications.js";
import { runClaim, type RunRecord } from "../../../models/run/record.js";
import type { RunSummary, DelegationWaitState } from "../../../models/run/summary.js";
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
import type { RunSessionRecord } from "../../../models/run/session.js";
import type { WorkerPoolRecord } from "../../../models/run/worker-pool.js";
import { queueRowActions } from "./queue-row-actions.js";
import { allowsSubjectIdentity, resolveResultTitle, verifiedResultDisplayValue, resolveSubjectTitle } from "./run-subject-title.js";
import { lastRunOf, stepInterruptOf, workerCardOf, type WorkerCardWire } from "./worker-cards.js";
import type { TimelineLine } from "../../storage/events/timeline-reader.js";
import type { TimelineRepository } from "../../../models/events/timeline.js";
import { readTimelineRecords, timelineSpanLocation } from "../../storage/events/timeline-reader.js";
import { nodeIdOfTaskSpanPath } from "../lifecycle/support.js";
import { deriveRunStatus, foldCategoryState, panelKindOf, taskStateOf, type TaskExecutionState } from "../../../rules/runs/run-status.js";
import { interruptTransition, pendingInterruptOf } from "../../../rules/runs/run-interrupt.js";
import { LogIdentityRefusedError, ProjectionDegradedError } from "../commands/refusals.js";

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
  eventCount: number;
}

/* ── dependencies ────────────────────────────────────────────────────────── */

// Production summaries share the authority snapshot; fixture readers may omit this port.
export interface ServedSummaryQueries {
  withSnapshot<T>(read: () => T): T;
  queue(input: { fromDay: string; toDay: string; limit: number; topLevel: boolean; after?: { localDay: string; runId: string } }): {
    items: readonly { runId: string; localDay: string; shape: string; parent: QueueParent | null; title: string; status: QueueSurfaceWire["status"]; children: readonly { runId: string }[] }[];
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
    batchMemberRetryAvailable?(run: RunRecord): boolean;
    queueParents(envelopes: readonly RunRecord["envelope"][]): ReadonlyMap<string, QueueParent | null>;
    delegationWait?(runId: string): DelegationWaitState | null;
    reviewAvailable?(runId: string): boolean;
    recordMembers?(run: RunRecord, children: readonly RunRecord[]): QueueRecordMembers | undefined;
    /** Durable inbox rows served by day. */
    listNotifications(actorId: string): readonly z.infer<typeof NotificationRecordSchema>[];
    latestNotificationSource?(notificationId: string): { actorId: string; notificationId: string; event: unknown; adopted: boolean } | undefined;
    command?(commandId: string): CommandRequest | undefined;
    listNotificationCheckpoints(workflowId: string, itemId: string, nodeId: string, attempt: number): readonly RunCheckpointRecord[];
    listCheckpoints: RunTimelineEvidenceSource["authority"]["listCheckpoints"];
    listGateResults: RunTimelineEvidenceSource["authority"]["listGateResults"];

    listWorkerSlots?(): readonly WorkerSlotRecord[];
    listWorkerRuns?(workerId: string): readonly RunRecord[];
    /** The profile runtime's worker pool members; absent where no pool runs (then no worker card is served). */
    workerMembers?(): readonly WorkerMemberView[];
    /** Whether a capacity step for the workflow is still starting its members. */
    workerStartupPending?(workflowId: string): boolean;
    heldDuoSystems?(workerId: string): readonly string[];
    /** Whether the run holds an `attempting` (fenced, unsettled) write intent. */
    writeInFlight?(runId: string): boolean;
    /** Absent in fixtures that have no SQLite generation. Present, an unchanged key skips the live-run read. */
    changeKey?(): Readonly<{ authorityGeneration: number; dataVersion: number; totalChanges: number }>;

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
  readonly queueCapabilities?: (workflowId: string) => Readonly<{
    sessionItemScope?: boolean;
    groupedBatchLayout?: boolean;
  }> | undefined;
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

interface QueueReadContext {
  runs: Map<string, RunRecord>;
  parents: Map<string, QueueParent | null>;
  links: Map<string, LinkedRunView>;
  receipts: Map<string, ReceiptView | undefined>;
  titles: Map<string, string>;
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

function surfaceKindOf(shape: RunQueuedWire["shape"]): "single" | "preview" | "operation" {
  if (shape === "operation") return "operation";
  if (shape === "operation-member") return "single";
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

type ActivityWorkflowCounts = Omit<ActivityWorkflowTotal, "workflowId" | "registration" | "needsAttention" | "typicalTime" | "outcomes" | "days" | "failedAt" | "typicalMedian">;

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


type LinkedRunView = QueueSurfaceWire["linkedRuns"][number];


/* ── the projection ──────────────────────────────────────────────────────── */

export class RunQueueProjection {
  readonly #deps: RunQueueProjectionDeps;
  readonly #rows = new Map<string, RunFoldRecord>();
  readonly #workers = new Map<string, WorkerFold>();
  readonly #runLogs = new Map<string, ProjectedRunLogEntry[]>();
  readonly #listeners = new Set<(change: RunQueueProjectionChange) => void>();
  readonly #notifiedRows = new Map<string, { status: string; surface: string }>();

  #timelineCursor = 0;

  #workerAuthorityFingerprint: string;
  #publishedBatchVersions: ReadonlyMap<string, number> = new Map();
  #storedCanonical: { key: string; storeJson: string; claimedIds: readonly string[]; batches: readonly { sessionId: string; version: number }[] } | undefined;
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
      if (events.length === 0) return;
      const runIds = new Set<string>();
      let workerChanged = false;
      for (const { event, line } of events) {
        const affected = this.#fold(event, line);
        this.#cursorValue += 1;
        this.#recordRunLog(event, line);
        for (const runId of affected.runIds) runIds.add(runId);
        workerChanged ||= affected.workerChanged;
      }
      this.#notify({ runIds: [...runIds], workerChanged }, events.length > 1);
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
      this.#degrade(`worker authority reconcile failed: ${error instanceof Error ? error.message : String(error)}`);
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
      this.#notifiedRows.clear();
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
    return this.queueSurfaces([runId])[0];
  }

  queueSurfaces(runIds: readonly string[]): readonly QueueSurfaceWire[] {
    const present = [...new Set(runIds)].filter(runId => {
      const existence = this.#deps.reader.read(runId);
      return existence.state === "present" && existence.disposition === "live";
    });
    return this.#deps.reader.withRunTreeSnapshot(present, runs => {
      const byId = new Map<string, RunRecord>(runs.map(run => [run.envelope.runId, run])), children = canonicalRunChildren(runs);
      const context = this.#readContext(runs);
      return runIds.flatMap(runId => {
        const run = byId.get(runId);
        return run === undefined ? [] : [this.#surface(this.#rows.get(runId), run, children.get(runId) ?? [], context)];
      });
    });
  }

  #workerLastRun(workerId: string): NonNullable<WorkerCardWire["lastRun"]> {
    const record = this.#deps.timeline.lastWorkerClaim(workerId);
    const claim = record?.payload.kind === "span" && record.payload.event.t === "run.claimed" ? record.payload.event : undefined;
    const read = claim === undefined ? undefined : this.#deps.reader.read(claim.runId);
    const run = read?.state === "present" && read.disposition === "live" ? read.run : undefined;
    return lastRunOf({ claim: claim === undefined ? undefined : { runId: claim.runId, attempt: claim.attempt }, run,
      spans: claim === undefined ? undefined : this.#rows.get(claim.runId)?.taskSpans,
      taskIdOf: (nodeId, spanPath) => run === undefined ? undefined : this.#taskIdOf(run, nodeId, spanPath) });
  }

  /** The task contract a span ran, read from the run's own descriptor version only. */
  #taskIdOf(run: RunRecord, nodeId: string, spanPath: string): string | undefined {
    const descriptor = this.#deps.descriptors.resolve(run.envelope.workflow);
    if (descriptor === undefined || descriptor.version !== run.envelope.descriptorVersion) return undefined;
    const node = descriptorRuntimeNodes(descriptor).find(candidate => String(candidate.id) === nodeId);
    if (node?.kind === "task") return String(node.uses.id);
    if (node?.kind !== "transaction") return undefined;
    const completion = node.commit.uses.writeSafety.completion;
    const contract = { probe: node.commit.uses.writeSafety.idempotency.probe, prepare: node.prepare.uses, commit: node.commit.uses,
      verify: completion.kind === "receipt" ? undefined : completion.verify }[spanPath.split("/")[2]?.split("#")[0] ?? ""];
    return contract === undefined ? undefined : "id" in contract ? String(contract.id) : String(contract.taskId);
  }

  #workerTimeline(runId: string, surfaces: readonly QueueSurfaceWire[]): NonNullable<WorkerCardWire["timeline"]> {
    const read = this.#deps.reader.read(runId);
    if (read.state !== "present" || read.disposition !== "live") return { state: "unavailable", reason: "run-unavailable" };
    const descriptor = this.#deps.descriptors.resolve(read.run.envelope.workflow);
    if (descriptor !== undefined && (descriptor.version !== read.run.envelope.descriptorVersion
      || descriptor.contractFingerprint !== read.run.envelope.contractFingerprint)) {
      try {
        assertRunTimelineCompatible(read.run, descriptor.timeline, { timeline: this.#deps.timeline, authority: this.#deps.authority }, this.#rows.get(runId));
      } catch (error) {
        if (error instanceof LogIdentityRefusedError) return { state: "unavailable", reason: "timeline-incompatible" };
        throw error;
      }
    }
    const surface = surfaces.find(candidate => candidate.runId === runId);
    if (surface === undefined) return { state: "unavailable", reason: "run-not-in-day" };
    return surface.pipeline.length === 0 ? { state: "unavailable", reason: "no-steps-recorded" } : { state: "present" };
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
          eventCount: 1,
        });
        return { runIds: [], workerChanged: true };
      }
      const worker = this.#workers.get(event.workerId)
        ?? { workerId: event.workerId, startedAt: event.ts, eventCount: 0 };
      this.#workers.set(event.workerId, worker);
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
      worker.eventCount += 1;
    }
    return { runIds: [], workerChanged: true };
  }

  // Row patches carry no count tuples; count changes require a snapshot.
  #notify(affected: { runIds: readonly string[]; workerChanged: boolean }, forceSnapshot = false): void {
    const publications = this.#deps.reader.withRunTreeSnapshot([], () => {
      const changes: RunQueueProjectionChange[] = [];
      let snapshotNeeded = affected.workerChanged;
      let batchPresentationChanged = false;
      let crossDayMembersChanged = false;
      const snapshot = this.#canonicalSnapshot();
      const { byId, children } = snapshot;
      const context = this.#readContext(snapshot.runs);
      const affectedIds = new Set(affected.runIds);
      for (const runId of affected.runIds) {
        const path = new Set<string>();
        let current = byId.get(runId);
        while (current?.envelope.parent !== undefined) {
          if (path.has(current.envelope.runId)) throw new ProjectionDegradedError("delegation-ancestry-cycle");
          path.add(current.envelope.runId);
          affectedIds.add(current.envelope.parent.runId);
          current = byId.get(current.envelope.parent.runId);
        }
      }
      for (const runId of [...affectedIds]) for (const child of children.get(runId) ?? []) affectedIds.add(child.envelope.runId);
      for (const runId of affectedIds) {
        const row = this.#rows.get(runId);
        const authority = byId.get(runId);
        const previous = this.#notifiedRows.get(runId);
        const previousStatus = previous?.status;

        if (authority === undefined) {
          if (previousStatus !== undefined) {
            this.#notifiedRows.delete(runId);
            snapshotNeeded = true;
          }
          continue;
        }
        const day = localDatePart(new Date(authority.envelope.enqueuedAt));
        const replacement = this.#surface(row, authority, children.get(runId) ?? [], context);
        const batch = replacement.session;
        if (batch.state === "present" && batch.presentation !== undefined
          && this.#publishedBatchVersions.get(batch.sessionId) !== batch.presentation.version) {
          // A row refresh can beat the poll. Its batch facts must move together
          // for all members, never leak a new revision through one row patch.
          batchPresentationChanged = true;
          snapshotNeeded = true;
        }
        const countNeutral = !isQueueTopLevel(replacement)
          ? previousStatus !== undefined
          : previousStatus === replacement.status;
        const surface = JSON.stringify(replacement);
        this.#notifiedRows.set(runId, { status: replacement.status, surface });
        if (!affected.runIds.includes(runId) && previous?.surface === surface) continue;
        let holder = authority;
        while (holder.envelope.parent !== undefined) {
          if (this.#parentFact(context, holder)?.visibility === "linked") break;
          const parent = byId.get(holder.envelope.parent.runId);
          if (parent === undefined) throw new ProjectionDegradedError("queue-parent-source-unavailable");
          if (localDatePart(new Date(parent.envelope.enqueuedAt)) !== day) crossDayMembersChanged = true;
          holder = parent;
        }
        if (crossDayMembersChanged) snapshotNeeded = true;
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
      const snapshotOnly = forceSnapshot || batchPresentationChanged || crossDayMembersChanged
        || changes.filter(change => change.kind === "patch").length > 1;
      if (snapshotOnly) snapshotNeeded = true;
      if (snapshotNeeded) this.#workerAuthorityFingerprint = this.#captureSharedAuthorityFingerprint(snapshot.runs);
      if (snapshotNeeded) changes.push({ kind: "snapshot", cursor: this.cursor() });
      const publications: readonly RunQueueProjectionChange[] = snapshotOnly
        ? [{ kind: "snapshot", cursor: this.cursor() }]
        : changes;
      return publications;
    });
    for (const change of publications) {
      for (const listener of this.#listeners) listener(change);
    }
  }

  /** Capture shared authority at a snapshot/reconcile boundary, including the batch revisions row patches may expose. */
  #captureSharedAuthorityFingerprint(canonicalRuns?: readonly RunRecord[]): string {
    const key = this.#deps.authority.changeKey?.();
    const keyText = key === undefined ? undefined : `${key.authorityGeneration}:${key.dataVersion}:${key.totalChanges}`;
    const stored = canonicalRuns === undefined && keyText !== undefined && this.#storedCanonical?.key === keyText ? this.#storedCanonical : undefined;
    let built: { storeJson: string; claimedIds: readonly string[]; batches: readonly { sessionId: string; version: number }[] } | undefined = stored;
    if (built === undefined) {
      const source = canonicalRuns ?? listCanonicalRuns(this.#deps.reader, "live");
      const pools = this.#deps.authority.listWorkerPools().map((pool) => ({
        workflowId: pool.workflow,
        desiredWorkers: pool.desiredWorkers,
        version: pool.version,
        plannedBy: pool.plannedBy,
        plannedAt: pool.plannedAt,
      }));
      const batches = this.#deps.authority.listRunBatches().map(({ sessionId, version }) => ({ sessionId, version })).sort((a, b) => a.sessionId.localeCompare(b.sessionId));
      const runs = source.map((run) => ({
        envelope: run.envelope, displayName: run.displayName, runNumber: run.runNumber,
        sessionId: run.sessionId, appVersion: run.appVersion,
        lifecycle: run.lifecycle.state === "claimed" || run.lifecycle.state === "validating" || run.lifecycle.state === "running"
          ? { ...run.lifecycle, heartbeatAt: undefined } : run.lifecycle,
        cancelRequested: run.cancelRequested,
        // Served step interrupts change with the pause request and the write fence.
        pause: run.pause,
      }));
      built = { storeJson: JSON.stringify({ pools, batches, runs }), claimedIds: source.filter((run) => runClaim(run) !== undefined).map((run) => run.envelope.runId), batches };
      if (canonicalRuns === undefined && keyText !== undefined) this.#storedCanonical = { key: keyText, ...built };
    }
    const workers = this.#deps.authority.workerMembers?.().map(view => ({ workerId: view.member.workerId, lifetimeId: view.lifetimeId, version: view.version }));
    const writeInFlight = built.claimedIds.map((id) => [id, this.#deps.authority.writeInFlight?.(id)]);
    const members = this.#deps.authority.listWorkerSlots?.();
    const startupPending = [...new Set(members?.map(member => member.workflow))].filter(workflowId => this.#deps.authority.workerStartupPending?.(workflowId) === true);
    const fingerprint = JSON.stringify({ members, workers, writeInFlight, startupPending }) + built.storeJson;
    const batches = built.batches;
    this.#publishedBatchVersions = new Map(batches.map(({ sessionId, version }) => [sessionId, version]));
    return fingerprint;
  }

  /* ── the authority join ────────────────────────────────────────────────── */

  #status(authority: RunRecord, delegationWait = this.#deps.authority.delegationWait?.(authority.envelope.runId)): z.infer<typeof QueueSurfaceWireSchema>["status"] {
    return deriveRunStatus({ ...authority, delegationWait });
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

  #pipeline(row: RunFoldRecord | undefined, workflow: string, runTerminal: boolean, wait?: DelegationWaitState | null): QueueSurfaceWire["pipeline"] {
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
        state: wait !== null && wait !== undefined && (String(category.key) === wait.nodeId || category.nodes.some(node => String(node.id) === wait.nodeId))
          ? wait.state === "blocked" ? "blocked" : "active" : foldCategoryState(states, runTerminal),
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


  #session(authority: RunRecord, operation: boolean): QueueSurfaceWire["session"] {
    if (authority.sessionId === undefined) return { state: "absent", reason: "no session grouping was recorded for this run or its retry source" };
    const batch = this.#deps.authority.getRunBatch(authority.sessionId);
    if (batch === undefined || batch.workflow !== authority.envelope.workflow) throw new Error(`workflow batch ${authority.sessionId} is missing or belongs to another workflow`);
    const capabilities = this.#deps.queueCapabilities?.(authority.envelope.workflow);
    const sessionScoped = capabilities?.sessionItemScope === true && authority.envelope.parent === undefined;
    return { state: "present", sessionId: batch.sessionId, itemScope: sessionScoped ? "session" : "workflow",
      origin: batch.origin,
      presentation: { layout: sessionScoped && capabilities?.groupedBatchLayout === true && !operation && batch.groupInQueue ? "batch" : "items",
        groupInQueue: batch.groupInQueue, version: PositiveIntSchema.parse(batch.version), startedAt: batch.startedAt } };
  }


  #readContext(runs: readonly RunRecord[] = []): QueueReadContext {
    const parents = new Map<string, QueueParent | null>();
    for (const run of runs) if (run.envelope.parent === undefined) parents.set(run.envelope.runId, null);
    return { runs: new Map(runs.map(run => [run.envelope.runId, run])), parents, links: new Map(), receipts: new Map(), titles: new Map() };
  }

  #readRun(context: QueueReadContext, runId: string): RunRecord {
    const known = context.runs.get(runId);
    if (known !== undefined) return known;
    const existence = this.#deps.reader.read(runId);
    if (existence.state !== "present" || existence.disposition !== "live") throw new ProjectionDegradedError("run-summary-source-missing");
    context.runs.set(runId, existence.run);
    return existence.run;
  }

  #parentFact(context: QueueReadContext, run: RunRecord): QueueParent | null {
    if (run.envelope.parent === undefined) return null;
    if (!context.parents.has(run.envelope.runId)) {
      for (const [runId, parent] of this.#deps.authority.queueParents([run.envelope])) context.parents.set(runId, parent);
    }
    const parent = context.parents.get(run.envelope.runId);
    if (parent === undefined || parent === null || parent.runId !== run.envelope.parent.runId) throw new ProjectionDegradedError("queue-parent-source-unavailable");
    return parent;
  }

  #runLink(context: QueueReadContext, run: RunRecord): LinkedRunView {
    const known = context.links.get(run.envelope.runId);
    if (known !== undefined) return known;
    const link: LinkedRunView = { runId: run.envelope.runId, partitionDay: LocalDateSchema.parse(localDatePart(new Date(run.envelope.enqueuedAt))),
      workflowId: run.envelope.workflow, label: this.#deps.descriptors.resolve(run.envelope.workflow)?.label ?? run.envelope.workflow,
      panelKind: panelKindOf(run.envelope.shape, this.#deps.authority.reviewAvailable?.(run.envelope.runId) === true), status: this.#status(run) };
    context.links.set(run.envelope.runId, link);
    return link;
  }

  #receipt(context: QueueReadContext, run: RunRecord, status: QueueSurfaceWire["status"]): ReceiptView | undefined {
    if (context.receipts.has(run.envelope.runId)) return context.receipts.get(run.envelope.runId);
    const stored = TERMINAL_QUEUE_STATUSES.has(status) ? this.#deps.authority.getReceipt(run.envelope.runId) : undefined;
    const receipt = stored === undefined ? undefined : projectReceiptForOperator(stored);
    context.receipts.set(run.envelope.runId, receipt);
    return receipt;
  }

  #title(context: QueueReadContext, run: RunRecord, receipt: ReceiptView | undefined): string {
    const known = context.titles.get(run.envelope.runId);
    if (known !== undefined) return known;
    const descriptor = this.#deps.descriptors.resolve(run.envelope.workflow);
    const title = (descriptor === undefined ? undefined : resolveResultTitle(descriptor, run, receipt?.value))
      ?? this.#subjectTitle(run.envelope.workflow, run) ?? this.#rows.get(run.envelope.runId)?.queued.title ?? run.envelope.runId;
    context.titles.set(run.envelope.runId, title);
    return title;
  }

  #parentWire(context: QueueReadContext, run: RunRecord) {
    const fact = this.#parentFact(context, run);
    if (fact === null) return null;
    const parent = this.#readRun(context, fact.runId), link = this.#runLink(context, parent);
    return { ...link, ...fact, title: this.#title(context, parent, this.#receipt(context, parent, link.status)) };
  }

  #linkedRuns(children: readonly RunRecord[], context: QueueReadContext): readonly LinkedRunView[] {
    return children.filter(child => this.#parentFact(context, child)?.visibility === "linked").map(child => this.#runLink(context, child));
  }


  #memberPreview(
    members: readonly RunRecord[],
    context: QueueReadContext,
  ): { state: "present"; value: string } | { state: "absent"; reason: string } {
    if (members.length === 0) return { state: "absent", reason: "this group has fanned out to no members yet" };
    const shown = members.slice(0, MEMBER_PREVIEW_LIMIT).map((member) => {
      return this.#title(context, member, this.#receipt(context, member, this.#status(member)));
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

  /** A queued row names NO_WORKER when every active slot of its workflow is exited. */
  #notStarting(workflowId: string, status: QueueSurfaceWire["status"]): QueueSurfaceWire["notStarting"] {
    if (status !== "queued") return undefined;
    const slots = this.#deps.authority.listWorkerSlots?.();
    const views = this.#deps.authority.workerMembers?.();
    if (slots === undefined || views === undefined) return undefined;
    const active = slots.filter(slot => slot.workflow === workflowId && slot.retiredAt === null);
    const viewOf = (workerId: string) => views.find(view => view.member.workerId === workerId);
    const live = active.filter(slot => {
      const view = viewOf(slot.workerId);
      return view !== undefined && view.state !== "exited";
    });
    if (live.length === 0) {
      if (this.#deps.authority.workerStartupPending?.(workflowId) === true) return undefined;
      const exited = active.some(slot => viewOf(slot.workerId)?.state === "exited");
      return exited ? QUEUE_NOT_STARTING_NO_WORKER : undefined;
    }
    const ordered = [...live].sort((left, right) => left.workerId < right.workerId ? -1 : left.workerId > right.workerId ? 1 : 0);
    const refusals = ordered.flatMap(slot => {
      const refusal = viewOf(slot.workerId)?.activity?.refusal;
      return refusal === undefined ? [] : [refusal];
    });
    if (refusals.length !== ordered.length) return undefined;
    const refusal = refusals[0];
    if (refusal === undefined) return undefined;
    return { code: refusal.code, summary: refusal.summary ?? operatorFailureSentence(refusal.code) };
  }

  #surfaceFold(row: RunFoldRecord | undefined, authority: RunRecord, children: readonly RunRecord[], context: QueueReadContext): SurfaceFold {
    const queued = authority.envelope;
    context.runs.set(queued.runId, authority);
    for (const child of children) context.runs.set(child.envelope.runId, child);
    const shape = queued.shape;
    const delegationWait = this.#deps.authority.delegationWait?.(queued.runId);
    const status = this.#status(authority, delegationWait);
    // Nonterminal rows read no receipt; terminal facts and warnings share one read.
    const receipt = this.#receipt(context, authority, status);
    const warningVerdict = this.#warningVerdict(status, receipt);
    const descriptor = this.#deps.descriptors.resolve(queued.workflow);
    const reviewAvailable = this.#deps.authority.reviewAvailable?.(queued.runId) === true;
    const recordMembers = this.#deps.authority.recordMembers?.(authority, children);

    const members = children.filter(member => isQueueMember({ parent: this.#parentFact(context, member), status: this.#status(member) }));
    const operation = shape === "operation" || members.length > 0 || recordMembers !== undefined;
    const memberChildIds = members.map((member) => member.envelope.runId);
    const failedTerminalMembers = members.filter((member) => member.lifecycle.state === "terminal" && member.lifecycle.outcome === "failed");
    const terminalMembers = members.filter((member) => member.lifecycle.state === "terminal");
    const displayName: QueueSurfaceWire["displayName"] = authority.displayName === undefined
      ? { state: "absent", reason: "the operator has not renamed this run" }
      : retainedRunProtectedBindings(authority).length > 0
        ? { state: "absent", reason: "the operator's display name is withheld because this run carries protected input" }
        : { state: "present", value: authority.displayName };
    const pending = pendingInterruptOf(authority);
    const pauseUnavailable = interruptTransition(authority, { kind: "pause" }).state === "refused";
    const pauseControl: NonNullable<QueueSurfaceWire["pauseControl"]> = { expectedVersion: authority.version,
      state: pauseUnavailable ? "unavailable" : pending === "pause-requested" ? "pause-pending" : pending === "paused" ? "paused" : "running",
      ...(pauseUnavailable ? {} : { command: pending === "none" ? "pause" as const : "resume" as const }) };
    const claim = runClaim(authority);
    const interrupt = claim === undefined ? undefined : stepInterruptOf(authority, this.#deps.authority.writeInFlight?.(queued.runId) === true);
    const notStarting = this.#notStarting(queued.workflow, status);
    const base = {
      runId: queued.runId,
      itemId: queued.itemId,
      workflowId: queued.workflow,
      traceId: queued.traceId,
      attempt: queued.attempt,
      parent: this.#parentWire(context, authority),
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
      ...(authority.pause === undefined ? {} : { pause: authority.pause }),
      pauseControl,
      ...(interrupt === undefined ? {} : { interrupt }),

      priority: authority.envelope.priority,
      runNumber: this.#runNumber(authority),
      session: this.#session(authority, operation),
      linkedRuns: this.#linkedRuns(children, context),
      startedAt: queued.enqueuedAt,
      updatedAt: authority.updatedAt,
      endedAt: this.#endedAt(authority, status),
      gateOpenedAt: this.#gateOpenedAt(row, authority, status),

      title: this.#title(context, authority, receipt),
      displayName,
      subtitle: descriptor?.subtitleProjection !== undefined ? this.#resultSubtitle(authority, descriptor, receipt, descriptor.subtitleProjection.fieldPath) : row?.queued.subtitle === undefined || (authority.input.parsed.protectedBindings === undefined
        && authority.input.parsed.value !== null && typeof authority.input.parsed.value === "object"
        && Object.hasOwn(authority.input.parsed.value, "timekeeperName"))
        ? { state: "absent", reason: "the start plan proposed no subtitle" }
        : { state: "present", value: row?.queued.subtitle },
      outcome: this.#resultOutcome(authority, receipt, descriptor?.outcomeProjection),
      facts: this.#facts(authority, descriptor, status, receipt),
      status,
      ...(notStarting === undefined ? {} : { notStarting }),
      ...(status === "cancelled" ? { cancelledBy: cancelledBy(authority) } : {}),
      liveMessage: interrupt?.step === "finish-write" ? { state: "present", value: "Finishing the save first" }
        : pauseControl.state === "pause-pending" ? { state: "present", value: "Restarts this step on Resume" }
        : pauseControl.state === "paused" ? { state: "present", value: "Pause recorded. Resume to continue." } : this.#liveMessage(authority, status),
      warnings: this.#warnings(warningVerdict),
      pipeline: this.#pipeline(row, queued.workflow, authority.lifecycle.state === "terminal", delegationWait),
      panelKind: panelKindOf(shape, reviewAvailable),
      availableSections: [
        "logs",
        ...(reviewAvailable ? ["review"] : []),
        "context-data",
        "context-attempts",
        ...(authority.lifecycle.state === "terminal" && authority.lifecycle.outcome === "failed" ? ["failure"] : []),
      ],

      actions: queueRowActions(descriptor?.actions, {
        pauseControl,
        crashed: authority.lifecycle.state === "terminal" && authority.lifecycle.outcome === "failed"
          && authority.lifecycle.failureId !== undefined && this.#deps.authority.getFailure(authority.lifecycle.failureId)?.code === "RUN_INTERRUPTED_BY_CRASH",
        status,
        ...(authority.lifecycle.state === "terminal" && (authority.lifecycle.outcome === "failed" || authority.lifecycle.outcome === "interrupted")
          ? { recoverySource: authority.lifecycle.outcome } : {}),
        rowRevision: authority.version,
        dryRun: authority.envelope.dryRun,
        isChild: authority.envelope.parent !== undefined,
        parkedWrite: authority.lifecycle.state === "parked-write",

        memberCount: shape === "operation" ? memberChildIds.length : 0,
        isMember: shape === "operation-member",
        named: authority.displayName !== undefined,

        hasReviewPanel: descriptor?.capabilities?.review ?? false,
        batchMemberRetryAvailable: this.#deps.authority.batchMemberRetryAvailable?.(authority) === true,
      }),
      rowRevision: authority.version,
    };
    if (operation) {
      return {
        warningVerdict,
        surface: QueueSurfaceWireSchema.parse({
          ...base,
          surfaceKind: "operation",
          memberRunIds: memberChildIds,
          ...(recordMembers === undefined ? {} : { recordMembers }),
          memberRollup: {
            total: memberChildIds.length,
            terminal: terminalMembers.length,
            failed: failedTerminalMembers.length,
          },
          memberPreview: this.#memberPreview(members, context),
        }),
      };
    }
    return {
      warningVerdict,
      surface: QueueSurfaceWireSchema.parse({ ...base, surfaceKind: surfaceKindOf(shape) }),
    };
  }

  #surface(row: RunFoldRecord | undefined, authority: RunRecord, children: readonly RunRecord[], context: QueueReadContext): QueueSurfaceWire {
    return this.#surfaceFold(row, authority, children, context).surface;
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
    let context: QueueReadContext;
    if (summaries !== undefined) {
      context = this.#readContext();
      let after: { localDay: string; runId: string } | undefined;
      const readLive = (runId: string): RunRecord => {
        return this.#readRun(context, runId);
      };
      do {
        const page = summaries.queue({ fromDay: `${monthPrefix}-01`, toDay: new Date(Date.UTC(Number(parsedDay.slice(0, 4)), Number(parsedDay.slice(5, 7)), 0)).toISOString().slice(0, 10), limit: 500,
          topLevel: false, ...(after === undefined ? {} : { after }) });
        for (const summary of page.items) context.parents.set(summary.runId, summary.parent);
        for (const summary of page.items) {
          if (isQueueTopLevel(summary)) monthCounts.set(summary.localDay, (monthCounts.get(summary.localDay) ?? 0) + 1);
          if (summary.localDay !== parsedDay) continue;
          const authority = readLive(summary.runId);
          const surface = this.#surface(this.#rows.get(summary.runId), authority, summary.children.map(child => readLive(child.runId)), context);
          if (surface.status !== summary.status) throw new ProjectionDegradedError("run-summary-status-stale");
          surfaces.push(surface);
        }
        after = page.next ?? undefined;
      } while (after !== undefined);
    } else {
      // Explicit fixture-only compatibility. Production composition always supplies summaries.
      const runs = listCanonicalRuns(this.#deps.reader, "live");
      context = this.#readContext(runs);
      fixtureRuns = runs;
      const children = canonicalRunChildren(runs);
      for (const authority of runs) {
        const row = this.#rows.get(authority.envelope.runId);
        const rowDay = localDatePart(new Date(authority.envelope.enqueuedAt));
        if (rowDay.startsWith(monthPrefix) && isQueueTopLevel({ parent: this.#parentFact(context, authority) })) {
          monthCounts.set(rowDay, (monthCounts.get(rowDay) ?? 0) + 1);
        }
        if (rowDay !== parsedDay) continue;
        surfaces.push(this.#surface(row, authority, children.get(authority.envelope.runId) ?? [], context));
      }
    }
    const selectedDayIds = new Set(surfaces.map(surface => surface.runId));
    const related = new Map<string, RunRecord>();
    for (;;) {
      const included = new Set(surfaces.map(surface => surface.runId));
      const missing = [...new Set(surfaces.flatMap(surface => surface.surfaceKind === "operation" ? surface.memberRunIds : []))]
        .filter(runId => !included.has(runId));
      if (missing.length === 0) break;
      this.#deps.reader.withRunTreeSnapshot(missing, runs => {
        const children = canonicalRunChildren(runs);
        for (const run of runs) context.runs.set(run.envelope.runId, run);
        for (const runId of missing) {
          const run = this.#readRun(context, runId);
          related.set(runId, run);
          surfaces.push(this.#surface(this.#rows.get(runId), run, children.get(runId) ?? [], context));
        }
      });
    }
    const itemKey = (workflowId: string, itemId: string) => JSON.stringify([workflowId, itemId]);
    const visibleItems = new Map(surfaces.map(surface => [itemKey(surface.workflowId, surface.itemId),
      { workflowId: surface.workflowId, itemId: surface.itemId }]));
    const attempts = visibleItems.size === 0 ? [] : summaries === undefined ? fixtureRuns?.filter(candidate =>
      localDatePart(new Date(candidate.envelope.enqueuedAt)) === parsedDay)
      : summaries.itemAttempts(parsedDay, [...visibleItems.values()]);
    if (attempts === undefined) throw new ProjectionDegradedError("queue-attempt-history-unavailable");
    const surfaceByRunId = new Map(surfaces.map(surface => [surface.runId, surface]));
    const attemptHistory = [...attempts, ...related.values()].map(candidate => {
      const envelope = candidate.envelope;
      const surface = surfaceByRunId.get(envelope.runId);
      const parent = surface?.parent === null || surface?.parent === undefined ? undefined : surfaceByRunId.get(surface.parent.runId);
      const relatedMember = related.has(envelope.runId) && surface !== undefined && isQueueMember(surface)
        && parent?.surfaceKind === "operation" && parent.memberRunIds.includes(envelope.runId);
      if (surface === undefined || (!selectedDayIds.has(envelope.runId) && !relatedMember)
        || (!relatedMember && localDatePart(new Date(envelope.enqueuedAt)) !== parsedDay)
        || surface.workflowId !== envelope.workflow || surface.itemId !== envelope.itemId
        || surface.attempt !== envelope.attempt || Number(surface.rowRevision) !== Number(candidate.version)) {
        throw new ProjectionDegradedError("queue-attempt-history-membership-mismatch");
      }
      return { runId: surface.runId, startedAt: surface.startedAt, endedAt: surface.endedAt };
    });
    const priorityOrder = (priority: "interactive" | "bulk"): number => (priority === "interactive" ? 0 : 1);
    surfaces.sort((a, b) => priorityOrder(a.priority) - priorityOrder(b.priority) || a.startedAt.localeCompare(b.startedAt) || a.runId.localeCompare(b.runId));


    const countable = surfaces.filter(isQueueTopLevel);
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
    let workerAuthority: DashboardDayWire["workerAuthority"];
    const workerCards: DashboardDayWire["workerCards"] = [];
    const unavailableWorkerCards: NonNullable<DashboardDayWire["unavailableWorkerCards"]> = [];
    try {
      members = this.#deps.authority.listWorkerSlots?.().filter(member => member.retiredAt === null);
      const views = this.#deps.authority.workerMembers?.();
      workerAuthority = members !== undefined && views !== undefined ? { state: "present", members: [...members] }
        : { state: "unavailable", members: [...(members ?? [])], reason: "Worker membership is unavailable." };
      for (const member of members ?? []) {
        if (views === undefined) continue;
        // A card that cannot be built is served as unavailable; its siblings still render.
        try {
          const view = views.find(candidate => candidate.member.workerId === member.workerId);
          const runId = view?.activity?.runId;
          const lastRun = runId === undefined && (view === undefined || view.state === "exited"
            || view.state === "running" && (view.activity === undefined || view.activity.state === "idle")) ? this.#workerLastRun(member.workerId) : undefined;
          const timelineRunId = runId ?? (lastRun?.state === "present" ? lastRun.runId : undefined);
          workerCards.push(workerCardOf({ slot: member, view, foldRevision: this.#workers.get(member.workerId)?.eventCount ?? 0,
            startupPending: this.#deps.authority.workerStartupPending?.(member.workflow) === true,
            duoSystems: this.#deps.authority.heldDuoSystems?.(member.workerId),
            writeInFlight: runId => this.#deps.authority.writeInFlight?.(runId) === true,
            ...(lastRun === undefined ? {} : { lastRun }),
            ...(timelineRunId !== undefined ? { timeline: this.#workerTimeline(timelineRunId, surfaces) }
              : lastRun?.state === "unavailable" && lastRun.reason === "run-unavailable" ? { timeline: { state: "unavailable", reason: "run-unavailable" } } : {}),
            resolveRun: runId => {
              const read = this.#deps.reader.read(runId);
              return read.state === "present" && read.disposition === "live" ? read.run : undefined;
            } }));
        } catch (error) {
          const reason = WorkerCardUnavailableReasonSchema.safeParse(error instanceof Error ? error.message : undefined);
          unavailableWorkerCards.push({ member: workerPoolMember(member), workerId: member.workerId,
            availability: { state: "unavailable", reason: reason.success ? reason.data : "worker-card-unavailable" } });
        }
      }
    } catch (error) {
      workerAuthority = { state: "unavailable", members: [...(members ?? [])],
        reason: error instanceof Error ? error.message : "Worker authority could not be verified." };
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
      ...(unavailableWorkerCards.length === 0 ? {} : { unavailableWorkerCards }),
      workerAuthority,

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
          receipt: id => this.#deps.authority.getReceipt(id),
          presentation: this.#deps,
          checkpoints: { listByAttempt: (workflowId, itemId, nodeId, attempt) => this.#deps.authority.listNotificationCheckpoints(workflowId, itemId, nodeId, attempt) },
          command: id => this.#deps.authority.command?.(id),
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

    const inRange: { day: string; fold: SurfaceFold; authority: RunRecord; taskSpans: RunFoldRecord["taskSpans"] }[] = [];
    const personRows: RunRecord[] = [];
    const runs = listCanonicalRuns(this.#deps.reader, "live");
    const context = this.#readContext(runs);
    const children = canonicalRunChildren(runs);
    for (const authority of runs) {
      const row = this.#rows.get(authority.envelope.runId);
      const day = localDatePart(new Date(authority.envelope.enqueuedAt));
      if (day < start || day > end) continue;

      if (authority.envelope.shape !== "operation" && authority.envelope.workflow === "separations") personRows.push(authority);
      // Member containment, applied once: a member counted inside its
      // operation's rollup is not counted again at top level.
      if (!isQueueTopLevel({ parent: this.#parentFact(context, authority) })) continue;
      inRange.push({ day, fold: this.#surfaceFold(row, authority, children.get(authority.envelope.runId) ?? [], context), authority, taskSpans: row?.taskSpans ?? [] });
    }

    const people = activityPeopleOf(
      personRows,
      this.#deps.authority.canonicalPerson === undefined ? undefined : (runId) => this.#deps.authority.canonicalPerson!(runId),
    );

    const workflows = new Map<string, ActivityWorkflowCounts>();
    const analytics = createActivityAnalytics();
    const statuses = new Map<string, { runs: number; sample: string[] }>();
    const outcomes = new Map<string, number>();
    const failures = new Map<string, { workflowId: string; code: string; runs: number; transient: number; sample: string[] }>();
    const measured: { runId: string; ms: number }[] = [];

    const completion = { readBack: 0, warnings: 0, warningsUnknown: 0 };
    let unmeasured = 0;
    let terminalRuns = 0;

    for (const { day, fold: { surface, warningVerdict }, authority, taskSpans } of inRange) {
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

      const durationMs = authority.lifecycle.state === "terminal" && surface.endedAt.state === "present"
        ? Math.max(0, Date.parse(surface.endedAt.value) - Date.parse(surface.startedAt))
        : null;
      const failureStep = surface.status === "failed"
        ? failureStepOfTaskSpans(taskSpans, this.#deps.descriptors.resolve(surface.workflowId)?.timeline)
        : undefined;
      analytics.observe({ workflowId: surface.workflowId, day, status: surface.status, lifecycleState: authority.lifecycle.state, durationMs, ...(failureStep === undefined ? {} : { failureStep }) });
      if (authority.lifecycle.state !== "terminal") continue;
      terminalRuns += 1;
      outcomes.set(authority.lifecycle.outcome, (outcomes.get(authority.lifecycle.outcome) ?? 0) + 1);
      // A terminal row without an end instant has unknown duration, never a growing elapsed value.
      if (durationMs !== null) measured.push({ runId: surface.runId, ms: durationMs });
      else unmeasured += 1;
      const { failureId } = authority.lifecycle;
      if (failureId === undefined) continue;
      const failure = this.#deps.authority.getFailure(failureId);
      if (failure === undefined) {
        throw new Error(
          `run ${surface.runId} settled failed against failure ${failureId}, which authority does not hold; `
          + "refusing to report a failure breakdown with a hole in it",
        );
      }
      const key = JSON.stringify([surface.workflowId, failure.code]);
      const bucket = failures.get(key) ?? { workflowId: surface.workflowId, code: failure.code, runs: 0, transient: 0, sample: [] };
      bucket.runs += 1;
      if (failure.transient) bucket.transient += 1;
      if (bucket.sample.length < ACTIVITY_SAMPLE_LIMIT) bucket.sample.push(surface.runId);
      failures.set(key, bucket);
    }

    const timingRows = inRange.map(({ fold: { surface }, authority }) => ({ workflowId: surface.workflowId,
      status: surface.status, parentRunId: authority.envelope.parent?.runId ?? null,
      durationMs: authority.lifecycle.state === "terminal" && surface.endedAt.state === "present"
        ? Math.max(0, Date.parse(surface.endedAt.value) - Date.parse(surface.startedAt)) : null }));
    const categories = new Map<string, number>();
    let unregisteredCategoryRuns = 0;
    const workflowTotals = [...workflows.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([workflowId, counts]) => {
      const typicalTime = activityTypicalTime(successfulActivityTiming(workflowId, timingRows));
      const descriptor = this.#deps.descriptors.resolve(workflowId);
      if (descriptor === undefined) {
        unregisteredCategoryRuns += counts.runs;
        return {
          ...counts, ...analytics.workflow(workflowId), needsAttention: counts.failed, typicalTime,
          workflowId,
          registration: {
            state: "unregistered",
            reason: `workflow ${workflowId} is no longer registered; its label and category are unavailable`,
          },
        };
      }
      categories.set(descriptor.category, (categories.get(descriptor.category) ?? 0) + counts.runs);
      return {
        ...counts, ...analytics.workflow(workflowId), needsAttention: counts.failed, typicalTime,
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
    const typicalMedian = activityMedian(measured.map(entry => entry.ms));

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
      outcomeSplit: analytics.outcomeSplit(),
      typicalMedian,
      days: analytics.days(),
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
      failures: [...failures.values()].sort((a, b) => a.workflowId.localeCompare(b.workflowId) || a.code.localeCompare(b.code))
        .map(bucket => ({ ...bucket, sentence: operatorFailureSentence(bucket.code),
          registration: workflowTotals.find(workflow => workflow.workflowId === bucket.workflowId)!.registration })),
      durations: {
        measuredRuns: measured.length,
        unmeasuredRuns: unmeasured,
        medianMs: median === undefined
          ? { state: "absent", reason: ACTIVITY_MEDIAN_ABSENT_REASON }
          : { state: "present", value: median.ms },
        longestMs: longest === undefined
          ? { state: "absent", reason: ACTIVITY_MEDIAN_ABSENT_REASON }
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

function cancelledBy(run: RunRecord): NonNullable<QueueSurfaceWire["cancelledBy"]> {
  const summary = run.lifecycle.state === "terminal" ? run.lifecycle.errorSummary : undefined;
  return summary?.startsWith("RUN_LOGOUT_CANCELLED:") === true ? "logout" : summary?.startsWith("RUN_STALE_QUEUE_CANCELLED:") === true ? "stale-queue" : "operator";
}
