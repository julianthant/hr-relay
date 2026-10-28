import assert from "node:assert/strict";
import { once } from "node:events";
import { afterEach, describe, it } from "vitest";
import { createOperatorProjection } from "../../../../../src/backend/app/composition/dashboard/queue.js";
import { reconcileExitedWorker } from "../../../../../src/backend/runs/lifecycle/startup-crash-recovery.js";
import { RuntimeLifetimeLock } from "../../../../../src/backend/storage/admission/lifetime-lock.js";
import { createTransactionHistory } from "../../../../../src/backend/storage/sqlite/transaction-history.js";
import { FingerprintSchema } from "../../../../../src/rules/identity/ids.js";
import { ownedWorkerLifetimeFixture } from "../../../../support/helpers/backend/worker-lifetime-world.js";
import { createRunRecordServiceTestWorld } from "../../../../support/helpers/backend/run-record-service-world.js";
import { personLookupDescriptor } from "../../../../support/helpers/registered-workflows.js";

const world = createRunRecordServiceTestWorld();
afterEach(world.cleanup);

describe("Sessions follows child-exit recovery", () => {
  it.each(["starting", "idle"] as const)("settles an exited %s lease before another Run", async phase => {
    const f = await ownedWorkerLifetimeFixture(world), lock = await RuntimeLifetimeLock.acquire(0);
    try {
      f.observe(phase);
      const projection = createOperatorProjection({ database: f.database, reader: f.service,
        stateRoot: f.root, clock: f.clock, appVersion: "0.1.0", descriptorSetHash: FingerprintSchema.parse("a".repeat(64)),
        ledger: createTransactionHistory(f.database.authority), descriptors: { resolve: () => personLookupDescriptor } });
      const day = f.clock.now().toISOString().slice(0, 10);
      assert.equal(projection.buildDashboardDayWire(day).workerCards[0]?.state, phase);
      const generation = f.database.getMeta().authorityGeneration;
      assert.equal(projection.buildDashboardDayWire(day).workerCards[0]?.state, phase);
      assert.equal(f.database.getMeta().authorityGeneration, generation);
      const exited = once(f.old.child, "exit");
      f.old.child.kill("SIGTERM"); await exited;
      f.clock.advanceWall(1000);
      const observedAt = f.clock.now().toISOString();
      reconcileExitedWorker({ ...f, lifecycle: f.service, lock, workerId: f.slot.workerId, leaseGeneration: f.started.leaseGeneration });
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
      assert.throws(() => reconcileExitedWorker({ ...f, lifecycle: f.service, lock, workerId: f.slot.workerId,
        leaseGeneration: f.started.leaseGeneration + 1 }));
      assert.deepEqual(projection.buildDashboardDayWire(day).workerCards, result.workerCards);
    } finally { await f.dispose(); await lock.close(); }
  });
});
