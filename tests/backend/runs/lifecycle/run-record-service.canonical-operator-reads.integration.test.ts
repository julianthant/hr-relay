import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { releaseSeededWriteOwners } from "../../../support/helpers/timeline-write-fixture.js";
import { afterAll } from "vitest";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { afterEach,it,vi } from "vitest";
import { RunRecordService,requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { listCanonicalRuns } from "../../../../src/backend/runs/queries/canonical-runs.js";
import { buildRunDetail,readRunDetail,type RunDetailQueryDeps } from "../../../../src/backend/runs/queries/run-detail.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { seedSyntheticRuntimeConfig } from "../../../support/fixtures/operator-command-fixtures.js";
import { CONFIG_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { testWorkerLifetime, testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { AT,DAY,makeWorld,queuedEventOf,runRecordOf,uuidOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { sqliteRunReader } from "../../../support/helpers/canonical-run-reader.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";

const profiles = createProfileFixtureSet();
afterAll(() => profiles.close());

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture() {
  const profile = await profiles.create();
  const root = profile.stateRoot;
  cleanups.push(() => profile.close());
  const clock = manualClock(AT);
  const database = AuthorityDatabase.open({ path: profile.path, migrationOwner: "unit-test", busyTimeoutMs: 250 }, clock);
  seedSyntheticRuntimeConfig(database);
  database.authority.configSnapshots.insert(CONFIG_SNAPSHOT);
  testWorkerPorts(database, clock, {path:profile.path,descriptor:personLookupDescriptor,poolIndex:1});
  cleanups.push(() => { releaseSeededWriteOwners(database, clock.now().toISOString()); database.close(); });
  const realReader = sqliteRunReader(database, clock);
  let listCalls = 0, treeCalls = 0;
  const reader: typeof realReader = {
    read: (id) => realReader.read(id),
    withRunTreeSnapshot: (ids, work) => { treeCalls += 1; return realReader.withRunTreeSnapshot(ids, work); },
    list: (input) => { listCalls += 1; return realReader.list(input); },
  };
  const world = await makeWorld({ reader, profileFixture: profiles.create });
  cleanups.push(async () => await world.dispose());
  const service = new RunRecordService({ database, clock,
    ids: { uuid: () => { throw new Error("read fixture cannot create identities"); } },
    publishQueued: () => { throw new Error("this proof must not publish spans"); },
  });
  const detailDeps: RunDetailQueryDeps = { stateRoot: world.stateRoot, timeline: world.timeline,
    projection: world.projection, runReader: reader, authority: world.authority,
    descriptors: { resolve: () => undefined },
    canonical: { reader, database, descriptors: { resolve: () => undefined } },
  };
  const detail = (runId: string) => buildRunDetail(detailDeps, runId);
  return { root, database, reader, world, service, detail, detailDeps, clock,
    listCalls: () => listCalls, treeCalls: () => treeCalls, resetListCalls: () => { listCalls = 0; treeCalls = 0; },
  };
}

it("reads a real canonical run without any spans through queue, detail, Activity and polling", async () => {
  const f = await fixture();
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

it("does not resurrect absent or deleted canonical runs from retained spans", async () => {
  const f = await fixture();
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

it("refuses a real generation change between canonical list pages instead of mixing generations", async () => {
  const f = await fixture();
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

it("moves a claimed run back to the queue and preserves its canonical attempt without a requeue span", async () => {
  const f = await fixture();
  const run = runRecordOf({ seed: 410 });
  f.database.authority.runs.enqueue(run);
  const claimMember1 = f.database.authority.workerSlots.get("person-lookup-worker-1");
  if (claimMember1 === undefined) throw new Error("fixture-claim-member-required");
  const claim = f.database.authority.runs.claimNext({ workerLifetime: testWorkerLifetime(f.database, run.envelope.workflow, claimMember1.poolIndex).workerLifetime, workflow: run.envelope.workflow,
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


it("publishes cancellation and rename without spans, while a pure claim heartbeat does not churn snapshots", async () => {
  const f = await fixture();
  const run = runRecordOf({ seed: 403 });
  f.database.authority.runs.enqueue(run);
  assert.equal(f.database.authority.runs.claimNext({ workerLifetime: testWorkerLifetime(f.database, run.envelope.workflow, 1).workerLifetime, workflow: run.envelope.workflow,
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


it("counts zero, one and multiple spanless members and removes the settled tree through canonical deletion", async () => {
  const f = await fixture();
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


it("materializes only the requested bounded canonical page", async () => {
  const f = await fixture();
  f.database.withAuthorityTransaction(repositories => {
    for (let seed = 1; seed <= 1001; seed++) repositories.runs.enqueue(runRecordOf({ seed }));
  });
  let scanned = 0;
  const authority = { ...f.database.authority, runs: { ...f.database.authority.runs,
    listByWorkflow(workflow: string) { const rows = f.database.authority.runs.listByWorkflow(workflow); scanned += rows.length; return rows; } } };
  const database = new Proxy(f.database, { get(target, key) {
    if (key === "authority") return authority;
    const value: unknown = Reflect.get(target, key);
    if (typeof value !== "function") return value;
    return (...args: unknown[]): unknown => Reflect.apply(value, target, args);
  } });
  const service = new RunRecordService({ database, clock: f.clock,
    ids: { uuid: () => { throw new Error("read fixture"); } }, publishQueued: () => {} });
  const prepare = vi.spyOn(DatabaseSync.prototype, "prepare");
  const first = service.list({ disposition: "live", limit: 10 });
  assert.equal(first.state, "listed");
  assert.equal(first.rows?.length, 10);
  assert.equal(scanned, 0, "a bounded page must not enumerate each workflow corpus");
  assert.equal(listCanonicalRuns(service, "live").length, 1001);
  assert.equal(prepare.mock.calls.filter(([sql]) => sql.includes("INSERT INTO canonical_run_page SELECT")).length, 1,
    "all pages share one complete scalar ordering per source generation");
  f.database.authority.runs.enqueue(runRecordOf({ seed: 2002 }));
  assert.equal(listCanonicalRuns(service, "live").length, 1002);
  assert.equal(prepare.mock.calls.filter(([sql]) => sql.includes("INSERT INTO canonical_run_page SELECT")).length, 2);
  prepare.mockRestore();
});
