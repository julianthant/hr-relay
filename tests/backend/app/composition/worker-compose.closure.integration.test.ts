import assert from "node:assert/strict";
import { afterEach, it, vi } from "vitest";
import { composeWorkerRuntime } from "../../../../src/backend/app/composition/worker-compose.js";
import { WorkerSessionClosureUnprovedError, WorkerSessionManager } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createWorkerCompositionTestWorld } from "../../../support/helpers/backend/worker-composition-world.js";
import { releaseAdmissionFixture, releaseAdmissionFixtures } from "../../../support/helpers/admission-fixture.js";
import { createBrowserSessionFactoryFixtures } from "../../../support/helpers/browser/session-factory-fixtures.js";
import { happySessionHarness, personLookupQueuedRun } from "../../../support/helpers/phase1f-executor-harness.js";

const { NOW, POOL_INDEX_1, repoRootWithState, seedQueuedRun, reopen, composeInput, cleanup } = createWorkerCompositionTestWorld(
  () => releaseAdmissionFixtures(), root => releaseAdmissionFixture(root),
);
afterEach(() => { vi.restoreAllMocks(); cleanup(); });

it("returns an unproved closure report while settling the worker lease as crashed", async () => {
  const { repoRoot, stateRoot } = repoRootWithState();
  const clock = manualClock(new Date(NOW));
  vi.spyOn(WorkerSessionManager.prototype, "closeAll").mockRejectedValue(
    new WorkerSessionClosureUnprovedError("closure-worker", [new Error("fixture cleanup failed")]),
  );
  const report = await composeWorkerRuntime(composeInput({ repoRoot, clock,
    sessions: happySessionHarness(), poolIndex: POOL_INDEX_1 }));
  assert.equal(report.closure, "unproved");
  assert.deepEqual(report.outcomes, []);
  const lease = reopen(stateRoot, clock).authority.workerLeases.get(report.workerId);
  assert.ok(lease?.lifecycle.state === "stopped");
  assert.equal(lease.lifecycle.reason, "crashed");
});

it("records a crashed lease for the real factory's generic launcher rejection", async () => {
  const { repoRoot, stateRoot } = repoRootWithState();
  const clock = manualClock(new Date(NOW));
  seedQueuedRun(stateRoot, clock, personLookupQueuedRun());
  const fixtures = createBrowserSessionFactoryFixtures(clock, "00000000-0000-4000-8000-000000000001",
    { schedule: () => ({ cancel: () => undefined }) });
  await fixtures.withTempRuntime(async ({ config }) => {
    let launches = 0;
    const factory = fixtures.factoryFor(config, {
      ...fixtures.fakeLauncher(),
      launcher: { launch: async () => { launches += 1; throw new Error("uncertain launch failure"); } },
    }, fixtures.recordingBindings());
    const report = await composeWorkerRuntime(composeInput({ repoRoot, clock,
      sessions: { ...happySessionHarness(), factory }, poolIndex: POOL_INDEX_1 }));
    assert.equal(report.closure, "unproved");
    assert.equal(launches, 1);
    const lease = reopen(stateRoot, clock).authority.workerLeases.get(report.workerId);
    assert.ok(lease?.lifecycle.state === "stopped");
    assert.equal(lease.lifecycle.reason, "crashed");
  });
});
