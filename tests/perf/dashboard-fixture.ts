/**
 * The §7.4 measurement fixture: ONE seeded state root at legacy's real
 * volume — 1,240 queue rows on ONE day, an operation with 108 members, a
 * ≥20,000-line note corpus, and three neighbouring days so day-scoping is a
 * filter that has something to filter.
 *
 * Every row here is produced by the PRODUCTION machinery: `AuthorityDatabase`
 * with its real migrations, `runs.enqueue` / `claimNext` / `transition`, the
 * D110/D114 atomic terminalizations, the real span and note JSONL writers, and
 * the real `RunQueueProjection` folding what those writers put on disk. Nothing
 * here writes SQL, and nothing hand-builds a wire payload — a fixture that
 * bypassed a schema invariant would measure a system this repository does not
 * have. Where a builder refuses, this module throws by name.
 *
 * It is deterministic: a `manualClock`, seeded identities, and a fixed
 * composition, so two runs of `npm run perf:dashboard` measure the same world
 * and the numbers are comparable across commits. That is the whole point —
 * Track D's D4/D5 re-run this same seed and the delta is the evidence.
 *
 * Ref: `docs/plans/2026-08-20-dashboard-architecture-audit.md` §3.3 P1–P5;
 * `ref frontend-backend-integration` §7.4 (D264).
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRunResult } from "../../src/core/run-result.js";
import { manualClock, type TestClock } from "../../src/domain/clock.js";
import { ReadActiveStatus } from "../../src/domain/contracts/person-lookup/read-active-status.js";
import { deriveSchemaHash } from "../../src/domain/schema-bound-value.js";
import { RunTerminalOutboxRecordSchema } from "../../src/domain/run/terminal-outbox.js";
import type { RunRecord } from "../../src/domain/run/record.js";
import { RunCheckpointRecordSchema } from "../../src/domain/workflow/checkpoint.js";
import { createNoteJsonlWriter } from "../../src/infra/events/note-jsonl-writer.js";
import { createSpanJsonlWriter } from "../../src/infra/events/span-jsonl-writer.js";
import { createLedgerReadThrough } from "../../src/infra/ledger/ledger-read-through.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/index.js";
import { descriptorSetHash } from "../../src/server/dashboard/compose.js";
import {
  createRunQueueProjection,
  type RunQueueProjection,
} from "../../src/server/dashboard/projectors/run-queue-projection.js";
import type { ArchiveQueryDeps } from "../../src/server/dashboard/queries/archive.js";
import { createArchiveSnapshotSource } from "../../src/server/dashboard/queries/archive.js";
import type { RunDetailQueryDeps } from "../../src/server/dashboard/queries/run-detail.js";
import { createReceiptService } from "../../src/server/trust/receipt-service.js";
import { PersonLookupCanonicalInput } from "../../src/workflows/person-lookup/workflow.js";
import { personLookupDescriptor } from "../helpers/registered-workflows.js";

/* ── the declared shape ──────────────────────────────────────────────────── */

/**
 * The fixture's declared volume. `tests/unit/server/dashboard-perf-fixture-shape.test.ts`
 * asserts the seeded world matches this exactly, so a silent drift in the
 * seeder cannot quietly change what a baseline number is a number OF.
 *
 * The composition is legacy's real shape, not a round number pulled apart at
 * random: most of a day's rows are settled by the time an operator looks at
 * them, a handful are in flight, and one bulk operation carries the long tail
 * of members.
 */
export const PERF_FIXTURE_PROFILE = Object.freeze({
  /** The day every measurement is taken over. */
  day: "2026-08-12",
  /** Days seeded either side of it, so `buildDashboardDayWire`'s filter has work to do. */
  neighbouringDays: Object.freeze(["2026-08-10", "2026-08-11", "2026-08-13"] as const),
  /** Rows the day wire must serve for `day` — the §7.4 number. */
  dayRunCount: 1240,
  /** Rows seeded on EACH neighbouring day. */
  neighbouringDayRunCount: 120,
  /** Members of the one operation on `day` — the §7.4 number. */
  operationMemberCount: 108,
  /** The single-run split on `day`. Members and their group are counted separately. */
  daySingles: Object.freeze({
    done: 700,
    failed: 180,
    cancelled: 60,
    running: 5,
    awaitingApproval: 3,
    queued: 183,
  }),
  /**
   * How many `done` runs carry a DERIVED evidence receipt. D141 makes
   * derivation an on-demand act (opening a run's Receipt tab), so a day where
   * every settled run had one would be a day nobody worked: a quarter is the
   * realistic mix, and it is what puts BOTH `#warningVerdict` arms —
   * `present` and `unread` — on the same wire.
   */
  receiptRunCount: 175,
  /**
   * Note lines per run, and how many runs carry them. Every seeded run gets a
   * trail: legacy's own corpus is ~187k lines a month, and a corpus concentrated
   * on a handful of runs would make the whole-corpus scan (P3) look cheaper than
   * it is by shrinking the number of FILES the reader opens.
   */
  notesPerRun: 13,
  noteBearingRunCount: 1600,
  /** The floor the corpus must clear; the seeder's own arithmetic must beat it. */
  minimumNoteLines: 20_000,
} as const);

export const PERF_FIXTURE_WORKFLOW = personLookupDescriptor.id;

/* ── deterministic identities ────────────────────────────────────────────── */

const CONTRACT_FINGERPRINT = personLookupDescriptor.contractFingerprint;
const CONFIG_FINGERPRINT = "b".repeat(64);
const INGRESS_SCHEMA_HASH = "a".repeat(64);
const FAILURE_FINGERPRINT = "c".repeat(64);
const CONFIG_SNAPSHOT_ID = "44444444-4444-4444-8444-444444444444";
const APP_VERSION = "0.1.0";

/** Namespaced id spaces, so a run id can never collide with an item or outbox id. */
const ID_SPACE = Object.freeze({
  run: 0,
  item: 100_000_000,
  failure: 200_000_000,
  outbox: 300_000_000,
});

function uuidOf(seed: number): string {
  const digits = String(seed).padStart(12, "0");
  return `${digits.slice(0, 8)}-${digits.slice(8, 12)}-4000-8000-${digits}`;
}

/** `<code>-<HHMMSS>-<hex4>` — `TraceIdSchema`'s exact shape, unique per seed. */
function traceOf(seed: number): string {
  const seconds = seed % 86_400;
  const hh = String(Math.floor(seconds / 3600)).padStart(2, "0");
  const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `pl-${hh}${mm}${ss}-${(seed % 65_536).toString(16).padStart(4, "0")}`;
}

/* ── the seeded world ────────────────────────────────────────────────────── */

export interface PerfFixture {
  readonly root: string;
  readonly stateRoot: string;
  readonly clock: TestClock;
  readonly database: AuthorityDatabase;
  readonly projection: RunQueueProjection;
  readonly runDetail: RunDetailQueryDeps;
  readonly archive: ArchiveQueryDeps;
  readonly archiveSnapshots: ReturnType<typeof createArchiveSnapshotSource>;
  /** The identities a measurement addresses, chosen once so every run is comparable. */
  readonly runIds: Readonly<{
    /** A settled `done` run WITH a derived receipt and a note trail — the logs/archive subject. */
    measuredRun: string;
    /** The 108-member operation — the `#memberPreview` subject. */
    operationRun: string;
    /** A plain single row, the control `queueSurface` cost is measured against. */
    singleRun: string;
  }>;
  /** Runs, in day-wire order, that a per-run measurement may sample. */
  readonly sampleRunIds: readonly string[];
  /** What the seeder actually produced, for the shape smoke test. */
  readonly seeded: Readonly<{
    dayRunCount: number;
    neighbouringRunCount: number;
    operationMemberCount: number;
    noteLines: number;
    receiptCount: number;
  }>;
  close(): void;
}

interface SeedContext {
  readonly database: AuthorityDatabase;
  readonly clock: TestClock;
  readonly spans: { emit(event: unknown): void };
  readonly notes: { emitNote(input: unknown): unknown };
}

interface RunSpec {
  readonly seed: number;
  readonly day: string;
  readonly title: string;
  readonly shape?: "single" | "operation" | "operation-member";
  readonly parentSeed?: number;
}

/** Noon local on the given day, offset by the seed so rows sort stably. */
function instantOf(day: string, seed: number): Date {
  const at = new Date(`${day}T09:00:00.000-07:00`);
  return new Date(at.getTime() + (seed % 20_000) * 1000);
}

function enqueueRun(context: SeedContext, spec: RunSpec): RunRecord {
  const runId = uuidOf(ID_SPACE.run + spec.seed);
  const traceId = traceOf(spec.seed);
  const shape = spec.shape ?? "single";
  const at = instantOf(spec.day, spec.seed);
  const now = at.toISOString();
  // The span writer names its stream file from the clock, and the projection
  // buckets a row by its `run.queued` ts — so the two must agree or a row
  // would land in a file whose date it does not belong to.
  context.clock.setWall(at);
  const parent = spec.parentSeed === undefined
    ? undefined
    : {
      runId: uuidOf(ID_SPACE.run + spec.parentSeed),
      tracePrefix: traceOf(spec.parentSeed),
      edgeId: "members",
    };

  const inserted = context.database.authority.runs.enqueue({
    envelope: {
      runId,
      workflow: PERF_FIXTURE_WORKFLOW,
      itemId: uuidOf(ID_SPACE.item + spec.seed),
      traceId,
      descriptorVersion: personLookupDescriptor.version,
      contractFingerprint: CONTRACT_FINGERPRINT,
      resolvedInstance: { ucpath: "prod", crm: "prod" },
      configFingerprint: CONFIG_FINGERPRINT,
      configSnapshotId: CONFIG_SNAPSHOT_ID,
      ...(parent === undefined ? {} : { parent }),
      shape,
      priority: "interactive",
      dryRun: false,
      attempt: 1,
      enqueuedAt: now,
    },
    input: {
      raw: { emplId: "10873698" },
      parsed: {
        schemaHash: deriveSchemaHash(PersonLookupCanonicalInput, "output"),
        value: { emplId: "10873698", keepNonHdh: false, includeCrmDates: false },
      },
      ingressSchemaHash: INGRESS_SCHEMA_HASH,
    },
    lifecycle: { state: "queued" },
    claimGeneration: 0,
    // D179: every real enqueue stamps the build it was enqueued under
    // (`command-kernel.ts`, `run-fan-out.ts`). Omitting it here would seed
    // every run onto the pre-D179 "absent" arm — a state production has not
    // produced since — and understate what the archive/version-bump reads
    // this fixture measures actually do.
    appVersion: APP_VERSION,
    runNumber: context.database.authority.runs.nextWorkflowRunNumber(PERF_FIXTURE_WORKFLOW),
    version: 1,
    createdAt: now,
    updatedAt: now,
  });

  context.spans.emit({
    t: "run.queued",
    kind: "run",
    ts: now,
    workflow: PERF_FIXTURE_WORKFLOW,
    runId,
    attempt: 1,
    traceId,
    spanPath: traceId,
    itemId: inserted.record.envelope.itemId,
    ...(parent === undefined ? {} : { parentRunId: parent.runId }),
    shape,
    priority: "interactive",
    dryRun: false,
    actorId: "local-operator",
    title: spec.title,
    descriptorVersion: personLookupDescriptor.version,
    contractFingerprint: CONTRACT_FINGERPRINT,
    resolvedInstance: { ucpath: "prod", crm: "prod" },
    configFingerprint: CONFIG_FINGERPRINT,
    configSnapshotId: CONFIG_SNAPSHOT_ID,
  });
  return inserted.record;
}

/** Enqueue → claim → validating → running, through production transitions only. */
function startRunning(context: SeedContext, spec: RunSpec, workerId: string, nodeId: string): RunRecord {
  const enqueued = enqueueRun(context, spec);
  const now = enqueued.envelope.enqueuedAt;
  const claimed = context.database.authority.runs.claimNext({
    workflow: PERF_FIXTURE_WORKFLOW,
    workerId,
    now,
  });
  if (claimed.state !== "claimed") {
    throw new Error(`perf seed ${String(spec.seed)} was not claimed by ${workerId}: ${claimed.state}`);
  }
  const runId = claimed.run.envelope.runId;
  if (runId !== enqueued.envelope.runId) {
    throw new Error(
      `claimNext took ${runId}, not the just-enqueued ${enqueued.envelope.runId}; the perf seeder's `
      + "claim ordering is wrong and every status below it would be mislabelled",
    );
  }
  const claim = { workerId, claimGeneration: claimed.run.claimGeneration };
  const claimFields = { workerId, claimedAt: now, heartbeatAt: now };

  context.spans.emit({
    t: "run.claimed",
    ts: now,
    workflow: PERF_FIXTURE_WORKFLOW,
    runId,
    attempt: 1,
    traceId: claimed.run.envelope.traceId,
    spanPath: claimed.run.envelope.traceId,
    workerId,
  });

  const validating = context.database.authority.runs.transition({
    runId,
    expectedVersion: claimed.run.version,
    claim,
    lifecycle: { state: "validating", ...claimFields },
    now,
  });
  if (validating.state !== "applied") throw new Error(`run ${runId} did not enter validating`);
  const running = context.database.authority.runs.transition({
    runId,
    expectedVersion: validating.run.version,
    claim,
    lifecycle: { state: "running", ...claimFields, currentNodeId: nodeId },
    now,
  });
  if (running.state !== "applied") throw new Error(`run ${runId} did not enter running`);
  return running.run;
}

function taskSpan(
  context: SeedContext,
  run: RunRecord,
  node: string,
  outcome?: "done" | "failed" | "skipped",
): void {
  const traceId = run.envelope.traceId;
  const base = {
    ts: run.envelope.enqueuedAt,
    workflow: PERF_FIXTURE_WORKFLOW,
    runId: run.envelope.runId,
    attempt: 1,
    traceId,
  } as const;
  context.spans.emit({
    ...base,
    t: "span.started",
    kind: "task",
    spanPath: `${traceId}/${node}#1`,
    parentSpanPath: traceId,
    name: node,
  });
  if (outcome !== undefined) {
    context.spans.emit({ ...base, t: "span.ended", kind: "task", spanPath: `${traceId}/${node}#1`, outcome });
  }
}

function claimOf(run: RunRecord): { workerId: string; claimGeneration: number } {
  if (!("workerId" in run.lifecycle)) {
    throw new Error(`run ${run.envelope.runId} holds no claim to authorize a terminal transition`);
  }
  return { workerId: run.lifecycle.workerId, claimGeneration: run.claimGeneration };
}

function terminalizeFailed(context: SeedContext, run: RunRecord, seed: number): void {
  const now = run.envelope.enqueuedAt;
  context.database.terminalizeFailure(personLookupDescriptor, {
    failure: {
      failureId: uuidOf(ID_SPACE.failure + seed),
      fingerprint: FAILURE_FINGERPRINT,
      runId: run.envelope.runId,
      traceId: run.envelope.traceId,
      attempt: run.envelope.attempt,
      workflowId: run.envelope.workflow,
      nodeId: "crm-dates",
      taskId: "crm/read-onboarding-dates",
      code: "CRM_UNAVAILABLE",
      summary: "CRM onboarding dates were unavailable",
      transient: true,
      writeState: "not-attempted",
      causeChain: [{
        code: "CRM_UNAVAILABLE",
        summary: "CRM returned an unavailable response",
        role: "primary",
        transient: true,
      }],
      remediation: [{ kind: "retry-when-served", message: "Retry after CRM is available" }],
      occurredAt: now,
    },
    authorization: {
      kind: "failed",
      runId: run.envelope.runId,
      workflowId: run.envelope.workflow,
      attempt: run.envelope.attempt,
      descriptorVersion: run.envelope.descriptorVersion,
      contractFingerprint: run.envelope.contractFingerprint,
      expectedVersion: run.version,
      claim: claimOf(run),
      authorizedAt: now,
      failureId: uuidOf(ID_SPACE.failure + seed),
    },
  });
}

function terminalizeDone(context: SeedContext, run: RunRecord, seed: number): void {
  const now = run.envelope.enqueuedAt;
  const checkpoint = RunCheckpointRecordSchema.parse({
    workflowId: run.envelope.workflow,
    itemId: run.envelope.itemId,
    nodeId: "active-status",
    attempt: run.envelope.attempt,
    claimGeneration: 1,
    runId: run.envelope.runId,
    output: {
      schemaHash: deriveSchemaHash(ReadActiveStatus.output, "output"),
      value: {
        state: "active",
        reason: "UCPath reports an active HDH appointment and CRM onboarding is complete",
        hdh: true,
      },
    },
    descriptorVersion: run.envelope.descriptorVersion,
    contractFingerprint: CONTRACT_FINGERPRINT,
    implFingerprint: CONFIG_FINGERPRINT,
    provenance: [{ path: "state", source: "derived", observedAt: now, originalObservedAt: now }],
    writtenAt: now,
  });
  context.database.authority.runCheckpoints.insert(checkpoint);

  const built = buildRunResult(
    personLookupDescriptor,
    run,
    [
      { state: "resolved", nodeId: "active-status", checkpoint },
      { state: "not-run", nodeId: "crm-dates", reason: "condition-false" },
    ],
    manualClock(new Date(now)),
  );
  const result = built.record;
  const outbox = RunTerminalOutboxRecordSchema.parse({
    outboxId: uuidOf(ID_SPACE.outbox + seed),
    payload: {
      kind: "run-terminal-result",
      runId: result.runId,
      workflowId: result.workflowId,
      attempt: result.attempt,
      resultDigest: result.resultDigest,
    },
    projection: { state: "pending" },
    createdAt: result.createdAt,
  });
  context.database.terminalizeSuccess({
    result,
    outbox,
    authorization: {
      kind: "done",
      runId: result.runId,
      workflowId: result.workflowId,
      attempt: result.attempt,
      descriptorVersion: result.descriptorVersion,
      contractFingerprint: result.contractFingerprint,
      expectedVersion: run.version,
      claim: claimOf(run),
      authorizedAt: now,
      resultDigest: result.resultDigest,
      outboxId: outbox.outboxId,
    },
  }, built.authorization);
}

function cancel(context: SeedContext, run: RunRecord): void {
  const now = run.envelope.enqueuedAt;
  const applied = context.database.authority.runs.transition({
    runId: run.envelope.runId,
    expectedVersion: run.version,
    claim: claimOf(run),
    lifecycle: { state: "terminal", outcome: "cancelled", endedAt: now },
    now,
  });
  if (applied.state !== "applied") throw new Error(`the perf seed's cancel transition answered ${applied.state}`);
}

/* ── the seed ────────────────────────────────────────────────────────────── */

/** Seed number ranges, one per status class, so an id says what it is. */
const SEEDS = Object.freeze({
  done: 1_000,
  failed: 2_000,
  cancelled: 3_000,
  running: 4_000,
  awaitingApproval: 4_100,
  queued: 5_000,
  operation: 6_000,
  operationMember: 6_001,
  neighbouring: 10_000,
});

/** Workers a terminal run may reuse: the run settles, so the id frees itself. */
const TERMINAL_WORKERS = Object.freeze(["perf-worker-1", "perf-worker-2", "perf-worker-3"] as const);

interface SeededRun {
  readonly runId: string;
  readonly day: string;
  readonly traceId: string;
  readonly attempt: number;
}

interface SeedTally {
  readonly all: SeededRun[];
  readonly doneRunIds: string[];
  dayRunCount: number;
  neighbouringRunCount: number;
}

function remember(tally: SeedTally, run: RunRecord, day: string): void {
  tally.all.push({
    runId: run.envelope.runId,
    day,
    traceId: run.envelope.traceId,
    attempt: run.envelope.attempt,
  });
  if (day === PERF_FIXTURE_PROFILE.day) tally.dayRunCount += 1;
  else tally.neighbouringRunCount += 1;
}

/**
 * Pass A — every run that gets CLAIMED, on every day.
 *
 * It runs before pass B for one reason that is not cosmetic: `claimNext` takes
 * the OLDEST queued row for the workflow, so a row that must STAY queued cannot
 * exist while any claim is still to be made. Seeding the two passes in the other
 * order would silently hand a claim the wrong run and mislabel its status.
 */
function seedClaimedRuns(context: SeedContext, tally: SeedTally): void {
  const { day, neighbouringDays, daySingles } = PERF_FIXTURE_PROFILE;
  let workerTurn = 0;
  const nextWorker = (): string => {
    const worker = TERMINAL_WORKERS[workerTurn % TERMINAL_WORKERS.length];
    workerTurn += 1;
    return worker;
  };

  for (let index = 0; index < daySingles.done; index += 1) {
    const seed = SEEDS.done + index;
    const run = startRunning(context, { seed, day, title: `EID 108${String(70000 + index)}` }, nextWorker(), "active-status");
    taskSpan(context, run, "searching", "done");
    taskSpan(context, run, "cross-verify", "done");
    taskSpan(context, run, "active-status", "done");
    terminalizeDone(context, run, seed);
    tally.doneRunIds.push(run.envelope.runId);
    remember(tally, run, day);
  }
  for (let index = 0; index < daySingles.failed; index += 1) {
    const seed = SEEDS.failed + index;
    const run = startRunning(context, { seed, day, title: `EID 106${String(90000 + index)}` }, nextWorker(), "crm-dates");
    taskSpan(context, run, "searching", "done");
    taskSpan(context, run, "crm-dates", "failed");
    terminalizeFailed(context, run, seed);
    remember(tally, run, day);
  }
  for (let index = 0; index < daySingles.cancelled; index += 1) {
    const seed = SEEDS.cancelled + index;
    const run = startRunning(context, { seed, day, title: `EID 102${String(20000 + index)}` }, nextWorker(), "searching");
    taskSpan(context, run, "searching", "done");
    cancel(context, run);
    remember(tally, run, day);
  }
  // In-flight rows hold their worker for good, so each gets its own id.
  for (let index = 0; index < daySingles.running; index += 1) {
    const seed = SEEDS.running + index;
    const run = startRunning(
      context,
      { seed, day, title: `EID 104${String(40000 + index)}` },
      `perf-live-worker-${String(index + 1)}`,
      "searching",
    );
    taskSpan(context, run, "searching");
    remember(tally, run, day);
  }
  for (let index = 0; index < daySingles.awaitingApproval; index += 1) {
    const seed = SEEDS.awaitingApproval + index;
    const run = startRunning(
      context,
      { seed, day, title: `EID 105${String(50000 + index)}` },
      `perf-gate-worker-${String(index + 1)}`,
      "cross-verify",
    );
    taskSpan(context, run, "searching", "done");
    context.spans.emit({
      t: "gate.opened",
      ts: run.envelope.enqueuedAt,
      workflow: PERF_FIXTURE_WORKFLOW,
      runId: run.envelope.runId,
      attempt: 1,
      traceId: run.envelope.traceId,
      spanPath: `${run.envelope.traceId}/cross-verify#1`,
      gate: "identity-review",
    });
    remember(tally, run, day);
  }

  for (const [dayIndex, neighbouringDay] of neighbouringDays.entries()) {
    const base = SEEDS.neighbouring + dayIndex * 1_000;
    for (let index = 0; index < PERF_FIXTURE_PROFILE.neighbouringDayRunCount / 2; index += 1) {
      const seed = base + index;
      const run = startRunning(
        context,
        { seed, day: neighbouringDay, title: `EID 109${String(10000 + seed)}` },
        nextWorker(),
        "active-status",
      );
      taskSpan(context, run, "searching", "done");
      taskSpan(context, run, "active-status", "done");
      terminalizeDone(context, run, seed);
      tally.doneRunIds.push(run.envelope.runId);
      remember(tally, run, neighbouringDay);
    }
  }
}

/** Pass B — every row that stays QUEUED, including the operation and its members. */
function seedQueuedRuns(context: SeedContext, tally: SeedTally): void {
  const { day, neighbouringDays, daySingles, operationMemberCount } = PERF_FIXTURE_PROFILE;
  for (let index = 0; index < daySingles.queued; index += 1) {
    const seed = SEEDS.queued + index;
    remember(tally, enqueueRun(context, { seed, day, title: `EID 103${String(30000 + index)}` }), day);
  }
  remember(
    tally,
    enqueueRun(context, {
      seed: SEEDS.operation,
      day,
      title: `Onboarding packet — ${String(operationMemberCount)} people`,
      shape: "operation",
    }),
    day,
  );
  for (let index = 0; index < operationMemberCount; index += 1) {
    remember(
      tally,
      enqueueRun(context, {
        seed: SEEDS.operationMember + index,
        day,
        title: `Member ${String(index + 1)}`,
        shape: "operation-member",
        parentSeed: SEEDS.operation,
      }),
      day,
    );
  }
  for (const [dayIndex, neighbouringDay] of neighbouringDays.entries()) {
    const base = SEEDS.neighbouring + dayIndex * 1_000 + 500;
    for (let index = 0; index < PERF_FIXTURE_PROFILE.neighbouringDayRunCount / 2; index += 1) {
      const seed = base + index;
      remember(
        tally,
        enqueueRun(context, { seed, day: neighbouringDay, title: `EID 107${String(70000 + seed)}` }),
        neighbouringDay,
      );
    }
  }
}

const NOTE_LEVELS = Object.freeze(["step", "step", "step", "warn", "step", "step", "error"] as const);

/** Every seeded run gets the same shaped note trail, on its own day's file. */
function seedNotes(context: SeedContext, tally: SeedTally): number {
  const { notesPerRun, noteBearingRunCount } = PERF_FIXTURE_PROFILE;
  let lines = 0;
  for (const run of tally.all.slice(0, noteBearingRunCount)) {
    context.clock.setWall(new Date(`${run.day}T09:30:00.000-07:00`));
    for (let index = 0; index < notesPerRun; index += 1) {
      context.notes.emitNote({
        workflow: PERF_FIXTURE_WORKFLOW,
        address: {
          runId: run.runId,
          attempt: run.attempt,
          traceId: run.traceId,
          spanPath: run.traceId,
        },
        level: NOTE_LEVELS[index % NOTE_LEVELS.length],
        message: `step ${String(index + 1)} of the person lookup — UCPath person search page ${String(index)}`,
      });
      lines += 1;
    }
  }
  return lines;
}

/* ── composition ─────────────────────────────────────────────────────────── */

/**
 * Seeds the fixture and returns the production query surfaces bound to it.
 * The caller MUST `close()`: the state root is a `mkdtemp` directory, never
 * `.tracker`, so a benchmark can never touch a real runtime's state.
 */
export function seedDashboardPerfFixture(): PerfFixture {
  const root = mkdtempSync(join(tmpdir(), "hrauto-perf-dashboard-"));
  const stateRoot = join(root, "state");
  const clock = manualClock(new Date(`${PERF_FIXTURE_PROFILE.day}T09:00:00.000-07:00`));
  const database = AuthorityDatabase.open(
    { path: join(root, "authority.sqlite"), busyTimeoutMs: 1000, migrationOwner: "dashboard-perf-fixture" },
    clock,
  );
  const spans = createSpanJsonlWriter({ stateRoot, clock, pid: 4242 });
  const notes = createNoteJsonlWriter({ stateRoot, clock, pid: 4242 });
  const context: SeedContext = { database, clock, spans, notes };

  const tally: SeedTally = { all: [], doneRunIds: [], dayRunCount: 0, neighbouringRunCount: 0 };
  seedClaimedRuns(context, tally);
  seedQueuedRuns(context, tally);
  const noteLines = seedNotes(context, tally);
  if (noteLines < PERF_FIXTURE_PROFILE.minimumNoteLines) {
    throw new Error(
      `the perf fixture seeded ${String(noteLines)} note lines, below its declared floor of `
      + `${String(PERF_FIXTURE_PROFILE.minimumNoteLines)}; the P3 scan would be measured over a corpus `
      + "smaller than the one the finding is about",
    );
  }

  const descriptors = {
    resolve: (workflowId: string) =>
      (workflowId === PERF_FIXTURE_WORKFLOW ? personLookupDescriptor : undefined),
  };
  const projection = createRunQueueProjection({
    stateRoot,
    clock,
    appVersion: APP_VERSION,
    descriptorSetHash: descriptorSetHash([CONTRACT_FINGERPRINT]),
    ledger: createLedgerReadThrough(stateRoot),
    authority: {
      getRun: (runId) => database.authority.runs.get(runId),
      listNotifications: (actorId: string) => database.authority.notifications.listByActor(actorId),
      listLiveWorkerLeases: () => database.authority.workerLeases.listLive(),
      getWorkerLease: (workerId: string) => database.authority.workerLeases.get(workerId),
      listWorkerPools: () => database.authority.workerPools.list(),
      isArchived: (runId: string) => database.authority.archivedRuns.isArchived(runId),
      getFailure: (failureId: string) => database.authority.failures.get(failureId),
      getReceipt: (runId: string) => database.authority.evidenceReceipts.findByRun(runId),
      listActivityPersonPseudonyms: (runIds: readonly string[]) => database.authority.activityPersonPseudonyms.listByRuns(runIds),
      latestCheckpoint: (workflowId: string, itemId: string, nodeId: string) =>
        database.authority.runCheckpoints.latest(workflowId, itemId, nodeId),
    },
    descriptors,
    projectionStore: database,
  });
  // D218: the production feed is the disk tail. Every span above is already on
  // disk, so ONE ingest folds the whole corpus through the same path a booting
  // dashboard uses.
  projection.ingestFromDisk();

  const trust = createReceiptService({ database, descriptors: [personLookupDescriptor] });
  // D141: a receipt exists because somebody opened the run. Deriving a subset
  // is what a real day looks like, and it is what puts both `#warningVerdict`
  // arms on one wire.
  for (const runId of tally.doneRunIds.slice(0, PERF_FIXTURE_PROFILE.receiptRunCount)) {
    trust.ensureReceipt(runId);
  }

  const runDetail: RunDetailQueryDeps = {
    stateRoot,
    projection,
    authority: {
      getRun: (runId: string) => database.authority.runs.get(runId),
      latestCheckpoint: (workflowId: string, itemId: string, nodeId: string) =>
        database.authority.runCheckpoints.latest(workflowId, itemId, nodeId),
      getWriteIntent: (writeIntentId: string) => database.authority.writeIntents.get(writeIntentId),
      listGateResults: (runId: string) => database.authority.gateResults.listByRun(runId),
    },
    descriptors,
    trust,
  };
  const archive: ArchiveQueryDeps = {
    clock,
    appVersion: APP_VERSION,
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    descriptors: {
      list: () => [{
        id: personLookupDescriptor.id,
        label: personLookupDescriptor.label,
        code: "pl",
        version: personLookupDescriptor.version,
        contractFingerprint: CONTRACT_FINGERPRINT,
      }],
    },
    ledger: createLedgerReadThrough(stateRoot),
  };

  return Object.freeze({
    root,
    stateRoot,
    clock,
    database,
    projection,
    runDetail,
    archive,
    archiveSnapshots: createArchiveSnapshotSource(runDetail),
    runIds: Object.freeze({
      measuredRun: uuidOf(ID_SPACE.run + SEEDS.done),
      operationRun: uuidOf(ID_SPACE.run + SEEDS.operation),
      singleRun: uuidOf(ID_SPACE.run + SEEDS.queued),
    }),
    sampleRunIds: Object.freeze(
      Array.from({ length: 5 }, (_unused, index) => uuidOf(ID_SPACE.run + SEEDS.done + index)),
    ),
    seeded: Object.freeze({
      dayRunCount: tally.dayRunCount,
      neighbouringRunCount: tally.neighbouringRunCount,
      operationMemberCount: PERF_FIXTURE_PROFILE.operationMemberCount,
      noteLines,
      receiptCount: Math.min(tally.doneRunIds.length, PERF_FIXTURE_PROFILE.receiptRunCount),
    }),
    close: (): void => {
      database.close();
      rmSync(root, { recursive: true, force: true });
    },
  });
}
