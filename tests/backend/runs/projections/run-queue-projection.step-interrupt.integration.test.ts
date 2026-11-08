import assert from "node:assert/strict";
import { afterAll, afterEach, describe, it } from "vitest";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";
import { claimEventOf, DAY, declareProjectionWorker, instantOffsetOf, uuidOf, workerLeaseOf,
  type DashboardWorld } from "../../../support/helpers/backend/dashboard-harness.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { WorkerControlRecordSchema } from "../../../../src/models/run/worker-control.js";
import { RunPauseSchema } from "../../../../src/models/run/record.js";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());
const { world, cleanup, queuedEventOf, CLAIM } = createRunQueueProjectionTestWorld(profileFixtures.create);
afterEach(cleanup);

const workerId = "person-lookup-worker-1";
const at = instantOffsetOf(0);
const PAUSE_REQUESTED = { state: "requested", commandId: uuidOf(90), requestedAt: at } as const;

/** Runs the write-in-flight fact through the authority port, as production composes it from the write intents. */
function setWritesInFlight(w: DashboardWorld, runIds: readonly string[]): void {
  Object.assign(w.authority, { writeInFlight: (runId: string) => runIds.includes(runId) });
}

function claimed(w: DashboardWorld, seed: number, patch: Record<string, unknown> = {}): void {
  queuedEventOf(w, { seed, descriptor: personLookupDescriptor, claimGeneration: 1, version: 2,
    lifecycle: { state: "running", ...CLAIM, workerLifetime: { membershipRevision: 1, leaseGeneration: 1 } } });
  claimEventOf(w, seed);
  const run = w.authority.getRun(uuidOf(seed));
  assert.ok(run);
  w.authority.put({ ...run, ...patch });
  w.projection.rebuildFromTimeline();
}

function busyWorker(w: DashboardWorld): void {
  declareProjectionWorker(w.authority, workerId, 1);
  w.authority.putWorkerLease(workerLeaseOf({ workerId,
    lifecycle: { state: "busy", startedAt: at, heartbeatAt: instantOffsetOf(0, 2_000), runId: uuidOf(1) } }));
}

function pendingStop(w: DashboardWorld): void {
  const commandId = uuidOf(91), member = { workflowId: "person-lookup", workerId, ordinal: 1, poolIndex: 1, membershipRevision: 1 };
  const basis = { leaseGeneration: 1, controlRevision: 1 };
  const control = WorkerControlRecordSchema.parse({ commandId, scope: "worker-pool:person-lookup", executorId: uuidOf(92),
    admittedAt: at, expiresAt: instantOffsetOf(0, 180_000), basisVersion: 1, phase: { state: "admitted" },
    request: { commandId, family: "worker-browser", type: "stop-worker", source: "dashboard", requestedBy: "local-operator", requestedAt: at,
      target: { workerId, membershipRevision: 1, expectedVersion: 1, controlBasis: basis } },
    reset: { commandId, member, lifetime: { leaseGeneration: 1, processId: 4242, startedAt: at }, basis, reservedControlRevision: 2,
      work: { kind: "current", cascade: [], current: { state: "claimed", runId: uuidOf(1), version: 2, attempt: 1, workerId, claimGeneration: 1 } } } });
  w.authority.workerControls = () => [control];
}

const rowOf = (w: DashboardWorld, seed: number) => w.projection.queueSurface(uuidOf(seed));
const cardOf = (w: DashboardWorld) => w.projection.buildDashboardDayWire(DAY).workerCards[0];

describe("served step interrupt", () => {
  it("serves a pending pause on a claimed run as a step restart", async () => {
    const w = await world({ descriptors: { resolve: () => personLookupDescriptor } });
    claimed(w, 1, { pause: PAUSE_REQUESTED });
    const row = rowOf(w, 1);
    assert.deepEqual(row?.interrupt, { action: "pause", step: "cancel" });
    assert.deepEqual(row?.liveMessage, { state: "present", value: "Restarts this step on Resume" });
  });

  it("serves a pending pause during an attempting write as finishing the save first", async () => {
    const w = await world({ descriptors: { resolve: () => personLookupDescriptor } });
    claimed(w, 1, { pause: PAUSE_REQUESTED });
    setWritesInFlight(w, [uuidOf(1)]);
    const row = rowOf(w, 1);
    assert.deepEqual(row?.interrupt, { action: "pause", step: "finish-write" });
    assert.deepEqual(row?.liveMessage, { state: "present", value: "Finishing the save first" });
  });

  it("serves a requested cancel on a claimed run as a stop", async () => {
    const w = await world({ descriptors: { resolve: () => personLookupDescriptor } });
    claimed(w, 1, { cancelRequested: true });
    assert.deepEqual(rowOf(w, 1)?.interrupt, { action: "stop", step: "cancel" });
  });

  it("serves no interrupt for a paused queued run or an unclaimed queued run", async () => {
    const w = await world({ descriptors: { resolve: () => personLookupDescriptor } });
    queuedEventOf(w, { seed: 1, descriptor: personLookupDescriptor });
    queuedEventOf(w, { seed: 2, descriptor: personLookupDescriptor });
    const paused = w.authority.getRun(uuidOf(1));
    assert.ok(paused);
    w.authority.put({ ...paused, pause: RunPauseSchema.parse({ state: "paused", commandId: uuidOf(90), requestedAt: at, pausedAt: at }) });
    w.projection.rebuildFromTimeline();
    assert.equal(rowOf(w, 1)?.interrupt, undefined);
    assert.equal(rowOf(w, 2)?.interrupt, undefined);
  });

  it("serves a busy worker card the pause interrupt of its current run", async () => {
    const w = await world({ descriptors: { resolve: () => personLookupDescriptor } });
    busyWorker(w);
    claimed(w, 1, { pause: PAUSE_REQUESTED });
    assert.deepEqual(cardOf(w)?.interrupt, { action: "pause", step: "cancel" });
    setWritesInFlight(w, [uuidOf(1)]);
    assert.deepEqual(cardOf(w)?.interrupt, { action: "pause", step: "finish-write" });
  });

  it("serves a busy worker card a stop interrupt while a stop-worker operation is pending", async () => {
    const w = await world({ descriptors: { resolve: () => personLookupDescriptor } });
    busyWorker(w);
    claimed(w, 1);
    assert.equal(cardOf(w)?.interrupt, undefined);
    pendingStop(w);
    assert.equal(cardOf(w)?.interrupt?.action, "stop");
    assert.equal(cardOf(w)?.interrupt?.step, "cancel");
    setWritesInFlight(w, [uuidOf(1)]);
    assert.deepEqual(cardOf(w)?.interrupt, { action: "stop", step: "finish-write" });
  });

  it("serves an idle worker card no interrupt", async () => {
    const w = await world({ descriptors: { resolve: () => personLookupDescriptor } });
    declareProjectionWorker(w.authority, workerId, 1);
    w.authority.putWorkerLease(workerLeaseOf({ workerId }));
    assert.equal(cardOf(w)?.interrupt, undefined);
  });
});
