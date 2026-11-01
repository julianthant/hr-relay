import { createClonedProfileFixtures, type BoundProfileStorageFixture } from "../../../support/helpers/admission-fixture.js";
import assert from "node:assert/strict";
import { mkdirSync,writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll,afterEach,describe,it,vi } from "vitest";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { AuthorityDatabase as ProductionAuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { SpanAuthorityReconciliationWireSchema } from "../../../../src/models/dashboard/storage.js";
import { RunRecordSchema,type RunRecord } from "../../../../src/models/run/record.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { CONFIG_SNAPSHOT,NOW,UUID_1,UUID_2,UUID_3,UUID_4,UUID_5,UUID_6,UUID_7 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { DAY,makeWorld,queuedEventOf,uuidOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { AuthorityDatabase,doctorAuthorityStorage,summarizeSpanAuthorityReconciliation } from "../../../support/helpers/synthetic-storage-admission.js";

const profiles = createClonedProfileFixtures();
const heldProfiles: BoundProfileStorageFixture[] = [];
afterAll(() => profiles.close());
const clock = manualClock(new Date(NOW));

afterEach(async () => {
  for (const profile of heldProfiles.splice(0)) await profile.close();
});

function currentRun(runId = UUID_1, itemId = UUID_4, traceId = "pl-120000-0000"): RunRecord {
  return RunRecordSchema.parse({
    ...QUEUED_RUN,
    envelope: {
      ...QUEUED_RUN.envelope,
      runId, itemId, traceId, priority: "interactive", dryRun: true,
      resolvedInstance: { ucpath: "prod" }, configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId, configFingerprint: CONFIG_SNAPSHOT.fingerprint,
    },
  });
}

async function fixture(
  runs: readonly RunRecord[] = [currentRun()],
  after?: (database: AuthorityDatabase) => void,
) {
  const profile = await profiles.create(); heldProfiles.push(profile);
  const root = profile.stateRoot, authorityPath = profile.path;
  const database = AuthorityDatabase.open({ path: authorityPath, busyTimeoutMs: 500, migrationOwner: "span-authority-test" }, clock);
  try {
    database.authority.runtimeConfig.initialize(CONFIG_SNAPSHOT);
    for (const run of runs) database.authority.runs.enqueue(run);
    after?.(database);
  } finally {
    database.close();
  }
  return {
    root,
    authorityPath,
    emit: (event: Readonly<Record<string, unknown>>) => {
      const writer = AuthorityDatabase.open({ path: authorityPath, busyTimeoutMs: 500, migrationOwner: "timeline-doctor-fixture" }, clock);
      try { createTimelineEmitter({ repository: writer.authority.timelineEvents, clock, pid: 4242 }).emit(event); }
      finally { writer.close(); }
    },
    retiredFile: (event: Readonly<Record<string, unknown>>) => {
      mkdirSync(join(root, "spans"), { recursive: true });
      writeFileSync(join(root, "spans", "person-lookup-2026-07-31.jsonl"), JSON.stringify(event));
    },
    read: async () => (await doctorAuthorityStorage({
      stateRootTrustAnchor: root, stateRoot: root, authorityPath,
      backupDirectory: join(root, "backups", "authority"), maxBackupAgeMs: 60_000, busyTimeoutMs: 500,
    }, clock)).spanAuthority,
  };
}

function rootEvent(run = currentRun()) {
  const e = run.envelope;
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

const AUTHORITY_RECONSTRUCTION = {
  kind: "authority-reconstruction",
  repairedAt: NOW,
  sourceAuthorityGeneration: 0,
  sourceAuthorityFingerprint: "a".repeat(64),
  priorStreamBytes: 0,
  priorStreamSha256: "b".repeat(64),
} as const;

function taskStartedBeforeRoot(change: Readonly<Record<string, unknown>> = {}) {
  return {
    t: "span.started", kind: "task", ts: NOW, workflow: "person-lookup", runId: UUID_1, attempt: 1,
    traceId: "pl-120000-0000", spanPath: "pl-120000-0000/searching#1", parentSpanPath: "pl-120000-0000", name: "searching",
    ...change,
  };
}

describe("storage doctor span/authority reconciliation", () => {
  it("names a missing current root and rejects an unowned event before persistence", async () => {
    const f = await fixture([currentRun(), currentRun(UUID_2, UUID_5, "pl-120001-0000")]);
    f.emit(rootEvent());
    assert.throws(() => f.emit(rootEvent(currentRun(UUID_3, UUID_6, "pl-120002-0000"))), /timeline-event-owner-missing/u);
    const report = await f.read();
    assert.deepEqual(report, {
      state: "degraded", streamRunCount: 1, liveRunCount: 1, archived: [], deleted: [],
      problems: [{ state: "missing-span", runId: UUID_2 }],
    });
    assert.equal(summarizeSpanAuthorityReconciliation(report).state, "degraded");
  });

  it("withholds mixed-snapshot reconciliation after a concurrent authority commit", async () => {
    const f = await fixture();
    f.emit(rootEvent());
    const inspect = ProductionAuthorityDatabase.inspectSpanRunAuthorityReadOnly.bind(ProductionAuthorityDatabase);
    let committed = false;
    const spy = vi.spyOn(ProductionAuthorityDatabase, "inspectSpanRunAuthorityReadOnly").mockImplementation((...args) => {
      if (!committed) {
        committed = true;
        f.emit({ t: "span.started", kind: "worker", ts: NOW, workflow: "person-lookup",
          workerId: "concurrent-worker", spanPath: "worker/concurrent-worker", name: "Worker" });
      }
      return inspect(...args);
    });
    try {
      await assert.rejects(f.read(), /authority changed while the storage doctor awaited external evidence/u);
    } finally { spy.mockRestore(); }
    assert.equal((await f.read()).state, "reconciled");
  });

  it("withholds a transient history replacement even when its generation and final bytes are unchanged", async () => {
    const f = await fixture();
    f.emit(rootEvent());
    f.emit({ t: "span.started", kind: "worker", ts: NOW, workflow: "person-lookup",
      workerId: "snapshot-worker", spanPath: "worker/snapshot-worker", name: "Original" });
    const inspect = ProductionAuthorityDatabase.inspectSpanRunAuthorityReadOnly.bind(ProductionAuthorityDatabase);
    const spy = vi.spyOn(ProductionAuthorityDatabase, "inspectSpanRunAuthorityReadOnly").mockImplementation((...args) => {
      const raw = new DatabaseSync(f.authorityPath);
      const row = raw.prepare("SELECT cursor,payload_json FROM timeline_events ORDER BY cursor DESC LIMIT 1").get();
      assert.ok(row);
      const trigger = raw.prepare("SELECT sql FROM sqlite_master WHERE name='timeline_events_immutable'").get();
      assert.equal(typeof trigger?.sql, "string");
      try {
        raw.exec("DROP TRIGGER timeline_events_immutable; PRAGMA ignore_check_constraints=ON");
        raw.prepare("UPDATE timeline_events SET payload_json=json_set(payload_json,'$.payload.event.name','Replacement') WHERE cursor=?").run(row.cursor);
        raw.exec(String(trigger?.sql));
        return inspect(...args);
      } finally {
        raw.exec("DROP TRIGGER IF EXISTS timeline_events_immutable");
        raw.prepare("UPDATE timeline_events SET payload_json=? WHERE cursor=?").run(row.payload_json, row.cursor);
        raw.exec(String(trigger?.sql));
        raw.close();
      }
    });
    try {
      const report = await f.read();
      assert.equal(report.state, "unavailable");
      if (report.state !== "unavailable") throw new Error("transient mismatched snapshots cannot reconcile");
      assert.match(report.cause.summary, /changed between read snapshots/u);
    } finally { spy.mockRestore(); }
    assert.equal((await f.read()).state, "reconciled");
  });

  it("names every missing current root in an existing empty span directory", async () => {
    const f = await fixture();
    mkdirSync(join(f.root, "spans"));
    assert.deepEqual(await f.read(), {
      state: "degraded", streamRunCount: 0, liveRunCount: 0, archived: [], deleted: [],
      problems: [{ state: "missing-span", runId: UUID_1 }],
    });
  });

  it("withholds absence claims when current authority is malformed", async () => {
    const f = await fixture([currentRun(), currentRun(UUID_2, UUID_5, "pl-120001-0000")]);
    f.emit(rootEvent());
    const raw = new DatabaseSync(f.authorityPath);
    try { raw.prepare("UPDATE runs SET envelope_json = '{}' WHERE id = ?").run(UUID_1); }
    finally { raw.close(); }
    const report = await f.read();
    assert.equal(report.state, "degraded");
    if (report.state !== "degraded") throw new Error("corrupt owner must degrade");
    assert.ok(report.problems.some((problem) => problem.state === "malformed" && problem.runId === UUID_1));
    assert.ok(report.problems.every((problem) => problem.state === "malformed"));
  });

  it("ignores malformed retired files and names only missing SQLite roots", async () => {
    const f = await fixture();
    mkdirSync(join(f.root, "spans"));
    writeFileSync(join(f.root, "spans", "person-lookup-2026-08-28.jsonl"), "{not-json}\n");
    const report = await f.read();
    assert.equal(report.state, "degraded");
    if (report.state !== "degraded") throw new Error("missing SQLite root must degrade");
    assert.deepEqual(report.problems, [{ state: "missing-span", runId: UUID_1 }]);
  });

  it("refuses corrupt SQLite evidence without exposing payload or inventing absence", async () => {
    const f = await fixture();
    f.emit(rootEvent());
    const raw = new DatabaseSync(f.authorityPath);
    try {
      raw.exec("DROP TRIGGER timeline_events_immutable; PRAGMA ignore_check_constraints=ON");
      raw.prepare("UPDATE timeline_events SET payload_json = ?").run(JSON.stringify({ private: "DO-NOT-PRINT" }));
    } finally { raw.close(); }
    const report = await f.read();
    assert.equal(report.state, "unavailable");
    assert.doesNotMatch(JSON.stringify(report), /DO-NOT-PRINT/u);
    assert.equal(JSON.stringify(report).includes(f.root), false);
  });

  it("names duplicate run.queued roots instead of reconciling the run-id set", async () => {
    const f = await fixture();
    f.emit(rootEvent());
    const raw = new DatabaseSync(f.authorityPath);
    try {
      raw.prepare("INSERT INTO timeline_events (id,workflow,run_id,worker_id,kind,occurred_at,recorded_at,retention_date,retention_class,operation_id,operation_generation,confirmed_at,system,payload_json) SELECT ?,workflow,run_id,worker_id,kind,occurred_at,recorded_at,retention_date,retention_class,operation_id,operation_generation,confirmed_at,system,json_set(payload_json,'$.eventId',?,'$.cursor',cursor+1) FROM timeline_events LIMIT 1").run(UUID_7, UUID_7);
    } finally { raw.close(); }
    const report = await f.read();
    assert.equal(report.state, "degraded");
    if (report.state !== "degraded") throw new Error("duplicate roots must degrade");
    assert.equal(report.problems.filter((p) => p.state === "malformed" && p.table === "span_stream").length, 2);
    assert.match(JSON.stringify(report.problems), /duplicate run.queued root/u);
  });

  it("rejects a root tuple that conflicts with its exact current authority row", async () => {
    const f = await fixture();
    assert.throws(() => f.emit({ ...rootEvent(), itemId: UUID_5 }), /timeline-event-owner-mismatch/u);
    const report = await f.read();
    assert.equal(report.state, "degraded");
    if (report.state !== "degraded") throw new Error("no invalid root may be persisted");
    assert.deepEqual(report.problems, [{ state: "missing-span", runId: UUID_1 }]);
  });

  it("compares resolved instances canonically rather than by insertion order", async () => {
    const run = RunRecordSchema.parse({
      ...currentRun(), envelope: { ...currentRun().envelope, resolvedInstance: { crm: "prod", ucpath: "test" } },
    });
    const f = await fixture([run]);
    f.emit({ ...rootEvent(run), resolvedInstance: { ucpath: "test", crm: "prod" } });
    assert.deepEqual(await f.read(), {
      state: "reconciled", streamRunCount: 1, liveRunCount: 1, archived: [], deleted: [],
    });
  });

  it.each([
    ["same-attempt claim recovery", 1, "person-lookup", true],
    ["skipped allocation", 3, "person-lookup", true],
    ["foreign skipped allocation", 3, "ucpath-person-search", false],
  ] as const)("reconciles %s requeue allocation against exact authority", async (_name, nextAttempt, workflow, healthy) => {
    const run = RunRecordSchema.parse({ ...currentRun(), envelope: { ...currentRun().envelope, attempt: nextAttempt } });
    const f = await fixture([run]);
    f.emit(rootEvent());
    const requeue = { t: "run.requeued", ts: NOW, workflow, runId: UUID_1, attempt: 1,
      traceId: "pl-120000-0000", spanPath: "pl-120000-0000", cause: "recovery", nextAttempt };
    if (!healthy) {
      assert.throws(() => f.emit(requeue), /timeline-event-owner-mismatch/u);
      return;
    }
    f.emit(requeue);
    const report = await f.read();
    assert.equal(report.state, healthy ? "reconciled" : "degraded");
    if (!healthy) {
      assert.equal(report.state, "degraded");
      if (report.state !== "degraded") throw new Error("invalid requeue must degrade");
      assert.match(JSON.stringify(report.problems), workflow === "person-lookup" ? /strictly increase/u : /workflow/u);
    }
  });

  it.each([
    ["foreign workflow", { t: "run.claimed", workflow: "ucpath-person-search", workerId: "worker-1" }, /workflow/u],
    ["foreign trace", { t: "run.claimed", traceId: "zz-120000-0000", spanPath: "zz-120000-0000", workerId: "worker-1" }, /traceId/u],
    ["out-of-order attempt", { t: "run.claimed", attempt: 2, workerId: "worker-1" }, /attempt/u],
    ["foreign task root", { t: "span.started", kind: "task", spanPath: "pl-120001-0000/searching#1", parentSpanPath: "pl-120001-0000", name: "searching" }, /spanPath/u],
    ["task end before start", { t: "span.ended", kind: "task", spanPath: "pl-120000-0000/searching#1", parentSpanPath: "pl-120000-0000", outcome: "done" }, /matching start/u],
  ] as const)("names %s instead of accepting a matching run-id set", async (_name, change, detail) => {
    const f = await fixture();
    f.emit(rootEvent());
    const event = { ts: NOW, workflow: "person-lookup", runId: UUID_1, attempt: 1,
      traceId: "pl-120000-0000", spanPath: "pl-120000-0000", ...change };
    if (["foreign workflow", "foreign trace", "out-of-order attempt"].includes(_name)) {
      assert.throws(() => f.emit(event), /timeline-event-owner-mismatch/u);
      assert.equal((await f.read()).state, "reconciled");
      return;
    }
    f.emit(event);
    const report = await f.read();
    assert.equal(report.state, "degraded");
    if (report.state !== "degraded") throw new Error("foreign event must degrade");
    assert.match(JSON.stringify(report.problems), detail);
  });

  it("rejects a queued root whose span path is not its exact trace root", async () => {
    const f = await fixture();
    f.emit({ ...rootEvent(), spanPath: "pl-120000-0000/not-root" });
    const report = await f.read();
    assert.equal(report.state, "degraded");
    if (report.state !== "degraded") throw new Error("foreign root must degrade");
    assert.match(JSON.stringify(report.problems), /does not equal traceId/u);
  });

  it.each([undefined, "pl-120000-0000/nested"])(
    "requires the exact run-root task parent rather than %s",
    async (parentSpanPath) => {
      const f = await fixture();
      f.emit(rootEvent());
      f.emit({
        t: "span.started", kind: "task", ts: NOW, workflow: "person-lookup",
        runId: UUID_1, attempt: 1, traceId: "pl-120000-0000",
        spanPath: "pl-120000-0000/searching#1", parentSpanPath, name: "searching",
      });
      const report = await f.read();
      assert.equal(report.state, "degraded");
      if (report.state !== "degraded") throw new Error("a task must name its exact run-root parent");
      assert.match(JSON.stringify(report.problems), /parentSpanPath must equal run root/u);
    },
  );

  it("names the absent ordinary root when only later SQLite events survive", async () => {
    const f = await fixture();
    f.emit({
      t: "span.started", kind: "task", ts: NOW, workflow: "person-lookup", runId: UUID_1, attempt: 1,
      traceId: "pl-120000-0000", spanPath: "pl-120000-0000/searching#1", parentSpanPath: "pl-120000-0000", name: "searching",
    });
    const report = await f.read();
    assert.equal(report.state, "degraded");
    if (report.state !== "degraded") throw new Error("rootless event must degrade");
    assert.deepEqual(report.problems, [{ state: "missing-span", runId: UUID_1 }]);
  });

  it("reconciles a late queued root only when it carries authority-reconstruction evidence", async () => {
    const f = await fixture();
    f.emit(taskStartedBeforeRoot());
    f.emit({ ...rootEvent(), repair: AUTHORITY_RECONSTRUCTION });
    assert.deepEqual(await f.read(), {
      state: "reconciled", streamRunCount: 1, liveRunCount: 1, archived: [], deleted: [],
    });
  });

  it("keeps an unmarked late queued root malformed", async () => {
    const f = await fixture();
    f.emit(taskStartedBeforeRoot());
    f.emit(rootEvent());
    const report = await f.read();
    assert.equal(report.state, "degraded");
    if (report.state !== "degraded") throw new Error("an unmarked late root must degrade");
    assert.match(JSON.stringify(report.problems), /authority-reconstruction repair/u);
  });

  it("refuses a malformed authority-reconstruction marker before persistence", async () => {
    const f = await fixture();
    assert.throws(() => f.emit({ ...rootEvent(), repair: { ...AUTHORITY_RECONSTRUCTION, sourceAuthorityGeneration: -1 } }), /timeline-span-invalid/u);
  });

  it.each([
    ["identity", taskStartedBeforeRoot({ traceId: "zz-120000-0000" }), /traceId/u],
    ["timestamp", taskStartedBeforeRoot({ ts: "2026-07-31T16:59:59.000Z" }), /precedes the prior run event timestamp/u],
    ["task span", {
      t: "span.ended", kind: "task", ts: NOW, workflow: "person-lookup", runId: UUID_1, attempt: 1,
      traceId: "pl-120000-0000", spanPath: "pl-120000-0000/searching#1", parentSpanPath: "pl-120000-0000", outcome: "done",
    }, /ends before its matching start/u],
  ] as const)("replays pre-root %s defects against a repaired queued root", async (_name, event, detail) => {
    const f = await fixture();
    if (_name === "identity") {
      assert.throws(() => f.emit(event), /timeline-event-owner-mismatch/u);
      return;
    }
    f.emit(event);
    f.emit({ ...rootEvent(), repair: AUTHORITY_RECONSTRUCTION });
    const report = await f.read();
    assert.equal(report.state, "degraded");
    if (report.state !== "degraded") throw new Error("pre-root span defects must degrade");
    assert.match(JSON.stringify(report.problems), detail);
  });

  it("names malformed authority with no queued root before classifying absence", async () => {
    const f = await fixture();
    mkdirSync(join(f.root, "spans"));
    const raw = new DatabaseSync(f.authorityPath);
    try {
      raw.prepare("UPDATE runs SET envelope_json = '{}' WHERE id = ?").run(UUID_1);
    } finally {
      raw.close();
    }
    const report = await f.read();
    assert.equal(report.state, "degraded");
    if (report.state !== "degraded") throw new Error("corrupt owner must degrade");
    assert.ok(report.problems.some((problem) => problem.state === "malformed-authority" && problem.recordKey === UUID_1));
    assert.ok(report.problems.every((problem) => problem.state === "malformed-authority"));
  });


  function deleteRun(run: RunRecord, commandId = UUID_7) {
    return (database: AuthorityDatabase) => {
      const terminal = database.authority.runs.transition({
        runId: run.envelope.runId,
        expectedVersion: run.version,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW },
        now: NOW,
      });
      if (terminal.state !== "applied") throw new Error("delete fixture could not terminalize its run");
      const deleted = testRunService(database, clock).delete({ runId: run.envelope.runId, commandId, expectedVersion: terminal.run.version });
      assert.equal(deleted.state, "deleted");
    };
  }

  it("deletes timeline roots with their owner and ignores surviving retired files", async () => {
    const run = currentRun();
    const f = await fixture([run]);
    f.emit(rootEvent(run));
    const database = AuthorityDatabase.open({ path: f.authorityPath, busyTimeoutMs: 500, migrationOwner: "delete-test" }, clock);
    try { deleteRun(run)(database); } finally { database.close(); }
    f.retiredFile(rootEvent(run));
    const report = await f.read();
    assert.deepEqual(report, { state: "reconciled", streamRunCount: 0, liveRunCount: 0, archived: [], deleted: [] });
    assert.equal(summarizeSpanAuthorityReconciliation(report).state, "healthy");
    assert.deepEqual(SpanAuthorityReconciliationWireSchema.parse(report), report);
  });

  it.each([
    ["exact deleted owner", {}],
    ["foreign workflow", { workflow: "ucpath-person-search" }],
    ["foreign trace", { traceId: "zz-120000-0000", spanPath: "zz-120000-0000" }],
  ] as const)("refuses new timeline history for %s after deletion", async (_name, change) => {
    const run = currentRun();
    const f = await fixture([run], deleteRun(run));
    assert.throws(() => f.emit({ ...rootEvent(run), ...change }), /timeline-event-owner-missing/u);
    assert.equal((await f.read()).state, "reconciled");
  });

  it("refuses an orphan event without resurrecting a deleted run", async () => {
    const run = currentRun();
    const f = await fixture([run], deleteRun(run));
    assert.throws(() => f.emit(rootEvent(currentRun(UUID_2, UUID_5, "pl-120001-0000"))), /timeline-event-owner-missing/u);
  });

  it("never renders a span-only run as current canonical authority", async () => {
    const world = await makeWorld();
    try {
      queuedEventOf(world, { seed: 91 });
      assert.equal(world.projection.buildDashboardDayWire(DAY).queueSurfaces.length, 1);
      world.authority.records.delete(uuidOf(91));
      assert.notEqual(world.projection.runFold(uuidOf(91)), undefined, "the orphan evidence is retained");
      assert.equal(world.projection.queueSurface(uuidOf(91)), undefined);
      const day = world.projection.buildDashboardDayWire(DAY);
      assert.deepEqual(day.queueSurfaces, []);
      assert.deepEqual(day.workflowCounts, []);
      assert.deepEqual(day.statusCounts, []);
      assert.deepEqual(day.monthCounts, []);
    } finally {
      await world.dispose();
    }
  });
});
