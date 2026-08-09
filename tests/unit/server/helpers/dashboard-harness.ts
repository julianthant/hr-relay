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
import { manualClock, type TestClock } from "../../../../src/domain/clock.js";
import { FingerprintSchema } from "../../../../src/domain/ids.js";
import { RunRecordSchema, type RunRecord } from "../../../../src/domain/run/record.js";
import type { RunQueuedWire, SpanEventWire } from "../../../../src/events/types.js";
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

export function uuidOf(seed: number): string {
  const tail = String(seed).padStart(4, "0");
  return `${tail.repeat(2)}-${tail}-4${tail.slice(1)}-8${tail.slice(1)}-${tail.repeat(3)}`;
}

export function traceOf(seed: number): string {
  return `pl-10000${String(seed % 10)}-${uuidOf(seed).slice(0, 4)}`;
}

export interface AuthorityFake {
  readonly records: Map<string, RunRecord>;
  getRun(runId: string): RunRecord | undefined;
  put(record: RunRecord): void;
  listNotifications(actorId: string): readonly never[];
}

export function authorityFake(): AuthorityFake {
  const records = new Map<string, RunRecord>();
  return {
    records,
    getRun: (runId) => records.get(runId),
    put: (record) => records.set(record.envelope.runId, record),
    listNotifications: () => [],
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
    descriptors: { resolve: () => undefined },
    projectionStore: store,
    ...(input?.collectRebuilds === true
      ? { scheduleRebuild: (rebuild: () => void): void => { scheduledRebuilds.push(rebuild); } }
      : {}),
  });
  const changes: RunQueueProjectionChange[] = [];
  projection.onChange((change) => changes.push(change));
  const writer = createSpanJsonlWriter({
    stateRoot,
    clock,
    pid: 4242,
    declaredDetails: () => input?.declaredDetails ?? new Set(["selection-status", "active-state"]),
    onEvent: (event: SpanEventWire) => projection.apply(event),
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
      priority: "interactive",
      dryRun: false,
      attempt: 1,
      enqueuedAt,
    },
    input: { raw: { emplId: "10873698" }, parsed: { schemaHash: HASH_B, value: { emplId: "10873698" } }, ingressSchemaHash: HASH_A },
    lifecycle: input.lifecycle ?? { state: "queued" },
    claimGeneration: input.claimGeneration ?? 0,
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
    priority: "interactive",
    dryRun: false,
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
