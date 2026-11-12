import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { createOperatorProjection } from "../../../../../src/backend/app/composition/dashboard/queue.js";
import { DESCRIPTORS } from "../../../../../src/backend/app/registries/workflow-registry.js";
import { QUEUE_NOT_STARTING_NO_WORKER } from "../../../../../src/models/dashboard/projection.js";
import { FingerprintSchema } from "../../../../../src/rules/identity/ids.js";
import { createDashboardPoolTestWorld, type ControlHarness } from "../../../../support/helpers/backend/dashboard-pool-world.js";

const { WORKFLOW, WORKER_1, openControlHarness, settleMicrotasks, view, dashboardLaunch, launchCommands, planWorkers, cleanup } = createDashboardPoolTestWorld();
afterEach(cleanup);

function queueRow(h: ControlHarness, runId: string) {
  const projection = createOperatorProjection({
    database: h.database, reader: h.lifecycle, workerMembers: () => h.workers.pool.snapshot(),
    descriptors: { resolve: workflowId => DESCRIPTORS.find(descriptor => descriptor.id === workflowId) },
    stateRoot: h.stateRoot, clock: h.clock, appVersion: "0.1.0", descriptorSetHash: FingerprintSchema.parse("a".repeat(64)),
    ledger: { foldActivityRange: () => { throw new Error("unrequested activity"); } },
  });
  return projection.queueSurface(runId);
}

async function stopMember(h: ControlHarness, reason: "operator" | "shutdown") {
  const current = view(h);
  if (reason === "shutdown") {
    await h.workers.pool.stopAll("shutdown");
    return;
  }
  await h.workers.pool.stop({ workerId: current.member.workerId, lifetimeId: current.lifetimeId, expectedVersion: current.version }, "operator");
}

describe("a crashed pool member is respawned once", () => {
  it("respawns a crashed member once when work is queued, then leaves the next crash exited with Cancel", async () => {
    const h = await openControlHarness();
    assert.equal((await launchCommands(h).submit(dashboardLaunch(h, "10873690", { items: 2 }).request)).state, "applied");
    await settleMicrotasks();
    assert.equal(h.children.length, 1);
    h.children[0]?.exit(1, null);
    await settleMicrotasks();
    assert.equal(h.children.length, 2, "one crash with queued work spawns one replacement");
    assert.equal(view(h).state, "running");
    const claimed = h.database.authority.runs.claimNext({ workflow: WORKFLOW, workerId: WORKER_1, now: h.clock.now().toISOString() });
    assert.equal(claimed.state, "claimed");
    assert.equal(h.children.length, 2);
    h.children[1]?.exit(1, null);
    await settleMicrotasks();
    assert.equal(h.children.length, 2, "the replacement's crash does not spawn a third process");
    assert.equal(view(h).exit?.outcome, "crashed");
    assert.equal(h.faults.length, 0);
    const runs = h.database.authority.runs.listByWorkflow(WORKFLOW);
    const queued = runs.filter(run => run.lifecycle.state === "queued");
    const failed = runs.filter(run => run.lifecycle.state === "terminal");
    assert.equal(queued.length, 1);
    assert.equal(failed.length, 1);
    const row = queueRow(h, queued[0]?.envelope.runId ?? "");
    assert.ok(row);
    assert.equal(row.status, "queued");
    assert.deepEqual(row.notStarting, QUEUE_NOT_STARTING_NO_WORKER);
    assert.equal(row.actions.some(action => action.key === "cancel"), true);
  });

  it("does not respawn a requested stop or a shutdown drain", async () => {
    for (const reason of ["operator", "shutdown"] as const) {
      const h = await openControlHarness();
      assert.equal((await launchCommands(h).submit(dashboardLaunch(h).request)).state, "applied");
      await settleMicrotasks();
      await stopMember(h, reason);
      await settleMicrotasks();
      assert.equal(h.children.length, 1, reason);
      assert.equal(view(h).exit?.outcome, "stopped");
      await h.workers.pool.stopAll("shutdown");
    }
  });

  it("does not respawn a crash when the workflow has no queued work", async () => {
    const h = await openControlHarness();
    await planWorkers(h, 1);
    await settleMicrotasks();
    h.children[0]?.exit(1, null);
    await settleMicrotasks();
    assert.equal(h.children.length, 1);
    assert.equal(view(h).state, "exited");
    assert.equal(view(h).exit?.outcome, "crashed");
  });
});
