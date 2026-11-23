import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, describe, it, vi } from "vitest";
import { createDebugEventWriter } from "../../../../src/backend/logs/debug-events.js";
import { startLoopDelayMonitor } from "../../../../src/backend/logs/loop-delay.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { createRunSearchIndex } from "../../../../src/backend/storage/sqlite/run-search-index.js";
import { doctorAuthorityStorage as inspectStorage } from "../../../../src/backend/storage/sqlite/storage-doctor.js";
import { runRecordColumns } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { createTimelineRepository } from "../../../../src/backend/storage/sqlite/timeline-repository.js";
import { RunRecordSchema, type RunRecord } from "../../../../src/models/run/record.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { fillDiagnosticBudget } from "../../../support/helpers/backend/full-diagnostic-budget.js";
import { CONFIG_SNAPSHOT, NOW } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { boundProfileCredentials, createProfileFixtureSet, type BoundProfileStorageFixture } from "../../../support/helpers/admission-fixture.js";
import { AuthorityDatabase, doctorAuthorityStorage } from "../../../support/helpers/synthetic-storage-admission.js";

vi.mock("node:perf_hooks", async importOriginal => ({
  ...await importOriginal<typeof import("node:perf_hooks")>(),
  monitorEventLoopDelay: () => ({ max: 250_000_000, enable() {}, disable() {}, reset() {} }),
}));

const profiles = createProfileFixtureSet();
const heldProfiles: BoundProfileStorageFixture[] = [];
afterAll(() => profiles.close());
afterEach(async () => {
  for (const profile of heldProfiles.splice(0)) await profile.close();
});
const clock = manualClock(new Date(NOW));
/** The whole-timeline cap the doctor used to refuse at: `timeline-doctor-payload-limit-exceeded: 16777216 bytes`. */
const OLD_WHOLE_TIMELINE_BYTES = 16 * 1024 * 1024;
const PAGE_ROWS = 500;

function run(index: number): RunRecord {
  return RunRecordSchema.parse({
    ...QUEUED_RUN,
    envelope: {
      ...QUEUED_RUN.envelope,
      runId: randomUUID(), itemId: randomUUID(), traceId: `pl-120000-${index.toString(16).padStart(4, "0")}`,
      priority: "interactive", dryRun: true, resolvedInstance: { ucpath: "prod" },
      configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId, configFingerprint: CONFIG_SNAPSHOT.fingerprint,
    },
  });
}

function rootEvent(record: RunRecord) {
  const e = record.envelope;
  return {
    t: "run.queued", kind: "run", ts: e.enqueuedAt, workflow: e.workflow,
    runId: e.runId, attempt: e.attempt, traceId: e.traceId, spanPath: e.traceId,
    itemId: e.itemId, shape: e.shape, priority: e.priority, dryRun: e.dryRun,
    actorId: "local-operator", title: "Redacted test run",
    descriptorVersion: e.descriptorVersion, contractFingerprint: e.contractFingerprint,
    resolvedInstance: e.resolvedInstance, configFingerprint: e.configFingerprint,
    configSnapshotId: e.configSnapshotId,
  };
}

function taskSpan(record: RunRecord, t: "span.started" | "span.ended", index: number) {
  const e = record.envelope;
  return {
    t, kind: "task", ts: NOW, workflow: e.workflow, runId: e.runId, attempt: e.attempt, traceId: e.traceId,
    spanPath: `${e.traceId}/searching#${String(index)}`, parentSpanPath: e.traceId,
    ...(t === "span.started" ? { name: "searching" } : { outcome: "done" }),
  };
}

const AUTHORITY_RECONSTRUCTION = {
  kind: "authority-reconstruction", repairedAt: NOW, sourceAuthorityGeneration: 0,
  sourceAuthorityFingerprint: "a".repeat(64), priorStreamBytes: 0, priorStreamSha256: "b".repeat(64),
} as const;

async function store(runs: readonly RunRecord[], write: (emit: (event: Readonly<Record<string, unknown>>) => void, database: AuthorityDatabase) => void) {
  const profile = await profiles.create(); heldProfiles.push(profile);
  const root = profile.stateRoot, authorityPath = profile.path;
  const database = AuthorityDatabase.open({ path: authorityPath, busyTimeoutMs: 500, migrationOwner: "timeline-volume-test" }, clock);
  try {
    database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    database.withAuthorityTransaction(() => {
      for (const record of runs) database.authority.runs.enqueue(record);
      const emitter = createTimelineEmitter({ repository: database.authority.timelineEvents, clock, pid: 4242 });
      write((event) => emitter.emit(event), database);
    });
  } finally {
    database.close();
  }
  const raw = new DatabaseSync(authorityPath, { readOnly: true });
  const totals = (() => {
    try {
      return raw.prepare(`SELECT sum(length(CAST(payload_json AS BLOB)))
          + (SELECT COALESCE(sum(length(CAST(payload_json AS BLOB))),0) FROM debug_events) AS bytes,
        sum(kind <> 'note') AS inspected FROM timeline_events`).get() as { bytes: number; inspected: number };
    } finally { raw.close(); }
  })();
  return {
    profile,
    authorityPath,
    totals,
    doctor: () => doctorAuthorityStorage({
      stateRootTrustAnchor: root, stateRoot: root, authorityPath,
      backupDirectory: join(root, "backups", "authority"), busyTimeoutMs: 500,
    }, clock),
  };
}

describe("storage doctor on a long-lived timeline", () => {
  it("stays healthy and reconciles every run past the old 16 MiB timeline cap", async () => {
    const runs = Array.from({ length: PAGE_ROWS + 20 }, (_, index) => run(index));
    const f = await store(runs, (emit, database) => {
      for (const record of runs) emit(rootEvent(record));
      const debug = createDebugEventWriter({ repository: database.authority.timelineEvents, clock, build: "test", writeStderr() {} });
      for (let bytes = 0; bytes <= OLD_WHOLE_TIMELINE_BYTES; bytes += 60_000) {
        debug.emit({ category: "boot", phase: "failed", correlationId: randomUUID(), area: "diagnostic-retention",
          reason: "purge-failed", message: "m".repeat(60_000) });
      }
    });
    assert.ok(f.totals.bytes > OLD_WHOLE_TIMELINE_BYTES, String(f.totals.bytes));
    assert.ok(f.totals.inspected > PAGE_ROWS, String(f.totals.inspected));
    const report = await f.doctor();
    assert.equal(report.authority.state, "healthy");
    assert.deepEqual(report.spanAuthority, { state: "reconciled", streamRunCount: runs.length, liveRunCount: runs.length, deleted: [] });
  });

  it("reconciles all 10,001 distinct runs in a healthy store", async () => {
    const f = await store([], () => {});
    // Bulk-load native rows in one fixture transaction. The doctor independently checks their mirrors and identities.
    const raw = new DatabaseSync(f.authorityPath);
    try {
      raw.exec("BEGIN");
      const search = createRunSearchIndex(raw);
      search.installTracking();
      const prior = search.publication();
      const keys = Object.keys(runRecordColumns(run(0)));
      const insert = raw.prepare(`INSERT INTO runs (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`);
      const timeline = createTimelineRepository({ database: raw, read: read => read(), mutate: write => write().result,
        assertOwner: () => {} });
      const emitter = createTimelineEmitter({ repository: timeline, clock, pid: 4242 });
      for (let index = 0; index < 10_001; index++) {
        const record = run(index);
        insert.run(...Object.values(runRecordColumns(record)));
        emitter.emit(rootEvent(record));
      }
      const generation = raw.prepare(`UPDATE database_states SET authority_generation=authority_generation+1,
        updated_at=?, search_state='invalid', search_generation=NULL WHERE id=1 RETURNING authority_generation`).get(NOW)?.authority_generation;
      assert.ok(typeof generation === "number");
      search.publishChanges(generation, NOW, prior);
      raw.exec("COMMIT");
    } finally { raw.close(); }
    const { admission, workspace, stateRoot } = f.profile;
    const report = await inspectStorage(admission, {
      stateRootTrustAnchor: workspace, stateRoot, authorityPath: f.authorityPath,
      backupDirectory: join(stateRoot, "backups", "authority"), busyTimeoutMs: 500,
    }, clock, boundProfileCredentials(admission), undefined, true);
    assert.deepEqual(report.spanAuthority, { state: "reconciled", streamRunCount: 10_001, liveRunCount: 10_001, deleted: [] });
    assert.equal(report.authority.state, "healthy");
    assert.equal(report.protectedSettings.state, "available");
    assert.equal(report.authorityUpgrades.state, "available");
  });

  it("publishes a queued run when ordinary diagnostics already occupy 250 MiB", async () => {
    const record = run(0);
    const f = await store([record], () => {});
    const database = AuthorityDatabase.open({ path: f.authorityPath, busyTimeoutMs: 500, migrationOwner: "timeline-volume-test" }, clock);
    try {
      const timeline = database.authority.timelineEvents;
      const debugEvents = createDebugEventWriter({ repository: timeline, clock, build: "test" });
      fillDiagnosticBudget(DatabaseSync, f.authorityPath, timeline, clock);
      const beforeStall = timeline.debugHighWaterMark();
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const monitorClock = manualClock(new Date(NOW));
      const monitor = startLoopDelayMonitor({ clock: monitorClock, debugEvents });
      try {
        vi.advanceTimersByTime(1000);
        assert.equal(timeline.debugHighWaterMark(), beforeStall);
        createTimelineEmitter({ repository: timeline, clock, pid: 4242 }).emit(rootEvent(record));
        const rows = timeline.page({ runId: record.envelope.runId });
        assert.equal(rows.length, 1);
        assert.equal(rows[0]?.payload.kind, "span");
        const afterRoot = timeline.debugHighWaterMark();
        const peer = new DatabaseSync(f.authorityPath);
        try { peer.exec("DELETE FROM debug_events WHERE cursor<=500"); }
        finally { peer.close(); }
        monitorClock.advanceMonotonic(10_000);
        vi.advanceTimersByTime(1000);
        const resumed = timeline.debugPage({ after: afterRoot });
        assert.equal(resumed.length, 1);
        const payload = resumed[0].payload;
        assert.equal(payload.kind, "debug");
        assert.equal(payload.event.reason, "event-loop-stall");
        assert.equal(payload.event.omitted, 1);
      } finally { monitor.stop(); vi.useRealTimers(); }
    } finally { database.close(); }
  });

  it("replays more than a page of pre-root events against a repaired root", async () => {
    const record = run(0);
    const pairs = PAGE_ROWS / 2 + 10;
    const prepare = (endBeforeStart: boolean) => store([record], (emit) => {
      for (let index = 1; index <= pairs; index += 1) {
        emit(taskSpan(record, "span.started", index));
        emit(taskSpan(record, "span.ended", index));
      }
      if (endBeforeStart) emit(taskSpan(record, "span.ended", pairs + 1));
      emit({ ...rootEvent(record), repair: AUTHORITY_RECONSTRUCTION });
    });
    const clean = await prepare(false);
    assert.ok(clean.totals.inspected > PAGE_ROWS + 1, String(clean.totals.inspected));
    assert.deepEqual((await clean.doctor()).spanAuthority, { state: "reconciled", streamRunCount: 1, liveRunCount: 1, deleted: [] });
    const defect = (await (await prepare(true)).doctor()).spanAuthority;
    assert.equal(defect.state, "degraded");
    assert.match(JSON.stringify(defect), /ends before its matching start/u);
  });

  // Pre-root replay selects by the indexed run_id column; it relies on this refusal.
  it("refuses a span event whose run differs from its run scope", async () => {
    const record = run(0);
    const f = await store([record], (emit) => {
      emit(rootEvent(record));
      emit(taskSpan(record, "span.started", 1));
    });
    const raw = new DatabaseSync(f.authorityPath), eventId = randomUUID();
    try {
      raw.prepare(`INSERT INTO timeline_events
        (cursor,id,workflow,run_id,worker_id,kind,occurred_at,recorded_at,retention_date,retention_class,payload_json)
        SELECT cursor+1,?,workflow,run_id,worker_id,kind,occurred_at,recorded_at,retention_date,retention_class,
          json_set(payload_json,'$.cursor',cursor+1,'$.eventId',?,'$.payload.event.runId',?)
        FROM timeline_events WHERE kind='span.started'`).run(eventId, eventId, randomUUID());
      raw.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally { raw.close(); }
    const report = (await f.doctor()).spanAuthority;
    assert.equal(report.state, "unavailable");
    assert.deepEqual(report, { state: "unavailable", cause: { code: "span-stream-invalid", summary: "timeline-record-invalid" } });
  });
});
