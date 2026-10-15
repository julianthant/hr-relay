import { WorkerSlotRecordSchema, type WorkerSlotRecord } from "../../../../src/models/run/worker-slot.js";
import type { WorkerControlRecord } from "../../../../src/models/run/worker-control.js";
import { AuthorityDatabase } from "../synthetic-database-admission.js";
import { DatabaseSync } from "node:sqlite";
import type { TimelineRepository } from "../../../../src/models/events/timeline.js";
import { runRecordColumns } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { createRunSearchIndex } from "../../../../src/backend/storage/sqlite/run-search-index.js";
import { TimelineAppendSchema } from "../../../../src/models/events/timeline.js";
import { inMemoryRunReaderFake, type CanonicalRunReader, type InMemoryRunReaderState } from "../canonical-run-reader.js";
import { type RunSessionRecord } from "../../../../src/models/run/session.js";

import { mkdtempSync, realpathSync, rmSync } from "node:fs";
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
import { SpanEventWireSchema, type RunQueuedWire, type SpanOutcomeWire } from "../../../../src/models/events/types.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
type TimelineEmitter = ReturnType<typeof createTimelineEmitter>;
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import {
  createRunQueueProjection,
  RunQueueProjection,
  type RunQueueProjectionChange,
} from "../../../../src/backend/runs/projections/run-queue-projection.js";
import { CONFIG_SNAPSHOT, HASH_A, HASH_B, NOW } from "../../fixtures/phase1c-contract-fixtures.js";

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
  listCheckpoints(workflowId: string, itemId: string): readonly RunCheckpointRecord[];
  latestCheckpoint(workflowId: string, itemId: string, nodeId: string): RunCheckpointRecord | undefined;
  /** Durable inbox rows keyed by actor. */
  readonly notifications: NotificationRecord[];
  listNotifications(actorId: string): readonly NotificationRecord[];
  listNotificationCheckpoints(workflowId: string, itemId: string, nodeId: string, attempt: number): readonly RunCheckpointRecord[];

  readonly failures: Map<string, FailureRecord>;
  getFailure(failureId: string): FailureRecord | undefined;

  readonly receipts: Map<string, RunEvidenceReceipt>;
  getReceipt(runId: string): RunEvidenceReceipt | undefined;
  readonly activityPersonPseudonyms: ActivityPersonPseudonymEvidence[];
  listActivityPersonPseudonyms(runIds: readonly string[]): readonly ActivityPersonPseudonymEvidence[];
  putActivityPersonPseudonym(record: unknown): void;
  /** Ref write-safety: the durable write-safety rows the parked-write section reads. */
  readonly writeIntents: Map<string, WriteIntentRecord>;
  getWriteIntent(writeIntentId: string): WriteIntentRecord | undefined;
  putWriteIntent(record: WriteIntentRecord): void;

  readonly gateResults: GateResultRecord[];
  listGateResults(runId: string): readonly GateResultRecord[];
  putGateResult(record: unknown): void;

  readonly workerSlots: Map<string, WorkerSlotRecord>;
  listWorkerSlots(): readonly WorkerSlotRecord[];
  listWorkerRuns(workerId: string): readonly RunRecord[];
  putWorkerSlot(record: unknown): void;
  readonly workerOwners: Set<string>;
  workerOwnerAlive(lease: WorkerLeaseRecord): boolean;
  workerControls(): readonly WorkerControlRecord[];
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
  const failures = new Map<string, FailureRecord>();
  const receipts = new Map<string, RunEvidenceReceipt>();
  const activityPersonPseudonyms: ActivityPersonPseudonymEvidence[] = [];
  const writeIntents = new Map<string, WriteIntentRecord>();
  const gateResults: GateResultRecord[] = [];
  const workerSlots = new Map<string, WorkerSlotRecord>(), workerOwners = new Set<string>();
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
    listCheckpoints: (workflowId, itemId) => [...checkpoints.values()].filter(row => row.workflowId === workflowId && row.itemId === itemId),
    latestCheckpoint: (workflowId, itemId, nodeId) =>
      checkpoints.get(checkpointKey(workflowId, itemId, nodeId)),
    notifications,
    listNotifications: (actorId) => notifications.filter((record) => record.actorId === actorId),
    listNotificationCheckpoints: (workflowId, itemId, nodeId, attempt) => [...checkpoints.values()].filter(row => row.workflowId === workflowId && row.itemId === itemId && row.nodeId === nodeId && row.attempt === attempt),
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
    workerSlots, workerOwners,
    listWorkerSlots: () => [...workerSlots.values()].sort((a, b) => a.workerId.localeCompare(b.workerId)),
    listWorkerRuns: workerId => [...records.values()].filter(run => "workerId" in run.lifecycle && run.lifecycle.workerId === workerId),
    putWorkerSlot: record => { const member = WorkerSlotRecordSchema.parse(record); workerSlots.set(member.workerId, member); },
    workerOwnerAlive: lease => workerOwners.has(`${lease.workerId}:${String(lease.leaseGeneration)}:${String(lease.processId)}:${lease.lifecycle.startedAt}`),
    workerControls: () => [],
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
  timeline?: TimelineRepository;
  collectRebuilds?: boolean;

  descriptors?: { resolve(workflowId: string): AnyWorkflowDescriptor | undefined };
}>): DashboardWorld {
  const stateRoot = mkdtempSync(join(realpathSync(tmpdir()), "hrauto-dashboard-"));
  const clock = manualClock(AT);
  const authority = authorityFake();
  const database = AuthorityDatabase.open({ path: join(stateRoot, "authority.db"), busyTimeoutMs: 500, migrationOwner: "history-dashboard-fixture" }, clock);
  database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
  const synchronizeOwner = (runId: string, visiting = new Set<string>()): void => {
    if(visiting.has(runId))throw new Error("fixture run ownership cycle");
    const run = authority.records.get(runId);
    if(run === undefined)throw new Error("fixture native timeline owner missing");
    visiting.add(runId);
    if(run.envelope.parent !== undefined)synchronizeOwner(run.envelope.parent.runId,visiting);
    if (run.sessionId !== undefined) {
      const batch = authority.batches.get(run.sessionId);
      if (batch === undefined) throw new Error("fixture native batch owner missing");
      const saved = database.authority.runSessions.get(run.sessionId);
      if (saved === undefined) database.authority.runSessions.insert(batch);
      else if (saved.workflow !== batch.workflow || saved.sessionId !== batch.sessionId || saved.startedAt !== batch.startedAt || JSON.stringify(saved.origin) !== JSON.stringify(batch.origin)) throw new Error("fixture native batch identity mismatch");
    }
    // The canonical fake varies independently; timeline storage owns a real queued envelope.
    const owner = RunRecordSchema.parse({
      envelope: run.envelope, input: run.input, lifecycle: { state: "queued" },
      claimGeneration: 0, version: 1, createdAt: run.envelope.enqueuedAt, updatedAt: run.envelope.enqueuedAt,
      ...(run.displayName === undefined ? {} : { displayName: run.displayName }),
      ...(run.runNumber === undefined ? {} : { runNumber: run.runNumber }),
      ...(run.sessionId === undefined ? {} : { sessionId: run.sessionId }),
    });
    const row = runRecordColumns(owner), columns = Object.keys(row), raw = new DatabaseSync(join(stateRoot,"authority.db"));
    try {
      const search = createRunSearchIndex(raw);
      search.installTracking();
      raw.exec("BEGIN IMMEDIATE");
      if (raw.prepare("SELECT 1 FROM runs WHERE id=?").get(runId) === undefined) {
        raw.prepare(`INSERT INTO runs(${columns.join(",")}) VALUES(${columns.map(()=>"?").join(",")})`).run(...Object.values(row));
      } else {
        const updated = columns.filter(key => key !== "id");
        raw.prepare(`UPDATE runs SET ${updated.map(key => `${key}=?`).join(",")} WHERE id=?`).run(...updated.map(key => row[key as keyof typeof row]), runId);
      }
      let publication = search.rebuild({ restart: true, limit: 500 }, database.getMeta().authorityGeneration, clock.now().toISOString());
      while (publication.state === "building") publication = search.rebuild({ restart: false, limit: 500 }, database.getMeta().authorityGeneration, clock.now().toISOString());
      raw.exec("COMMIT");
    }
    finally { raw.close(); }
    visiting.delete(runId);
  };
  const timeline: TimelineRepository = Object.freeze({ ...database.authority.timelineEvents,
    append(input: Parameters<TimelineRepository["append"]>[0]) {
      const record = TimelineAppendSchema.parse(input);
      if(record.scope.kind === "run")synchronizeOwner(record.scope.runId);
      return database.authority.timelineEvents.append(record);
    },
  });
  const runReaderState = { records: authority.records, deleted: new Map(), generation: 0 };
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
    timeline: input?.timeline ?? timeline,
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
  const timelineWriter = createTimelineEmitter({
    repository: timeline,
    clock,
    pid: 4242,
  });

  const writer: TimelineEmitter = Object.freeze({
    emit: (event: unknown): void => {
      timelineWriter.emit(event);
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
    dispose: () => { database.close(); rmSync(stateRoot, { recursive: true, force: true }); },
  };
}

/* ── seeded rows ─────────────────────────────────────────────────────────── */

export interface SeedRunInput {
  readonly descriptor?: Pick<AnyWorkflowDescriptor, "version" | "contractFingerprint">;
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
    controlRevision: 1,
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
      descriptorVersion: input.descriptor?.version ?? 1,
      contractFingerprint: input.descriptor?.contractFingerprint ?? HASH_A,
      resolvedInstance: { ucpath: "prod" },
      configFingerprint: CONFIG_SNAPSHOT.fingerprint,
      configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId,
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
    input: { raw: { emplId: "10873698" }, parsed: { schemaHash: HASH_B, protectedBindings: [], value: { mode: "search", crmCheck: true, emplId: "10873698", keepNonHdh: false, includeCrmDates: false } }, ingressSchemaHash: HASH_A },
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
    descriptorVersion: record.envelope.descriptorVersion,
    contractFingerprint: record.envelope.contractFingerprint,
    resolvedInstance: { ucpath: "prod" },
    configFingerprint: record.envelope.configFingerprint,
    configSnapshotId: record.envelope.configSnapshotId,
  } as const;
  world.writer.emit(event);
  const parsed = SpanEventWireSchema.parse({ ...event, pid: 4242 });
  if(parsed.t!=="run.queued")throw new Error("fixture queued event kind changed");
  return parsed;
}


export function taskEventsOf(
  world: DashboardWorld,
  seed: number,
  node: string,
  outcome?: SpanOutcomeWire,

  notRunReason?: "condition-false" | "branch-not-selected" | "operator-asserted" | "step-omitted",
): void {
  const owner = world.authority.getRun(uuidOf(seed));
  if (owner === undefined) throw new Error("fixture-task-run-owner-missing");
  const base = {
    ts: world.clock.now().toISOString(),
    workflow: owner.envelope.workflow,
    runId: owner.envelope.runId,
    attempt: owner.envelope.attempt,
    traceId: owner.envelope.traceId,
  };
  world.writer.emit({ ...base, t: "span.started", kind: "task", spanPath: `${owner.envelope.traceId}/${node}#${String(owner.envelope.attempt)}`, parentSpanPath: owner.envelope.traceId, name: node });
  if (outcome !== undefined) {
    world.writer.emit({
      ...base, t: "span.ended", kind: "task", spanPath: `${owner.envelope.traceId}/${node}#${String(owner.envelope.attempt)}`, outcome,
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
    composition: 5,
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
  const run = world.authority.getRun(uuidOf(seed));
  if (run === undefined) throw new Error("claim fixture run is missing");
  world.writer.emit({
    t: "run.claimed",
    ts: world.clock.now().toISOString(),
    workflow: run.envelope.workflow,
    runId: run.envelope.runId,
    attempt: run.envelope.attempt,
    traceId: run.envelope.traceId,
    spanPath: run.envelope.traceId,
    workerId,
  });
}


export function declareProjectionWorker(authority: AuthorityFake, workerId: string, ordinal: number): void {
  authority.putWorkerSlot({ workerId, workflow: "person-lookup", ordinal, poolIndex: ordinal, membershipRevision: 1,
    phase: "idle", retiredAt: null, retirementCommandId: null, reservationCommandId: null,
    createdAt: instantOffsetOf(0), updatedAt: instantOffsetOf(0) });
  authority.workerOwners.add(`${workerId}:1:4242:${instantOffsetOf(0)}`);
}
