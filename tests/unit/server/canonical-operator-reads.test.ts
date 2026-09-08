import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it } from "vitest";
import { RunRecordService, requireLifecycleApplied } from "../../../src/core/run-record-service.js";
import { manualClock } from "../../../src/domain/clock.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/authority-database.js";
import { listCanonicalRuns } from "../../../src/server/dashboard/queries/canonical-runs.js";
import { buildRunDetail, readRunDetail, type RunDetailQueryDeps } from "../../../src/server/dashboard/queries/run-detail.js";
import { buildArchiveIndex, buildArchivedRunDetail, createArchiveSnapshotSource } from "../../../src/server/dashboard/queries/archive.js";
import { deriveArchivedRunRecord } from "../../../src/services/archive/archive-service.js";
import { archivedRunReferenceFingerprint } from "../../../src/domain/archive/model.js";
import { archiveQueryDeps } from "../../fixtures/archive-seams.js";
import { VERSION_PLAN_ROW, VERSION_BUMP_APPLICATION } from "../../fixtures/archive-fixtures.js";
import { sqliteRunReader } from "../../helpers/canonical-run-reader.js";
import { AT, DAY, makeWorld, queuedEventOf, runRecordOf, uuidOf } from "./helpers/dashboard-harness.js";

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "canonical-operator-"));
  cleanups.push(() => rmSync(root, { recursive: true }));
  const clock = manualClock(AT);
  const database = AuthorityDatabase.open({ path: join(root, "authority.sqlite"), migrationOwner: "unit-test", busyTimeoutMs: 250 }, clock);
  cleanups.push(() => database.close());
  const reader = sqliteRunReader(database, clock);
  const world = makeWorld({ reader });
  cleanups.push(() => world.dispose());
  const service = new RunRecordService({ database, clock,
    ids: { uuid: () => { throw new Error("read fixture cannot create identities"); } },
    publishQueued: () => { throw new Error("this proof must not publish spans"); },
  });
  const detailDeps: RunDetailQueryDeps = { stateRoot: world.stateRoot,
    projection: world.projection, runReader: reader, authority: world.authority,
    descriptors: { resolve: () => undefined },
    canonical: { reader, database, descriptors: { resolve: () => undefined } },
  };
  const detail = (runId: string) => buildRunDetail(detailDeps, runId);
  return { database, reader, world, service, detail, detailDeps, clock };
}

it.each(["single", "operation-member"] as const)("freezes a spanless canonical %s and converges live/archive/deleted views without reconstructing evidence", async (shape) => {
  const f = fixture();
  const parent = shape === "operation-member" ? runRecordOf({ seed: 412, shape: "operation" }) : undefined;
  if (parent !== undefined) f.database.authority.runs.enqueue(parent);
  const run = runRecordOf({ seed: 409, shape, ...(parent === undefined ? {} : { parentSeed: 412 }) });
  f.database.authority.runs.enqueue(run);
  assert.equal((await readRunDetail(f.detailDeps, run.envelope.runId)).header.status, "queued");
  const terminal = requireLifecycleApplied(f.service.transition({ commandId: uuidOf(6409),
    runId: run.envelope.runId, expectedVersion: run.version,
    lifecycle: { state: "terminal", outcome: "cancelled", endedAt: AT.toISOString() },
  }));
  const frozen = createArchiveSnapshotSource(f.detailDeps).snapshot(run.envelope.runId);
  assert.equal(frozen.row.status, "cancelled");
  assert.equal(frozen.row.actorId, undefined);
  assert.deepEqual(frozen.detail.timeline.events, []);
  assert.equal(frozen.sections.attempts.state, "absent");
  const archive = f.database.withAuthorityTransaction((repositories) => {
    repositories.versionPlans.insert(VERSION_PLAN_ROW);
    repositories.versionBumpApplications.insert({ ...VERSION_BUMP_APPLICATION,
      archivedRunIds: [run.envelope.runId] });
    return deriveArchivedRunRecord({ repositories, run: terminal, snapshot: frozen,
      applicationId: VERSION_BUMP_APPLICATION.applicationId, drift: ["descriptor-version"],
      archivedBy: "local-operator", archivedAt: AT.toISOString(),
      workflowLabel: undefined, workflowCode: undefined,
    });
  });
  requireLifecycleApplied(f.service.archive({ commandId: uuidOf(7409), expectedVersion: terminal.version, archive }));
  const queries = archiveQueryDeps({ database: f.database, clock: f.clock, appVersion: "0.1.0",
    descriptors: [], stateRoot: f.world.stateRoot });
  const assertCurrentCount = (expected: number) => {
    const day = f.world.projection.buildDashboardDayWire(DAY);
    assert.equal(day.queueSurfaces.length, expected);
    assert.equal(day.workflowCounts.reduce((total, entry) => total + entry.count, 0), expected);
    assert.equal(day.statusCounts.reduce((total, entry) => total + entry.count, 0), expected);
    assert.equal(day.monthCounts.reduce((total, entry) => total + entry.count, 0), expected);
    assert.equal(f.world.projection.buildActivityReportWire(DAY, DAY).totalRuns, expected);
  };
  assertCurrentCount(parent === undefined ? 0 : 1);
  if (parent !== undefined) {
    const row = f.world.projection.queueSurface(parent.envelope.runId);
    assert.ok(row?.surfaceKind === "operation");
    assert.deepEqual(row.memberRollup, { total: 0, terminal: 0, failed: 0 });
    assert.deepEqual(row.memberRunIds, []);
  }
  assert.equal(buildArchiveIndex(queries).entries.length, 1);
  assert.throws(() => f.detail(run.envelope.runId), /archived/);
  const readback = buildArchivedRunDetail(queries, run.envelope.runId);
  assert.equal(readback.row.status, "cancelled");
  assert.deepEqual(readback.detail.timeline.events, []);
  assert.equal(JSON.stringify(f.database.authority.archivedRuns.get(run.envelope.runId)), JSON.stringify(archive));
  const deletion = f.service.deleteArchived({ commandId: uuidOf(8409), runId: run.envelope.runId,
    archiveFingerprint: archivedRunReferenceFingerprint(archive) });
  if (parent === undefined) assert.equal(deletion.state, "deleted");
  else {
    assert.deepEqual(deletion, { state: "refused", refusal: { reason: "is-member" } });
    const settled = requireLifecycleApplied(f.service.transition({ commandId: uuidOf(8412),
      runId: parent.envelope.runId, expectedVersion: parent.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: AT.toISOString() },
    }));
    assert.equal(f.service.delete({ commandId: uuidOf(9412), runId: parent.envelope.runId,
      expectedVersion: settled.version }).state, "deleted");
  }
  assertCurrentCount(0);
  assert.equal(buildArchiveIndex(queries).entries.length, 0);
  assert.throws(() => buildArchivedRunDetail(queries, run.envelope.runId), /deleted/);
  assert.equal(f.world.projection.runFold(run.envelope.runId), undefined);
});

it("reads a real canonical run without any spans through queue, detail, Activity and polling", async () => {
  const f = fixture();
  const run = runRecordOf({ seed: 401 });
  f.database.authority.runs.enqueue(run);
  assert.equal(f.world.projection.runFold(run.envelope.runId), undefined);
  assert.equal(f.world.projection.queueSurface(run.envelope.runId)?.status, "queued");
  const detail = f.detail(run.envelope.runId);
  assert.equal(detail.header.status, "queued");
  assert.equal(detail.header.actorId, undefined);
  assert.deepEqual(detail.timeline.events, []);
  assert.equal(detail.header.title, run.envelope.runId);
  const asynchronous = await readRunDetail(f.detailDeps, run.envelope.runId);
  assert.deepEqual(asynchronous.header, detail.header);
  assert.equal(asynchronous.captures?.state, "absent");
  assert.equal(f.world.projection.buildDashboardDayWire(DAY).queueSurfaces.length, 1);
  assert.equal(f.world.projection.buildActivityReportWire(DAY, DAY).totalRuns, 1);
  const before = f.world.changes.length;
  f.world.projection.reconcileWorkerAuthority();
  assert.equal(f.world.changes.length, before + 1);
  assert.equal(f.world.changes.at(-1)?.kind, "snapshot");
  f.world.projection.reconcileWorkerAuthority();
  assert.equal(f.world.changes.length, before + 1, "unchanged authority must not churn snapshots");
});

it("does not resurrect absent or deleted canonical runs from retained spans", () => {
  const f = fixture();
  const queued = queuedEventOf(f.world, { seed: 402 });
  assert.equal(f.reader.read(queued.runId).state, "absent");
  assert.equal(f.world.projection.queueSurface(queued.runId), undefined);
  assert.throws(() => f.detail(queued.runId), /is absent/);
  const run = runRecordOf({ seed: 402 });
  f.database.authority.runs.enqueue(run);
  const terminal = requireLifecycleApplied(f.service.transition({ commandId: uuidOf(1402),
    runId: run.envelope.runId, expectedVersion: run.version,
    lifecycle: { state: "terminal", outcome: "cancelled", endedAt: AT.toISOString() },
  }));
  assert.equal(f.world.projection.queueSurface(queued.runId)?.status, "cancelled");
  assert.equal(f.service.delete({ commandId: uuidOf(2402), runId: queued.runId, expectedVersion: terminal.version }).state, "deleted");
  assert.equal(f.reader.read(queued.runId).state, "deleted");
  assert.notEqual(f.world.projection.runFold(queued.runId), undefined, "evidence survives deletion");
  assert.equal(f.world.projection.queueSurface(queued.runId), undefined);
  assert.deepEqual(f.world.projection.buildDashboardDayWire(DAY).queueSurfaces, []);
  assert.throws(() => f.detail(queued.runId), /is deleted/);
});

it("refuses a real generation change between canonical list pages instead of mixing generations", () => {
  const f = fixture();
  f.database.withAuthorityTransaction((repositories) => {
    for (let seed = 1; seed <= 1001; seed++) repositories.runs.enqueue(runRecordOf({ seed }));
  });
  assert.equal(listCanonicalRuns(f.reader, "live").length, 1001, "positive control spans both pages");
  let calls = 0;
  assert.throws(() => listCanonicalRuns({ list(input) {
    const page = f.reader.list(input);
    if (++calls === 1) f.database.authority.runs.enqueue(runRecordOf({ seed: 2001 }));
    return page;
  } }, "live"), /cursor-stale/);
  assert.equal(calls, 2);
});

it("moves a claimed run back to the queue and preserves its canonical attempt without a requeue span", () => {
  const f = fixture();
  const run = runRecordOf({ seed: 410 });
  f.database.authority.runs.enqueue(run);
  const claim = f.database.authority.runs.claimNext({ workflow: run.envelope.workflow,
    workerId: "person-lookup-worker-1", now: AT.toISOString() });
  assert.equal(claim.state, "claimed");
  if (claim.state !== "claimed") throw new Error("claim positive control failed");
  f.world.projection.reconcileWorkerAuthority();
  assert.equal(f.detail(run.envelope.runId).header.status, "running");
  const before = f.world.changes.length;
  const outcome = f.service.requeue({ commandId: uuidOf(6410), runId: run.envelope.runId,
    expectedVersion: claim.run.version, claim: { workerId: "person-lookup-worker-1", claimGeneration: 1 },
    cause: "recovery",
  });
  assert.equal(outcome.state, "applied");
  f.world.projection.reconcileWorkerAuthority();
  assert.equal(f.world.changes.length, before + 1);
  const detail = f.detail(run.envelope.runId);
  assert.equal(detail.header.status, "queued");
  assert.equal(detail.header.attempt, run.envelope.attempt);
  const day = f.world.projection.buildDashboardDayWire(DAY);
  assert.deepEqual(day.statusCounts, [{ status: "queued", count: 1 }]);
  assert.equal(day.queueSurfaces[0]?.attempt, run.envelope.attempt);
  assert.equal(f.world.projection.buildActivityReportWire(DAY, DAY).totalRuns, 1);
  assert.equal(f.world.projection.runFold(run.envelope.runId), undefined);
});


it("publishes cancellation and rename without spans, while a pure claim heartbeat does not churn snapshots", () => {
  const f = fixture();
  const run = runRecordOf({ seed: 403 });
  f.database.authority.runs.enqueue(run);
  assert.equal(f.database.authority.runs.claimNext({ workflow: run.envelope.workflow,
    workerId: "person-lookup-worker-1", now: AT.toISOString(),
  }).state, "claimed");
  const named = runRecordOf({ seed: 408 });
  f.database.authority.runs.enqueue(named);
  f.world.projection.reconcileWorkerAuthority();
  const initial = f.world.changes.length;
  f.clock.advanceWall(1_000);
  const renewed = requireLifecycleApplied(f.service.renewClaim({ commandId: uuidOf(3403),
    runId: run.envelope.runId, claim: { workerId: "person-lookup-worker-1", claimGeneration: 1 },
  }));
  assert.ok(renewed.version > run.version);
  f.world.projection.reconcileWorkerAuthority();
  assert.equal(f.world.changes.length, initial, "heartbeat alone is not an operator change");
  const cancelling = requireLifecycleApplied(f.service.transition({ commandId: uuidOf(4403),
    runId: run.envelope.runId, expectedVersion: renewed.version,
    lifecycle: { state: "terminal", outcome: "cancelled", endedAt: f.clock.now().toISOString() },
  }));
  f.world.projection.reconcileWorkerAuthority();
  assert.equal(f.world.changes.length, initial + 1);
  assert.equal(f.detail(run.envelope.runId).header.status, "cancelling");
  const surface = f.world.projection.queueSurface(run.envelope.runId);
  assert.equal(surface?.status, "cancelling");
  assert.equal(surface?.endedAt.state, "absent");
  requireLifecycleApplied(f.service.transition({ commandId: uuidOf(5403),
    runId: named.envelope.runId, expectedVersion: named.version, displayName: "Queued work under review",
  }));
  f.world.projection.reconcileWorkerAuthority();
  assert.equal(f.world.changes.length, initial + 2);
  assert.deepEqual(f.world.projection.queueSurface(named.envelope.runId)?.displayName, { state: "present", value: "Queued work under review" });
  assert.equal(cancelling.cancelRequested, true);
});


it("counts zero, one and multiple spanless members and removes the settled tree through canonical deletion", () => {
  const f = fixture();
  const parent = runRecordOf({ seed: 404, shape: "operation" });
  f.database.authority.runs.enqueue(parent);
  const rollup = () => {
    const row = f.world.projection.queueSurface(parent.envelope.runId);
    assert.ok(row?.surfaceKind === "operation");
    return row.memberRollup;
  };
  assert.deepEqual(rollup(), { total: 0, terminal: 0, failed: 0 });
  const member = runRecordOf({ seed: 405, parentSeed: 404, shape: "operation-member" });
  f.database.authority.runs.enqueue(member);
  assert.deepEqual(rollup(), { total: 1, terminal: 0, failed: 0 });
  const child = runRecordOf({ seed: 406, parentSeed: 404, shape: "operation-member" });
  f.database.authority.runs.enqueue(child);
  const terminal = requireLifecycleApplied(f.service.transition({ commandId: uuidOf(7406),
    runId: child.envelope.runId, expectedVersion: child.version,
    lifecycle: { state: "terminal", outcome: "cancelled", endedAt: AT.toISOString() },
  }));
  f.database.authority.runs.enqueue(runRecordOf({ seed: 407, parentSeed: 404, shape: "single" }));
  assert.deepEqual(rollup(), { total: 2, terminal: 1, failed: 0 });
  assert.equal(f.world.projection.queueSurface(parent.envelope.runId)?.linkedRuns.length, 1);
  assert.equal(f.world.projection.buildActivityReportWire(DAY, DAY).totalRuns, 2, "members count inside their operation");
  assert.deepEqual(f.service.delete({ commandId: uuidOf(6406), runId: terminal.envelope.runId, expectedVersion: terminal.version }),
    { state: "refused", refusal: { reason: "is-member" } });
  assert.deepEqual(rollup(), { total: 2, terminal: 1, failed: 0 });
  for (const seed of [405, 407, 404]) requireLifecycleApplied(f.service.transition({
    commandId: uuidOf(seed + 8000), runId: uuidOf(seed), expectedVersion: 1,
    lifecycle: { state: "terminal", outcome: "cancelled", endedAt: AT.toISOString() },
  }));
  assert.equal(f.service.delete({ commandId: uuidOf(9404), runId: parent.envelope.runId, expectedVersion: 2 }).state, "deleted");
  assert.equal(f.world.projection.queueSurface(parent.envelope.runId), undefined);
  assert.deepEqual(f.world.projection.buildDashboardDayWire(DAY).queueSurfaces, []);
  assert.equal(f.world.projection.buildActivityReportWire(DAY, DAY).totalRuns, 0);
});
