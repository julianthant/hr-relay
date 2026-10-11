import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { DAY, instantOffsetOf, workerLeaseOf } from "../../../support/helpers/backend/dashboard-harness.js";

const { worlds, world } = createRunQueueProjectionTestWorld();


afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
});


describe("lease-only transitions reach the Session Panel without a span", () => {
  const workerId = "person-lookup-worker-1";
  const startedAt = instantOffsetOf(0);
  const workerPath = "worker/person-lookup/person-lookup-worker-1";
  function snapshots(w: ReturnType<typeof world>): number {
    return w.changes.filter((change) => change.kind === "snapshot").length;
  }

  it("publishes a snapshot for a lease born before its first span, and an idle tick publishes nothing", () => {
    const w = world();
    assert.equal(w.projection.buildDashboardDayWire(DAY).workerCards.length, 0);
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

  it("ignores heartbeat-only writes and publishes each phase, directive and settlement move exactly once", () => {
    const w = world();
    w.authority.putWorkerLease(workerLeaseOf({ workerId, lifecycle: { state: "starting", startedAt } }));
    w.projection.reconcileWorkerAuthority();
    assert.equal(snapshots(w), 1);

    // The maintenance ticker settles `idle`: a lease-only phase move.
    w.authority.putWorkerLease(workerLeaseOf({
      workerId, lifecycle: { state: "idle", startedAt, heartbeatAt: instantOffsetOf(0, 5_000) }, version: 2,
    }));
    w.projection.reconcileWorkerAuthority();
    assert.equal(snapshots(w), 2);
    assert.equal(w.projection.buildDashboardDayWire(DAY).workerCards[0]?.state, "idle");

    // A heartbeat bumps the instant and the version and draws nothing.
    w.authority.putWorkerLease(workerLeaseOf({
      workerId, lifecycle: { state: "idle", startedAt, heartbeatAt: instantOffsetOf(0, 10_000) }, version: 3,
    }));
    w.projection.reconcileWorkerAuthority();
    assert.equal(snapshots(w), 2);

    // An operator directive is a lease write with no span of its own.
    w.authority.putWorkerLease(workerLeaseOf({
      workerId, lifecycle: { state: "idle", startedAt, heartbeatAt: instantOffsetOf(0, 10_000) }, directive: "pause", version: 4,
    }));
    w.projection.reconcileWorkerAuthority();
    assert.equal(snapshots(w), 3);
    assert.equal(w.projection.buildDashboardDayWire(DAY).workerCards[0]?.directive, "pause");
  });

  it("publishes a crash or expiry another process settled, keeping the card while its spans are retained", () => {
    const w = world();
    w.authority.putWorkerLease(workerLeaseOf({ workerId }));
    w.writer.emit({
      t: "span.started", kind: "worker", ts: w.clock.now().toISOString(), workflow: "person-lookup",
      workerId, spanPath: workerPath, name: "person-lookup",
    });
    const before = snapshots(w);
    w.authority.putWorkerLease(workerLeaseOf({
      workerId,
      lifecycle: { state: "stopped", startedAt, stoppedAt: instantOffsetOf(0, 60_000), reason: "lease-expired" },
      directive: "stop",
      version: 5,
    }));
    w.projection.reconcileWorkerAuthority();
    assert.equal(snapshots(w), before + 1);
    const [card] = w.projection.buildDashboardDayWire(DAY).workerCards;
    assert.equal(card?.state, "failed");
    assert.equal(card?.stopReason, "lease-expired");
    assert.deepEqual(card?.browsers, []);
  });

  it("publishes the disappearance of a settled lease the span stream never named", () => {
    const w = world();
    w.authority.putWorkerLease(workerLeaseOf({ workerId, lifecycle: { state: "starting", startedAt } }));
    w.projection.reconcileWorkerAuthority();
    assert.equal(w.projection.buildDashboardDayWire(DAY).workerCards.length, 1);
    w.authority.putWorkerLease(workerLeaseOf({
      workerId,
      lifecycle: { state: "stopped", startedAt, stoppedAt: instantOffsetOf(0, 1_000), reason: "crashed" },
      directive: "stop",
      version: 2,
    }));
    w.projection.reconcileWorkerAuthority();
    assert.equal(snapshots(w), 2);

    assert.equal(w.projection.buildDashboardDayWire(DAY).workerCards.length, 0);
  });

  it("publishes a pool declaration the operator planned, which no span carries", () => {
    const w = world();
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

  it("degrades loudly when lease authority cannot be read instead of serving a stale card set", () => {
    const w = world({ collectRebuilds: true });
    w.authority.listLiveWorkerLeases = () => {
      throw new Error("leases table unreadable");
    };
    w.projection.reconcileWorkerAuthority();
    assert.equal(w.projection.health().state, "degraded");
    assert.match(w.projection.health().lastError ?? "", /worker lease reconcile failed: leases table unreadable/);
    assert.equal(w.scheduledRebuilds.length, 1);
  });
});
