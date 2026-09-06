import { retainedRunProtectedBindings } from "../../../domain/protected-input.js";
import { hasProtectedTransactionInput } from "../../../domain/protected-input.js";
/**
 * THE run/queue projection — the single server-side read model every surface
 * renders (ref dashboard-surfaces §2.2/§2.3, D81 §10.1).
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
 * for parked/terminal, `version` as the row's CAS revision). The
 * folded rows are persisted to the rebuildable `runs_view` projection table;
 * deleting that table loses nothing — `rebuildFromJsonl` is the
 * `rebuild-from-native-jsonl` recovery class.
 *
 * Failure policy (ref dashboard-surfaces §2.3): JSONL append happens BEFORE any fold sees the
 * event — structurally, because the fold only reads the file. A failing fold
 * or an unparsable tailed line marks the projection degraded and schedules a
 * guarded rebuild — never a skip, and never a throw into the emitting path. A
 * rebuild that itself fails leaves the projection loudly degraded (health
 * carries the exact error); it never serves a half-folded day as healthy.
 *
 * Closed vocabulary mappings, and where they live (D268). This projector no
 * longer OWNS them: `deriveRunStatus` (run → status), `taskStateOf` (task span
 * → step state) and `panelKindOf` are one implementation each in
 * `../run-status.ts`, which the run-detail query reads too — a queue row and
 * the panel that opens from it cannot report a run differently, because there
 * is one function. The task map changed shape when it moved: a
 * `cancelled|discarded|superseded` span now reads `cancelled` on the chip as
 * well as on the timeline step, where the pipeline used to say `blocked`.
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
  ACTIVITY_SAMPLE_LIMIT,
  ActivityReportWireSchema,
  type ActivityLedgerBlock,
  type ActivityReportWire,
  type ActivityWorkflowTotal,
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
import type { ActivityPersonPseudonymEvidence } from "../../../domain/trust/activity-person-pseudonym.js";
import {
  projectReceiptForOperator,
  type OperatorReceiptProjection,
  type RunEvidenceReceipt,
} from "../../../domain/trust/evidence.js";
import {
  projectFailureForOperator,
  type FailureRecord,
} from "../../../domain/trust/failure.js";
import { deriveSchemaHash } from "../../../domain/schema-bound-value.js";
import { sha256Hex } from "../../../domain/sha256.js";
import { SpanEventWireSchema, type RunQueuedWire, type SpanEventWire } from "../../../events/types.js";
import type { RunCheckpointRecord } from "../../../domain/workflow/checkpoint.js";
import type { WorkerLeaseRecord } from "../../../domain/run/worker.js";
import type { WorkerPoolRecord } from "../../../domain/run/worker-pool.js";
import { queueRowActions } from "./queue-row-actions.js";
import { resolveSubjectTitle } from "./run-subject-title.js";
import { workerCardOf, type WorkerBrowserFold } from "./worker-cards.js";
import type { ProjectionRepositories } from "../../../infra/sqlite/authority-database.js";
import { readEventStreamLinesFrom, type EventStreamFileCursor, type EventStreamLine } from "../../../infra/events/jsonl-streams.js";
import { browserSessionOfSpanPath, nodeIdOfTaskSpanPath } from "../support.js";
import { deriveRunStatus, panelKindOf, taskStateOf, type TaskExecutionState } from "../run-status.js";
import { ProjectionDegradedError, TargetNotFoundError } from "../../failures.js";

/* ── the persisted fold shape (internal, versioned by its own schema hash) ─ */

const TaskSpanFoldSchema = z.strictObject({
  /**
   * Span identity is `(runId, attempt, spanPath)` (ref dashboard-surfaces §1.1), and the
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
  /**
   * D248 — the browser sessions this worker has OPEN, keyed by session id in
   * the order they started. A close deletes its entry rather than marking it,
   * because the tile grid states what a worker is holding: a session that has
   * closed is not one, and keeping the row would grow without bound over a
   * long-lived worker that opens a fresh session per fresh boundary.
   */
  browsers: Map<string, WorkerBrowserFold>;
  eventCount: number;
}

/* ── dependencies ────────────────────────────────────────────────────────── */

export interface RunQueueProjectionDeps {
  readonly stateRoot: string;
  readonly clock: Clock;
  readonly appVersion: string;
  /** One fingerprint over the registered descriptor set — ref workflow-model's skew tripwire. */
  readonly descriptorSetHash: Fingerprint;
  /**
   * D236 — the ONE second authority this projection reports beside its own
   * totals: the write ledger's fold over the Activity range.
   *
   * It is a PORT, not a count this class computes, and that is the whole shape
   * of the carve-out. Every other number `buildActivityReportWire` serves is
   * folded from `#rows` in the loop below; this block arrives already folded
   * from `src/infra/ledger/`, an append-only audit corpus whose entries outlive
   * the runs that filed them (ref dashboard-surfaces §10.1/§10.2 rule 1). Nothing here
   * reconciles the two — a cross-check would assert they cover the same rows,
   * and they do not.
   */
  readonly ledger: {
    foldActivityRange(from: string, to: string): ActivityLedgerBlock;
  };
  /** Narrow authority read view; the projection never mutates authority. */
  readonly authority: {
    getRun(runId: string): RunRecord | undefined;
    /** 2i-B: the durable inbox rows the day wire serves. */
    listNotifications(actorId: string): readonly z.infer<typeof NotificationRecordSchema>[];
    /**
     * D248: the Session Panel's card set. Two reads, because the panel answers
     * two questions — every worker that EXISTS right now (`listLive`), and the
     * settled lease behind a worker the retained span stream still names
     * (`get`). Ref execution-and-sessions §3 gives the lease this job explicitly, so the projector
     * no longer infers phase from whichever rows happen to be claimed.
     */
    listLiveWorkerLeases(): readonly WorkerLeaseRecord[];
    getWorkerLease(workerId: string): WorkerLeaseRecord | undefined;
    /** D269: every workflow's pool declaration — the spawn control's CAS basis, served from authority. */
    listWorkerPools(): readonly WorkerPoolRecord[];
    /**
     * D179/D80: whether a version bump has archived this run. Ref dashboard-surfaces §10.1 is
     * explicit that archived rows are excluded ONCE, inside the projection,
     * alongside member containment — so an archived run leaves the queue, the
     * workflow badge, the status pill, the month calendar and the Activity
     * report at the same instant, by construction. Since D234 it is the ONLY
     * exclusion of a whole run: there are runs and archived runs, and nothing
     * else takes a row off the queue.
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
    /**
     * D288: the only identity authority Activity may count. This read is
     * intentionally range-scoped by the exact served Separations run ids;
     * receipts are still read for the independent warning/Unread axis only.
     */
    listActivityPersonPseudonyms(runIds: readonly string[]): readonly ActivityPersonPseudonymEvidence[];
    /**
     * Ref workflow-model §5.7's "latest compatible attempt wins" read, for the ONE fact the
     * row derives from a stored node output: the subject's display name, at the
     * leaf the descriptor declares (ref dashboard-surfaces §1.2, `run-subject-title.ts`).
     *
     * It is read here rather than folded from a span because the fold has no
     * such fact to offer: D254 retired the `span.patched` detail channel — a
     * declared vocabulary with zero production emitters — so `row.details` no
     * longer exists in either direction. The checkpoint is the record the
     * identity chunk actually writes, and the only stored node output this row
     * reads.
     */
    latestCheckpoint(
      workflowId: string,
      itemId: string,
      nodeId: string,
    ): RunCheckpointRecord | undefined;
  };
  readonly descriptors: { resolve(workflowId: string): AnyWorkflowDescriptor | undefined };
  /** The rebuildable projection tables (ref dashboard-surfaces §2.3). */
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

export type ProjectedRunLogEvent = Extract<SpanEventWire, { t: "data.observed" | "transaction.fenced" }>;

export interface ProjectedRunLogEntry {
  readonly line: EventStreamLine;
  readonly event: ProjectedRunLogEvent;
  /** Append-fold revision within this projection generation. */
  readonly revision: number;
}

export interface ProjectedRunLogSnapshot {
  readonly projectionGeneration: number;
  readonly snapshotRevision: number;
  readonly entries: readonly ProjectedRunLogEntry[];
}

interface ParsedSpanLine {
  readonly line: EventStreamLine;
  readonly event: SpanEventWire;
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

/**
 * What the run's evidence receipt says about its warnings, before either
 * consumer renders it (D22/D126). `unread` is a run with NO derived receipt —
 * distinct from `none`, which is a receipt that recorded nothing, and the
 * distinction is the whole reason this is a tagged verdict rather than a
 * count: an aggregate that folded `unread` into `none` would report a run
 * nobody checked as a run that came back clean.
 */
/**
 * The receipt a row reads, or `undefined` for a row whose receipt was never
 * derived. It is read ONCE per surface (D5): `#facts` and `#warnings` each used
 * to call `getReceipt` for themselves, which was two authority statements per
 * terminal row on every day wire and every resnapshot for one row's worth of
 * facts. Passing the value keeps both readings of one receipt provably the same
 * receipt, which re-reading never guaranteed.
 */
type ReceiptView = OperatorReceiptProjection;

type WarningVerdict =
  | { kind: "not-terminal"; status: QueueSurfaceWire["status"] }
  | { kind: "unread" }
  | { kind: "withheld"; reason: string }
  | { kind: "none" }
  | { kind: "present"; count: number; first: string };

/**
 * The internal result of one queue-surface fold. The public wire carries only
 * `surface`; Activity retains the safe receipt verdict so its aggregate does
 * not re-read or re-project the same terminal receipt.
 */
interface SurfaceFold {
  readonly surface: QueueSurfaceWire;
  readonly warningVerdict: WarningVerdict;
}

/**
 * The Activity report's per-workflow bucket for one surface — TOTAL over the
 * closed `QueueStatus` vocabulary, so a status this projector does not produce
 * today still lands somewhere rather than being dropped out of a row's own
 * partition. `done` splits three ways on the warning verdict above.
 */
const ACTIVITY_STATUS_BUCKET = {
  done: "completion",
  failed: "failed",
  cancelled: "cancelled",
  partial: "partial",
  queued: "open",
  running: "open",
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

/**
 * D288's one Activity identity fold. It deliberately does not return an
 * individual pseudonym or generation: those are authority-only evidence.
 * `evidenceRows` reports rows with one locally valid evidence record, while
 * `unavailableRows` reports target rows that lack one. A range can still be
 * absent with zero unavailable rows when its locally complete rows span more
 * than one generation; that is not a missing row, it is an incomparable set.
 */
function activityPeopleOf(
  personRows: readonly RunRecord[],
  evidence: readonly ActivityPersonPseudonymEvidence[],
) {
  if (personRows.length === 0) return { state: "present" as const, distinct: 0, evidenceRows: 0 };

  const expectedRunIds = new Set(personRows.map((row) => row.envelope.runId));
  const rowsByRun = new Map<string, ActivityPersonPseudonymEvidence[]>();
  let foreignEvidence = 0;
  for (const record of evidence) {
    if (!expectedRunIds.has(record.runId) || record.workflowId !== "separations") {
      foreignEvidence += 1;
      continue;
    }
    const records = rowsByRun.get(record.runId) ?? [];
    records.push(record);
    rowsByRun.set(record.runId, records);
  }

  const compatible = new Map<string, ActivityPersonPseudonymEvidence>();
  let unavailableRows = 0;
  let duplicateRows = 0;
  let multiGenerationRows = 0;
  for (const runId of expectedRunIds) {
    const records = rowsByRun.get(runId) ?? [];
    const generations = new Set(records.map((record) => record.keyGeneration));
    if (records.length === 0) {
      unavailableRows += 1;
      continue;
    }
    if (generations.size > 1) {
      multiGenerationRows += 1;
      unavailableRows += 1;
      continue;
    }
    if (records.length !== 1) {
      duplicateRows += 1;
      unavailableRows += 1;
      continue;
    }
    compatible.set(runId, records[0]);
  }

  const evidenceRows = compatible.size;
  const generations = new Set([...compatible.values()].map((record) => record.keyGeneration));
  const absent = (reason: string) => ({
    state: "absent" as const,
    evidenceRows,
    unavailableRows,
    reason,
  });
  if (foreignEvidence > 0) {
    return absent(`${String(foreignEvidence)} pseudonym evidence row${foreignEvidence === 1 ? " is" : "s are"} outside the served current Separations run/member range; distinct people is unavailable`);
  }
  if (unavailableRows > 0) {
    const cause = multiGenerationRows > 0
      ? `${String(multiGenerationRows)} run/member row${multiGenerationRows === 1 ? " carries" : "s carry"} more than one pseudonym key generation`
      : duplicateRows > 0
        ? `${String(duplicateRows)} run/member row${duplicateRows === 1 ? " carries" : "s carry"} more than one pseudonym evidence row for one generation`
        : `${String(unavailableRows)} of ${String(personRows.length)} current Separations run/member rows lack pseudonym evidence`;
    return absent(`${cause}; distinct people is unavailable`);
  }
  if (generations.size !== 1) {
    return absent("current Separations run/member rows use mixed pseudonym key generations; distinct people is unavailable");
  }
  return {
    state: "present" as const,
    distinct: new Set([...compatible.values()].map((record) => record.pseudonym)).size,
    evidenceRows,
  };
}

/**
 * How many members a group's preview names before it says `+N more`. Three is
 * the demo's own number and it is a LAYOUT fact, not a policy one: the preview
 * shares one line with the group's title.
 */
const MEMBER_PREVIEW_LIMIT = 3;

/**
 * One entry of a row's `linkedRuns`, before `QueueSurfaceWireSchema.parse`
 * brands its identities. Declared here rather than reused off the wire type for
 * the reason every other value in `#surface` is built plain: the schema is what
 * turns a composed object into a served one, and a builder that already held
 * branded ids would be claiming the parse it has not run.
 */
interface LinkedRunView {
  readonly runId: string;
  readonly workflowId: string;
  readonly label: string;
  readonly panelKind: "run" | "member" | "group";
  readonly status: string;
}

/**
 * The lease facts `workerCardOf` renders, canonicalised for change detection:
 * identity, phase and its instants, the stop reason, the directive, and the
 * launch-time browser systems. `heartbeatAt`, `updatedAt` and `version` move
 * on every heartbeat and are left out on purpose — counting them would
 * republish every live card every beat. `version` IS served (`leaseVersion`),
 * but the worker directive commands re-read the current lease in the kernel
 * rather than compare-and-swap on the served value, so a `leaseVersion` that
 * trails a heartbeat between snapshots changes no write. Insertion order is
 * the caller's sorted order, so equal sets fingerprint equal.
 */
function workerLeaseFingerprintOf(leases: ReadonlyMap<string, WorkerLeaseRecord>): string {
  const facts = [...leases.values()]
    .sort((a, b) => a.workerId.localeCompare(b.workerId))
    .map((lease) => ({
      workerId: lease.workerId,
      workflow: lease.workflow,
      leaseGeneration: lease.leaseGeneration,
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
  readonly #foldSchemaHash: Fingerprint;
  /**
   * The D218 tail state: how far into each `spans/` file this projection has
   * folded, in bytes-through-the-last-newline. Seeded by `rebuildFromJsonl`
   * (so a rebuild and the tail can never double-fold a line) and advanced
   * only by `ingestFromDisk`.
   */
  #spanCursors: ReadonlyMap<string, EventStreamFileCursor> = new Map();
  /**
   * The Session Panel's authority facts as of the last reconcile — the
   * card-relevant lease facts plus the pool declarations — so a transition no
   * span carries (a lease born before its first span, `starting` → `idle`
   * from the maintenance ticker, an operator directive, a crash or expiry
   * settled by another process, a `plan-worker-count`) reaches subscribers.
   */
  #workerAuthorityFingerprint: string;
  #cursorValue = 0;
  #generationValue: number;
  #health: RunQueueProjectionHealth = { state: "live" };

  constructor(deps: RunQueueProjectionDeps) {
    this.#deps = deps;
    this.#generationValue = Math.max(1, Math.trunc(deps.clock.nowMs()));
    this.#foldSchemaHash = deriveSchemaHash(RunFoldRecordSchema, "output");
    this.#workerAuthorityFingerprint = this.#workerAuthorityFingerprintOf();
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
   * Observed/fenced rows indexed by the append-time disk tail. A logs query
   * never reconstructs this list from run-instant partitions.
   */
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
      for (const { event, line } of events) {
        const affected = this.#fold(event);
        this.#cursorValue += 1;
        this.#recordRunLog(event, line);
        this.#persist(affected.runIds);
        this.#notify(affected);
      }
    } catch (error) {
      this.#degrade(`span tail ingest failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * The Session Panel's card set and pool declarations are AUTHORITY's
   * (D248/D269), but every change trigger above is a span. A lease moves
   * without a span when a worker process writes `starting`, when its
   * maintenance ticker settles `idle`, when an operator directive lands, and
   * when a crash or expiry is settled by whichever process observed it; a
   * pool row moves on `plan-worker-count`, which emits no span either. So the
   * same tick that tails the span files re-reads exactly what the day wire
   * renders from those two tables and publishes a snapshot when a served fact
   * moved. Heartbeat instants and the versions they bump are not card facts
   * and are excluded on purpose: counting them would republish every live
   * card every beat.
   */
  reconcileWorkerAuthority(): void {
    if (this.#health.state === "degraded") return;
    try {
      const fingerprint = this.#workerAuthorityFingerprintOf();
      if (fingerprint === this.#workerAuthorityFingerprint) return;
      this.#workerAuthorityFingerprint = fingerprint;
      this.#cursorValue += 1;
      this.#notify({ runIds: [], workerChanged: true });
    } catch (error) {
      this.#degrade(`worker lease reconcile failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Ref dashboard-surfaces §2.3's failure policy, shared by every ingest path: degraded
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
  #parseSpanLines(lines: readonly EventStreamLine[]): readonly ParsedSpanLine[] {
    const events = lines.map((line) => {
      try {
        return { line, event: SpanEventWireSchema.parse(JSON.parse(line.text)) };
      } catch (error) {
        throw new Error(
          `corrupt span line ${line.file.path}:${String(line.lineNumber)}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    });
    return events.sort((a, b) => a.event.ts.localeCompare(b.event.ts));
  }

  #recordRunLog(event: SpanEventWire, line: EventStreamLine): void {
    if (event.t !== "data.observed" && event.t !== "transaction.fenced") return;
    const entries = this.#runLogs.get(event.runId) ?? [];
    if (!this.#runLogs.has(event.runId)) this.#runLogs.set(event.runId, entries);
    entries.push(Object.freeze({ event, line, revision: this.#cursorValue }));
  }

  /** The `rebuild-from-native-jsonl` recovery class: clear, re-read, re-fold. */
  rebuildFromJsonl(): void {
    try {
      const whole = readEventStreamLinesFrom(this.#deps.stateRoot, "spans", new Map());
      const events = this.#parseSpanLines(whole.lines);
      this.#rows.clear();
      this.#workers.clear();
      this.#runLogs.clear();
      this.#notifiedStatus.clear();
      const touched = new Set<string>();
      this.#cursorValue = 0;
      for (const { event, line } of events) {
        for (const runId of this.#fold(event).runIds) touched.add(runId);
        this.#cursorValue += 1;
        this.#recordRunLog(event, line);
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
      this.#cursorValue = Math.max(1, this.#cursorValue);
      this.#health = { state: "live" };
      this.#workerAuthorityFingerprint = this.#workerAuthorityFingerprintOf();
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
   * (rename/bump/cancel). The surface is rebuilt from the same
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
      // D248: the tile grid's row. A browser span whose identity cannot be read
      // is a PRODUCER defect — `browserSessionSpanPath` composes both halves on
      // every emit — so it degrades this projection by name rather than being
      // folded as a session with a guessed system or id.
      const session = browserSessionOfSpanPath(event.spanPath, event.system);
      worker.browsers.set(session.sessionId, { ...session, openedAt: event.ts });
      worker.eventCount += 1;
      return { runIds: [], workerChanged: true };
    }

    /**
     * D210 — `transaction.previewed`. The JSONL stream carries it (ref task-contract §6.2)
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

    /**
     * The durable-fence beat is transaction detail, not a task settlement.
     * `#recordRunLog` indexes it for the run-detail query; this QUEUE fold
     * ignores it explicitly so it cannot masquerade as task settlement.
     */
    if (event.t === "transaction.fenced") return { runIds: [], workerChanged: false };

    /**
     * D270 — `data.observed`. The queue row's vocabulary is task spans and
     * terminal outcomes; a recorded page observation is neither, and folding it
     * into a span it is not would be D123's collapse by another route. It is
     * therefore IGNORED BY THE QUEUE FOLD rather than by falling through, while
     * `#recordRunLog` retains it in the append-time per-run log index. Keeping
     * those jobs separate prevents an observation from becoming queue state and
     * prevents the logs GET from reconstructing append partitions from record
     * time.
     */
    if (event.t === "data.observed") return { runIds: [], workerChanged: false };

    // span.ended
    if (event.kind === "task") {
      const row = this.#row(event.runId, event.t);
      /**
       * D255 — a close binds to the LAST STILL-OPEN entry at this identity,
       * never to the first entry at its key. The two differ only when a
       * producer emits the same `(attempt, spanPath)` twice, and where that
       * happens the first-match rule does not undercount, it FABRICATES: entry
       * one keeps its own `startedAt` and takes execution two's `endedAt`, so
       * the chip reports a duration spanning both executions and everything
       * between them (a gate park is hours), while execution two's entry stays
       * open and is dropped as unmeasured. Binding to an open entry keeps each
       * execution a fact about ITSELF — D123/D214's rule, applied at the fold.
       */
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
        // A restart may close a span an earlier process opened; the open time
        // is genuinely unknown and stays absent rather than being invented.
        // The same arm carries a close whose identity is already CLOSED here:
        // a second measured execution is appended rather than overwriting the
        // first, because rewriting a measured span's end is the fabrication
        // above by another route.
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
      // A closed session is not a browser this worker holds — including a
      // poison close, which is a session that ended badly rather than one that
      // is still there to act on (ref execution-and-sessions §1: closure is OBSERVED, and this is
      // the observation).
      else worker.browsers.delete(browserSessionOfSpanPath(event.spanPath).sessionId);
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
   * transition, an archive) becomes a fresh SNAPSHOT, which is why the client's
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
      // Archiving is count-bearing: the row leaves the payload, so the client
      // is handed a fresh snapshot rather than a patch that could only describe
      // a row that is no longer there.
      if (this.#deps.authority.isArchived(runId)) {
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

  /**
   * D248 — the card set is AUTHORITY's, not the span stream's.
   *
   * Every live lease is a card, because a live lease is a worker that exists
   * whether or not this process has tailed a single one of its spans. A
   * settled lease is a card only while the span stream still names its
   * worker: that keeps a crashed worker on screen exactly as long as the
   * evidence of its run is retained (`pruneEventStreams`), and stops the
   * panel accumulating one card per worker id ever started, which is the
   * cardinality a bare listing of the lease table would have.
   *
   * A worker the SPANS name and authority does not is deliberately not a
   * card: authority is what says a worker exists, and drawing one from a
   * pruned-authority stream would be the panel inventing a daemon.
   *
   * `buildDashboardDayWire` renders exactly this map and
   * `reconcileWorkerAuthority` fingerprints exactly this map (with the pools), so a card can never
   * be drawn from one lease set and watched from another.
   */
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

  /** Leases as the cards render them, plus pool declarations as the wire serves them. */
  #workerAuthorityFingerprintOf(): string {
    const pools = this.#deps.authority.listWorkerPools().map((pool) => ({
      workflowId: pool.workflow,
      desiredWorkers: pool.desiredWorkers,
      version: pool.version,
      plannedBy: pool.plannedBy,
      plannedAt: pool.plannedAt,
    }));
    return JSON.stringify({ leases: workerLeaseFingerprintOf(this.#cardLeases()), pools });
  }

  /* ── the authority join ────────────────────────────────────────────────── */

  #authorityRun(runId: string): RunRecord {
    const record = this.#deps.authority.getRun(runId);
    if (record === undefined) {
      throw new TargetNotFoundError(
        `run ${runId} exists in the span stream but not in authority; the projection refuses to render an unaccounted run`,
      );
    }
    return record;
  }

  #status(row: RunFoldRecord, authority: RunRecord): z.infer<typeof QueueSurfaceWireSchema>["status"] {
    return deriveRunStatus(row, authority);
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
    return { state: "present", value: projectFailureForOperator(failure, retainedRunProtectedBindings(authority).length > 0).summary };
  }

  /**
   * D22/D126: the REAL warning count behind the `△ N` chip, plus the first
   * warning's own sentence for its title.
   *
   * The warning set lives on the run's evidence receipt (ref operator-trust's uncertainty
   * evidence) — the terminal result record stores the workflow's declared
   * result and knows nothing about uncertainty. The read is a plain lookup of
   * an already-derived receipt: deriving one here would make rendering a queue
   * write authority (D141), and this projection never mutates authority.
   *
   * Three distinct absences, never collapsed into a zero: the run has not
   * settled, no receipt has been derived, or the receipt records no warning.
   *
   * The verdict is derived ONCE, here, and rendered twice — as this row's chip
   * arm and as the Activity report's completion split — so the `△ N` an
   * operator reads on a row and the `Warnings` column a supervisor reads in the
   * report cannot come to two different conclusions about the same run. The
   * report needs the three absences KEPT APART, and reason-string matching
   * would be a second classifier wearing a comparison.
   */
  #warningVerdict(status: QueueSurfaceWire["status"], receipt: ReceiptView | undefined): WarningVerdict {
    if (!TERMINAL_QUEUE_STATUSES.has(status)) return { kind: "not-terminal", status };
    if (receipt === undefined) return { kind: "unread" };
    if (receipt.state === "withheld") return { kind: "withheld", reason: receipt.reason };
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

  /**
   * Ref dashboard-surfaces §1.2: the subject's name, once this run has resolved one.
   *
   * The whole decision lives in `run-subject-title.ts` — a declared address,
   * one checkpoint read, no per-workflow branch — so the queue row and the
   * run-detail header cannot come to two different conclusions about who a run
   * is about. `undefined` means *keep the composed title*, and it covers the
   * three honest reasons for that: the workflow declares no subject leaf, the
   * declared node has no checkpoint yet, or the leaf's union arm was not taken.
   *
   * A workflow with no registered descriptor in this build resolves nothing,
   * exactly as `#pipeline` shows only observed nodes for one: a build that
   * cannot read the declaration must not invent an address into it.
   */
  #subjectTitle(workflowId: string, authority: RunRecord): string | undefined {
    return resolveSubjectTitle(
      this.#deps.descriptors.resolve(workflowId)?.subjectProjection,
      { workflowId, itemId: authority.envelope.itemId },
      this.#deps.authority,
    );
  }

  #pipeline(row: RunFoldRecord): QueueSurfaceWire["pipeline"] {
    const descriptor = this.#deps.descriptors.resolve(row.queued.workflow);
    const spanByNode = new Map<string, z.infer<typeof TaskSpanFoldSchema>>();
    /**
     * Every execution of each node, not just the last one. `spanByNode` above
     * is deliberately latest-wins — one node draws ONE chip, and two chips for
     * one step would show it in two states at once — but the chip's DURATION is
     * time spent on the step, which a node re-executed across a gate resume
     * (D214) genuinely spent twice. Two maps, two questions.
     */
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
    /**
     * The measured half of a step, in the same shape the run-detail timeline
     * computes it (`spanDuration` there) — and with the same refusals. A span
     * with no end, no folded start, unreadable instants, or an end before its
     * start contributes NOTHING; a step where nothing measured carries no
     * duration at all rather than a zero, because zero is a measurement and
     * "unmeasured" is not.
     */
    const stepMeasurement = (nodeId: string): { durationSec?: number; executions?: number } => {
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
        ...(measured ? { durationSec: Math.round(ms / 1000) } : {}),
        ...(executions.length >= 2 ? { executions: executions.length } : {}),
      };
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
      return [...observed].map(([id, { label, span }]) => ({
        id,
        label,
        state: stepState(span),
        ...stepMeasurement(id),
      }));
    }
    return descriptorRuntimeNodes(descriptor)
      .filter((node) => node.kind === "task" || node.kind === "transaction" || node.kind === "child-run")
      .map((node) => ({
        id: String(node.id),
        label: String(node.id),
        state: stepState(spanByNode.get(String(node.id))),
        ...stepMeasurement(String(node.id)),
      }));
  }

  /**
   * D230: this run's ordinal within its workflow, read from AUTHORITY.
   *
   * It is never derived here and there is deliberately no fallback. A number
   * computed from this row's position in the day's sorted array would be a
   * different number on a different day's page for the same run, which is
   * exactly the defect the durable field exists to remove — so a run enqueued
   * before schema v15 reports its absence with the reason, and the footer draws
   * its trace id instead.
   */
  #runNumber(authority: RunRecord): { state: "present"; value: number } | { state: "absent"; reason: string } {
    return authority.runNumber === undefined
      ? { state: "absent", reason: "enqueued before runs carried a workflow ordinal (D230)" }
      : { state: "present", value: authority.runNumber };
  }

  /** D269: membership is the run row's own field — never a lookup in a stored member list. */
  #session(authority: RunRecord): { state: "present"; sessionId: string } | { state: "absent"; reason: string } {
    return authority.sessionId === undefined
      ? { state: "absent", reason: "this run predates D269 session grouping, or retries a run that does" }
      : { state: "present", sessionId: authority.sessionId };
  }

  /**
   * How this row is contained by its parent.
   *
   * The whole decision is the run's own SHAPE plus its lineage, both of which
   * are write-once identity attributes on the `run.queued` span — never the
   * workflow id, which ref frontend-backend-integration §1.1 names as the inference this must not be.
   * A parented run whose shape is `operation-member` is the row a group counts;
   * any other parented run keeps its own row in its own panel and its parent
   * shows a chip.
   */
  #containment(queued: RunQueuedWire): "root" | "member" | "linked" {
    if (queued.parentRunId === undefined) return "root";
    return queued.shape === "operation-member" ? "member" : "linked";
  }

  /**
   * The runs this row delegated to and is waiting on — the parent's half of
   * `containment: "linked"`.
   *
   * Read from the SAME child set the member rollup reads (`row.memberRunIds`,
   * folded from each child's `run.queued.parentRunId`), partitioned by the
   * child's own shape, so the two lists are disjoint by construction: a row a
   * group counts is never also a chip on that group, and a chip is never also
   * counted. Each entry carries the target's live status, resolved through the
   * SAME `#status` every row's own status comes from — the client re-deriving
   * it from the day payload would be the second status path D81 deletes, and it
   * would go blank the moment the target sat on another day.
   *
   * A child the fold has not seen yet is skipped rather than guessed at: a chip
   * that named a run and could not say what it was doing would be a link to a
   * status nobody computed.
   */
  #linkedRuns(row: RunFoldRecord): readonly LinkedRunView[] {
    const linked: LinkedRunView[] = [];
    for (const childId of row.memberRunIds) {
      const child = this.#rows.get(childId);
      if (child === undefined || child.queued.shape === "operation-member") continue;
      const childDescriptor = this.#deps.descriptors.resolve(child.queued.workflow);
      linked.push({
        runId: child.queued.runId,
        workflowId: child.queued.workflow,
        // The workflow id is the honest stand-in when this build cannot resolve
        // the descriptor: it is what the run IS, not a guessed pretty name.
        label: childDescriptor?.label ?? child.queued.workflow,
        panelKind: panelKindOf(child.queued.shape),
        status: this.#status(child, this.#authorityRun(childId)),
      });
    }
    return linked;
  }

  /**
   * The first few members BY NAME — the group's `memberPreview`.
   *
   * Composed from the member rows' OWN titles, resolved through the same
   * `#subjectTitle`-or-composed-title rule their rows draw, so a preview can
   * never name somebody the group does not contain or spell a subject two ways.
   * The count in the `+N more` tail comes off the same list as the rollup.
   *
   * D5 (ref frontend-backend-integration §7.4, audit P2): the SLICE happens before the JOIN.
   * Deciding which members exist is a Map lookup per id and costs nothing;
   * NAMING one is an authority `getRun` plus a checkpoint read, and a
   * 108-member operation resolved all 108 to print three — 216 SQLite
   * statements per group row, on every day wire and every resnapshot. Only the
   * members that can appear are named; the `+N more` tail still counts the
   * whole seen set, because the count is what the rollup is about.
   *
   * One consequence is deliberate and worth naming: `#authorityRun` refuses a
   * member the span stream knows and authority does not, and that refusal now
   * fires for the named few rather than for all of them. Nothing is weakened —
   * the member's OWN row runs the same join through `#surface`, so an
   * unaccounted run is still refused where it is rendered; the preview simply
   * stops re-proving it 108 times.
   */
  #memberPreview(
    memberIds: readonly string[],
  ): { state: "present"; value: string } | { state: "absent"; reason: string } {
    if (memberIds.length === 0) {
      return { state: "absent", reason: "this group has fanned out to no members yet" };
    }
    const seen: { readonly memberId: string; readonly member: RunFoldRecord }[] = [];
    for (const memberId of memberIds) {
      const member = this.#rows.get(memberId);
      if (member !== undefined) seen.push({ memberId, member });
    }
    if (seen.length === 0) {
      return {
        state: "absent",
        reason: `this group names ${String(memberIds.length)} member(s) the span fold has not seen, so none can be named`,
      };
    }
    const shown = seen.slice(0, MEMBER_PREVIEW_LIMIT).map(({ memberId, member }) =>
      this.#subjectTitle(member.queued.workflow, this.#authorityRun(memberId)) ?? member.queued.title);
    const remaining = seen.length - shown.length;
    return {
      state: "present",
      value: remaining > 0 ? `${shown.join(", ")} +${String(remaining)} more` : shown.join(", "),
    };
  }

  /**
   * D7: what this run PRODUCED, in the words its receipt uses.
   *
   * The same plain `getReceipt` lookup `#warnings` does — never `ensureReceipt`,
   * because D141 makes derivation an act that persists a row and this
   * projection never mutates authority. The receipt's `output` facts ARE the
   * flattening the Receipt tab prints, so reading them here is what keeps the
   * chip on the row and the row in the tab from being two derivations of one
   * result.
   *
   * A leaf becomes a chip only when its redacted value is `allowed` AND a JSON
   * primitive. The redaction half is not negotiable: the queue is on screen all
   * day and gets screenshotted into tickets, so it is the last surface that may
   * print a dropped or transformed value. The primitive half is honesty about
   * shape — an object or array is not a chip, and flattening one into a string
   * would author a presentation the receipt never did. Both exclusions are
   * COUNTED into the absent reason rather than silently swallowed.
   */
  #facts(
    status: QueueSurfaceWire["status"],
    receipt: ReceiptView | undefined,
  ): { state: "present"; value: readonly { label: string; value: string }[] } | { state: "absent"; reason: string } {
    if (!TERMINAL_QUEUE_STATUSES.has(status)) {
      return { state: "absent", reason: `run is ${status} and has not produced a terminal result` };
    }
    if (receipt === undefined) {
      return {
        state: "absent",
        reason: "no evidence receipt has been derived for this run, so its outputs are unknown",
      };
    }
    if (receipt.state === "withheld") {
      return { state: "absent", reason: receipt.reason };
    }
    if (receipt.value.output.length === 0) {
      return { state: "absent", reason: "this run's evidence receipt records no output fact" };
    }
    const chips: { label: string; value: string }[] = [];
    let withheld = 0;
    for (const fact of receipt.value.output) {
      if (fact.state !== "satisfied" || fact.value.state !== "allowed") {
        withheld += 1;
        continue;
      }
      const { value } = fact.value;
      if (typeof value === "string") chips.push({ label: fact.field, value });
      else if (typeof value === "number" || typeof value === "boolean") {
        chips.push({ label: fact.field, value: String(value) });
      } else withheld += 1;
    }
    if (chips.length === 0) {
      return {
        state: "absent",
        reason: `all ${String(withheld)} of this run's output facts are redacted or structured, `
          + "and neither is a value the queue may print",
      };
    }
    return { state: "present", value: chips };
  }

  #surfaceFold(row: RunFoldRecord, authority: RunRecord): SurfaceFold {
    const { queued } = row;
    const shape = queued.shape;
    const status = this.#status(row, authority);
    /**
     * D5: ONE receipt read per row, for the two consumers that need it.
     * A non-terminal row reads none at all — neither consumer has anything to
     * say about a run that has not produced a terminal result — which is the
     * same condition each of them tested for itself before.
     */
    const storedReceipt = TERMINAL_QUEUE_STATUSES.has(status)
      ? this.#deps.authority.getReceipt(queued.runId)
      : undefined;
    const receipt = storedReceipt === undefined ? undefined : projectReceiptForOperator(storedReceipt);
    const warningVerdict = this.#warningVerdict(status, receipt);
    const descriptor = this.#deps.descriptors.resolve(queued.workflow);
    /**
     * The children a group COUNTS, which is not every child it spawned. The
     * fold links a child to its parent on `run.queued.parentRunId` regardless
     * of shape, and `containment` splits that set in two: an `operation-member`
     * is counted in this rollup and never at top level, and everything else
     * keeps its own row and appears on `linkedRuns` instead. Partitioning here
     * is what makes the two lists disjoint rather than merely intended to be —
     * a child on both would be counted once and chipped once for the same work.
     */
    const memberChildIds = row.memberRunIds.filter((memberId) =>
      this.#rows.get(memberId)?.queued.shape === "operation-member");
    const failedTerminalMembers = memberChildIds.filter((memberId) => {
      const member = this.#rows.get(memberId);
      return member?.ended?.outcome === "failed";
    });
    const terminalMembers = memberChildIds.filter((memberId) => this.#rows.get(memberId)?.ended !== undefined);
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
      /**
       * D95's scheduling class, read from the envelope for the same reason
       * `dryRun` is: `bumpPriority` rewrites the envelope, and a row that read
       * the `run.queued` span's frozen copy would keep saying `bulk` after the
       * operator's bump had already changed the claim order.
       */
      priority: authority.envelope.priority,
      runNumber: this.#runNumber(authority),
      session: this.#session(authority),
      containment: this.#containment(queued),
      linkedRuns: this.#linkedRuns(row),
      facts: this.#facts(status, receipt),
      startedAt: queued.ts,
      updatedAt: authority.updatedAt,
      endedAt: this.#endedAt(row, authority, status),
      gateOpenedAt: this.#gateOpenedAt(row, authority, status),
      /**
       * Ref dashboard-surfaces §1.2: the document number the plan composed, REPLACED once the
       * run's own reads have settled the subject's name at the leaf this
       * workflow declares. A workflow that declares no subject leaf, and a run
       * whose declared node has not produced a checkpoint yet, both keep the
       * composed title — never a blank, never a guess.
       *
       * The operator's own name for the run is NOT folded in here: it rides
       * `displayName` beside this, so a renamed row can still state the subject
       * it was renamed away from.
       */
      title: this.#subjectTitle(queued.workflow, authority) ?? (hasProtectedTransactionInput(authority) ? "Protected test subject" : queued.title),
      displayName: authority.displayName === undefined
        ? { state: "absent", reason: "the operator has not renamed this run" }
        : { state: "present", value: authority.displayName },
      subtitle: queued.subtitle === undefined || (authority.input.parsed.protectedBindings === undefined
        && authority.input.parsed.value !== null && typeof authority.input.parsed.value === "object"
        && Object.hasOwn(authority.input.parsed.value, "timekeeperName"))
        ? { state: "absent", reason: "the start plan proposed no subtitle" }
        : { state: "present", value: queued.subtitle },
      status,
      liveMessage: this.#liveMessage(authority, status),
      warnings: this.#warnings(warningVerdict),
      pipeline: this.#pipeline(row),
      panelKind: panelKindOf(shape),
      availableSections: [
        "logs",
        "context-data",
        "context-attempts",
        ...(authority.lifecycle.state === "terminal" && authority.lifecycle.outcome === "failed" ? ["failure"] : []),
      ],
      /**
       * The row's own command controls (ref frontend-backend-integration §8.5). Derived from the
       * descriptor's declared `WorkflowActionPolicy` intersected with the
       * kernel's own preconditions — never from the status key, which is the
       * branch ref frontend-backend-integration §8.5 fails a build for.
       */
      actions: queueRowActions(descriptor?.actions, {
        status,
        rowRevision: authority.version,
        dryRun: authority.envelope.dryRun,
        isChild: authority.envelope.parent !== undefined,
        parkedWrite: authority.lifecycle.state === "parked-write",
        // The count the confirm copy calls "delegated members" (cancelBody's
        // "cancels the group and every one of its N delegated members"): the
        // operation-member subset, NOT every child. A non-member child keeps its
        // own row, its own cancel, and its own cascade policy, so counting it
        // here would promise a cancellation this copy does not own.
        memberCount: shape === "operation" ? memberChildIds.length : 0,
        isMember: shape === "operation-member",
        named: authority.displayName !== undefined,
        // The workflow id is the honest stand-in when this build cannot resolve
        // the descriptor — but `queueRowActions` serves nothing in that case, so
        // it is never the text on a control the operator reads.
        workflowLabel: descriptor?.label ?? queued.workflow,
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
          memberPreview: this.#memberPreview(memberChildIds),
        }),
      };
    }
    return {
      warningVerdict,
      surface: QueueSurfaceWireSchema.parse({ ...base, surfaceKind: surfaceKindOf(shape) }),
    };
  }

  #surface(row: RunFoldRecord, authority: RunRecord): QueueSurfaceWire {
    return this.#surfaceFold(row, authority).surface;
  }

  /* ── THE payload (D81) ─────────────────────────────────────────────────── */

  buildDashboardDayWire(day: string): DashboardDayWire {
    if (this.#health.state === "degraded") {
      throw new ProjectionDegradedError(`the run/queue projection is degraded and refuses to serve counts: ${this.#health.lastError ?? "unknown"}`);
    }
    const parsedDay = z.iso.date().parse(day);
    const surfaces: QueueSurfaceWire[] = [];
    const monthPrefix = parsedDay.slice(0, 7);
    const monthCounts = new Map<string, number>();
    for (const row of this.#rows.values()) {
      const rowDay = localDatePart(new Date(row.queued.ts));
      const authority = this.#authorityRun(row.queued.runId);
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

    // D248 — the card set is authority's; `#cardLeases` says why and how.
    const workerCards = [...this.#cardLeases().values()]
      .sort((a, b) => a.workerId.localeCompare(b.workerId))
      .map((lease) => {
        const fold = this.#workers.get(lease.workerId);
        return workerCardOf({
          lease,
          fold: fold === undefined
            ? undefined
            : {
              revision: fold.eventCount,
              ...(fold.currentRunId === undefined ? {} : { currentRunId: fold.currentRunId }),
              browsers: [...fold.browsers.values()],
            },
          resolveTrace: (runId) => this.#rows.get(runId)?.queued.traceId,
        });
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
      /**
       * D269 — the pool block is AUTHORITY's, read whole on every snapshot
       * exactly as the cards are: one entry per workflow that has a row, in
       * workflow order, carrying the version the spawn control must cite.
       * Snapshot-only by construction (the day patch carries row splices).
       */
      workerPools: this.#deps.authority.listWorkerPools().map((pool) => ({
        workflowId: pool.workflow,
        desiredWorkers: pool.desiredWorkers,
        version: pool.version,
        plannedBy: pool.plannedBy,
        plannedAt: pool.plannedAt,
      })),
      notifications: this.#deps.authority.listNotifications(LOCAL_OPERATOR_ACTOR_ID)
        .map((record) => notificationWireOf(record, this.#deps.clock.nowMs()))
        .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || String(a.notificationId).localeCompare(String(b.notificationId))),
    });
  }

  /**
   * The Activity report (D180, ref frontend-backend-integration §5/§6.7) — a range rendering of the SAME
   * surfaces `buildDashboardDayWire` renders. It lives on this class, and not
   * in a query module, because ref frontend-backend-integration §8 guard #4 names Activity aggregates
   * explicitly: a report that summed rows a second way could disagree with the
   * day it summarises, which is the exact count/badge divergence D81 exists to
   * make unrepresentable. Archived rows and member containment are already
   * applied here, once, for every surface.
   *
   * ONE field on the payload is not this fold's (D236): `ledger`. It comes from
   * the write ledger through `deps.ledger`, a different authority whose entries
   * outlive the runs that filed them, and it is reported beside these totals
   * rather than reconciled against them. See `ActivityLedgerBlockSchema`.
   */
  buildActivityReportWire(from: string, to: string): ActivityReportWire {
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
    for (const row of this.#rows.values()) {
      const day = localDatePart(new Date(row.queued.ts));
      if (day < start || day > end) continue;
      const authority = this.#authorityRun(row.queued.runId);
      if (this.#deps.authority.isArchived(row.queued.runId)) continue;
      // An operation is the counted container, not another person. Its member
      // rows are excluded from run totals below but INCLUDED on this axis: a
      // 50-person operation touches 50 people and still counts as one run.
      if (row.queued.shape !== "operation" && authority.envelope.workflow === "separations") personRows.push(authority);
      // Member containment, applied once: a member counted inside its
      // operation's rollup is not counted again at top level.
      if (row.queued.shape === "operation-member") continue;
      inRange.push({ day, fold: this.#surfaceFold(row, authority), authority });
    }

    const people = activityPeopleOf(
      personRows,
      this.#deps.authority.listActivityPersonPseudonyms(personRows.map((row) => row.envelope.runId)),
    );

    const days = new Map<string, number>();
    const workflows = new Map<string, ActivityWorkflowCounts>();
    const statuses = new Map<string, { runs: number; sample: string[] }>();
    const outcomes = new Map<string, number>();
    const failures = new Map<string, { runs: number; transient: number; sample: string[] }>();
    const measured: { runId: string; ms: number }[] = [];
    /**
     * The whole-report completion split, incremented in THIS loop beside the
     * per-workflow one it must equal. Two folds over one array would be the
     * second counting path D81 exists to delete, and the schema refuses the
     * payload if they ever part company.
     */
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
        // D22/D126 reuse the safe verdict that built this row's warning chip.
        // A run whose receipt was never derived is counted as unread, never as
        // read-back: this is the report's `unmeasuredRuns`, one axis over.
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
      /**
       * D236 — passed through, never folded here. The block is read from the
       * write ledger over the SAME window, and it is the one number on this
       * payload that does not descend from the loop above.
       */
      ledger: this.#deps.ledger.foldActivityRange(start, end),
    });
  }
}

export function createRunQueueProjection(deps: RunQueueProjectionDeps): RunQueueProjection {
  return new RunQueueProjection(deps);
}
