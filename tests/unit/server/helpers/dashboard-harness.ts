/**
 * Shared harness for the 1g-spine projection/hub/route suites: a temp state
 * root, a real span writer chained into the real projection ("JSONL first,
 * projection after"), a Map-backed authority read fake whose records are
 * REAL `RunRecordSchema` parses (no state a production transition could not
 * produce), and an in-memory projection store implementing the repository
 * surface.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { AnyWorkflowDescriptor } from "../../../../src/base/workflow.js";
import { localDatePart, manualClock, type TestClock } from "../../../../src/domain/clock.js";
import { FingerprintSchema } from "../../../../src/domain/ids.js";
import { NotificationRecordSchema } from "../../../../src/domain/notifications.js";
import { RunRecordSchema, type RunRecord } from "../../../../src/domain/run/record.js";
import { RunEvidenceReceiptSchema, type RunEvidenceReceipt } from "../../../../src/domain/trust/evidence.js";
import { FailureRecordSchema, type FailureRecord } from "../../../../src/domain/trust/failure.js";
import type { RunCheckpointRecord } from "../../../../src/domain/workflow/checkpoint.js";
import type { WriteIntentRecord } from "../../../../src/domain/write-safety.js";
import type { RunQueuedWire } from "../../../../src/events/types.js";
import { createSpanJsonlWriter, type SpanJsonlWriter } from "../../../../src/infra/events/span-jsonl-writer.js";
import type { ProjectionRepositories } from "../../../../src/infra/sqlite/authority-database.js";
import {
  createRunQueueProjection,
  RunQueueProjection,
  type RunQueueProjectionChange,
} from "../../../../src/server/dashboard/projectors/run-queue-projection.js";
import { HASH_A, HASH_B, NOW, UUID_4 } from "../../fixtures/phase1c-contract-fixtures.js";

export const DAY = "2026-08-03";
export const AT = new Date("2026-08-03T10:00:00.000-07:00");
export const APP_VERSION = "0.1.0";
export const DESCRIPTOR_SET_HASH = FingerprintSchema.parse("d".repeat(64));

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The local day `offset` whole days after `AT`, named by the SAME function the
 * projection buckets rows with. A range test that hard-coded "2026-08-05" would
 * be asserting the harness's arithmetic; asserting `dayOffsetOf(2)` asserts the
 * projection's.
 */
export function dayOffsetOf(offset: number): string {
  return localDatePart(new Date(AT.getTime() + offset * DAY_MS));
}

/** Move the world's wall clock to the same time of day, `offset` days on. */
export function atDayOffset(world: DashboardWorld, offset: number): void {
  world.clock.setWall(new Date(AT.getTime() + offset * DAY_MS));
}

/**
 * The instant `elapsedMs` after the clock reads day `offset` — i.e. exactly
 * `elapsedMs` after the `run.queued` span a run seeded on that day carries, so
 * a duration assertion is stating the interval it means.
 */
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
  /** D179/D80: the archived-run set the projection excludes, once, for every surface. */
  readonly archived: Set<string>;
  isArchived(runId: string): boolean;
  readonly failures: Map<string, FailureRecord>;
  getFailure(failureId: string): FailureRecord | undefined;
  /** D22/D126: the already-derived receipts the `△ N` warning count reads. */
  readonly receipts: Map<string, RunEvidenceReceipt>;
  getReceipt(runId: string): RunEvidenceReceipt | undefined;
  /** Doc 09 §4.1: the durable write-safety rows the parked-write section reads. */
  readonly writeIntents: Map<string, WriteIntentRecord>;
  getWriteIntent(writeIntentId: string): WriteIntentRecord | undefined;
  putWriteIntent(record: WriteIntentRecord): void;
}

export function authorityFake(): AuthorityFake {
  const records = new Map<string, RunRecord>();
  const checkpoints = new Map<string, RunCheckpointRecord>();
  const archived = new Set<string>();
  const failures = new Map<string, FailureRecord>();
  const receipts = new Map<string, RunEvidenceReceipt>();
  const writeIntents = new Map<string, WriteIntentRecord>();
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
    archived,
    isArchived: (runId) => archived.has(runId),
    failures,
    getFailure: (failureId) => failures.get(failureId),
    receipts,
    getReceipt: (runId) => receipts.get(runId),
    writeIntents,
    getWriteIntent: (writeIntentId) => writeIntents.get(writeIntentId),
    putWriteIntent: (record) => writeIntents.set(record.writeIntentId, record),
  };
}

export interface ProjectionStoreFake {
  readonly rows: Map<string, unknown>;
  readonly clears: number[];
  withProjectionTransaction<Result>(work: (repositories: ProjectionRepositories) => Result): Result;
}

export function projectionStoreFake(): ProjectionStoreFake {
  const tables = new Map<string, Map<string, unknown>>([
    ["spans", new Map()], ["gates", new Map()], ["notes", new Map()], ["runs_view", new Map()],
  ]);
  const clears: number[] = [];
  const repository = (name: string): ProjectionRepositories["runsView"] => {
    const table = tables.get(name);
    if (table === undefined) throw new Error(`unknown projection table ${name}`);
    return Object.freeze({
      upsert: (input: unknown) => {
        const record = z.strictObject({
          projectionKey: z.string().length(64),
          payload: z.strictObject({ schemaHash: z.string().length(64), value: z.unknown() }),
          updatedAt: z.string().min(1),
        }).parse(input);
        table.set(record.projectionKey, record);
        return record as never;
      },
      get: (projectionKey: string) => table.get(projectionKey) as never,
      clear: () => {
        clears.push(table.size);
        const size = table.size;
        table.clear();
        return size;
      },
    });
  };
  return {
    rows: tables.get("runs_view") as Map<string, unknown>,
    clears,
    withProjectionTransaction: (work) => work(Object.freeze({
      spans: repository("spans"),
      gates: repository("gates"),
      notes: repository("notes"),
      runsView: repository("runs_view"),
    })),
  };
}

export interface DashboardWorld {
  readonly stateRoot: string;
  readonly clock: TestClock;
  readonly authority: AuthorityFake;
  readonly store: ProjectionStoreFake;
  readonly projection: RunQueueProjection;
  readonly writer: SpanJsonlWriter;
  readonly changes: RunQueueProjectionChange[];
  readonly scheduledRebuilds: (() => void)[];
  dispose(): void;
}

export function makeWorld(input?: Readonly<{
  declaredDetails?: ReadonlySet<string>;
  collectRebuilds?: boolean;
  /**
   * The registry the projection resolves labels, categories and runtime nodes
   * against. It defaults to resolving NOTHING — the unregistered-workflow
   * posture — so a test that wants a label has to say which descriptor it
   * expects it from.
   */
  descriptors?: { resolve(workflowId: string): AnyWorkflowDescriptor | undefined };
}>): DashboardWorld {
  const stateRoot = mkdtempSync(join(tmpdir(), "hrauto-dashboard-"));
  const clock = manualClock(AT);
  const authority = authorityFake();
  const store = projectionStoreFake();
  const scheduledRebuilds: (() => void)[] = [];
  const projection = createRunQueueProjection({
    stateRoot,
    clock,
    appVersion: APP_VERSION,
    descriptorSetHash: DESCRIPTOR_SET_HASH,
    authority,
    descriptors: input?.descriptors ?? { resolve: () => undefined },
    projectionStore: store,
    ...(input?.collectRebuilds === true
      ? { scheduleRebuild: (rebuild: () => void): void => { scheduledRebuilds.push(rebuild); } }
      : {}),
  });
  const changes: RunQueueProjectionChange[] = [];
  projection.onChange((change) => changes.push(change));
  const jsonlWriter = createSpanJsonlWriter({
    stateRoot,
    clock,
    pid: 4242,
    declaredDetails: () => input?.declaredDetails ?? new Set(["selection-status", "active-state"]),
  });
  // D218: the projection's one live feed is the disk tail. The harness ticks
  // it after every append so each emitted event folds through the same
  // read-back-from-disk path production uses.
  const writer: SpanJsonlWriter = Object.freeze({
    emit: (event: unknown): void => {
      jsonlWriter.emit(event);
      projection.ingestFromDisk();
    },
  });
  return {
    stateRoot,
    clock,
    authority,
    store,
    projection,
    writer,
    changes,
    scheduledRebuilds,
    dispose: () => rmSync(stateRoot, { recursive: true, force: true }),
  };
}

/* ── seeded rows ─────────────────────────────────────────────────────────── */

export interface SeedRunInput {
  readonly seed: number;
  readonly workflow?: string;
  readonly shape?: "single" | "preview" | "operation" | "operation-member";
  readonly parentSeed?: number;
  readonly title?: string;
  readonly hidden?: boolean;
  /** Plain-object lifecycle input; `RunRecordSchema.parse` proves it legal. */
  readonly lifecycle?: unknown;
  readonly version?: number;
  readonly claimGeneration?: number;
  readonly enqueuedAt?: string;
  /** Pending checkpoint corrections riding the envelope (D166/2i-C). */
  readonly injected?: unknown;
  /** D6: the rehearsal flag, whose one home is the envelope. */
  readonly dryRun?: boolean;
  /** The operator's own name for the run — the `rename` command's durable field. */
  readonly displayName?: string;
  /** D95's scheduling class, the `bump` command's durable target. */
  readonly priority?: "interactive" | "bulk";
  /**
   * D230's workflow ordinal. `undefined` is the READ-FORWARD arm, not a
   * convenience default — it is exactly the shape of every run enqueued before
   * schema v15, so a seed that omits it exercises the absence rather than
   * skipping it.
   */
  readonly runNumber?: number;
}

export function runRecordOf(input: SeedRunInput): RunRecord {
  const enqueuedAt = input.enqueuedAt ?? NOW;
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
      attempt: 1,
      enqueuedAt,
    },
    input: { raw: { emplId: "10873698" }, parsed: { schemaHash: HASH_B, value: { emplId: "10873698" } }, ingressSchemaHash: HASH_A },
    lifecycle: input.lifecycle ?? { state: "queued" },
    claimGeneration: input.claimGeneration ?? 0,
    ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
    ...(input.runNumber === undefined ? {} : { runNumber: input.runNumber }),
    hidden: input.hidden ?? false,
    version: input.version ?? 1,
    createdAt: enqueuedAt,
    updatedAt: enqueuedAt,
  });
}

export function queuedEventOf(world: DashboardWorld, input: SeedRunInput): RunQueuedWire {
  const record = runRecordOf(input);
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
  outcome?: "done" | "failed" | "skipped",
  notRunReason?: "condition-false" | "branch-not-selected",
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

/** The run's own `span.ended` — the settlement the fold sees before authority. */
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

/**
 * The minimum legal `FailureRecord` for a run: exactly one primary cause whose
 * `transient` flag the record's own flag must match (the schema refuses any
 * other combination), so a breakdown's transient tally is a real fact.
 */
export function failureRecordOf(input: Readonly<{
  seed: number;
  code: string;
  transient?: boolean;
  workflow?: string;
}>): FailureRecord {
  const transient = input.transient ?? false;
  return FailureRecordSchema.parse({
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

/**
 * A minimal `done-with-warnings` evidence receipt for a run — the source the
 * queue row's `△ N` count reads (D22/D126). Everything the schema does not
 * need for the warning arm is deliberately empty: the point of the fixture is
 * the warning SET and its first summary, not a second receipt derivation.
 */
export function receiptWithWarningsOf(input: Readonly<{
  seed: number;
  summaries: readonly string[];
  workflow?: string;
}>): RunEvidenceReceipt {
  return RunEvidenceReceiptSchema.parse({
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

/**
 * A receipt carrying OUTPUT facts — the queue row's `facts[]` chips (D7).
 *
 * The three arms it can author are exactly the three the row has to keep apart:
 * an `allowed` primitive becomes a chip, an `allowed` STRUCTURED value does not
 * (an object is not a chip), and a `drop`ped leaf must never reach a surface an
 * operator screenshots.
 */
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

/**
 * A receipt that was DERIVED and records no warning — the third arm of the
 * warning verdict, and the one an aggregate must keep apart from "no receipt
 * exists". They read the same on a row (both are absences) and mean opposite
 * things in a total: one run came back clean, the other was never checked.
 */
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
