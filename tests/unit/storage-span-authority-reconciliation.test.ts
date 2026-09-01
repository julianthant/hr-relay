import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { RunRecordSchema, type RunRecord } from "../../src/domain/run/record.js";
import { createSpanJsonlWriter } from "../../src/infra/events/span-jsonl-writer.js";
import { doctorAuthorityStorage, summarizeSpanAuthorityReconciliation } from "../../src/infra/sqlite/storage-doctor.js";
import { AuthorityDatabase } from "../../src/infra/sqlite/authority-database.js";
import { NOW, UUID_1, UUID_2, UUID_3, UUID_4, UUID_5, UUID_6 } from "./fixtures/phase1c-contract-fixtures.js";
import { QUEUED_RUN } from "./fixtures/phase1f-run-fixtures.js";
import { DAY, makeWorld, queuedEventOf, uuidOf } from "./server/helpers/dashboard-harness.js";

const roots: string[] = [];
const clock = manualClock(new Date(NOW));

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function currentRun(runId = UUID_1, itemId = UUID_4, traceId = "pl-120000-0000"): RunRecord {
  return RunRecordSchema.parse({
    ...QUEUED_RUN,
    envelope: {
      ...QUEUED_RUN.envelope,
      runId, itemId, traceId, priority: "interactive", dryRun: true,
      resolvedInstance: { ucpath: "test" }, configSnapshotId: UUID_6,
    },
  });
}

function fixture(runs: readonly RunRecord[] = [currentRun()]) {
  const root = mkdtempSync(join(tmpdir(), "hrauto-span-authority-"));
  roots.push(root);
  const authorityPath = join(root, "state.db");
  const database = AuthorityDatabase.open({ path: authorityPath, busyTimeoutMs: 500, migrationOwner: "span-authority-test" }, clock);
  try {
    for (const run of runs) database.authority.runs.enqueue(run);
  } finally {
    database.close();
  }
  return {
    root,
    authorityPath,
    emit: (event: Readonly<Record<string, unknown>>) =>
      createSpanJsonlWriter({ stateRoot: root, clock, pid: 4242 }).emit(event),
    read: async () => (await doctorAuthorityStorage({
      stateRootTrustAnchor: root, stateRoot: root, authorityPath,
      backupDirectory: join(root, "backups"), maxBackupAgeMs: 60_000, busyTimeoutMs: 500,
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
  it("names a current run whose individual queued root is missing alongside an unaccounted root", async () => {
    const f = fixture([currentRun(), currentRun(UUID_2, UUID_5, "pl-120001-0000")]);
    f.emit(rootEvent());
    f.emit(rootEvent(currentRun(UUID_3, UUID_6, "pl-120002-0000")));
    const report = await f.read();
    assert.deepEqual(report, {
      state: "degraded", streamRunCount: 2, liveRunCount: 1, archived: [],
      problems: [{ state: "missing", runId: UUID_3 }, { state: "missing-span", runId: UUID_2 }],
    });
    assert.equal(summarizeSpanAuthorityReconciliation(report).state, "degraded");
  });

  it("names every missing current root in an existing empty span directory", async () => {
    const f = fixture();
    mkdirSync(join(f.root, "spans"));
    assert.deepEqual(await f.read(), {
      state: "degraded", streamRunCount: 0, liveRunCount: 0, archived: [],
      problems: [{ state: "missing-span", runId: UUID_1 }],
    });
  });

  it("deduplicates exact malformed rows while withholding mixed-snapshot absence claims", async () => {
    const f = fixture([
      currentRun(), currentRun(UUID_2, UUID_5, "pl-120001-0000"),
      currentRun(UUID_3, UUID_6, "pl-120002-0000"),
    ]);
    f.emit(rootEvent());
    f.emit(rootEvent(currentRun(UUID_4, UUID_1, "pl-120003-0000")));
    const raw = new DatabaseSync(f.authorityPath);
    try {
      const corrupt = raw.prepare("UPDATE tasks SET record_json = ? WHERE record_key = ?");
      for (const runId of [UUID_1, UUID_2]) corrupt.run(JSON.stringify({ malformed: true }), runId);
    } finally { raw.close(); }
    const report = await f.read();
    assert.equal(report.state, "degraded");
    if (report.state !== "degraded") throw new Error("malformed authority must degrade");
    assert.deepEqual(report.problems, [
      { state: "malformed", runId: UUID_1, table: "tasks", summary: "tasks authority failed its strict record or identity validation" },
      { state: "malformed-authority", source: "current", recordKey: UUID_2, summary: "tasks record failed its strict authority schema" },
    ]);
    // UUID_3 lacks a queued root and UUID_4 lacks authority, but neither is
    // classified absent while this authority snapshot contains malformed rows.
  });

  it("does not invent missing-span findings around unreadable evidence", async () => {
    const f = fixture();
    mkdirSync(join(f.root, "spans"));
    writeFileSync(join(f.root, "spans", "person-lookup-2026-08-28.jsonl"), "{not-json}\n");
    const report = await f.read();
    assert.equal(report.state, "unavailable");
    if (report.state !== "unavailable") throw new Error("corrupt corpus must refuse");
    assert.equal(report.cause.code, "span-stream-invalid");
    assert.equal(report.cause.summary, "span file sha256:7db3-5938-6fe9-c2db-4c9f-38de-7462-bfea-af99-fb06-7702-a0e8-c2fd-8930-77e6-c08b line 1 is invalid JSON");
    assert.equal(report.cause.summary.includes(f.root), false);
  });

  it("names duplicate run.queued roots instead of reconciling the run-id set", async () => {
    const f = fixture();
    f.emit(rootEvent());
    f.emit({ ...rootEvent(), itemId: UUID_5 });
    const report = await f.read();
    assert.equal(report.state, "degraded");
    if (report.state !== "degraded") throw new Error("duplicate roots must degrade");
    assert.equal(report.problems.filter((p) => p.state === "malformed" && p.table === "span_stream").length, 2);
    assert.match(JSON.stringify(report.problems), /duplicate run.queued root/u);
  });

  it("rejects a root tuple that conflicts with its exact current authority row", async () => {
    const f = fixture();
    f.emit({ ...rootEvent(), itemId: UUID_5 });
    const report = await f.read();
    assert.equal(report.state, "degraded");
    if (report.state !== "degraded") throw new Error("foreign tuple must degrade");
    assert.equal(report.problems[0]?.state, "malformed");
    assert.match(JSON.stringify(report.problems), /itemId/u);
  });

  it("compares resolved instances canonically rather than by insertion order", async () => {
    const run = RunRecordSchema.parse({
      ...currentRun(), envelope: { ...currentRun().envelope, resolvedInstance: { crm: "prod", ucpath: "test" } },
    });
    const f = fixture([run]);
    f.emit({ ...rootEvent(run), resolvedInstance: { ucpath: "test", crm: "prod" } });
    assert.deepEqual(await f.read(), { state: "reconciled", streamRunCount: 1, liveRunCount: 1, archived: [] });
  });

  it.each([
    ["non-increasing", 1, "person-lookup", false],
    ["skipped allocation", 3, "person-lookup", true],
    ["foreign skipped allocation", 3, "ucpath-person-search", false],
  ] as const)("reconciles %s requeue allocation against exact authority", async (_name, nextAttempt, workflow, healthy) => {
    const run = RunRecordSchema.parse({ ...currentRun(), envelope: { ...currentRun().envelope, attempt: nextAttempt } });
    const f = fixture([run]);
    f.emit(rootEvent());
    f.emit({
      t: "run.requeued", ts: NOW, workflow, runId: UUID_1, attempt: 1,
      traceId: "pl-120000-0000", spanPath: "pl-120000-0000", cause: "recovery", nextAttempt,
    });
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
    const f = fixture();
    f.emit(rootEvent());
    f.emit({
      ts: NOW, workflow: "person-lookup", runId: UUID_1, attempt: 1,
      traceId: "pl-120000-0000", spanPath: "pl-120000-0000", ...change,
    });
    const report = await f.read();
    assert.equal(report.state, "degraded");
    if (report.state !== "degraded") throw new Error("foreign event must degrade");
    assert.match(JSON.stringify(report.problems), detail);
  });

  it("rejects a queued root whose span path is not its exact trace root", async () => {
    const f = fixture();
    f.emit({ ...rootEvent(), spanPath: "pl-120000-0000/not-root" });
    const report = await f.read();
    assert.equal(report.state, "degraded");
    if (report.state !== "degraded") throw new Error("foreign root must degrade");
    assert.match(JSON.stringify(report.problems), /does not equal traceId/u);
  });

  it.each([undefined, "pl-120000-0000/nested"])(
    "requires the exact run-root task parent rather than %s",
    async (parentSpanPath) => {
      const f = fixture();
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

  it("names a task event before its run root as malformed ordering", async () => {
    const f = fixture();
    f.emit({
      t: "span.started", kind: "task", ts: NOW, workflow: "person-lookup", runId: UUID_1, attempt: 1,
      traceId: "pl-120000-0000", spanPath: "pl-120000-0000/searching#1", parentSpanPath: "pl-120000-0000", name: "searching",
    });
    const report = await f.read();
    assert.equal(report.state, "unavailable");
    if (report.state !== "unavailable") throw new Error("rootless event must refuse");
    assert.match(report.cause.summary, /appeared before run.queued/u);
  });

  it("reconciles a late queued root only when it carries authority-reconstruction evidence", async () => {
    const f = fixture();
    f.emit(taskStartedBeforeRoot());
    f.emit({ ...rootEvent(), repair: AUTHORITY_RECONSTRUCTION });
    assert.deepEqual(await f.read(), {
      state: "reconciled", streamRunCount: 1, liveRunCount: 1, archived: [],
    });
  });

  it("keeps an unmarked late queued root malformed", async () => {
    const f = fixture();
    f.emit(taskStartedBeforeRoot());
    f.emit(rootEvent());
    const report = await f.read();
    assert.equal(report.state, "degraded");
    if (report.state !== "degraded") throw new Error("an unmarked late root must degrade");
    assert.match(JSON.stringify(report.problems), /authority-reconstruction repair/u);
  });

  it("refuses a malformed authority-reconstruction marker before reconciliation", async () => {
    const f = fixture();
    mkdirSync(join(f.root, "spans"));
    writeFileSync(join(f.root, "spans", "person-lookup-2026-08-28.jsonl"), `${JSON.stringify({
      ...rootEvent(), repair: { ...AUTHORITY_RECONSTRUCTION, sourceAuthorityGeneration: -1 },
    })}\n`);
    const report = await f.read();
    assert.equal(report.state, "unavailable");
    if (report.state !== "unavailable") throw new Error("a malformed repair marker must refuse");
    assert.equal(report.cause.code, "span-stream-invalid");
  });

  it.each([
    ["identity", taskStartedBeforeRoot({ traceId: "zz-120000-0000" }), /traceId/u],
    ["timestamp", taskStartedBeforeRoot({ ts: "2026-07-31T16:59:59.000Z" }), /precedes the prior run event timestamp/u],
    ["task span", {
      t: "span.ended", kind: "task", ts: NOW, workflow: "person-lookup", runId: UUID_1, attempt: 1,
      traceId: "pl-120000-0000", spanPath: "pl-120000-0000/searching#1", parentSpanPath: "pl-120000-0000", outcome: "done",
    }, /ends before its matching start/u],
  ] as const)("replays pre-root %s defects against a repaired queued root", async (_name, event, detail) => {
    const f = fixture();
    f.emit(event);
    f.emit({ ...rootEvent(), repair: AUTHORITY_RECONSTRUCTION });
    const report = await f.read();
    assert.equal(report.state, "degraded");
    if (report.state !== "degraded") throw new Error("pre-root span defects must degrade");
    assert.match(JSON.stringify(report.problems), detail);
  });

  it("names malformed authority with no queued root before classifying absence", async () => {
    const f = fixture();
    mkdirSync(join(f.root, "spans"));
    const raw = new DatabaseSync(f.authorityPath);
    try {
      raw.prepare("UPDATE tasks SET record_json = '{}' WHERE record_key = ?").run(UUID_1);
    } finally {
      raw.close();
    }
    const report = await f.read();
    assert.equal(report.state, "degraded");
    if (report.state !== "degraded") throw new Error("malformed authority must degrade");
    assert.deepEqual(report.problems, [{
      state: "malformed-authority", source: "current", recordKey: UUID_1,
      summary: "tasks record failed its strict authority schema",
    }]);
  });

  it("preserves the queue projection's exact refusal for a span-only run", () => {
    const world = makeWorld();
    try {
      queuedEventOf(world, { seed: 91 });
      world.authority.records.delete(uuidOf(91));
      assert.throws(
        () => world.projection.buildDashboardDayWire(DAY),
        (error: unknown) => error instanceof Error
          && error.message === `run ${uuidOf(91)} exists in the span stream but not in authority; the projection refuses to render an unaccounted run`,
      );
    } finally {
      world.dispose();
    }
  });
});
