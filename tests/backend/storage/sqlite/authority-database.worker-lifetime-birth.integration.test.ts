import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireRuntimeProcessLock, bindWorkerProcessAdmission } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { WorkerIdSchema } from "../../../../src/rules/identity/ids.js";
import { createRunRecordServiceTestWorld } from "../../../support/helpers/backend/run-record-service-world.js";

const world = createRunRecordServiceTestWorld();
afterEach(world.cleanup);

describe("actual native worker lifetime birth", () => {
  it("commits the original authenticated acquisition journal and lease reference together", async () => {
    const h = await world.fixture();
    const slot = h.database.authority.workerSlots.list()[0];
    if (slot === undefined) throw new Error("missing fixture member");
    const old = h.database.authority.workerLeases.get(slot.workerId);
    if (old === undefined) throw new Error("missing fixture lifetime");
    const now = h.clock.now().toISOString();
    h.database.authority.workerLeases.reportLifecycle({ workerId: slot.workerId, leaseGeneration: old.leaseGeneration,
      lifecycle: { state: "stopped", startedAt: old.lifecycle.startedAt, stoppedAt: now, reason: "shutdown" }, now });
    const request = { workerId: slot.workerId, workflow: slot.workflow, browserSystems: old.browserSystems,
      processId: process.pid, requestedBy: "local-operator", now };
    expect(() => h.database.authority.workerLeases.start({ ...request, birthCommandId: randomUUID() })).toThrow();
    const root = join(h.root, "locks");
    const direct = acquireRuntimeProcessLock({ name: "workers", processLockRoot: root, workerId: slot.workerId, pid: process.pid }, h.clock);
    const before = h.database.getMeta().authorityGeneration;
    expect(() => h.database.startOwnedWorker(request, direct)).toThrow("worker-birth-custody-unavailable");
    expect(h.database.getMeta().authorityGeneration).toBe(before);
    direct.release();
    const other = bindWorkerProcessAdmission({ processLockRoot: root, authorityPath: join(h.root, "other.db"),
      workerId: slot.workerId, pid: process.pid, clock: h.clock, open: () => h.database,
      admit: () => WorkerIdSchema.parse(slot.workerId), close: () => undefined });
    expect(() => h.database.startOwnedWorker(request, other.processLock)).toThrow("worker-birth-custody-unavailable");
    expect(h.database.getMeta().authorityGeneration).toBe(before);
    other.processLock.release();
    const bound = bindWorkerProcessAdmission({ processLockRoot: root, authorityPath: join(h.root, "state.db"),
      workerId: slot.workerId, pid: process.pid, clock: h.clock, open: () => h.database,
      admit: () => WorkerIdSchema.parse(slot.workerId), close: () => undefined });
    try {
      const result = h.database.startOwnedWorker(request, bound.processLock);
      expect(result.state).toBe("started");
      if (result.state !== "started") throw new Error("birth not started");
      expect(result.lease.leaseGeneration).toBe(old.leaseGeneration + 1);
      expect(result.lease.version).toBe(old.version + 2);
      expect(result.lease.birthCommandId).toBeDefined();
      const custody = h.database.workerLifetimeCustody(slot.workerId);
      expect(custody).toMatchObject({ state: "alive", birth: { member: { workerId: slot.workerId,
        membershipRevision: slot.membershipRevision }, leaseGeneration: result.lease.leaseGeneration,
        authorityPath: join(h.root, "state.db"), processLockRoot: root,
        owner: { acquisitionId: bound.processLock.acquisitionId, pid: process.pid } } });
      expect(h.database.authority.lifecycleJournal.findAuditByCommand(String(result.lease.birthCommandId))).toMatchObject({
        request: { operation: "worker-lifetime-birth" }, result: { kind: "worker-birth", workerId: slot.workerId,
          leaseGeneration: result.lease.leaseGeneration } });
      bound.processLock.release();
      expect(h.database.workerLifetimeCustody(slot.workerId).state).toBe("released-alive");
    } finally { bound.processLock.release(); }
  });
});
