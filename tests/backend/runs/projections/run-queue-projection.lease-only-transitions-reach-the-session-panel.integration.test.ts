import { afterAll, afterEach, describe, it } from "vitest";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";
import assert from "node:assert/strict";
import { DAY, instantOffsetOf, workerLeaseOf, declareProjectionWorker } from "../../../support/helpers/backend/dashboard-harness.js";

const profileFixtures = createProfileFixtureSet();
afterAll(() => profileFixtures.close());

const {world, cleanup, queuedEventOf, runRecordOf } = createRunQueueProjectionTestWorld(profileFixtures.create);


afterEach(cleanup);


describe("lease-only transitions reach the Session Panel without a span", () => {
  const workerId = "person-lookup-worker-1";
  const startedAt = instantOffsetOf(0);
  const workerPath = "worker/person-lookup/person-lookup-worker-1";
  function snapshots(w: Awaited<ReturnType<typeof world>>): number {
    return w.changes.filter((change) => change.kind === "snapshot").length;
  }

  for (const phase of ["running", "starting", "idle", "waiting", "paused", "failed"] as const) {
    it(`serves exact ${phase} authority independently of the span fold`, async () => {
      const w = await world();
      declareProjectionWorker(w.authority, workerId, 1);
      let runId: string | undefined;
      if (phase === "running") {
        const event = queuedEventOf(w, { seed: 51, lifecycle: { state: "running", workerId,
          claimedAt: startedAt, heartbeatAt: startedAt, workerLifetime: { membershipRevision: 1, leaseGeneration: 1 } }, claimGeneration: 1, version: 2 });
        runId = event.runId;
      }
      const lifecycle = phase === "running" ? { state: "busy", startedAt, heartbeatAt: startedAt, runId }
        : phase === "failed" ? { state: "stopped", startedAt, stoppedAt: startedAt, reason: "shutdown" }
        : phase === "paused" ? { state: phase, startedAt, heartbeatAt: startedAt, pausedAt: startedAt }
        : phase === "waiting" ? { state: phase, startedAt, heartbeatAt: startedAt, activity: "authenticating" }
        : phase === "starting" ? { state: phase, startedAt } : { state: phase, startedAt, heartbeatAt: startedAt };
      w.authority.putWorkerLease(workerLeaseOf({ workerId, lifecycle, directive: phase === "failed" ? "stop" : phase === "paused" ? "pause" : "run" }));
      const day = w.projection.buildDashboardDayWire(DAY);
      assert.equal(day.workerAuthority.state, "present");
      assert.equal(day.workerCards[0]?.state, phase);
      assert.equal(day.workerCards[0]?.currentRun.state, phase === "running" ? "present" : "absent");
      assert.equal(day.workerCards[0]?.member.membershipRevision, 1);
    });
  }

  it("retains member refs and refuses dead idle or an old-generation current run", async () => {
    const w = await world();
    declareProjectionWorker(w.authority, workerId, 1);
    w.authority.putWorkerLease(workerLeaseOf({ workerId }));
    w.authority.workerOwners.clear();
    let day = w.projection.buildDashboardDayWire(DAY);
    assert.equal(day.workerAuthority.state, "unavailable");
    assert.equal(day.workerAuthority.members.length, 1);
    assert.deepEqual(day.workerCards, []);
    declareProjectionWorker(w.authority, workerId, 1);
    const event = queuedEventOf(w, { seed: 52, lifecycle: { state: "running", workerId, claimedAt: startedAt,
      heartbeatAt: startedAt, workerLifetime: { membershipRevision: 1, leaseGeneration: 2 } }, claimGeneration: 1, version: 2 });
    w.authority.putWorkerLease(workerLeaseOf({ workerId, lifecycle: { state: "busy", startedAt, heartbeatAt: startedAt, runId: event.runId } }));
    day = w.projection.buildDashboardDayWire(DAY);
    assert.equal(day.workerAuthority.state, "unavailable");
    assert.equal(day.workerAuthority.members.length, 1);
    assert.deepEqual(day.workerCards, []);
  });

  async function busyWorld() {
    const w = await world();
    declareProjectionWorker(w.authority, workerId, 1);
    const event = queuedEventOf(w, { seed: 53, lifecycle: { state: "running", workerId, claimedAt: startedAt,
      heartbeatAt: startedAt, workerLifetime: { membershipRevision: 1, leaseGeneration: 1 } }, claimGeneration: 1, version: 2 });
    w.authority.putWorkerLease(workerLeaseOf({ workerId,
      lifecycle: { state: "busy", startedAt, heartbeatAt: startedAt, runId: event.runId } }));
    Object.assign(w.runReader, { summaries: {
      withSnapshot: <T>(read: () => T): T => read(),
      queue: () => ({ items: [], next: null }),
      activity: () => { throw new Error("unrequested activity"); },
    } });
    w.runReader.list = () => { throw new Error("whole history forbidden"); };
    const run = w.authority.records.get(event.runId);
    assert.ok(run);
    return { w, run };
  }

  function assertWorkerUnavailable(w: Awaited<ReturnType<typeof world>>): void {
    const day = w.projection.buildDashboardDayWire(DAY);
    assert.equal(day.workerAuthority.state, "unavailable");
    assert.equal(day.workerAuthority.members.length, 1);
    assert.deepEqual(day.workerCards, []);
  }

  it("serves a busy member with worker-indexed reads and never lists whole history", async () => {
    const { w, run } = await busyWorld();
    const queried: string[] = [];
    const listWorkerRuns = w.authority.listWorkerRuns.bind(w.authority);
    w.authority.listWorkerRuns = id => { queried.push(id); return listWorkerRuns(id); };
    const day = w.projection.buildDashboardDayWire(DAY);
    assert.equal(day.workerAuthority.state, "present");
    assert.deepEqual(day.workerCards[0]?.currentRun, { state: "present", runId: run.envelope.runId, traceId: run.envelope.traceId });
    assert.deepEqual(queried, [workerId]);
  });

  it("rejects two active claims even when one is absent from summary rows", async () => {
    const { w } = await busyWorld();
    w.authority.put(runRecordOf({ seed: 54, lifecycle: { state: "running", workerId, claimedAt: startedAt,
      heartbeatAt: startedAt, workerLifetime: { membershipRevision: 1, leaseGeneration: 1 } }, claimGeneration: 1, version: 2 }));
    assertWorkerUnavailable(w);
  });

  it("rejects a duplicate run ID from the worker index", async () => {
    const { w, run } = await busyWorld();
    w.authority.listWorkerRuns = () => [run, run];
    assertWorkerUnavailable(w);
  });

  it("rejects a foreign worker row from the worker index", async () => {
    const { w } = await busyWorld();
    w.authority.listWorkerRuns = () => [runRecordOf({ seed: 54, lifecycle: { state: "running", workerId: "person-lookup-worker-2",
      claimedAt: startedAt, heartbeatAt: startedAt, workerLifetime: { membershipRevision: 1, leaseGeneration: 1 } }, claimGeneration: 1, version: 2 })];
    assertWorkerUnavailable(w);
  });

  it("retains an indexed claim as unavailable when canonical read cannot find it", async () => {
    const { w, run } = await busyWorld();
    w.runReader.read = () => ({ state: "absent", runId: run.envelope.runId });
    assertWorkerUnavailable(w);
  });

  it("rejects canonical readback with a different identity or lifetime", async () => {
    for (const mismatch of ["identity", "lifetime"] as const) {
      const { w, run } = await busyWorld();
      w.runReader.read = () => ({ state: "present", disposition: "live", run: runRecordOf({ seed: mismatch === "identity" ? 54 : 53,
        lifecycle: { state: "running", workerId, claimedAt: startedAt, heartbeatAt: startedAt,
          workerLifetime: { membershipRevision: 1, leaseGeneration: mismatch === "lifetime" ? 2 : 1 } }, claimGeneration: 1, version: 2 }) });
      assert.equal(w.authority.records.has(run.envelope.runId), true);
      assertWorkerUnavailable(w);
    }
  });

  it("requires worker-run authority only when a standing member exists", async () => {
    const { w } = await busyWorld();
    Reflect.deleteProperty(w.authority, "listWorkerRuns");
    assertWorkerUnavailable(w);
    w.authority.workerSlots.clear();
    const day = w.projection.buildDashboardDayWire(DAY);
    assert.equal(day.workerAuthority.state, "present");
    assert.deepEqual(day.workerCards, []);
  });

  it("publishes a snapshot for a lease born before its first span, and an idle tick publishes nothing", async () => {
    const w = await world();
    assert.equal(w.projection.buildDashboardDayWire(DAY).workerCards.length, 0);
    declareProjectionWorker(w.authority, workerId, 1);
    w.authority.putWorkerLease(workerLeaseOf({ workerId, lifecycle: { state: "starting", startedAt } }));
    w.projection.reconcileWorkerAuthority();
    assert.equal(snapshots(w), 1);
    const [card] = w.projection.buildDashboardDayWire(DAY).workerCards;
    assert.equal(card?.state, "starting");
    assert.deepEqual(card?.browserRequirements, { state: "present", systems: ["crm", "ucpath"] });
    w.projection.reconcileWorkerAuthority();
    w.projection.reconcileWorkerAuthority();
    assert.equal(snapshots(w), 1);
  });

  it("ignores heartbeat-only writes and publishes each phase, directive and settlement move exactly once", async () => {
    const w = await world();
    declareProjectionWorker(w.authority, workerId, 1);
    w.authority.putWorkerLease(workerLeaseOf({ workerId, lifecycle: { state: "starting", startedAt } }));
    w.projection.reconcileWorkerAuthority();
    assert.equal(snapshots(w), 1);

    // The maintenance ticker settles `idle`: a lease-only phase move.
    declareProjectionWorker(w.authority, workerId, 1);
    w.authority.putWorkerLease(workerLeaseOf({
      workerId, lifecycle: { state: "idle", startedAt, heartbeatAt: instantOffsetOf(0, 5_000) }, version: 2,
    }));
    w.projection.reconcileWorkerAuthority();
    assert.equal(snapshots(w), 2);
    assert.equal(w.projection.buildDashboardDayWire(DAY).workerCards[0]?.state, "idle");

    // A heartbeat bumps the instant and the version and draws nothing.
    declareProjectionWorker(w.authority, workerId, 1);
    w.authority.putWorkerLease(workerLeaseOf({
      workerId, lifecycle: { state: "idle", startedAt, heartbeatAt: instantOffsetOf(0, 10_000) }, version: 3,
    }));
    w.projection.reconcileWorkerAuthority();
    assert.equal(snapshots(w), 2);

    // An operator directive is a lease write with no span of its own.
    declareProjectionWorker(w.authority, workerId, 1);
    w.authority.putWorkerLease(workerLeaseOf({
      workerId, lifecycle: { state: "idle", startedAt, heartbeatAt: instantOffsetOf(0, 10_000) }, directive: "pause", version: 4,
    }));
    w.projection.reconcileWorkerAuthority();
    assert.equal(snapshots(w), 3);
    assert.equal(w.projection.buildDashboardDayWire(DAY).workerCards[0]?.directive, "pause");
  });

  it("publishes a crash the controller settled, keeping the card while its spans are retained", async () => {
    const w = await world();
    declareProjectionWorker(w.authority, workerId, 1);
    w.authority.putWorkerLease(workerLeaseOf({ workerId }));
    w.writer.emit({
      t: "span.started", kind: "worker", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      workerId, spanPath: workerPath, name: "person-lookup",
    });
    const before = snapshots(w);
    declareProjectionWorker(w.authority, workerId, 1);
    w.authority.putWorkerLease(workerLeaseOf({
      workerId,
      lifecycle: { state: "stopped", startedAt, stoppedAt: instantOffsetOf(0, 60_000), reason: "crashed" },
      directive: "stop",
      version: 5,
    }));
    w.projection.reconcileWorkerAuthority();
    assert.equal(snapshots(w), before + 1);
    const [card] = w.projection.buildDashboardDayWire(DAY).workerCards;
    assert.equal(card?.state, "failed");
    assert.equal(card?.stopReason, "crashed");
    assert.deepEqual(card?.browsers, []);
  });

  it("retains the failed standing member even when its span stream never named it", async () => {
    const w = await world();
    declareProjectionWorker(w.authority, workerId, 1);
    w.authority.putWorkerLease(workerLeaseOf({ workerId, lifecycle: { state: "starting", startedAt } }));
    w.projection.reconcileWorkerAuthority();
    assert.equal(w.projection.buildDashboardDayWire(DAY).workerCards.length, 1);
    declareProjectionWorker(w.authority, workerId, 1);
    w.authority.putWorkerLease(workerLeaseOf({
      workerId,
      lifecycle: { state: "stopped", startedAt, stoppedAt: instantOffsetOf(0, 1_000), reason: "crashed" },
      directive: "stop",
      version: 2,
    }));
    w.projection.reconcileWorkerAuthority();
    assert.equal(snapshots(w), 2);

    assert.equal(w.projection.buildDashboardDayWire(DAY).workerCards[0]?.state, "failed");
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

  it("degrades loudly when lease authority cannot be read instead of serving a stale card set", async () => {
    const w = await world({ collectRebuilds: true });
    w.authority.listLiveWorkerLeases = () => {
      throw new Error("leases table unreadable");
    };
    w.projection.reconcileWorkerAuthority();
    assert.equal(w.projection.health().state, "degraded");
    assert.match(w.projection.health().lastError ?? "", /worker lease reconcile failed: leases table unreadable/);
    assert.equal(w.scheduledRebuilds.length, 1);
  });
});
