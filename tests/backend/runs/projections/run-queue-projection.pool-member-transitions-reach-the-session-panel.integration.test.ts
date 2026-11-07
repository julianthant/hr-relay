import { afterAll, afterEach, describe, it } from "vitest";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";
import assert from "node:assert/strict";
import { DAY, instantOffsetOf, workerMemberOf, declareProjectionWorker } from "../../../support/helpers/backend/dashboard-harness.js";
import type { WorkerMemberView } from "../../../../src/backend/runtime/workers/worker-pool.js";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());

const { world, cleanup, queuedEventOf } = createRunQueueProjectionTestWorld(profileFixtures.create);

afterEach(cleanup);

describe("pool member transitions reach the Session Panel without a span", () => {
  const workerId = "person-lookup-worker-1";
  const startedAt = instantOffsetOf(0);
  const workerPath = "worker/person-lookup/person-lookup-worker-1";
  const crashed: WorkerMemberView["exit"] = { code: null, signal: "SIGKILL", at: instantOffsetOf(0, 60_000), outcome: "crashed", settlement: "settled" };
  function snapshots(w: Awaited<ReturnType<typeof world>>): number {
    return w.changes.filter((change) => change.kind === "snapshot").length;
  }

  for (const phase of ["running", "starting", "idle", "waiting", "paused", "failed"] as const) {
    it(`serves the ${phase} member independently of the span fold`, async () => {
      const w = await world();
      declareProjectionWorker(w.authority, workerId, 1);
      const runId = phase === "running" ? queuedEventOf(w, { seed: 51, lifecycle: { state: "running", workerId,
        claimedAt: startedAt, heartbeatAt: startedAt }, claimGeneration: 1, version: 2 }).runId : undefined;
      w.authority.putWorkerMember(workerMemberOf(w.authority, { workerId,
        state: phase === "starting" ? "starting" : phase === "failed" ? "exited" : "running",
        activity: runId !== undefined ? { state: "busy", runId } : phase === "waiting" ? { state: "waiting" } : phase === "paused" ? { state: "paused" } : { state: "idle" },
        ...(phase === "failed" ? { exit: crashed } : {}) }));
      const day = w.projection.buildDashboardDayWire(DAY);
      assert.equal(day.workerAuthority.state, "present");
      assert.equal(day.workerCards[0]?.state, phase);
      assert.equal(day.workerCards[0]?.currentRun.state, phase === "running" ? "present" : "absent");
      assert.deepEqual(day.workerCards[0]?.controls?.basis, { state: "present", value: { lifetimeId: "aaaaaaaa-0001-4000-8000-000100000000", version: 0 } });
    });
  }

  it("serves a not-started card with the null-lifetime fence for a slot whose member has no process", async () => {
    const w = await world();
    declareProjectionWorker(w.authority, workerId, 1);
    const day = w.projection.buildDashboardDayWire(DAY);
    assert.equal(day.workerAuthority.state, "present");
    assert.equal(day.workerAuthority.members.length, 1);
    assert.equal(day.workerCards.length, 1);
    assert.equal(day.workerCards[0]?.state, "failed");
    assert.equal(day.workerCards[0]?.stopReason, "not-started");
    assert.deepEqual(day.workerCards[0]?.controls?.basis, { state: "present", value: { lifetimeId: null, version: 0 } });
  });

  it("serves no current run for a run another worker claimed", async () => {
    const w = await world();
    declareProjectionWorker(w.authority, workerId, 1);
    const event = queuedEventOf(w, { seed: 52, lifecycle: { state: "running", workerId: "person-lookup-worker-2", claimedAt: startedAt,
      heartbeatAt: startedAt }, claimGeneration: 1, version: 2 });
    w.authority.putWorkerMember(workerMemberOf(w.authority, { workerId, activity: { state: "busy", runId: event.runId } }));
    assert.deepEqual(w.projection.buildDashboardDayWire(DAY).workerCards[0]?.currentRun, { state: "absent", reason: "no current claimed run" });
  });

  it("serves no member authority when the profile runtime has no pool", async () => {
    const w = await world();
    declareProjectionWorker(w.authority, workerId, 1);
    Reflect.deleteProperty(w.authority, "workerMembers");
    const day = w.projection.buildDashboardDayWire(DAY);
    assert.equal(day.workerAuthority.state, "unavailable");
    assert.deepEqual(day.workerCards, []);
  });

  it("publishes each member version and slot directive move exactly once", async () => {
    const w = await world();
    assert.equal(w.projection.buildDashboardDayWire(DAY).workerCards.length, 0);
    declareProjectionWorker(w.authority, workerId, 1);
    w.authority.putWorkerMember(workerMemberOf(w.authority, { workerId, state: "starting" }));
    w.projection.reconcileWorkerAuthority();
    assert.equal(snapshots(w), 1);
    assert.equal(w.projection.buildDashboardDayWire(DAY).workerCards[0]?.state, "starting");
    w.projection.reconcileWorkerAuthority();
    w.projection.reconcileWorkerAuthority();
    assert.equal(snapshots(w), 1);

    w.authority.putWorkerMember(workerMemberOf(w.authority, { workerId, version: 1 }));
    w.projection.reconcileWorkerAuthority();
    assert.equal(snapshots(w), 2);
    assert.equal(w.projection.buildDashboardDayWire(DAY).workerCards[0]?.state, "idle");

    const slot = w.authority.workerSlots.get(workerId);
    assert.ok(slot);
    w.authority.putWorkerSlot({ ...slot, paused: true });
    w.projection.reconcileWorkerAuthority();
    assert.equal(snapshots(w), 3);
    assert.equal(w.projection.buildDashboardDayWire(DAY).workerCards[0]?.directive, "pause");
  });

  it("publishes a crash the pool settled, keeping the card while its spans are retained", async () => {
    const w = await world();
    declareProjectionWorker(w.authority, workerId, 1);
    w.authority.putWorkerMember(workerMemberOf(w.authority, { workerId }));
    w.writer.emit({
      t: "span.started", kind: "worker", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      workerId, spanPath: workerPath, name: "person-lookup",
    });
    const before = snapshots(w);
    w.authority.putWorkerMember(workerMemberOf(w.authority, { workerId, state: "exited", exit: crashed, version: 5 }));
    w.projection.reconcileWorkerAuthority();
    assert.equal(snapshots(w), before + 1);
    const [card] = w.projection.buildDashboardDayWire(DAY).workerCards;
    assert.equal(card?.state, "failed");
    assert.equal(card?.stopReason, "crashed");
    assert.deepEqual(card?.browsers, []);
  });

  it("publishes a pool declaration the operator planned, which no span carries", async () => {
    const w = await world();
    const plannedAt = instantOffsetOf(0, 2_000);
    w.authority.putWorkerPool({
      workflow: "person-lookup", desiredWorkers: 2, plannedBy: "local-operator",
      plannedAt, version: 1, createdAt: plannedAt, updatedAt: plannedAt,
    });
    w.projection.reconcileWorkerAuthority();
    assert.equal(snapshots(w), 1);
    assert.deepEqual(w.projection.buildDashboardDayWire(DAY).workerPools, [
      { workflowId: "person-lookup", desiredWorkers: 2, version: 1, plannedBy: "local-operator", plannedAt },
    ]);
    w.projection.reconcileWorkerAuthority();
    assert.equal(snapshots(w), 1);
  });

  it("degrades loudly when member authority cannot be read instead of serving a stale card set", async () => {
    const w = await world({ collectRebuilds: true });
    w.authority.workerMembers = () => {
      throw new Error("pool unreadable");
    };
    w.projection.reconcileWorkerAuthority();
    assert.equal(w.projection.health().state, "degraded");
    assert.match(w.projection.health().lastError ?? "", /worker authority reconcile failed: pool unreadable/);
    assert.equal(w.scheduledRebuilds.length, 1);
  });
});
