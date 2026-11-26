import assert from "node:assert/strict";
import { join } from "node:path";
import { afterAll, afterEach, describe, it } from "vitest";
import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/queue.js";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";
import { DAY, DESCRIPTOR_SET_HASH, declareProjectionWorker, uuidOf, workerMemberOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";

const profiles = createProfileFixtureSet();
afterAll(() => profiles.close());
const { world, queuedEventOf, cleanup } = createRunQueueProjectionTestWorld(profiles.create);
afterEach(cleanup);

async function duoWorld() {
  const w = await world({ descriptors: { resolve: () => personLookupDescriptor } });
  const workerId = "person-lookup-worker-1";
  const since = w.clock.now().toISOString();
  testWorkerPorts(w.database, w.clock, { path: join(w.stateRoot, "state.db"), descriptor: personLookupDescriptor, poolIndex: 1 });
  declareProjectionWorker(w.authority, workerId, 1);
  w.authority.putWorkerMember(workerMemberOf(w.authority, { workerId, activity: { state: "busy", runId: uuidOf(1) } }));
  queuedEventOf(w, { seed: 1, descriptor: personLookupDescriptor, claimGeneration: 1, version: 2,
    lifecycle: { state: "running", workerId, claimedAt: since, heartbeatAt: since } });
  const projection = createOperatorProjection({ database: w.database, reader: w.runReader, workerMembers: () => w.authority.workerMembers(),
    descriptors: { resolve: () => personLookupDescriptor }, stateRoot: w.stateRoot, clock: w.clock,
    appVersion: "0.1.0", descriptorSetHash: DESCRIPTOR_SET_HASH, ledger: { foldActivityRange: () => { throw new Error("unrequested activity"); } } });
  return { w, projection, workerId, since };
}

describe("the served queue's Duo wait", () => {
  it("counts the lease holder under NEEDS YOU until the lease is released", async () => {
    const { w, projection, workerId, since } = await duoWorld();
    const changes: string[] = [];
    projection.onChange(change => changes.push(change.kind));
    projection.reconcileWorkerAuthority();
    changes.length = 0;
    const lease = w.database.authority.duoCeremonyLeases.acquire({ credentialKey: "a".repeat(64), workerId, system: "ucpath", now: since, ttlMs: 80_000 });
    assert.equal(lease.state, "acquired");
    if (lease.state !== "acquired") throw new Error("fixture lease unavailable");
    projection.reconcileWorkerAuthority();
    assert.deepEqual(changes, ["snapshot"]);
    const waiting = projection.buildDashboardDayWire(DAY);
    assert.deepEqual(waiting.queueSurfaces[0]?.operatorWait, { state: "present", kind: "duo", system: "ucpath", since });
    assert.equal(waiting.queueSurfaces[0]?.status, "awaiting-approval");
    assert.deepEqual(waiting.statusCounts, [{ status: "awaiting-approval", count: 1 }]);
    assert.deepEqual(waiting.workflowCounts, [{ workflowId: "person-lookup", count: 1, statusCounts: [{ status: "awaiting-approval", count: 1 }] }]);
    assert.equal(waiting.queueSurfaces[0]?.gateOpenedAt.state, "absent");
    changes.length = 0;
    w.database.authority.duoCeremonyLeases.release({ token: lease.token, now: since });
    projection.reconcileWorkerAuthority();
    assert.deepEqual(changes, ["snapshot"]);
    const released = projection.buildDashboardDayWire(DAY);
    assert.deepEqual(released.queueSurfaces[0]?.operatorWait, { state: "absent" });
    assert.equal(released.queueSurfaces[0]?.status, "running");
    assert.deepEqual(released.statusCounts, [{ status: "running", count: 1 }]);
  });

  it("serves the claimed run on the worker card and Needs Duo on its row while the worker waits on Duo sign-in", async () => {
    const { w, projection, workerId, since } = await duoWorld();
    w.authority.putWorkerMember(workerMemberOf(w.authority, { workerId, activity: { state: "waiting", waiting: "authenticating", runId: uuidOf(1) } }));
    w.database.authority.duoCeremonyLeases.acquire({ credentialKey: "a".repeat(64), workerId, system: "ucpath", now: since, ttlMs: 80_000 });
    projection.reconcileWorkerAuthority();
    const day = projection.buildDashboardDayWire(DAY);
    assert.equal(day.workerCards[0]?.state, "waiting");
    assert.deepEqual(day.workerCards[0]?.currentRun, { state: "present", runId: uuidOf(1), traceId: day.queueSurfaces[0]?.traceId });
    assert.equal(day.queueSurfaces[0]?.status, "awaiting-approval");
    assert.deepEqual(day.queueSurfaces[0]?.operatorWait, { state: "present", kind: "duo", system: "ucpath", since });
  });

  it("publishes expiry without a span or authority mutation and keeps the acquisition time while held", async () => {
    const { w, projection, workerId, since } = await duoWorld();
    w.database.authority.duoCeremonyLeases.acquire({ credentialKey: "a".repeat(64), workerId, system: "crm", now: since, ttlMs: 80_000 });
    projection.reconcileWorkerAuthority();
    w.clock.advanceWall(79_999);
    assert.deepEqual(projection.queueSurface(uuidOf(1))?.operatorWait, { state: "present", kind: "duo", system: "crm", since });
    const changes: string[] = [];
    projection.onChange(change => changes.push(change.kind));
    const key = w.database.changeKey();
    w.clock.advanceWall(1);
    projection.reconcileWorkerAuthority();
    assert.deepEqual(w.database.changeKey(), key);
    assert.deepEqual(changes, ["snapshot"]);
    const day = projection.buildDashboardDayWire(DAY);
    assert.deepEqual(day.queueSurfaces[0]?.operatorWait, { state: "absent" });
    assert.deepEqual(day.statusCounts, [{ status: "running", count: 1 }]);
  });

  it("does not attribute a lease to another run or an exited worker", async () => {
    const { w, projection, workerId, since } = await duoWorld();
    w.database.authority.duoCeremonyLeases.acquire({ credentialKey: "a".repeat(64), workerId, system: "ucpath", now: since, ttlMs: 80_000 });
    queuedEventOf(w, { seed: 2, descriptor: personLookupDescriptor, claimGeneration: 1, version: 2,
      lifecycle: { state: "running", workerId, claimedAt: since, heartbeatAt: since } });
    queuedEventOf(w, { seed: 3, descriptor: personLookupDescriptor });
    assert.deepEqual(projection.queueSurface(uuidOf(2))?.operatorWait, { state: "absent" });
    assert.equal(projection.queueSurface(uuidOf(2))?.status, "running");
    assert.deepEqual(projection.queueSurface(uuidOf(3))?.operatorWait, { state: "absent" });
    assert.equal(projection.queueSurface(uuidOf(3))?.status, "queued");
    w.authority.putWorkerMember(workerMemberOf(w.authority, { workerId, state: "exited",
      exit: { code: null, signal: "SIGKILL", at: since, outcome: "crashed", settlement: "settled" } }));
    assert.deepEqual(projection.queueSurface(uuidOf(1))?.operatorWait, { state: "absent" });
    assert.equal(projection.queueSurface(uuidOf(1))?.status, "running");
  });
});
