import { reconcileDeadWorkerLifetimes } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import assert from "node:assert/strict";
import { once } from "node:events";
import { afterEach, describe, it } from "vitest";
import { createOperatorProjection } from "../../../../../src/backend/app/composition/dashboard/queue.js";
import { createTransactionHistory } from "../../../../../src/backend/storage/sqlite/transaction-history.js";
import { FingerprintSchema } from "../../../../../src/rules/identity/ids.js";
import { ownedWorkerLifetimeFixture } from "../../../../support/helpers/backend/worker-lifetime-world.js";
import { createRunRecordServiceTestWorld } from "../../../../support/helpers/backend/run-record-service-world.js";
import { personLookupDescriptor } from "../../../../support/helpers/registered-workflows.js";

const world = createRunRecordServiceTestWorld();
afterEach(world.cleanup);

describe("Sessions observes an actual dead worker lifetime", () => {
  it("refuses missing native birth custody without settling the lease", () => {
    const f = world.fixture();
    const lease = f.database.authority.workerLeases.listLive()[0]; assert.ok(lease);
    assert.throws(() => f.database.settleDeadWorkerLifetime(lease.workerId, f.clock.now().toISOString()), /worker-birth-authority-unavailable/);
    const faults: Error[] = [];
    reconcileDeadWorkerLifetimes(f.database, f.clock, error => { faults.push(error); });
    assert.ok(faults.some(error => error.message === "worker-birth-authority-unavailable"));
    assert.deepEqual(f.database.authority.workerLeases.get(lease.workerId), lease);
  });

  it("preserves a settled reason and refuses a replacement while its old process is alive", async () => {
    const f = await ownedWorkerLifetimeFixture(world);
    try {
      f.database.authority.workerLeases.reportLifecycle({ workerId: f.slot.workerId, leaseGeneration: f.started.leaseGeneration,
        lifecycle: { state: "stopped", startedAt: f.started.lifecycle.startedAt, stoppedAt: f.now, reason: "shutdown" }, now: f.now });
      const stopped = f.database.authority.workerLeases.get(f.slot.workerId);
      assert.deepEqual(f.database.settleDeadWorkerLifetime(f.slot.workerId, f.now), stopped);
      assert.throws(() => f.database.assertRetainedWorkerDeath({ workerId: f.slot.workerId, workflowId: f.slot.workflow,
        ordinal: f.slot.ordinal, poolIndex: f.slot.poolIndex, membershipRevision: f.slot.membershipRevision },
        { leaseGeneration: f.started.leaseGeneration, processId: f.old.pid, startedAt: f.started.lifecycle.startedAt }), /worker-recovery-death-unproved/);
      assert.deepEqual(f.database.authority.workerLeases.get(f.slot.workerId), stopped);
    } finally { await f.dispose(); }
  });

  it.each(["starting", "idle"] as const)("settles a dead %s lease with its reason before another Run", async phase => {
    const f = await ownedWorkerLifetimeFixture(world);
    try {
      f.observe(phase);
      const projection = createOperatorProjection({ database: f.database, reader: f.service,
        stateRoot: f.root, clock: f.clock, appVersion: "0.1.0", descriptorSetHash: FingerprintSchema.parse("a".repeat(64)),
        ledger: createTransactionHistory(f.database.authority), descriptors: { resolve: () => personLookupDescriptor } });
      const day = f.clock.now().toISOString().slice(0, 10);
      assert.equal(projection.buildDashboardDayWire(day).workerCards[0]?.state, phase);
      const exited = once(f.old.child, "exit");
      f.old.child.kill("SIGTERM"); await exited;
      f.clock.advanceWall(1000);
      const observedAt = f.clock.now().toISOString();
      const unchanged = f.database.authority.workerLeases.get(f.slot.workerId);
      const generation = f.database.getMeta().authorityGeneration;
      assert.equal(projection.buildDashboardDayWire(day).workerAuthority.state, "unavailable");
      assert.deepEqual(f.database.authority.workerLeases.get(f.slot.workerId), unchanged);
      assert.equal(f.database.getMeta().authorityGeneration, generation);
      const faults: Error[] = [];
      reconcileDeadWorkerLifetimes(f.database, f.clock, error => { faults.push(error); });
      assert.deepEqual(faults, []);
      const result = projection.buildDashboardDayWire(day);
      assert.equal(result.workerAuthority.state, "present", JSON.stringify(result.workerAuthority));
      assert.equal(result.workerCards[0]?.state, "failed");
      assert.equal(result.workerCards[0]?.stopReason, "crashed");
      assert.equal(result.workerCards[0]?.endedAt, observedAt);
      assert.deepEqual(f.database.authority.workerLeases.get(f.slot.workerId)?.lifecycle,
        { state: "stopped", startedAt: f.started.lifecycle.startedAt, stoppedAt: observedAt, reason: "crashed" });
      assert.equal(f.database.authority.workerLeases.get(f.slot.workerId)?.leaseGeneration, f.started.leaseGeneration);
      assert.equal(f.database.authority.workerSlots.get(f.slot.workerId)?.retiredAt, null);
      assert.deepEqual(projection.buildDashboardDayWire(day).workerCards, result.workerCards);
    } finally { await f.dispose(); }
  });
});
