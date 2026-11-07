import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { createDashboardPoolTestWorld } from "../../../support/helpers/backend/dashboard-pool-world.js";

const { WORKFLOW, WORKER_1, openControlHarness, dashboardLaunch, launchCommands, planWorkers, nextCommandId, settleMicrotasks, view, cleanup } = createDashboardPoolTestWorld();
afterEach(cleanup);

describe("automatic Run capacity", () => {
  it("starts exactly one worker for a run with no member and replays without another", async () => {
    const h = await openControlHarness();
    const { request } = dashboardLaunch(h, "10873690", { items: 2 });
    assert.equal((await launchCommands(h).submit(request)).state, "applied");
    await settleMicrotasks();
    assert.equal(h.children.length, 1);
    assert.equal(h.database.authority.workerPools.get(WORKFLOW)?.desiredWorkers, 1);
    assert.equal((await launchCommands(h).submit(request)).state, "already-applied");
    assert.equal(h.children.length, 1);
    assert.equal(h.database.authority.workerSlots.active(WORKFLOW).length, 1);
  });

  it("creates no workers for a preview plan", async () => {
    const h = await openControlHarness(); const { request } = dashboardLaunch(h, "10873690");
    const plan = h.database.authority.startPlans.get(request.target.startPlanId); assert.ok(plan);
    const preview = { ...plan, startPlanId: nextCommandId(), shape: "preview" };
    h.database.authority.startPlans.create(preview);
    const result = await launchCommands(h).submit({ ...request, target: { ...request.target, startPlanId: preview.startPlanId } });
    assert.equal(result.state, "applied");
    assert.equal(h.children.length, 0);
    assert.equal(h.database.authority.workerSlots.active(WORKFLOW).length, 0);
  });

  it("uses every running member without adding another", async () => {
    const h = await openControlHarness();
    await planWorkers(h, 2); await settleMicrotasks();
    assert.equal((await launchCommands(h).submit(dashboardLaunch(h).request)).state, "applied");
    await settleMicrotasks();
    assert.equal(h.children.length, 2);
    assert.equal(h.database.authority.workerPools.get(WORKFLOW)?.desiredWorkers, 2);
  });

  it("replaces a crashed sole member once without expanding the pool", async () => {
    const h = await openControlHarness();
    await planWorkers(h, 1); await settleMicrotasks();
    h.children[0]?.exit(null, "SIGKILL"); await settleMicrotasks();
    assert.equal(view(h).state, "exited");
    assert.equal((await launchCommands(h).submit(dashboardLaunch(h).request)).state, "applied");
    await settleMicrotasks();
    assert.equal(h.children.length, 2);
    assert.equal(view(h, WORKER_1).state, "running");
    assert.equal(h.database.authority.workerPools.get(WORKFLOW)?.desiredWorkers, 1);
  });

  it("keeps the start applied and shows a member that never becomes ready as failed on its card", async () => {
    const h = await openControlHarness({ ready: false });
    const pending = launchCommands(h).submit(dashboardLaunch(h).request);
    await settleMicrotasks();
    h.clock.advanceMonotonic(60_000);
    for (const entry of h.scheduler.pending()) entry.fire();
    await settleMicrotasks();
    h.children[0]?.exit(null, "SIGKILL"); await settleMicrotasks();
    assert.equal((await pending).state, "applied");
    assert.deepEqual(h.children[0]?.kills, ["SIGKILL"]);
    assert.deepEqual(h.faults.map(fault => "code" in fault ? fault.code : fault.message), ["WORKER_START_TIMED_OUT"]);
    assert.equal(view(h).state, "exited");
  });
});
