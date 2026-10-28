import { BrowserSessionClosureUnprovedError } from "../../../../src/workflow-kit/session.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { WorkerSessionClosureUnprovedError, type WorkerSessionEvent } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { createWorkerSessionManagerTestWorld } from "../../../support/helpers/backend/worker-session-manager-world.js";

const childWorkflow = WorkflowIdSchema.parse("separations");
const need = { system: "ucpath", access: "read", session: "reuse-worker" } as const;

describe("worker execution session identity", () => {
  it("probes optional browser profiles without logging in, then authenticates only ordinary acquisition", async () => {
    const world = createWorkerSessionManagerTestWorld(), harness = world.sessionFactory();
    const events: WorkerSessionEvent[] = [], manager = await world.manager(harness, events);
    try {
      await manager.prepareProfile({ system: "crm", access: "read", session: "reuse-worker" }, "prod", new AbortController().signal);
      assert.equal(harness.probes(), 1); assert.equal(harness.opens(), 0); assert.equal(harness.closes(), 0);
      assert.equal(harness.logins(), 0); assert.equal(harness.resets(), 0); assert.deepEqual(events, []);
      await manager.withDriver(need, "prod", new AbortController().signal, async driver => { assert.equal(driver.system, "ucpath"); });
      assert.equal(harness.opens(), 1); assert.equal(harness.logins(), 1);
      const resets = harness.resets(), count = events.length;
      await manager.prepareProfile(need, "prod", new AbortController().signal);
      assert.equal(harness.opens(), 1); assert.equal(harness.logins(), 1); assert.equal(harness.resets(), resets);
      assert.equal(harness.probes(), 1); assert.equal(events.length, count);
    } finally { manager.releaseRunConfigFingerprint(); await manager.closeAll("worker-stop"); }
  });

  it("retains uncertain native probe closure and refuses ordinary acquisition", async () => {
    const world = createWorkerSessionManagerTestWorld(), harness = world.sessionFactory();
    const failure = new BrowserSessionClosureUnprovedError([new Error("injected probe close failure")], "probe closure unproved");
    const manager = await world.manager({ ...harness, factory: { ...harness.factory, probeProfile: async () => { throw failure; } } });
    await assert.rejects(manager.prepareProfile(need, "prod", new AbortController().signal), error => error === failure);
    assert.equal(harness.logins(), 0); assert.equal(harness.opens(), 0);
    await assert.rejects(manager.withDriver(need, "prod", new AbortController().signal, async () => assert.fail("uncertain probe cannot drive")));
    manager.releaseRunConfigFingerprint();
    await assert.rejects(manager.closeAll("worker-stop"), WorkerSessionClosureUnprovedError);
    assert.equal(harness.logins(), 0); assert.equal(harness.opens(), 0);
  });

  it("preserves the physical worker while attributing acquired sessions to the actual execution workflow", async () => {
    const world = createWorkerSessionManagerTestWorld();
    const harness = world.sessionFactory();
    const events: WorkerSessionEvent[] = [];
    const manager = await world.manager(harness, events);
    manager.releaseRunConfigFingerprint();
    manager.configureExecution(childWorkflow, taskStoreRegistry);
    manager.bindRunConfigFingerprint(world.RUN_FINGERPRINT);
    try {
      await manager.withDriver(need, "prod", new AbortController().signal, async () => undefined);
    } finally {
      manager.releaseRunConfigFingerprint();
      await manager.closeAll("parked");
    }
    assert.equal(harness.opens(), 1);
    assert.equal(harness.closes(), 1);
    assert.deepEqual(events.map(event => [event.type, event.workerId, event.workflowId]), [
      ["browser-session:start", world.WORKER_ID, childWorkflow],
      ["browser-session:reset", world.WORKER_ID, childWorkflow],
      ["browser-session:close", world.WORKER_ID, childWorkflow],
    ]);
    manager.configureExecution(world.WORKFLOW_ID, taskStoreRegistry);
    manager.bindRunConfigFingerprint(world.RUN_FINGERPRINT);
    try {
      await manager.withDriver(need, "prod", new AbortController().signal, async () => undefined);
    } finally {
      manager.releaseRunConfigFingerprint();
      await manager.closeAll("worker-stop");
    }
    assert.equal(harness.opens(), 2);
    assert.equal(harness.closes(), 2);
    assert.deepEqual(events.slice(3).map(event => [event.type, event.workerId, event.workflowId]), [
      ["browser-session:start", world.WORKER_ID, world.WORKFLOW_ID],
      ["browser-session:reset", world.WORKER_ID, world.WORKFLOW_ID],
      ["browser-session:close", world.WORKER_ID, world.WORKFLOW_ID],
    ]);
  });

  it("refuses an execution switch while a run or retained parent session is owned", async () => {
    const world = createWorkerSessionManagerTestWorld();
    const harness = world.sessionFactory();
    const manager = await world.manager(harness);
    assert.throws(() => manager.configureExecution(childWorkflow, taskStoreRegistry), WorkerSessionClosureUnprovedError);
    try {
      await manager.withDriver(need, "prod", new AbortController().signal, async () => undefined);
      manager.releaseRunConfigFingerprint();
      assert.throws(() => manager.configureExecution(childWorkflow, taskStoreRegistry), WorkerSessionClosureUnprovedError);
    } finally {
      await manager.closeAll("parked");
    }
    manager.configureExecution(childWorkflow, taskStoreRegistry);
    assert.equal(harness.opens(), 1);
    assert.equal(harness.closes(), 1);
  });

  it("retains failed parent-session closure and refuses a child execution switch", async () => {
    const world = createWorkerSessionManagerTestWorld();
    const harness = world.sessionFactory({ closeFailureAt: 1 });
    const manager = await world.manager(harness);
    await manager.withDriver(need, "prod", new AbortController().signal, async () => undefined);
    manager.releaseRunConfigFingerprint();
    await assert.rejects(manager.closeAll("parked"), WorkerSessionClosureUnprovedError);
    assert.throws(() => manager.configureExecution(childWorkflow, taskStoreRegistry), WorkerSessionClosureUnprovedError);
    assert.equal(harness.opens(), 1);
    assert.equal(harness.closes(), 1);
  });
});
