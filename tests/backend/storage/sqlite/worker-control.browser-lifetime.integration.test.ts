import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, describe, it, vi } from "vitest";
import { createWorkerBrowserControl } from "../../../../src/backend/runtime/workers/worker-browser-control.js";
import type { WorkerSessionManager } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { WorkerControlRefusal } from "../../../../src/models/run/worker-control.js";
import { BrowserSessionIdSchema, FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { createDashboardPoolTestWorld } from "../../../support/helpers/backend/dashboard-pool-world.js";

const world = createDashboardPoolTestWorld();
afterEach(world.cleanup);

/** An idle worker with one observed browser and a real kernel-admitted refresh-browser control, left in `settle`'s phase. */
async function refreshControl(settle: "uncertain" | "ready") {
  const signal = new AbortController().signal;
  let held: (() => void) | undefined, admitted!: () => void;
  const reachedReady = new Promise<void>(resolve => { admitted = resolve; });
  const hold = new Promise<void>(resolve => { held = resolve; });
  const h = await world.openControlHarness({ interceptPool: pool => ({ ...pool, refreshPoolBrowser: async context => {
    h.database.authority.workerControls.transition(context.command.commandId, "admitted", { state: "ready" });
    if (settle === "ready") { admitted(); await hold; throw new WorkerControlRefusal("test-released"); }
    const failing = { assertControlTarget: () => undefined, controlBrowser: async () => { throw new Error("browser-call-threw"); } } as unknown as WorkerSessionManager;
    await createWorkerBrowserControl({ database: h.database, workerId: world.WORKER_1, leaseGeneration: 1, clock: h.clock, signal })(failing);
    return { state: "accepted" };
  } }) });
  await world.spawnPoolWorker(h);
  h.database.authority.workerLeases.reportLifecycle({ workerId: world.WORKER_1, leaseGeneration: 1,
    lifecycle: { state: "idle", startedAt: world.NOW, heartbeatAt: world.NOW }, now: world.NOW });
  const fingerprint = FingerprintSchema.parse("a".repeat(64)), sessionId = BrowserSessionIdSchema.parse(randomUUID());
  h.database.authority.workerControls.observe({ workerId: world.WORKER_1, leaseGeneration: 1, sessionId, system: "crm", configFingerprint: fingerprint,
    signInFingerprint: fingerprint, browserMode: "headed", acceptDownloads: false, exclusive: false, health: "authenticated",
    observedAt: world.NOW, openedAt: world.NOW, profileRevision: 1 });
  const lease = h.database.authority.workerLeases.get(world.WORKER_1); assert(lease);
  const commandId = randomUUID();
  const command = h.kernel.executeWorkerPool({ ...world.envelope(h, commandId), type: "refresh-browser",
    target: { workerId: world.WORKER_1, browserSessionId: sessionId, expectedVersion: lease.version, controlBasis: world.servedControlBasis(h.database, world.WORKER_1) } });
  // The kernel cannot observe an uncertain browser effect and rejects the call, as it does live.
  if (settle === "ready") await reachedReady; else await assert.rejects(command, /worker-browser-outcome-not-observed/);
  const release = async () => { held?.(); await command.catch(() => undefined); };
  return { h, commandId, release };
}

describe("browser controls bound to an ended worker lifetime", () => {
  const scope = `worker-pool:${world.WORKFLOW}`;
  const stopWorker = (h: Awaited<ReturnType<typeof refreshControl>>["h"]) => h.database.authority.workerLeases.reportLifecycle({ workerId: world.WORKER_1, leaseGeneration: 1,
    lifecycle: { state: "stopped", startedAt: world.NOW, stoppedAt: world.NOW, reason: "operator" }, now: world.NOW });
  function assertRefused({ h, commandId }: Awaited<ReturnType<typeof refreshControl>>, now: string) {
    const record = h.database.authority.workerControls.get(commandId);
    assert.deepEqual(record?.phase, { state: "refused", completedAt: now, message: "worker-browser-lifetime-ended" });
    assert.equal(record?.auditedAt, now);
    assert.deepEqual(h.database.authority.commandAudits.findByCommand(commandId)?.result,
      { state: "rejected", commandId, code: "invalid-state", message: "worker-browser-lifetime-ended" });
    assert.deepEqual(h.database.authority.workerControls.pending(scope), []);
  }

  it("refuses and audits an uncertain refresh-browser once its worker lifetime has stopped, unblocking the pool", async () => {
    const f = await refreshControl("uncertain");
    assert.equal(f.h.database.authority.workerControls.get(f.commandId)?.phase.state, "uncertain");
    assert.equal(f.h.database.authority.workerControls.pending(scope).length, 1);
    stopWorker(f.h);
    const now = new Date(f.h.clock.now().getTime() + 1000).toISOString();
    f.h.database.reconcileWorkerControlMilestones(now);
    assertRefused(f, now);
    const next = await f.h.kernel.executeWorkerPool({ ...world.envelope(f.h, randomUUID()), type: "plan-worker-count",
      target: { workflowId: world.WORKFLOW, expectedVersion: f.h.database.authority.workerPools.get(world.WORKFLOW)?.version ?? 0 }, payload: { desiredWorkers: 2 } });
    assert.ok(next.state !== "rejected" || !next.message.includes("worker-control-unresolved-effect"), JSON.stringify(next));
  });

  it("refuses and audits a never-executed ready refresh-browser once its worker lifetime has stopped", async () => {
    const f = await refreshControl("ready");
    assert.equal(f.h.database.authority.workerControls.get(f.commandId)?.phase.state, "ready");
    stopWorker(f.h);
    const now = new Date(f.h.clock.now().getTime() + 1000).toISOString();
    f.h.database.reconcileWorkerControlMilestones(now);
    assertRefused(f, now);
    await f.release();
  });

  it("leaves an uncertain refresh-browser untouched, without a write transaction, while its worker lifetime is live", async () => {
    const f = await refreshControl("uncertain");
    const writes = vi.spyOn(f.h.database, "withAuthorityTransaction");
    f.h.database.reconcileWorkerControlMilestones(new Date(f.h.clock.now().getTime() + 1000).toISOString());
    assert.equal(writes.mock.calls.length, 0, "the poll must not open a write transaction for a live control");
    const record = f.h.database.authority.workerControls.get(f.commandId);
    assert.equal(record?.phase.state, "uncertain");
    assert.equal(record?.auditedAt, undefined);
    assert.equal(f.h.database.authority.workerControls.pending(scope).length, 1);
  });
});
