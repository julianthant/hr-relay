import { createHash } from "node:crypto";
import { setImmediate as yieldTurn } from "node:timers/promises";
import { operatorFailureSentence } from "../../../models/failures/error-catalog.js";
import { buildActivityReport, failureStepOfTaskSpans, type ActivityReportRow } from "../queries/activity-analytics.js";
import { isQueueMember, isQueueTopLevel, type QueueParent } from "../../../models/dashboard/queue-parent.js";
import { titleCasePersonName } from "../../../models/fields/cell-coercion.js";
import { workerPoolMember, type WorkerSlotRecord } from "../../../models/run/worker-slot.js";
import { displayScalar } from "../queries/data.js";
import type { WorkerMemberView } from "../../runtime/workers/worker-pool.js";
import type { AuthorityDatabase } from "../../storage/sqlite/authority-database.js";
import type { RunRecordService } from "../lifecycle/run-record-service.js";
import { canonicalRunChildren, listCanonicalRuns } from "../queries/canonical-runs.js";
import { assertRunTimelineCompatible, type RunTimelineEvidenceSource } from "../queries/run-timeline-compatibility.js";
import { retainedRunProtectedBindings } from "../../../models/write-safety/protected-input.js";
import { deriveEvidenceEntryId, evidenceEntryRef } from "../../../models/trust/evidence-identity.js";
import { deepFreeze } from "../../../rules/validation/immutability.js";

import { z } from "zod";
import { descriptorRuntimeNodes, workflowPlanning, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import type { Clock } from "../../../rules/time/clock.js";
import { searchPartitionDay } from "../../../models/dashboard/search-calendar.js";
import {
  DashboardDayWireSchema,
  WorkerCardUnavailableReasonSchema,
  QUEUE_NOT_STARTING_NO_WORKER,
  QueueStatusSchema,
  QueueSurfaceWireSchema,
  TERMINAL_QUEUE_STATUSES,
  type DashboardDayWire,
  type QueueSurfaceWire,
  type QueueRecordMembers,
} from "../../../models/dashboard/projection.js";
import {
  type ActivityLedgerBlock,
  type ActivityReportWire,
  type ActivityAssistantUsage,
} from "../../../models/dashboard/activity.js";
import { DashboardDayPatchSchema, QueueDayCountsSchema } from "../../../models/dashboard/subscription.js";
import { RowRevisionSchema } from "../../../models/dashboard/primitives.js";
import {
  PositiveIntSchema,
  LocalDateSchema,
  EidSchema,
  ProjectionCursorSchema,
  IsoInstantSchema,
  RunIdSchema,
  type Fingerprint,
  type BrowserSystemId,
  type IsoInstant,
  type RunId,
} from "../../../rules/identity/ids.js";
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
import { SpanEventWireSchema, SpanNotRunReasonSchema, type RunQueuedWire, type SpanEventWire } from "../../../models/events/types.js";
import type { RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import type { RunSessionRecord } from "../../../models/run/session.js";
import type { WorkerPoolRecord } from "../../../models/run/worker-pool.js";
import { queueRowActions } from "./queue-row-actions.js";
import { allowsSubjectIdentity, resolveResultTitle, verifiedResultDisplayValue, resolveSubjectTitle } from "./run-subject-title.js";
import { lastRunOf, stepInterruptOf, workerCardOf, type WorkerCardWire } from "./worker-cards.js";
import type { TimelineLine } from "../../storage/events/timeline-reader.js";
import type { DashboardBackgroundReadRequest, DashboardBackgroundReadResult } from "../../storage/sqlite/dashboard-background-read-worker.js";
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

  notRunReason: SpanNotRunReasonSchema.optional(),
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
  dayCounts(fromDay: string, toDay: string): ReadonlyMap<string, number>;
  queue(input: { fromDay: string; toDay: string; limit: number; topLevel: boolean; workflow?: string; after?: { localDay: string; runId: string } }): {
    items: readonly { runId: string; localDay: string; shape: string; parent: QueueParent | null; title: string; status: QueueSurfaceWire["status"]; children: readonly { runId: string }[] }[];
    next: { localDay: string; runId: string } | null;
  };
  itemAttempts(day: string, items: readonly { workflowId: string; itemId: string }[]): readonly RunRecord[];
  activity(from: string, to: string): ActivityReportWire;
}

type CheckQueueDaySources = AuthorityDatabase["checkQueueDaySources"];
type QueueDaySources = Exclude<Parameters<CheckQueueDaySources>[1], number | undefined>;

interface CachedQueueDay {
  wire: DashboardDayWire;
  sources: QueueDaySources;
  workerKey: string;
  reusable: ReadonlySet<string>;
  builtAt: number;
  validUntil: number;
  cursor: string;
  refreshedRuns: Set<string>;
}

interface QueueDayPatch {
  previous: CachedQueueDay;
  affected: ReadonlySet<string>;
  dayRunIds: readonly string[];
  countDays: readonly string[];
  sameWorkers: boolean;
}

export interface RunQueueProjectionDeps {
  readonly assistantUsage?: (from: string, to: string, generatedAt: string) => ActivityAssistantUsage;
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
    aggregateMemberRetryAvailable?(run: RunRecord): boolean;
    queueParents(envelopes: readonly RunRecord["envelope"][]): ReadonlyMap<string, QueueParent | null>;
    delegationWait?(runId: string): DelegationWaitState | null;
    reviewAvailable?(runId: string): boolean;
    recordMembers?(run: RunRecord, children: readonly RunRecord[]): QueueRecordMembers | undefined;
    listCheckpoints: RunTimelineEvidenceSource["authority"]["listCheckpoints"];
    listGateResults: RunTimelineEvidenceSource["authority"]["listGateResults"];

    listWorkerSlots?(): readonly WorkerSlotRecord[];
    /** A copy's sample cards: served on Sessions, never pool members, so Add and readback count only real slots. */
    listSampleWorkerSlots?(): readonly WorkerSlotRecord[];
    listWorkerRuns?(workerId: string): readonly RunRecord[];
    /** The profile runtime's worker pool members; absent where no pool runs (then no worker card is served). */
    workerMembers?(): readonly WorkerMemberView[];
    /** Whether a capacity step for the workflow is still starting its members. */
    workerStartupPending?(workflowId: string): boolean;
    heldDuoLeases?(workerId: string): readonly { system: BrowserSystemId; since: IsoInstant }[];
    /** Whether the run holds an `attempting` (fenced, unsettled) write intent. */
    writeInFlight?(runId: string): boolean;
    /** An unchanged key skips the live-run read. */
    changeKey?(): number | undefined;
    checkDaySources?: CheckQueueDaySources;
    nextDuoLeaseExpiry?(nowMs: number): number;

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
  /** Builds the day on the navigation lane; without it the day is built here. */
  readonly dayLane?: DashboardDayLane;
  /** A lane's replica serves days and publishes nothing: an ingest only invalidates its cached days. */
  readonly replica?: true;
}

/* ── the day as a lane serves it ─────────────────────────────────────────── */

/** A served row's identity and status: what main records as published from a day it did not build itself. */
const PublishedSurfaceSchema = z.strictObject({ runId: RunIdSchema, status: QueueStatusSchema, startedAt: IsoInstantSchema });
export type PublishedSurface = z.infer<typeof PublishedSurfaceSchema>;

const QueueRowBasisSchema = z.strictObject({ runId: RunIdSchema, status: QueueStatusSchema,
  rowRevision: RowRevisionSchema, fingerprint: z.string().length(64) });
const QueuePatchBasisSchema = z.strictObject({
  shared: z.string().length(64),
  rows: z.array(QueueRowBasisSchema),
  counts: QueueDayCountsSchema,
});
export type QueuePatchBasis = z.infer<typeof QueuePatchBasisSchema>;

function queueFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function queueRowBasis(row: QueueSurfaceWire): z.infer<typeof QueueRowBasisSchema> {
  return { runId: row.runId, status: row.status, rowRevision: row.rowRevision, fingerprint: queueFingerprint(row) };
}

const LaneDayFactsSchema = z.strictObject({
  /** The timeline position the day's fold reached, in the snapshot its rows were read in. */
  position: z.number().int().nonnegative(),
  surfaces: z.array(PublishedSurfaceSchema),
  /** Whether this read built the day, rather than reusing one it had cached. */
  built: z.boolean(),
  patchBasis: QueuePatchBasisSchema.optional(),
});
export type LaneDayFacts = z.infer<typeof LaneDayFactsSchema>;
/** The day without main's envelope stamp. The lane never names a projection cursor or generation. */
export type UnstampedDayWire = Omit<DashboardDayWire, "projectionGeneration" | "snapshotCursor">;

/** The lane body: `{"d":<unstamped day>,"f":<facts>}`, serialized once where it was built. */
export function laneDayBody(day: DashboardDayWire, facts: Omit<LaneDayFacts, "patchBasis">): { d: UnstampedDayWire; f: LaneDayFacts } {
  const { projectionGeneration: _generation, snapshotCursor: _cursor, ...unstamped } = day;
  const { queueSurfaces, attemptHistory, monthCounts, workflowCounts, statusCounts, ...shared } = unstamped;
  return { d: unstamped, f: { ...facts,
    patchBasis: { counts: { monthCounts, workflowCounts, statusCounts }, rows: queueSurfaces.map(queueRowBasis),
      // Attempt times are validated against each row. Their membership and order are independent facts.
      shared: queueFingerprint([shared, monthCounts, attemptHistory?.map(entry => entry.runId)]) } } };
}

const LANE_DAY_HEAD = "{\"d\":";
const LANE_DAY_FACTS = ",\"f\":";

/** Splits a lane body without parsing the day: the facts are the body's last member, and no key inside them is `f`. */
export function decodeLaneDay(body: string): { dayJson: string; facts: LaneDayFacts } {
  const split = body.lastIndexOf(LANE_DAY_FACTS);
  if (!body.startsWith(LANE_DAY_HEAD) || !body.endsWith("}") || split <= LANE_DAY_HEAD.length) throw new Error("queue-day-lane-body-unverified: frame");
  const facts = LaneDayFactsSchema.parse(JSON.parse(body.slice(split + LANE_DAY_FACTS.length, -1)));
  return { dayJson: body.slice(LANE_DAY_HEAD.length, split), facts };
}

/**
 * Main's stamp, spliced into the lane's day after its two leading members, in the wire's own key order. A body whose
 * leading members are not exactly this day and descriptor set is refused, never re-serialized.
 */
export function stampDashboardDay(dayJson: string, stamp: Readonly<{ day: string; descriptorHash: string; generation: number; cursor: ProjectionCursor }>): string {
  const head = `{"day":${JSON.stringify(stamp.day)},"descriptorHash":${JSON.stringify(stamp.descriptorHash)},`;
  if (!dayJson.startsWith(head) || !dayJson.endsWith("}")) throw new Error("queue-day-lane-body-unverified: head");
  return `${head}"projectionGeneration":${JSON.stringify(stamp.generation)},"snapshotCursor":${JSON.stringify(stamp.cursor)},${dayJson.slice(head.length)}`;
}

/** The navigation lane's day read, as the projection calls it. */
export interface DashboardDayLane {
  read(day: string, request: Readonly<{ slot?: Readonly<{ subscriberId: string; slot: string }>; signal?: AbortSignal }>): Promise<Readonly<{ body: string; processRevision: number | null }>>;
  /** The current process-facts revision; a reply built at another revision is discarded. */
  processRevision(): number;
}

/** A day read at a dispatch: its body, the generation and cursor main held when it asked, and whether it still holds. */
export interface DashboardDayRead {
  readonly dayJson: string;
  readonly facts: LaneDayFacts;
  readonly generation: number;
  /** The cursor main held when it asked; everything main published at or below it is in the day. */
  readonly dispatchCursor: number;
  /** Built from main's own fold in the dispatching turn, so it is framed at its dispatch cursor with no fold mapping. */
  readonly foldedHere: boolean;
  /** The day as built here, stamped at the dispatch cursor; a lane read carries none. */
  readonly wire: DashboardDayWire | undefined;
  /** False once the projection generation or the process facts moved past the read. */
  current(): boolean;
}

/** Where main's fold stood when the lane's position `T` was reached. */
export type FoldCursor = { readonly state: "at"; readonly cursor: number } | { readonly state: "ahead" | "evicted" };

/** One ingest of main's fold: the timeline position it reached and the cursor before and after its envelopes. */
interface FoldMark { readonly position: number; readonly before: number; after: number }
const FOLD_MARK_LIMIT = 1024;
const DAY_LANE_ATTEMPTS = 3;

type ProjectionCursor = z.infer<typeof ProjectionCursorSchema>;

export type RunQueueProjectionChange =
  | { readonly kind: "patch"; readonly cursor: ProjectionCursor; readonly position: number; readonly day: string; readonly patch: z.infer<typeof DashboardDayPatchSchema> }
  | { readonly kind: "snapshot"; readonly cursor: ProjectionCursor; readonly position: number;
      readonly statusCandidate?: { readonly day: string; readonly replacement: QueueSurfaceWire } }
  | { readonly kind: "generation"; readonly cursor: ProjectionCursor }
  /** Runs whose timeline records an ingest folded, notes included, that no patch or snapshot of that ingest carried. */
  | { readonly kind: "runs"; readonly runIds: readonly RunId[]; readonly position: number };

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
  reviewAvailability?: Map<string, boolean>;
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


const MEMBER_PREVIEW_LIMIT = 3;
const DAY_CACHE_LIMIT = 16;

const PROJECTION_SPAN_TYPES = [
  "run.queued", "run.claimed", "run.requeued", "span.started", "span.ended",
  "gate.opened", "gate.resolved", "transaction.fenced", "data.observed",
] satisfies SpanEventWire["t"][];

const PROJECTION_SPAN_TYPE_SET: ReadonlySet<string> = new Set(PROJECTION_SPAN_TYPES);

function isProjectionSpan(record: ReturnType<typeof readTimelineRecords>["records"][number]): boolean {
  return record.payload.kind === "span" && PROJECTION_SPAN_TYPE_SET.has(record.payload.event.t);
}

function projectionEvents(records: ReturnType<typeof readTimelineRecords>["records"]) {
  return records.map(record => {
    if (record.payload.kind !== "span" || record.payload.event.t === "transaction.previewed") {
      throw new ProjectionDegradedError("unexpected projection timeline kind");
    }
    const event = record.payload.event;
    return { event, line: timelineSpanLocation(record) };
  });
}

interface BackgroundWorkerFacts {
  fingerprint: string;
  slotWorkflows: DashboardBackgroundReadResult["workers"]["slotWorkflows"];
  leases: Map<string, { system: BrowserSystemId; since: IsoInstant }[]>;
}

class TimelineFoldState {
  readonly rows = new Map<string, RunFoldRecord>();
  readonly workers = new Map<string, WorkerFold>();
  readonly runLogs = new Map<string, ProjectedRunLogEntry[]>();
}

const BACKGROUND_PAGE_SIZE = 32;
type ProjectionEvent = ReturnType<typeof projectionEvents>[number];
function compareEvents(left: ProjectionEvent, right: ProjectionEvent): number {
  return left.event.ts.localeCompare(right.event.ts) || left.line.lineNumber - right.line.lineNumber;
}

// Merge sorted worker pages without a single sort or copy of the entire retained history.
function mergeReplayPages(left: Iterator<ProjectionEvent>, right: Iterator<ProjectionEvent>): IterableIterator<ProjectionEvent> {
  let a = left.next(), b = right.next();
  return (function* () {
    while (!a.done || !b.done) {
      if (!a.done && (b.done || compareEvents(a.value, b.value) <= 0)) { yield a.value; a = left.next(); }
      else if (!b.done) { yield b.value; b = right.next(); }
    }
  })();
}

type LinkedRunView = QueueSurfaceWire["linkedRuns"][number];


/* ── the projection ──────────────────────────────────────────────────────── */

export class RunQueueProjection {
  readonly #deps: RunQueueProjectionDeps;
  #foldState = new TimelineFoldState();
  readonly #listeners = new Set<(change: RunQueueProjectionChange) => void>();
  readonly #notifiedRows = new Map<string, { status: QueueSurfaceWire["status"]; surface?: string }>();
  readonly #dayCache = new Map<string, CachedQueueDay>();
  /** Day builds so far, so a lane read can report whether it built its day or reused a cached one. */
  #dayBuilds = 0;

  #timelineCursor = 0;

  #workerAuthorityFingerprint: string;
  #backgroundWorkers?: BackgroundWorkerFacts;
  #foregroundSnapshot?: { fingerprint: string };
  #publishedBatchVersions: ReadonlyMap<string, number> = new Map();
  #storedCanonical: { key: number; storeJson: string; claimedIds: readonly string[]; batches: readonly { sessionId: string; version: number }[] } | undefined;
  /** One step per emitted envelope; the projection is the only owner of the sequence. */
  #cursorValue = 1;
  #generationValue: number;
  #health: RunQueueProjectionHealth = { state: "live" };
  #rebuildScheduled = false;
  #foldMarks: FoldMark[] = [{ position: 0, before: 1, after: 1 }];
  #foldMarksEvicted = false;
  readonly #foldWaiters = new Set<{ readonly position: number; readonly resolve: () => void }>();

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

  cursor(): ProjectionCursor {
    return ProjectionCursorSchema.parse(`pc:${String(this.#cursorValue)}`);
  }

  /** Advance the sequence for one envelope and name its cursor. */
  takeCursor(): ProjectionCursor {
    const previous = this.cursor();
    this.#cursorValue += 1;
    const next = this.cursor();
    // A minted cursor changes no row; a cached day stays current and is restamped when served.
    for (const cached of this.#dayCache.values()) if (cached.cursor === previous) cached.cursor = next;
    return next;
  }

  /** The highest `timeline_events.cursor` folded so far. */
  position(): number {
    return this.#timelineCursor;
  }

  runFold(runId: string): RunFoldRecord | undefined {
    return this.#foldState.rows.get(runId);
  }

  // Index logs by durable ingestion order, never by run-instant file partitions.
  runLogSnapshot(runId: string): ProjectedRunLogSnapshot {
    if (this.#health.state === "degraded") {
      throw new ProjectionDegradedError(
        `the run/queue projection is degraded and refuses to serve observed logs: ${this.#health.lastError ?? "unknown"}`,
      );
    }
    const entries = this.#foldState.runLogs.get(runId) ?? [];
    return Object.freeze({
      projectionGeneration: this.#generationValue,
      snapshotRevision: entries.at(-1)?.revision ?? 0,
      entries: Object.freeze([...entries]),
    });
  }


  apply(event: SpanEventWire, line?: TimelineLine): void {
    try {
      const affected = this.#foldEvent(event, line);
      if (affected !== undefined) this.#notify(affected);
    } catch (error) {
      this.#degrade(`projection apply failed for ${event.t}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }


  ingestFromTimeline(): void {
    if (this.#health.state === "degraded") {
      this.#scheduleRebuild();
      return;
    }
    try {
      this.#ingestTail(readTimelineRecords(this.#deps.timeline, this.#timelineCursor));
    } catch (error) {
      this.#degrade(`timeline ingest failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  #ingestTail(tail: ReturnType<typeof readTimelineRecords>, workerFactsCaptured = false): void {
    const before = this.#cursorValue;
    try { this.#foldTail(tail, workerFactsCaptured); }
    finally { this.#markFold(before); }
  }

  /** Records where this ingest left the fold, and wakes the reads waiting for it. */
  #markFold(before: number): void {
    const last = this.#foldMarks.at(-1);
    // A later ingest at the same position mints above the mark: those envelopes are not part of reaching it.
    if (last === undefined || last.position < this.#timelineCursor) {
      this.#foldMarks.push({ position: this.#timelineCursor, before, after: this.#cursorValue });
      if (this.#foldMarks.length > FOLD_MARK_LIMIT) { this.#foldMarks.shift(); this.#foldMarksEvicted = true; }
    }
    for (const waiter of [...this.#foldWaiters]) {
      if (waiter.position > this.#timelineCursor) continue;
      this.#foldWaiters.delete(waiter);
      waiter.resolve();
    }
  }

  #foldTail(tail: ReturnType<typeof readTimelineRecords>, workerFactsCaptured: boolean): void {
    this.#timelineCursor = tail.cursor;
    if (tail.records.length === 0) return;
    const touched = new Set<RunId>();
    for (const record of tail.records) if (record.scope.kind === "run") touched.add(record.scope.runId);
    const events = projectionEvents(tail.records.filter(isProjectionSpan));
    let queueRevisions = 0;
    const runIds = new Set<string>();
    let workerChanged = false;
    for (const { event, line } of events) {
      const affected = this.#foldEvent(event, line);
      if (affected === undefined) continue;
      queueRevisions += 1;
      for (const runId of affected.runIds) runIds.add(runId);
      workerChanged ||= affected.workerChanged;
    }
    const affected = { runIds: [...runIds], workerChanged };
    const forceSnapshot = queueRevisions > 1 && (workerChanged || runIds.size !== 1);
    const carried = queueRevisions > 0 ? this.#notify(affected, forceSnapshot, workerFactsCaptured) : { snapshot: false, runIds: [] };
    const uncarried = carried.snapshot ? [] : [...touched].filter(runId => !carried.runIds.includes(runId));
    if (uncarried.length > 0) this.#emit({ kind: "runs", runIds: uncarried, position: this.#timelineCursor });
  }

  async pollBackground(read: (request: DashboardBackgroundReadRequest) => Promise<DashboardBackgroundReadResult>, nowMs: number,
    workerRevisionState?: () => { readUnchanged: boolean; startupUnchanged: boolean }): Promise<number | undefined> {
    const generation = this.#generationValue, rebuilding = this.#health.state === "degraded";
    const first = this.#backgroundWorkers === undefined;
    const foregroundAtRead = this.#foregroundSnapshot;
    const workerFactsCurrent = () => (this.#foregroundSnapshot === undefined || this.#foregroundSnapshot === foregroundAtRead)
      && workerRevisionState?.().readUnchanged !== false;
    const after = rebuilding ? 0 : this.#timelineCursor;
    const request = { limit: BACKGROUND_PAGE_SIZE, nowMs, ...(rebuilding ? { spanTypes: PROJECTION_SPAN_TYPES } : {}) };
    const current = () => generation === this.#generationValue && rebuilding === (this.#health.state === "degraded");
    let page = await read({ ...request, after });
    const { through } = page;
    const workers: BackgroundWorkerFacts = { fingerprint: page.workers.fingerprint, slotWorkflows: [], leases: new Map() };
    const batches = new Map<string, number>();
    const replay: (IterableIterator<ProjectionEvent> | undefined)[] = [];
    let expiry = Infinity, moreWorkerFacts = true;
    for (;;) {
      if (!current()) return undefined;
      if (moreWorkerFacts) {
        workers.slotWorkflows.push(...page.workers.slotWorkflows);
        for (const batch of page.workers.batchVersions) batches.set(batch.sessionId, batch.version);
        for (const lease of page.workers.heldDuoLeases) {
          expiry = Math.min(expiry, Date.parse(lease.expiresAt));
          const leases = workers.leases.get(lease.workerId) ?? [];
          leases.push({ system: lease.system, since: lease.since });
          workers.leases.set(lease.workerId, leases);
        }
        moreWorkerFacts = page.workers.next !== null;
        // A timeline snapshot carries worker state too. Capture its admitted fingerprint before publishing it.
        if (!moreWorkerFacts && !rebuilding && workerFactsCurrent()) this.#backgroundWorkers = workers;
      }
      if (rebuilding && page.records.length > 0) {
        let events: IterableIterator<ProjectionEvent> = projectionEvents(page.records).sort(compareEvents).values();
        let level = 0;
        for (const previous of replay) {
          if (previous === undefined) break;
          events = mergeReplayPages(previous, events);
          replay[level++] = undefined;
        }
        replay[level] = events;
      } else if (!rebuilding && page.cursor > this.#timelineCursor) {
        // A synchronous command may already have consumed part or all of this page.
        this.#ingestTail({ records: page.records.filter(row => row.cursor > this.#timelineCursor), cursor: page.cursor }, this.#backgroundWorkers === workers && workerFactsCurrent());
      }
      if (page.cursor >= through && !moreWorkerFacts) break;
      const workerCursor = moreWorkerFacts ? page.workers.next : null;
      page = await read({ ...request, after: page.cursor, through, ...(workerCursor === null ? {} : { workerCursor }) });
    }
    const rebuilt = rebuilding ? new TimelineFoldState() : undefined;
    if (rebuilt !== undefined) {
      const ordered = replay.reduce<IterableIterator<ProjectionEvent> | undefined>((left, right) =>
        left === undefined ? right : right === undefined ? left : mergeReplayPages(left, right), undefined);
      let count = 0;
      for (const { event, line } of ordered ?? []) {
        this.#foldEvent(event, line, rebuilt);
        if (++count % BACKGROUND_PAGE_SIZE === 0) {
          await yieldTurn();
          if (!current()) return undefined;
        }
      }
    }
    // Fold the timeline even when a concurrent commit requires a fresh read of worker authority.
    if (!rebuilding && !workerFactsCurrent()) return undefined;
    this.#publishedBatchVersions = batches;
    if (rebuilt !== undefined) {
      this.#backgroundWorkers = workers;
      this.#foldState = rebuilt;
      this.#notifiedRows.clear();
      this.#finishRebuild(through);
    } else {
      // The worker uses a different fingerprint format. Only rebaseline silently when the startup facts still match.
      if (first && workerRevisionState?.().startupUnchanged === true) this.#workerAuthorityFingerprint = this.#captureSharedAuthorityFingerprint();
      // Commands can publish the same authority before the worker catches up.
      const foreground = this.#foregroundSnapshot;
      this.#foregroundSnapshot = undefined;
      if (foreground !== undefined) {
        const fingerprint = this.#captureSharedAuthorityFingerprint();
        if (fingerprint !== this.#workerAuthorityFingerprint && this.#deps.reader.withRunTreeSnapshot([], () =>
          this.#captureSharedAuthorityFingerprint(undefined, true)) === foreground.fingerprint) this.#workerAuthorityFingerprint = fingerprint;
      }
      this.reconcileWorkerAuthority();
    }
    return expiry;
  }

  backgroundReadFailed(error: unknown): void {
    this.#health = { state: "degraded", lastError: `timeline background read failed: ${error instanceof Error ? error.message : String(error)}` };
  }

  // Reconcile live leases independently of span ingestion; lifecycle changes need not emit spans.
  reconcileWorkerAuthority(): void {
    if (this.#health.state === "degraded") return;
    try {
      const fingerprint = this.#captureSharedAuthorityFingerprint();
      if (fingerprint === this.#workerAuthorityFingerprint) return;
      this.#workerAuthorityFingerprint = fingerprint;
      if (this.#backgroundWorkers === undefined) {
        this.#notify({ runIds: [], workerChanged: true });
        return;
      }
      this.#dayCache.clear();
      this.#publishBackgroundSnapshot();
    } catch (error) {
      this.#degrade(`worker authority reconcile failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }


  #publishBackgroundSnapshot(): void {
    this.#emit({ kind: "snapshot", cursor: this.takeCursor(), position: this.#timelineCursor });
  }

  /** Worker authority can publish a run's new status before its spans arrive. */
  recordPublishedDay(day: string, surfaces: readonly PublishedSurface[]): void {
    for (const { runId, status, startedAt } of surfaces) {
      const previous = this.#notifiedRows.get(runId);
      if (previous !== undefined && previous.status !== status && searchPartitionDay(new Date(startedAt)) === day) {
        this.#notifiedRows.set(runId, { status });
      }
    }
  }

  #degrade(lastError: string): void {
    this.#health = { state: "degraded", lastError };
    this.#scheduleRebuild();
  }

  #scheduleRebuild(): void {
    if (this.#rebuildScheduled) return;
    this.#rebuildScheduled = true;
    const schedule = this.#deps.scheduleRebuild ?? ((rebuild: () => void): void => rebuild());
    schedule(() => {
      try {
        if (this.#health.state === "degraded") this.rebuildFromTimeline();
      } finally {
        this.#rebuildScheduled = false;
      }
    });
  }


  #foldEvent(event: SpanEventWire, line?: TimelineLine, state = this.#foldState) {
    const affected = this.#fold(event, line, state);
    if (line !== undefined && (event.t === "data.observed" || event.t === "transaction.fenced")) {
      const entries = state.runLogs.get(event.runId) ?? [];
      if (entries.length === 0) state.runLogs.set(event.runId, entries);
      entries.push(Object.freeze({ event, line, revision: entries.length + 1 }));
    }
    if (affected.runIds.length === 0 && !affected.workerChanged) return undefined;
    return affected;
  }

  /** Rebuild derived views from a consistent SQLite timeline snapshot. */
  rebuildFromTimeline(): void {
    try {
      const whole = readTimelineRecords(this.#deps.timeline, 0, undefined, PROJECTION_SPAN_TYPES);
      const events = projectionEvents(whole.records).sort(compareEvents);
      this.#foldState = new TimelineFoldState();
      this.#notifiedRows.clear();
      for (const { event, line } of events) this.#foldEvent(event, line);
      this.#finishRebuild(whole.cursor);
    } catch (error) {
      this.#health = {
        state: "degraded",
        lastError: `timeline rebuild failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }


  #finishRebuild(cursor: number): void {
    // The tail resumes from exactly what this rebuild consumed — set
    // together with `live` so the two ingest paths can never overlap.
    this.#timelineCursor = cursor;
    this.#generationValue = Math.max(this.#generationValue + 1, Math.trunc(this.#deps.clock.nowMs()));
    this.#cursorValue = 1;
    this.#foldMarks = [{ position: cursor, before: 1, after: 1 }];
    this.#foldMarksEvicted = false;
    this.#health = { state: "live" };
    this.#foregroundSnapshot = undefined;
    this.#workerAuthorityFingerprint = this.#captureSharedAuthorityFingerprint();
    this.#emit({ kind: "generation", cursor: this.cursor() });
    // Every read waiting on the old generation's fold settles; its reader sees the generation moved.
    for (const waiter of this.#foldWaiters) waiter.resolve();
    this.#foldWaiters.clear();
  }

  refreshRun(runId: string): void {
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
        return run === undefined ? [] : [this.#surface(this.#foldState.rows.get(runId), run, children.get(runId) ?? [], context)];
      });
    });
  }

  #workerLastRun(workerId: string, readRun: RunQueueProjectionDeps["reader"]["read"],
    timeline: TimelineRepository): NonNullable<WorkerCardWire["lastRun"]> {
    const record = timeline.lastWorkerClaim(workerId);
    const claim = record?.payload.kind === "span" && record.payload.event.t === "run.claimed" ? record.payload.event : undefined;
    const read = claim === undefined ? undefined : readRun(claim.runId);
    const run = read?.state === "present" && read.disposition === "live" ? read.run : undefined;
    return lastRunOf({ claim: claim === undefined ? undefined : { runId: claim.runId, attempt: claim.attempt }, run,
      spans: claim === undefined ? undefined : this.#foldState.rows.get(claim.runId)?.taskSpans,
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

  #workerTimeline(runId: string, surfaces: readonly QueueSurfaceWire[], readRun: RunQueueProjectionDeps["reader"]["read"],
    presentation: RunTimelineEvidenceSource): NonNullable<WorkerCardWire["timeline"]> {
    const read = readRun(runId);
    if (read.state !== "present" || read.disposition !== "live") return { state: "unavailable", reason: "run-unavailable" };
    const descriptor = this.#deps.descriptors.resolve(read.run.envelope.workflow);
    if (descriptor !== undefined && (descriptor.version !== read.run.envelope.descriptorVersion
      || descriptor.contractFingerprint !== read.run.envelope.contractFingerprint)) {
      try {
        assertRunTimelineCompatible(read.run, descriptor.timeline, presentation, this.#foldState.rows.get(runId));
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

  #row(runId: string, eventType: string, state: TimelineFoldState): RunFoldRecord {
    const row = state.rows.get(runId);
    if (row === undefined) {
      throw new Error(`${eventType} names run ${runId}, which has no run.queued span in the fold`);
    }
    return row;
  }

  #fold(event: SpanEventWire, line: TimelineLine | undefined, state: TimelineFoldState): { runIds: readonly string[]; workerChanged: boolean } {
    if (event.t === "run.queued") {
      if (state.rows.has(event.runId)) {
        throw new Error(`run.queued replayed for ${event.runId}; identity attributes are write-once`);
      }
      state.rows.set(event.runId, RunFoldRecordSchema.parse({
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
        const parent = state.rows.get(event.parentRunId);
        if (parent !== undefined && !parent.memberRunIds.includes(event.runId)) {
          parent.memberRunIds.push(event.runId);
          affected.push(event.parentRunId);
        }
      }
      return { runIds: affected, workerChanged: false };
    }

    if (event.t === "run.claimed") {
      const row = this.#row(event.runId, event.t, state);
      row.claimedBy = event.workerId;
      row.attempt = event.attempt;
      row.lastEventAt = event.ts;
      row.eventCount += 1;
      const worker = state.workers.get(event.workerId);
      if (worker !== undefined) {
        worker.currentRunId = event.runId;
        worker.eventCount += 1;
      }
      return { runIds: [event.runId], workerChanged: worker !== undefined };
    }

    if (event.t === "run.requeued") {
      const row = this.#row(event.runId, event.t, state);
      const worker = row.claimedBy === undefined ? undefined : state.workers.get(row.claimedBy);
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
      const row = this.#row(event.runId, event.t, state);
      row.openGates.push({ gate: event.gate, openedAt: event.ts });
      row.lastEventAt = event.ts;
      row.eventCount += 1;
      return { runIds: [event.runId], workerChanged: false };
    }

    if (event.t === "gate.resolved") {
      const row = this.#row(event.runId, event.t, state);
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
        const row = this.#row(event.runId, event.t, state);
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
        state.workers.set(event.workerId, {
          workerId: event.workerId,
          startedAt: event.ts,
          eventCount: 1,
        });
        return { runIds: [], workerChanged: true };
      }
      const worker = state.workers.get(event.workerId)
        ?? { workerId: event.workerId, startedAt: event.ts, eventCount: 0 };
      state.workers.set(event.workerId, worker);
      worker.eventCount += 1;
      return { runIds: [], workerChanged: true };
    }

    // A preview event is transaction detail, not a task settlement.
    if (event.t === "transaction.previewed") return { runIds: [], workerChanged: false };


    if (event.t === "transaction.fenced") return { runIds: [], workerChanged: false };


    if (event.t === "data.observed") return { runIds: [], workerChanged: false };

    // span.ended
    if (event.kind === "task") {
      const row = this.#row(event.runId, event.t, state);
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
      const row = this.#row(event.runId, event.t, state);
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
      for (const worker of state.workers.values()) {
        if (worker.currentRunId === event.runId) {
          delete worker.currentRunId;
          worker.eventCount += 1;
          workerChanged = true;
        }
      }
      return { runIds: [event.runId], workerChanged };
    }
    // worker / browser span end
    const worker = state.workers.get(event.workerId);
    if (worker !== undefined) {
      if (event.kind === "worker") worker.endedAt = event.ts;
      worker.eventCount += 1;
    }
    return { runIds: [], workerChanged: true };
  }

  #emit(change: RunQueueProjectionChange): void {
    for (const listener of this.#listeners) listener(change);
  }

  /** Publishes day changes and reports which runs they carried. A snapshot carries every run. */
  #notify(affected: { runIds: readonly string[]; workerChanged: boolean }, forceSnapshot = false,
    workerFactsCaptured = false): { snapshot: boolean; runIds: readonly string[] } {
    if (affected.workerChanged) this.#dayCache.clear();
    else {
      for (const cached of this.#dayCache.values()) {
        for (const id of affected.runIds) cached.refreshedRuns.add(id);
      }
    }
    if (this.#deps.replica === true) return { snapshot: false, runIds: affected.runIds };
    const publications = this.#deps.reader.withRunTreeSnapshot([], () => {
      const patches: { day: string; patch: z.infer<typeof DashboardDayPatchSchema> }[] = [];
      let snapshotNeeded = affected.workerChanged;
      let batchPresentationChanged = false;
      let crossDayMembersChanged = false;
      let statusCandidate: { day: string; replacement: QueueSurfaceWire } | undefined;
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
        const row = this.#foldState.rows.get(runId);
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
        const day = searchPartitionDay(new Date(authority.envelope.enqueuedAt));
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
          if (searchPartitionDay(new Date(parent.envelope.enqueuedAt)) !== day) crossDayMembersChanged = true;
          holder = parent;
        }
        if (crossDayMembersChanged) snapshotNeeded = true;
        if (!countNeutral) {
          snapshotNeeded = true;
          if (isQueueTopLevel(replacement) && affectedIds.size === 1) statusCandidate = { day, replacement };
          continue;
        }
        patches.push({
          day,
          patch: DashboardDayPatchSchema.parse({
            operation: "replace-queue-surface",
            target: { runId, rowRevision: replacement.rowRevision },
            replacement,
          }),
        });
      }
      const snapshotOnly = forceSnapshot || batchPresentationChanged || crossDayMembersChanged || patches.length > 1;
      if (snapshotOnly) snapshotNeeded = true;
      if (snapshotNeeded) {
        this.#workerAuthorityFingerprint = this.#captureSharedAuthorityFingerprint(snapshot.runs);
        this.#foregroundSnapshot = workerFactsCaptured ? undefined : { fingerprint: this.#backgroundWorkers === undefined
          ? this.#workerAuthorityFingerprint : this.#captureSharedAuthorityFingerprint(snapshot.runs, true) };
      }
      // Each emitted change takes its own cursor, in emission order.
      const position = this.#timelineCursor;
      const changes: RunQueueProjectionChange[] = snapshotOnly ? []
        : patches.map(patch => ({ kind: "patch" as const, cursor: this.takeCursor(), position, ...patch }));
      if (snapshotNeeded) changes.push({ kind: "snapshot", cursor: this.takeCursor(), position,
        ...(!snapshotOnly && !affected.workerChanged && statusCandidate !== undefined ? { statusCandidate } : {}) });
      return changes;
    });
    for (const change of publications) this.#emit(change);
    return {
      snapshot: publications.some(change => change.kind === "snapshot"),
      runIds: publications.flatMap(change => change.kind === "patch" ? [change.patch.target.runId] : []),
    };
  }

  /** Capture shared authority at a snapshot/reconcile boundary, including the batch revisions row patches may expose. */
  #captureSharedAuthorityFingerprint(canonicalRuns?: readonly RunRecord[], foreground = false): string {
    const facts = foreground ? undefined : this.#backgroundWorkers;
    if (facts !== undefined) {
      const members = this.#deps.authority.workerMembers?.().map(view => ({
        workerId: view.member.workerId, lifetimeId: view.lifetimeId, version: view.version,
        duoLeases: facts.leases.get(view.member.workerId) ?? [],
      }));
      const startupPending = facts.slotWorkflows.filter(workflow => this.#deps.authority.workerStartupPending?.(workflow));
      return JSON.stringify([facts.fingerprint, members, startupPending]);
    }
    const key = this.#deps.authority.changeKey?.();
    const stored = canonicalRuns === undefined && key !== undefined && this.#storedCanonical?.key === key ? this.#storedCanonical : undefined;
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
      if (key !== undefined) this.#storedCanonical = { key, ...built };
    }
    const workers = this.#deps.authority.workerMembers?.().map(view => ({ workerId: view.member.workerId, lifetimeId: view.lifetimeId, version: view.version,
      duoLeases: this.#deps.authority.heldDuoLeases?.(view.member.workerId) }));
    const writeInFlight = built.claimedIds.map((id) => [id, this.#deps.authority.writeInFlight?.(id)]);
    const members = this.#deps.authority.listWorkerSlots?.();
    const startupPending = [...new Set(members?.map(member => member.workflow))].filter(workflowId => this.#deps.authority.workerStartupPending?.(workflowId) === true);
    const samples = this.#deps.authority.listSampleWorkerSlots?.();
    const fingerprint = JSON.stringify({ members, samples, workers, writeInFlight, startupPending }) + built.storeJson;
    const batches = built.batches;
    if (!foreground || canonicalRuns !== undefined) this.#publishedBatchVersions = new Map(batches.map(({ sessionId, version }) => [sessionId, version]));
    return fingerprint;
  }

  /* ── the authority join ────────────────────────────────────────────────── */

  #operatorWait(authority: RunRecord): QueueSurfaceWire["operatorWait"] {
    const claim = runClaim(authority);
    if (claim === undefined) return { state: "absent" };
    const worker = this.#deps.authority.workerMembers?.().find(view => view.member.workerId === claim.workerId);
    if (worker?.state !== "running" || worker.activity?.runId !== authority.envelope.runId) return { state: "absent" };
    const lease = this.#deps.authority.heldDuoLeases?.(claim.workerId)[0];
    return lease === undefined ? { state: "absent" } : { state: "present", kind: "duo", ...lease };
  }

  #status(authority: RunRecord, delegationWait = this.#deps.authority.delegationWait?.(authority.envelope.runId), operatorWait = this.#operatorWait(authority)): QueueSurfaceWire["status"] {
    const status = deriveRunStatus({ ...authority, delegationWait });
    return status === "running" && operatorWait.state === "present" ? "awaiting-approval" : status;
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

  #reviewAvailable(context: QueueReadContext, runId: string): boolean {
    const cached = context.reviewAvailability?.get(runId);
    if (cached !== undefined) return cached;
    const available = this.#deps.authority.reviewAvailable?.(runId) === true;
    context.reviewAvailability?.set(runId, available);
    return available;
  }

  #runLink(context: QueueReadContext, run: RunRecord): LinkedRunView {
    const known = context.links.get(run.envelope.runId);
    if (known !== undefined) return known;
    const link: LinkedRunView = { runId: run.envelope.runId, partitionDay: LocalDateSchema.parse(searchPartitionDay(new Date(run.envelope.enqueuedAt))),
      workflowId: run.envelope.workflow, label: this.#deps.descriptors.resolve(run.envelope.workflow)?.label ?? run.envelope.workflow,
      panelKind: panelKindOf(run.envelope.shape, this.#reviewAvailable(context, run.envelope.runId)), status: this.#status(run) };
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
      ?? this.#subjectTitle(run.envelope.workflow, run) ?? this.#foldState.rows.get(run.envelope.runId)?.queued.title ?? run.envelope.runId;
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

  /** A queued row shows why its workflow's workers cannot take it. */
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
      for (const slot of active) {
        const exit = viewOf(slot.workerId)?.exit;
        if (exit?.outcome === "setup-refused" && exit.settlement === "settled") {
          return { code: exit.failureCode, summary: operatorFailureSentence(exit.failureCode) };
        }
      }
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
    const operatorWait = this.#operatorWait(authority);
    const status = this.#status(authority, delegationWait, operatorWait);
    // Nonterminal rows read no receipt; terminal facts and warnings share one read.
    const receipt = this.#receipt(context, authority, status);
    const warningVerdict = this.#warningVerdict(status, receipt);
    const descriptor = this.#deps.descriptors.resolve(queued.workflow);
    const reviewAvailable = this.#reviewAvailable(context, queued.runId);
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
      operatorWait,
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
        interrupted: authority.lifecycle.state === "terminal" && authority.lifecycle.outcome === "interrupted",
        status,
        cancelled: authority.lifecycle.state === "terminal" && authority.lifecycle.outcome === "cancelled",
        rowRevision: authority.version,
        dryRun: authority.envelope.dryRun,
        isChild: authority.envelope.parent !== undefined,
        parkedWrite: authority.lifecycle.state === "parked-write",

        memberCount: shape === "operation" ? memberChildIds.length : 0,
        isMember: shape === "operation-member",
        named: authority.displayName !== undefined,

        hasReviewPanel: descriptor?.capabilities?.review ?? false,
        batchMemberRetryAvailable: this.#deps.authority.batchMemberRetryAvailable?.(authority) === true,
        aggregateMemberRetryAvailable: this.#deps.authority.aggregateMemberRetryAvailable?.(authority) === true,
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
    if (this.#health.state === "degraded") {
      throw new ProjectionDegradedError(`the run/queue projection is degraded and refuses to serve counts: ${this.#health.lastError ?? "unknown"}`);
    }
    const parsedDay = LocalDateSchema.parse(day);
    const summaries = this.#deps.reader.summaries;
    const saved = this.#dayCache.get(parsedDay);
    const cursor = this.cursor();
    const current = saved?.wire.projectionGeneration === this.#generationValue && saved.cursor === cursor ? saved : undefined;
    const atCursor = (wire: DashboardDayWire): DashboardDayWire => wire.snapshotCursor === cursor ? wire : Object.freeze({ ...wire, snapshotCursor: cursor });
    if (current !== undefined && current.refreshedRuns.size === 0) {
      // Classify a changed journal only inside the snapshot that will consume it.
      const revision = this.#deps.authority.checkDaySources?.(parsedDay, current.sources.through);
      const now = this.#deps.clock.nowMs();
      if (revision?.kind === "unchanged" && current.builtAt <= now && now < current.validUntil) {
        current.wire = atCursor(current.wire);
        return current.wire;
      }
    }
    this.#dayCache.delete(parsedDay);
    const read = (): { wire: DashboardDayWire; cache?: CachedQueueDay } => {
      const now = this.#deps.clock.nowMs();
      // Sample the rebuild position in the same snapshot as its rows.
      const previous = current !== undefined && current.builtAt <= now && now < current.validUntil ? current : undefined;
      const revision = summaries === undefined ? undefined : this.#deps.authority.checkDaySources?.(parsedDay, previous?.sources);
      if (previous !== undefined && revision?.kind === "unchanged" && previous.refreshedRuns.size === 0) {
        const wire = atCursor(previous.wire);
        return { wire, cache: { ...previous, wire, sources: { ...previous.sources, through: revision.through } } };
      }
      let patch: QueueDayPatch | undefined;
      if (previous !== undefined && revision?.kind === "runs") {
        const affected = new Set(revision.runIds);
        if ([...previous.refreshedRuns].every(id => affected.has(id))) {
          const sameWorkers = previous.workerKey === this.#workerSurfaceKey(previous.wire.workerAuthority.members);
          patch = { previous, affected, dayRunIds: revision.dayRunIds, countDays: revision.countDays, sameWorkers };
        }
      }
      const { wire, sources, reusable } = this.#buildDashboardDayWire(parsedDay, patch);
      if (revision === undefined || wire.workerAuthority.state === "unavailable" || wire.unavailableWorkerCards !== undefined) return { wire };

      const workerKey = this.#workerSurfaceKey(wire.workerAuthority.members);
      if (typeof workerKey !== "string") return { wire };
      const validUntil = this.#deps.authority.nextDuoLeaseExpiry?.(now) ?? Infinity;
      deepFreeze(wire);
      return { wire, cache: { wire, workerKey,
        sources: { ...sources, through: revision.through, retryConfigFingerprint: revision.kind === "full"
          ? revision.retryConfigFingerprint : previous?.sources.retryConfigFingerprint }, reusable, builtAt: now, validUntil,
        cursor: wire.snapshotCursor, refreshedRuns: new Set() } };
    };
    const { wire, cache } = summaries === undefined ? read() : summaries.withSnapshot(read);
    if (cache !== undefined) {
      const oldest = this.#dayCache.keys().next().value;
      if (this.#dayCache.size >= DAY_CACHE_LIMIT && oldest !== undefined) this.#dayCache.delete(oldest);
      this.#dayCache.set(parsedDay, cache);
    }
    return wire;
  }

  /**
   * The cursor that names main's fold at the lane's position `T`. A batched fold that passed `T` names the cursor before
   * that batch, so its envelopes replay above the baseline. `ahead` until main folds `T`; `evicted` once its marks are gone.
   */
  foldCursor(position: number): FoldCursor {
    const index = this.#foldMarks.findIndex(mark => mark.position >= position);
    const mark = this.#foldMarks[index];
    if (mark === undefined) return { state: "ahead" };
    if (mark.position === position) return { state: "at", cursor: mark.after };
    if (index === 0 && this.#foldMarksEvicted) return { state: "evicted" };
    return { state: "at", cursor: mark.before };
  }

  /** Settles once main's fold has reached `position`; a rebuild that moves past it also settles it. */
  whenFolded(position: number, signal?: AbortSignal): Promise<void> {
    if (this.#timelineCursor >= position) return Promise.resolve();
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const onAbort = () => { this.#foldWaiters.delete(waiter); reject(signal?.reason instanceof Error ? signal.reason : new Error("read-aborted")); };
    const waiter = { position, resolve: () => { signal?.removeEventListener("abort", onAbort); resolve(); } };
    if (signal?.aborted === true) { onAbort(); return promise; }
    signal?.addEventListener("abort", onAbort, { once: true });
    this.#foldWaiters.add(waiter);
    return promise;
  }

  /** The day and the facts main needs from it, as the lane serves it; the lane's replica calls this inside its read snapshot. */
  buildLaneDay(day: string): { d: UnstampedDayWire; f: LaneDayFacts } {
    const builds = this.#dayBuilds;
    const wire = this.buildDashboardDayWire(day);
    return laneDayBody(wire, this.#laneFacts(wire, this.#dayBuilds > builds));
  }

  /** A lane replica's days were built with the process facts main sent before; none of them is served again. */
  processFactsChanged(): void {
    this.#dayCache.clear();
  }

  #laneFacts(wire: DashboardDayWire, built: boolean): Omit<LaneDayFacts, "patchBasis"> {
    return { position: this.#timelineCursor, built,
      surfaces: wire.queueSurfaces.map(({ runId, status, startedAt }) => ({ runId, status, startedAt })) };
  }

  /**
   * One read of the day at this dispatch. With a lane it is the lane's reply; without one it is built here, in this turn,
   * so it is current by construction.
   */
  requestDashboardDay(day: string, request: Readonly<{ slot?: Readonly<{ subscriberId: string; slot: string }>; signal?: AbortSignal }> = {}): DashboardDayRead | Promise<DashboardDayRead> {
    if (this.#health.state === "degraded") {
      throw new ProjectionDegradedError(`the run/queue projection is degraded and refuses to serve counts: ${this.#health.lastError ?? "unknown"}`);
    }
    const generation = this.#generationValue, dispatchCursor = this.#cursorValue, lane = this.#deps.dayLane;
    if (lane === undefined) {
      const builds = this.#dayBuilds;
      const wire = this.buildDashboardDayWire(day);
      const { dayJson, facts } = decodeLaneDay(JSON.stringify(laneDayBody(wire, this.#laneFacts(wire, this.#dayBuilds > builds))));
      return { dayJson, facts, generation, dispatchCursor, foldedHere: true, wire, current: () => generation === this.#generationValue };
    }
    const revision = lane.processRevision();
    return lane.read(day, request).then(reply => {
      const { dayJson, facts } = decodeLaneDay(reply.body);
      return { dayJson, facts, generation, dispatchCursor, foldedHere: false, wire: undefined,
        current: () => generation === this.#generationValue && reply.processRevision === revision && lane.processRevision() === revision };
    });
  }

  /** The stamp main gives a day read at baseline `cursor`. */
  stampDay(day: string, read: DashboardDayRead, cursor: number): string {
    return stampDashboardDay(read.dayJson, { day, descriptorHash: this.#deps.descriptorSetHash, generation: read.generation,
      cursor: ProjectionCursorSchema.parse(`pc:${String(cursor)}`) });
  }

  /**
   * `GET /api/v1/dashboard`: the same day read the stream frames, stamped at main's baseline for the lane's position. A read
   * that a generation or process-facts change overtook is asked again, at most three times.
   */
  async servedDashboardDay(day: string, request: Readonly<{ slot?: Readonly<{ subscriberId: string; slot: string }>; signal?: AbortSignal }> = {}): Promise<string> {
    const parsedDay = LocalDateSchema.parse(day);
    for (let attempt = 1; ; attempt++) {
      const read = await this.requestDashboardDay(parsedDay, request);
      if (read.foldedHere) return this.stampDay(parsedDay, read, read.dispatchCursor);
      if (read.current()) await this.whenFolded(read.facts.position, request.signal);
      if (read.current()) {
        const fold = this.foldCursor(read.facts.position);
        if (fold.state === "at") return this.stampDay(parsedDay, read, Math.max(fold.cursor, read.dispatchCursor));
      }
      if (attempt >= DAY_LANE_ATTEMPTS) throw new ProjectionDegradedError("queue-day-lane-read-overtaken");
    }
  }

  #workerSurfaceKey(members: readonly WorkerSlotRecord[]): string | { state: "unavailable" } {
    // SQLite certifies the durable slots, writes and leases. Live views and pending starts are process state.
    try {
      const views = this.#deps.authority.workerMembers?.();
      if (views === undefined) return { state: "unavailable" };
      const pending = [...new Set(members.map(member => member.workflow))]
        .filter(workflow => this.#deps.authority.workerStartupPending?.(workflow) === true);
      return JSON.stringify([views, pending]);
    } catch {
      // A missing observation disables row reuse. The worker card reader reports its own availability.
      return { state: "unavailable" };
    }
  }

  #selectedDaySurfaces(day: string, summaries: ServedSummaryQueries, context: QueueReadContext, patch?: QueueDayPatch): QueueSurfaceWire[] {
    const surfaces: QueueSurfaceWire[] = [];
    const readPage = (afterId: string | undefined, limit: number, workflow?: string) => {
      const page = summaries.queue({ fromDay: day, toDay: day, topLevel: false, limit, workflow,
        ...(afterId === undefined ? {} : { after: { localDay: day, runId: afterId } }) });
      for (const summary of page.items) context.parents.set(summary.runId, summary.parent);
      for (const summary of page.items) {
        if (summary.localDay !== day) throw new ProjectionDegradedError("queue-summary-day-mismatch");
        const authority = this.#readRun(context, summary.runId);
        const children = summary.children.map(child => this.#readRun(context, child.runId));
        const surface = this.#surface(this.#foldState.rows.get(summary.runId), authority, children, context);
        // A running run whose worker holds a Duo lease reads awaiting-approval; the stored summary cannot see the lease.
        const duoWait = summary.status === "running" && surface.status === "awaiting-approval" && surface.operatorWait.state === "present";
        if (surface.status !== summary.status && !duoWait) throw new ProjectionDegradedError("run-summary-status-stale");
        surfaces.push(surface);
      }
      return page;
    };

    const fullDay = () => {
      let afterId: string | undefined;
      do { afterId = readPage(afterId, 500).next?.runId; } while (afterId !== undefined);
      return surfaces;
    };
    if (patch === undefined || !patch.sameWorkers) return fullDay();

    const selected = patch.dayRunIds.map(runId => ({
      runId, workflowId: this.#readRun(context, runId).envelope.workflow,
    }));
    const reusable = new Map<string, QueueSurfaceWire>();
    for (const surface of patch.previous.wire.queueSurfaces) {
      if (patch.affected.has(surface.runId) || searchPartitionDay(new Date(surface.startedAt)) !== day) continue;
      selected.push({ runId: surface.runId, workflowId: surface.workflowId });
      if (patch.previous.reusable.has(surface.runId)) reusable.set(surface.runId, surface);
    }
    // The summary merger uses locale order and SQLite seeks in binary order.
    selected.sort((a, b) => a.runId.localeCompare(b.runId));
    if (selected.some((row, index) => index > 0 && selected[index - 1].runId > row.runId)) return fullDay();
    for (const [workflow, rows] of Map.groupBy(selected, row => row.workflowId)) {
      for (let start = 0; start < rows.length;) {
        const cached = reusable.get(rows[start].runId);
        if (cached !== undefined) {
          surfaces.push(cached);
          start += 1;
          continue;
        }
        let end = start + 1;
        while (end < rows.length && end - start < 500 && !reusable.has(rows[end].runId)) end += 1;
        const page = readPage(rows[start - 1]?.runId, end - start, workflow);
        if (page.items.length !== end - start || page.items.some((row, index) => row.runId !== rows[start + index].runId)) {
          throw new ProjectionDegradedError("queue-summary-membership-mismatch");
        }
        start = end;
      }
    }
    return surfaces.sort((a, b) => a.runId.localeCompare(b.runId));
  }

  #buildDashboardDayWire(parsedDay: string, patch?: QueueDayPatch): {
    wire: DashboardDayWire; sources: Omit<QueueDaySources, "through" | "retryConfigFingerprint">; reusable: ReadonlySet<string>;
  } {
    this.#dayBuilds += 1;
    const surfaces: QueueSurfaceWire[] = [];
    let fixtureRuns: readonly RunRecord[] | undefined;
    const monthPrefix = parsedDay.slice(0, 7);
    const monthFrom = `${monthPrefix}-01`;
    const monthEnd = new Date(`${monthFrom}T00:00:00.000Z`);
    monthEnd.setUTCMonth(monthEnd.getUTCMonth() + 1, 0);
    const monthTo = monthEnd.toISOString().slice(0, 10);
    const monthCounts = new Map<string, number>();
    const summaries = this.#deps.reader.summaries;
    let context: QueueReadContext;
    if (summaries !== undefined) {
      context = { ...this.#readContext(), reviewAvailability: new Map() };
      for (const surface of this.#selectedDaySurfaces(parsedDay, summaries, context, patch)) surfaces.push(surface);
      if (patch === undefined) {
        for (const [day, count] of summaries.dayCounts(monthFrom, monthTo)) monthCounts.set(day, count);
      } else {
        for (const { day, count } of patch.previous.wire.monthCounts) monthCounts.set(day, count);
        for (const day of patch.countDays) {
          if (day < monthFrom || day > monthTo) continue;
          const count = day === parsedDay ? surfaces.filter(isQueueTopLevel).length : summaries.dayCounts(day, day).get(day);
          if (count === undefined || count === 0) monthCounts.delete(day);
          else monthCounts.set(day, count);
        }
      }
    } else {
      // Explicit fixture-only compatibility. Production composition always supplies summaries.
      const runs = listCanonicalRuns(this.#deps.reader, "live");
      context = this.#readContext(runs);
      fixtureRuns = runs;
      const children = canonicalRunChildren(runs);
      for (const authority of runs) {
        const row = this.#foldState.rows.get(authority.envelope.runId);
        const rowDay = searchPartitionDay(new Date(authority.envelope.enqueuedAt));
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
          surfaces.push(this.#surface(this.#foldState.rows.get(runId), run, children.get(runId) ?? [], context));
        }
      });
    }
    const itemKey = (workflowId: string, itemId: string) => JSON.stringify([workflowId, itemId]);
    const visibleItems = new Map(surfaces.map(surface => [itemKey(surface.workflowId, surface.itemId),
      { workflowId: surface.workflowId, itemId: surface.itemId }]));
    const attempts = visibleItems.size === 0 ? [] : summaries === undefined ? fixtureRuns?.filter(candidate =>
      searchPartitionDay(new Date(candidate.envelope.enqueuedAt)) === parsedDay)
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
        || (!relatedMember && searchPartitionDay(new Date(envelope.enqueuedAt)) !== parsedDay)
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
    const sharedRuns = new Set<string>();
    const timelineRunIds = new Set<string>();
    const lastWorkerClaims: { workerId: string; cursor: number | null }[] = [];
    const presentation: RunTimelineEvidenceSource = {
      authority: this.#deps.authority,
      timeline: {
        ...this.#deps.timeline,
        page: input => {
          if (input.runId !== undefined) timelineRunIds.add(input.runId);
          return this.#deps.timeline.page(input);
        },
        lastWorkerClaim: workerId => {
          const claim = this.#deps.timeline.lastWorkerClaim(workerId);
          lastWorkerClaims.push({ workerId, cursor: claim?.cursor ?? null });
          return claim;
        },
      },
    };
    const readSharedRun: RunQueueProjectionDeps["reader"]["read"] = runId => {
      sharedRuns.add(runId);
      return this.#deps.reader.read(runId);
    };
    let workerAuthority: DashboardDayWire["workerAuthority"];
    const workerCards: DashboardDayWire["workerCards"] = [];
    const unavailableWorkerCards: NonNullable<DashboardDayWire["unavailableWorkerCards"]> = [];
    try {
      members = this.#deps.authority.listWorkerSlots?.().filter(member => member.retiredAt === null);
      const views = this.#deps.authority.workerMembers?.();
      workerAuthority = members !== undefined && views !== undefined ? { state: "present", members: [...members] }
        : { state: "unavailable", members: [...(members ?? [])], reason: "Worker membership is unavailable." };
      const samples = new Set(this.#deps.authority.listSampleWorkerSlots?.() ?? []);
      for (const member of [...members ?? [], ...samples]) {
        if (views === undefined) continue;
        // A card that cannot be built is served as unavailable; its siblings still render.
        try {
          const view = views.find(candidate => candidate.member.workerId === member.workerId);
          const runId = view?.activity?.runId;
          const lastRun = runId === undefined && (view === undefined || view.state === "exited"
            || view.state === "running" && (view.activity === undefined || view.activity.state === "idle"))
            ? this.#workerLastRun(member.workerId, readSharedRun, presentation.timeline) : undefined;
          const timelineRunId = runId ?? (lastRun?.state === "present" ? lastRun.runId : undefined);
          workerCards.push(workerCardOf({ slot: member, view, foldRevision: this.#foldState.workers.get(member.workerId)?.eventCount ?? 0,
            startupPending: !samples.has(member) && this.#deps.authority.workerStartupPending?.(member.workflow) === true,
            ...(samples.has(member) ? { sample: true } : {}),
            duoSystems: this.#deps.authority.heldDuoLeases?.(member.workerId).map(lease => lease.system),
            writeInFlight: runId => this.#deps.authority.writeInFlight?.(runId) === true,
            ...(lastRun === undefined ? {} : { lastRun }),
            ...(timelineRunId !== undefined ? { timeline: this.#workerTimeline(timelineRunId, surfaces, readSharedRun, presentation) }
              : lastRun?.state === "unavailable" && lastRun.reason === "run-unavailable" ? { timeline: { state: "unavailable", reason: "run-unavailable" } } : {}),
            resolveRun: runId => {
              const read = readSharedRun(runId);
              return read.state === "present" && read.disposition === "live" ? read.run : undefined;
            } }));
        } catch (error) {
          // A sample card is seeded data; one that cannot be built is a seed bug, never an unavailable member.
          if (samples.has(member)) throw error;
          const reason = WorkerCardUnavailableReasonSchema.safeParse(error instanceof Error ? error.message : undefined);
          unavailableWorkerCards.push({ member: workerPoolMember(member), workerId: member.workerId,
            availability: { state: "unavailable", reason: reason.success ? reason.data : "worker-card-unavailable" } });
        }
      }
    } catch (error) {
      workerAuthority = { state: "unavailable", members: [...(members ?? [])],
        reason: error instanceof Error ? error.message : "Worker authority could not be verified." };
    }

    const wire = DashboardDayWireSchema.parse({
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
    });
    const relationships = new Map<string, QueueDaySources["relationships"][number]>();
    if (patch !== undefined) {
      for (const source of patch.previous.sources.relationships) {
        if (!patch.affected.has(source.runId)) relationships.set(source.runId, source);
      }
    }
    for (const { envelope } of context.runs.values()) {
      relationships.set(envelope.runId, { runId: envelope.runId, parentId: envelope.parent?.runId ?? null,
        workflowId: envelope.workflow, itemId: envelope.itemId, day: searchPartitionDay(new Date(envelope.enqueuedAt)) });
    }
    const runIds = new Set([...relationships.keys(), ...sharedRuns]);
    const reusable = new Set<string>();
    for (const surface of surfaces) {
      const run = context.runs.get(surface.runId);
      if (run === undefined) {
        if (patch?.previous.reusable.has(surface.runId)) reusable.add(surface.runId);
      } else {
        // Review and continuation rows can read retained evidence outside their run tree.
        const review = this.#deps.descriptors.resolve(surface.workflowId)?.capabilities?.review === true
          || run.envelope.continuation !== undefined || surface.surfaceKind === "operation" && surface.recordMembers !== undefined;
        if (!review) reusable.add(surface.runId);
      }
      if (surface.surfaceKind !== "operation" || surface.recordMembers === undefined) continue;
      for (const runId of surface.recordMembers.runIds) runIds.add(runId);
      for (const member of surface.recordMembers.members) {
        runIds.add(member.kind === "record" ? member.record.runId : member.ownerRunId);
      }
    }
    return { wire, reusable, sources: { relationships: [...relationships.values()], runIds: [...runIds], timelineRunIds: [...timelineRunIds], lastWorkerClaims,
      month: { from: monthFrom, to: monthTo, counts: wire.monthCounts } } };
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

    const activityRows: ActivityReportRow[] = [];
    const people: RunSummary["person"][] = [];
    const runs = listCanonicalRuns(this.#deps.reader, "live");
    const context = this.#readContext(runs);
    const children = canonicalRunChildren(runs);
    for (const authority of runs) {
      const { envelope, lifecycle } = authority;
      const { runId, workflow, enqueuedAt } = envelope;
      const day = searchPartitionDay(new Date(enqueuedAt));
      if (day < start || day > end) continue;

      if (envelope.shape !== "operation" && workflow === "separations") {
        people.push(this.#deps.authority.canonicalPerson?.(runId)
          ?? { state: "unavailable", reason: "canonical-result-reader-unavailable" });
      }
      if (!isQueueTopLevel({ parent: this.#parentFact(context, authority) })) continue;
      const row = this.#foldState.rows.get(runId);
      const { surface, warningVerdict } = this.#surfaceFold(row, authority, children.get(runId) ?? [], context);
      const durationMs = lifecycle.state === "terminal" && surface.endedAt.state === "present"
        ? Math.max(0, Date.parse(surface.endedAt.value) - Date.parse(surface.startedAt))
        : null;
      const failureStep = surface.status === "failed"
        ? failureStepOfTaskSpans(row?.taskSpans ?? [], this.#deps.descriptors.resolve(workflow)?.timeline)
        : undefined;
      let terminal: ActivityReportRow["terminal"];
      if (lifecycle.state === "terminal") {
        terminal = { outcome: lifecycle.outcome };
        if (lifecycle.failureId !== undefined) {
          const failure = this.#deps.authority.getFailure(lifecycle.failureId);
          if (failure === undefined) {
            throw new Error(`run ${runId} settled failed against failure ${lifecycle.failureId}, which authority does not hold; `
              + "refusing to report a failure breakdown with a hole in it");
          }
          terminal.failure = failure;
        }
      }
      const completion = warningVerdict.kind === "present" ? "warnings"
        : warningVerdict.kind === "none" ? "readBack" : "warningsUnknown";
      activityRows.push({ day, enqueuedAt, workflowId: workflow, runId, parentRunId: envelope.parent?.runId ?? null,
        status: surface.status, lifecycleState: lifecycle.state, durationMs, completion,
        ...(terminal === undefined ? {} : { terminal }), ...(failureStep === undefined ? {} : { failureStep }) });
    }

    const generatedAt = this.#deps.clock.now().toISOString();
    return buildActivityReport({
      from: start, to: end, generatedAt, rows: activityRows, people, descriptors: this.#deps.descriptors,
      assistantUsage: () => {
        if (this.#deps.assistantUsage === undefined) throw new Error("assistant-usage-source-unavailable");
        return this.#deps.assistantUsage(start, end, generatedAt);
      },
      ledger: () => this.#deps.ledger.foldActivityRange(start, end),
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
