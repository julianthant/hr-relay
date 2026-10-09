import { AuthorityDatabase } from "../synthetic-database-admission.js";
import { DatabaseSync } from "node:sqlite";
import type { TimelineRepository } from "../../../../src/models/events/timeline.js";
import { createTimelineRepository, TIMELINE_EVENT_TABLE_DDL, TIMELINE_EVENT_INDEX_DDL } from "../../../../src/backend/storage/sqlite/timeline-repository.js";
import { inMemoryRunReaderFake, type CanonicalRunReader, type InMemoryRunReaderState } from "../canonical-run-reader.js";
import { type RunSessionRecord } from "../../../../src/models/run/session.js";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { AnyWorkflowDescriptor } from "../../../../src/workflow-kit/workflow.js";
import { localDatePart, manualClock, type TestClock } from "../../../../src/rules/time/clock.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { NotificationRecordSchema } from "../../../../src/models/notifications/notifications.js";
import { RunLifecycleSchema, RunRecordSchema, type RunRecord } from "../../../../src/models/run/record.js";
import { isLiveWorker, WorkerLeaseRecordSchema, type WorkerLeaseRecord } from "../../../../src/models/run/worker.js";
import { WorkerPoolRecordSchema, type WorkerPoolRecord } from "../../../../src/models/run/worker-pool.js";
import { RunEvidenceReceiptSchema, type RunEvidenceReceipt } from "../../../../src/models/trust/evidence.js";
import {
  ActivityPersonPseudonymEvidenceSchema,
  type ActivityPersonPseudonymEvidence,
} from "../../../../src/models/trust/activity-person-pseudonym.js";
import {
  CURRENT_DIAGNOSTIC_SAFETY_VERSION,
  FailureRecordSchema,
  type FailureRecord,
} from "../../../../src/models/trust/failure.js";
import { GateResultRecordSchema, type GateResultRecord } from "../../../../src/models/workflow/gates.js";
import type { RunCheckpointRecord } from "../../../../src/models/workflow/checkpoint.js";
import type { WriteIntentRecord } from "../../../../src/rules/write-safety/write-safety.js";
import type { RunQueuedWire, SpanOutcomeWire } from "../../../../src/models/events/types.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
type TimelineEmitter = ReturnType<typeof createTimelineEmitter>;
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import {
  createRunQueueProjection,
  RunQueueProjection,
  type RunQueueProjectionChange,
} from "../../../../src/backend/runs/projections/run-queue-projection.js";
import { HASH_A, HASH_B, NOW, UUID_4 } from "../../fixtures/phase1c-contract-fixtures.js";

export const DAY = "2026-08-03";
export const AT = new Date("2026-08-03T10:00:00.000-07:00");
export const APP_VERSION = "0.1.0";
export const DESCRIPTOR_SET_HASH = FingerprintSchema.parse("d".repeat(64));

const DAY_MS = 24 * 60 * 60 * 1000;


export function dayOffsetOf(offset: number): string {
  return localDatePart(new Date(AT.getTime() + offset * DAY_MS));
}

/** Move the world's wall clock to the same time of day, `offset` days on. */
export function atDayOffset(world: DashboardWorld, offset: number): void {
  world.clock.setWall(new Date(AT.getTime() + offset * DAY_MS));
}


export function instantOffsetOf(offset: number, elapsedMs = 0): string {
  return new Date(AT.getTime() + offset * DAY_MS + elapsedMs).toISOString();
}

export function uuidOf(seed: number): string {
  const tail = String(seed).padStart(4, "0");
  return `${tail.repeat(2)}-${tail}-4${tail.slice(1)}-8${tail.slice(1)}-${tail.repeat(3)}`;
}

export function traceOf(seed: number): string {
  return `pl-10000${String(seed % 10)}-${uuidOf(seed).slice(0, 4)}`;
}

export type NotificationRecord = z.infer<typeof NotificationRecordSchema>;

export interface AuthorityFake {
  readonly records: Map<string, RunRecord>;
  readonly checkpoints: Map<string, RunCheckpointRecord>;
  getRun(runId: string): RunRecord | undefined;
  put(record: RunRecord): void;
  putCheckpoint(record: RunCheckpointRecord): void;
  latestCheckpoint(workflowId: string, itemId: string, nodeId: string): RunCheckpointRecord | undefined;
  /** 2i-B: the durable inbox rows the day wire serves, keyed by actor. */
  readonly notifications: NotificationRecord[];
  listNotifications(actorId: string): readonly NotificationRecord[];
  listNotificationCheckpoints(workflowId: string, itemId: string, nodeId: string, attempt: number): readonly RunCheckpointRecord[];

  readonly archived: Set<string>;
  isArchived(runId: string): boolean;
  readonly failures: Map<string, FailureRecord>;
  getFailure(failureId: string): FailureRecord | undefined;

  readonly receipts: Map<string, RunEvidenceReceipt>;
  getReceipt(runId: string): RunEvidenceReceipt | undefined;
  readonly activityPersonPseudonyms: ActivityPersonPseudonymEvidence[];
  listActivityPersonPseudonyms(runIds: readonly string[]): readonly ActivityPersonPseudonymEvidence[];
  putActivityPersonPseudonym(record: unknown): void;
  /** Ref write-safety §4.1: the durable write-safety rows the parked-write section reads. */
  readonly writeIntents: Map<string, WriteIntentRecord>;
  getWriteIntent(writeIntentId: string): WriteIntentRecord | undefined;
  putWriteIntent(record: WriteIntentRecord): void;

  readonly gateResults: GateResultRecord[];
  listGateResults(runId: string): readonly GateResultRecord[];
  putGateResult(record: unknown): void;

  readonly workerLeases: Map<string, WorkerLeaseRecord>;
  listLiveWorkerLeases(): readonly WorkerLeaseRecord[];
  getWorkerLease(workerId: string): WorkerLeaseRecord | undefined;
  putWorkerLease(record: unknown): void;

  readonly workerPools: Map<string, WorkerPoolRecord>;
  listWorkerPools(): readonly WorkerPoolRecord[];
  readonly batches: Map<string, RunSessionRecord>;
  listRunBatches(): readonly RunSessionRecord[];
  getRunBatch(id: string): RunSessionRecord | undefined;
  putWorkerPool(record: unknown): void;
}

export function authorityFake(): AuthorityFake {
  const records = new Map<string, RunRecord>();
  const checkpoints = new Map<string, RunCheckpointRecord>();
  const archived = new Set<string>();
  const failures = new Map<string, FailureRecord>();
  const receipts = new Map<string, RunEvidenceReceipt>();
  const activityPersonPseudonyms: ActivityPersonPseudonymEvidence[] = [];
  const writeIntents = new Map<string, WriteIntentRecord>();
  const gateResults: GateResultRecord[] = [];
  const workerLeases = new Map<string, WorkerLeaseRecord>();
  const workerPools = new Map<string, WorkerPoolRecord>();
  const notifications: NotificationRecord[] = [];
  const checkpointKey = (workflowId: string, itemId: string, nodeId: string): string =>
    `${workflowId}\u0000${itemId}\u0000${nodeId}`;
  return {
    records,
    checkpoints,
    getRun: (runId) => records.get(runId),
    put: (record) => records.set(record.envelope.runId, record),
    putCheckpoint: (record) =>
      checkpoints.set(checkpointKey(record.workflowId, record.itemId, record.nodeId), record),
    latestCheckpoint: (workflowId, itemId, nodeId) =>
      checkpoints.get(checkpointKey(workflowId, itemId, nodeId)),
    notifications,
    listNotifications: (actorId) => notifications.filter((record) => record.actorId === actorId),
    listNotificationCheckpoints: (workflowId, itemId, nodeId, attempt) => [...checkpoints.values()].filter(row => row.workflowId === workflowId && row.itemId === itemId && row.nodeId === nodeId && row.attempt === attempt),
    archived,
    isArchived: (runId) => archived.has(runId),
    failures,
    getFailure: (failureId) => failures.get(failureId),
    receipts,
    getReceipt: (runId) => receipts.get(runId),
    activityPersonPseudonyms,
    // Return foreign evidence from the broad fake to prove the projector rejects incorrect repository scope.
    listActivityPersonPseudonyms: () => activityPersonPseudonyms,
    putActivityPersonPseudonym: (record) => {
      activityPersonPseudonyms.push(ActivityPersonPseudonymEvidenceSchema.parse(record));
    },
    writeIntents,
    getWriteIntent: (writeIntentId) => writeIntents.get(writeIntentId),
    putWriteIntent: (record) => writeIntents.set(record.writeIntentId, record),
    workerLeases,
    listLiveWorkerLeases: () => [...workerLeases.values()].filter((lease) => isLiveWorker(lease)),
    getWorkerLease: (workerId) => workerLeases.get(workerId),
    putWorkerLease: (record) => {
      const lease = WorkerLeaseRecordSchema.parse(record);
      workerLeases.set(lease.workerId, lease);
    },
    workerPools,
    batches: new Map<string, RunSessionRecord>(),
    listRunBatches() { return [...this.batches.values()]; },
    getRunBatch(id: string) { return this.batches.get(id); },
    listWorkerPools: () => [...workerPools.values()].sort((a, b) => a.workflow.localeCompare(b.workflow)),
    putWorkerPool: (record) => {
      const pool = WorkerPoolRecordSchema.parse(record);
      workerPools.set(pool.workflow, pool);
    },
    gateResults,
    listGateResults: (runId) => gateResults.filter((record) => record.runId === runId),
    putGateResult: (record) => gateResults.push(GateResultRecordSchema.parse(record)),
  };
}

export interface DashboardWorld {
  readonly database: AuthorityDatabase;
  readonly timeline: TimelineRepository;
  readonly stateRoot: string;
  readonly clock: TestClock;
  readonly authority: AuthorityFake;
  readonly runReader: CanonicalRunReader;
  readonly runReaderState: InMemoryRunReaderState;
  readonly projection: RunQueueProjection;
  readonly writer: TimelineEmitter;
  readonly changes: RunQueueProjectionChange[];
  readonly scheduledRebuilds: (() => void)[];
  dispose(): void;
}

export function makeWorld(input?: Readonly<{
  reader?: CanonicalRunReader;
  collectRebuilds?: boolean;

  descriptors?: { resolve(workflowId: string): AnyWorkflowDescriptor | undefined };
}>): DashboardWorld {
  const stateRoot = mkdtempSync(join(tmpdir(), "hrauto-dashboard-"));
  const clock = manualClock(AT);
  const authority = authorityFake();
  const database = AuthorityDatabase.open({ path: join(stateRoot, "authority.db"), busyTimeoutMs: 500, migrationOwner: "history-dashboard-fixture" }, clock);
  const eventDatabase = new DatabaseSync(join(stateRoot, "timeline.sqlite"));
  eventDatabase.exec("PRAGMA foreign_keys=ON; CREATE TABLE workflow_runs(record_key TEXT PRIMARY KEY) STRICT; CREATE TABLE deleted_runs(record_key TEXT PRIMARY KEY) STRICT");
  eventDatabase.exec(TIMELINE_EVENT_TABLE_DDL);
  for (const sql of TIMELINE_EVENT_INDEX_DDL) eventDatabase.exec(sql);
  const timeline = createTimelineRepository({ database: eventDatabase, read: (work) => work(),
    assertOwner: (record) => {
      if (record.scope.kind === "run" && authority.records.has(record.scope.runId)) {
        eventDatabase.prepare("INSERT OR IGNORE INTO workflow_runs(record_key) VALUES (?)").run(record.scope.runId);
      }
    }, mutate: (work) => {
      eventDatabase.exec("BEGIN IMMEDIATE");
      try { const result = work().result; eventDatabase.exec("COMMIT"); return result; }
      catch (error) { eventDatabase.exec("ROLLBACK"); throw error; }
    } });
  const runReaderState = { records: authority.records, archived: authority.archived, deleted: new Map(), generation: 0 };
  const canonical = input?.reader ?? inMemoryRunReaderFake(runReaderState);
  // Keep the consumed port instrumentable for structural read-count proofs;
  // the underlying canonical reader retains its own frozen implementation.
  const runReader: CanonicalRunReader = {
    read: (runId) => canonical.read(runId),
    withRunTreeSnapshot: (ids, work) => canonical.withRunTreeSnapshot(ids, work),
    list: (query) => canonical.list(query),
  };
  const scheduledRebuilds: (() => void)[] = [];
  const projection = createRunQueueProjection({
    timeline,
    reader: runReader,
    stateRoot,
    clock,
    appVersion: APP_VERSION,
    descriptorSetHash: DESCRIPTOR_SET_HASH,

    ledger: createTransactionHistory(database.authority),
    authority,
    descriptors: input?.descriptors ?? { resolve: () => undefined },
    ...(input?.collectRebuilds === true
      ? { scheduleRebuild: (rebuild: () => void): void => { scheduledRebuilds.push(rebuild); } }
      : {}),
  });
  const changes: RunQueueProjectionChange[] = [];
  projection.onChange((change) => changes.push(change));
  const jsonlWriter = createTimelineEmitter({
    repository: timeline,
    clock,
    pid: 4242,
  });

  const writer: TimelineEmitter = Object.freeze({
    emit: (event: unknown): void => {
      jsonlWriter.emit(event);
      projection.ingestFromTimeline();
    },
  });
  return {
    database,
    timeline,
    stateRoot,
    clock,
    authority,
    runReader,
    runReaderState,
    projection,
    writer,
    changes,
    scheduledRebuilds,
    dispose: () => { database.close(); eventDatabase.close(); rmSync(stateRoot, { recursive: true, force: true }); },
  };
}

/* ── seeded rows ─────────────────────────────────────────────────────────── */

export interface SeedRunInput {
  readonly seed: number;
  readonly attempt?: number;
  readonly workflow?: string;
  readonly shape?: "single" | "preview" | "operation" | "operation-member";
  readonly parentSeed?: number;
  readonly title?: string;
  /** Plain-object lifecycle input; `RunRecordSchema.parse` proves it legal. */
  readonly lifecycle?: unknown;
  readonly version?: number;
  readonly claimGeneration?: number;
  readonly enqueuedAt?: string;

  readonly injected?: unknown;

  readonly dryRun?: boolean;
  /** The operator's own name for the run — the `rename` command's durable field. */
  readonly displayName?: string;

  readonly priority?: "interactive" | "bulk";
  // Undefined is the stored pre-ordinal shape, not a guessed default.
  readonly runNumber?: number;

  readonly sessionId?: string;
}


export function workerLeaseOf(input: Readonly<{
  workerId?: string;
  workflow?: string;
  browserSystems?: unknown;
  lifecycle?: unknown;
  directive?: "run" | "pause" | "stop";
  version?: number;
}> = {}): WorkerLeaseRecord {
  const startedAt = instantOffsetOf(0);
  return WorkerLeaseRecordSchema.parse({
    workerId: input.workerId ?? "person-lookup-worker-1",
    workflow: input.workflow ?? "person-lookup",
    browserSystems: input.browserSystems ?? ["crm", "ucpath"],
    processId: 4242,
    leaseGeneration: 1,
    lifecycle: input.lifecycle ?? { state: "idle", startedAt, heartbeatAt: instantOffsetOf(0, 1_000) },
    control: {
      directive: input.directive ?? "run",
      requestedAt: startedAt,
      requestedBy: "local-operator",
    },
    version: input.version ?? 1,
    createdAt: startedAt,
    updatedAt: instantOffsetOf(0, 1_000),
  });
}

export function runRecordOf(input: SeedRunInput): RunRecord {
  const enqueuedAt = input.enqueuedAt ?? AT.toISOString();
  const lifecycle = RunLifecycleSchema.parse(input.lifecycle ?? {state: "queued"});
  const settled = lifecycle.state === "terminal" && (lifecycle.outcome === "done" || lifecycle.outcome === "failed");
  const version = settled ? Math.max(2, input.version ?? 1) : input.version ?? 1;
  const claimGeneration = settled ? Math.max(1, input.claimGeneration ?? 0) : input.claimGeneration ?? 0;
  const completion = settled && lifecycle.state === "terminal" ? {
    schemaVersion: 1, kind: lifecycle.outcome, expectedVersion: version - 1,
    claim: {workerId: "dashboard-fixture-worker", claimGeneration}, authorizedAt: lifecycle.endedAt,
    ...(lifecycle.outcome === "done" ? {resultDigest: HASH_A} : lifecycle.outcome === "failed" ? {failureId: lifecycle.failureId} : {}),
  } : undefined;
  return RunRecordSchema.parse({
    envelope: {
      runId: uuidOf(input.seed),
      workflow: input.workflow ?? "person-lookup",
      itemId: uuidOf(input.seed + 5000),
      traceId: traceOf(input.seed),
      descriptorVersion: 1,
      contractFingerprint: HASH_A,
      resolvedInstance: { ucpath: "prod" },
      configFingerprint: HASH_B,
      configSnapshotId: UUID_4,
      ...(input.parentSeed === undefined ? {} : {
        parent: {
          runId: uuidOf(input.parentSeed),
          tracePrefix: traceOf(input.parentSeed),
          edgeId: "members",
        },
      }),
      shape: input.shape ?? "single",
      priority: input.priority ?? "interactive",
      dryRun: input.dryRun ?? false,
      ...(input.injected === undefined ? {} : { injected: input.injected }),
      attempt: input.attempt ?? 1,
      enqueuedAt,
    },
    input: { raw: { emplId: "10873698" }, parsed: { schemaHash: HASH_B, protectedBindings: [], value: { emplId: "10873698" } }, ingressSchemaHash: HASH_A },
    lifecycle,
    claimGeneration,
    ...(completion === undefined ? {} : {completion}),
    ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
    ...(input.runNumber === undefined ? {} : { runNumber: input.runNumber }),
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    version,
    createdAt: enqueuedAt,
    updatedAt: settled && lifecycle.state === "terminal" ? lifecycle.endedAt : enqueuedAt,
  });
}

export function queuedEventOf(world: DashboardWorld, input: SeedRunInput): RunQueuedWire {
  const record = runRecordOf({ ...input, enqueuedAt: input.enqueuedAt ?? world.clock.now().toISOString() });
  world.authority.put(record);
  const event = {
    t: "run.queued",
    kind: "run",
    ts: world.clock.now().toISOString(),
    workflow: record.envelope.workflow,
    runId: record.envelope.runId,
    attempt: 1,
    traceId: record.envelope.traceId,
    spanPath: record.envelope.traceId,
    itemId: record.envelope.itemId,
    ...(record.envelope.parent === undefined ? {} : { parentRunId: record.envelope.parent.runId }),
    shape: record.envelope.shape,
    priority: record.envelope.priority,
    dryRun: record.envelope.dryRun,
    actorId: "local-operator",
    title: input.title ?? `EID 10873698 #${String(input.seed)}`,
    descriptorVersion: 1,
    contractFingerprint: HASH_A,
    resolvedInstance: { ucpath: "prod" },
    configFingerprint: HASH_B,
    configSnapshotId: UUID_4,
  } as const;
  world.writer.emit(event);
  return event as unknown as RunQueuedWire;
}


export function taskEventsOf(
  world: DashboardWorld,
  seed: number,
  node: string,
  outcome?: SpanOutcomeWire,

  notRunReason?: "condition-false" | "branch-not-selected" | "operator-asserted" | "step-omitted",
): void {
  const base = {
    ts: world.clock.now().toISOString(),
    workflow: "person-lookup",
    runId: uuidOf(seed),
    attempt: 1,
    traceId: traceOf(seed),
  };
  world.writer.emit({ ...base, t: "span.started", kind: "task", spanPath: `${traceOf(seed)}/${node}#1`, parentSpanPath: traceOf(seed), name: node });
  if (outcome !== undefined) {
    world.writer.emit({
      ...base, t: "span.ended", kind: "task", spanPath: `${traceOf(seed)}/${node}#1`, outcome,
      ...(notRunReason === undefined ? {} : { notRunReason }),
    });
  }
}


export function runEndedEventOf(
  world: DashboardWorld,
  seed: number,
  outcome: "done" | "failed" | "cancelled" | "discarded" | "interrupted" | "superseded",
  input?: Readonly<{ workflow?: string; failureId?: string }>,
): void {
  world.writer.emit({
    t: "span.ended",
    kind: "run",
    ts: world.clock.now().toISOString(),
    workflow: input?.workflow ?? "person-lookup",
    runId: uuidOf(seed),
    attempt: 1,
    traceId: traceOf(seed),
    spanPath: traceOf(seed),
    outcome,
    ...(input?.failureId === undefined ? {} : { failureId: input.failureId }),
  });
}


export function failureRecordOf(input: Readonly<{
  seed: number;
  code: string;
  transient?: boolean;
  workflow?: string;
}>): FailureRecord {
  const transient = input.transient ?? false;
  return FailureRecordSchema.parse({
    diagnosticSafetyVersion: CURRENT_DIAGNOSTIC_SAFETY_VERSION,
    failureId: uuidOf(input.seed + 9000),
    fingerprint: "ab".repeat(32),
    runId: uuidOf(input.seed),
    traceId: traceOf(input.seed),
    attempt: 1,
    workflowId: input.workflow ?? "person-lookup",
    code: input.code,
    summary: `seeded ${input.code} for run ${String(input.seed)}`,
    transient,
    writeState: "not-attempted",
    causeChain: [{ code: input.code, summary: `seeded ${input.code}`, role: "primary", transient }],
    remediation: [{ kind: "operator-action", message: "seeded remediation" }],
    occurredAt: NOW,
  });
}


export function receiptWithWarningsOf(input: Readonly<{
  seed: number;
  summaries: readonly string[];
  workflow?: string;
}>): RunEvidenceReceipt {
  return RunEvidenceReceiptSchema.parse({
    composition: 4,
    receiptId: uuidOf(input.seed + 7000),
    runId: uuidOf(input.seed),
    traceId: traceOf(input.seed),
    workflowId: input.workflow ?? "person-lookup",
    attempt: 1,
    generatedAt: NOW,
    descriptorFingerprint: HASH_A,
    configFingerprint: HASH_B,
    retryOf: { state: "absent" },
    failure: { state: "absent" },
    input: [],
    observations: [],
    decisions: [],
    actions: [],
    verification: [],
    output: [],
    reuse: [],
    warnings: input.summaries.map((summary, index) => ({
      id: uuidOf(input.seed + 7100 + index),
      code: "REPLAYED_FACT_OLDER_THAN_FRESHNESS_LIMIT",
      summary,
      loadBearing: false,
      evidence: [],
    })),
    confidence: "partial",
    result: "done-with-warnings",
  });
}


export function receiptWithOutputOf(input: Readonly<{
  seed: number;
  outputs: readonly { field: string; value: unknown; redact?: "drop" }[];
  workflow?: string;
}>): RunEvidenceReceipt {
  return RunEvidenceReceiptSchema.parse({
    ...cleanReceiptOf(input),
    output: input.outputs.map((entry, index) => ({
      id: uuidOf(input.seed + 7200 + index),
      field: entry.field,
      mandatory: true,
      source: { kind: "system", taskId: "ucpath/search-person-org", observedAt: NOW },
      state: "satisfied",
      value: entry.redact === "drop"
        ? { key: entry.field, state: "redacted", classification: "sensitive-hr", transform: "drop" }
        : { key: entry.field, state: "allowed", classification: "safe-diagnostic", transform: "allow", value: entry.value },
    })),
  });
}


export function cleanReceiptOf(input: Readonly<{ seed: number; workflow?: string }>): RunEvidenceReceipt {
  return RunEvidenceReceiptSchema.parse({
    ...receiptWithWarningsOf({ ...input, summaries: ["placeholder"] }),
    warnings: [],
    confidence: "verified",
    result: "verified-done",
  });
}

/** A durable inbox row, at the one instant the wire orders and dedupes on. */
export function notificationRecordOf(input: Readonly<{
  seed: number;
  title: string;
  lastSeenAt: string;
  trigger?: "failed" | "gate-waiting" | "write-parked" | "repeating" | "verified-done";
}>): NotificationRecord {
  const trigger = input.trigger ?? "failed";
  return NotificationRecordSchema.parse({
    notificationId: uuidOf(input.seed + 7000),
    actorId: "local-operator",
    dedupeFingerprint: FingerprintSchema.parse(String(input.seed % 10).repeat(64)),
    trigger,
    channel: trigger === "verified-done" ? "inbox" : "ping",
    status: "unread",
    snooze: { state: "not-snoozed" },
    title: input.title,
    summary: `seeded ${trigger} notification`,
    links: [{ kind: "run", runId: uuidOf(input.seed) }],
    count: 1,
    lastSeenAt: input.lastSeenAt,
    version: 1,
    createdAt: input.lastSeenAt,
    updatedAt: input.lastSeenAt,
  });
}

export function claimEventOf(world: DashboardWorld, seed: number, workerId = "person-lookup-worker-1"): void {
  world.writer.emit({
    t: "run.claimed",
    ts: world.clock.now().toISOString(),
    workflow: "person-lookup",
    runId: uuidOf(seed),
    attempt: 1,
    traceId: traceOf(seed),
    spanPath: traceOf(seed),
    workerId,
  });
}
