import { BrowserSessionClosureUnprovedError } from "../../../../src/workflow-kit/session.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { BrowserLoginError } from "../../../../src/backend/systems/browser-shared/login-contract.js";
import { WorkerSessionClosureUnprovedError, type WorkerSessionEvent } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { createWorkerSessionManagerTestWorld } from "../../../support/helpers/backend/worker-session-manager-world.js";

const childWorkflow = WorkflowIdSchema.parse("separations");
const need = { system: "ucpath", access: "read", session: "reuse-worker" } as const;

describe("worker execution session identity", () => {
  it("keeps a fresh lease behind the active browser when a queued waiter aborts", async () => {
    const world = createWorkerSessionManagerTestWorld(), harness = world.sessionFactory();
    const events: WorkerSessionEvent[] = [], manager = await world.manager(harness, events);
    const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    const signal = new AbortController().signal;
    const first = manager.withDriver(need, "prod", signal, async () => {
      started.resolve();
      await release.promise;
    });
    await started.promise;
    const cancel = new AbortController();
    const waiter = manager.withDriver(need, "prod", cancel.signal, async () => assert.fail("aborted waiter used the browser"));
    cancel.abort();
    await assert.rejects(waiter, /aborted before acquisition/);
    const fresh = manager.withDriver({ ...need, session: "fresh" }, "prod", signal, async () => "replacement");
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      assert.equal(harness.closes(), 0, "the first lease still owns its browser");
      assert.equal(harness.opens(), 1);
      release.resolve();
      await first;
      assert.equal(await fresh, "replacement");
      assert.deepEqual(events.map(event => event.type), [
        "browser-session:start", "browser-session:reset", "browser-session:close",
        "browser-session:start", "browser-session:reset",
      ]);
    } finally {
      release.resolve();
      await Promise.allSettled([first, fresh]);
      manager.releaseRunConfigFingerprint();
      await manager.closeAll("worker-stop");
    }
  });

  it("replaces a retained session whose authentication expired before the next task", async () => {
    const world = createWorkerSessionManagerTestWorld(), harness = world.sessionFactory();
    let expired = false;
    const events: WorkerSessionEvent[] = [];
    const manager = await world.manager({ ...harness, factory: {
      ...harness.factory,
      async open(input) {
        const resource = await harness.factory.open(input);
        if (harness.opens() !== 1) return resource;
        return { ...resource, async reset(options) {
          if (expired) throw new BrowserLoginError(input.system, "verify-landing", "session expired", "about:blank", undefined, undefined, "positive-evidence");
          await resource.reset(options);
        } };
      },
    } }, events);
    const signal = new AbortController().signal;
    try {
      const first = await manager.withDriver(need, "prod", signal, async driver => driver);
      manager.releaseRunConfigFingerprint();
      expired = true;
      manager.bindRunConfigFingerprint(world.RUN_FINGERPRINT);
      await manager.withDriver(need, "prod", signal, async driver => {
        assert.notEqual(driver, first, "the expired browser reached the task");
        assert.equal(harness.logins(), 2);
        assert.equal(harness.closes(), 1);
      });
      assert.deepEqual(events.map(event => event.type), [
        "browser-session:start", "browser-session:reset", "browser-session:close",
        "browser-session:start", "browser-session:reset",
      ]);
    } finally {
      manager.releaseRunConfigFingerprint();
      await manager.closeAll("worker-stop");
    }
  });

  it.each(["proved", "unproved"] as const)("poison-closes on abort during idle revalidation (closure %s)", async closure => {
    const world = createWorkerSessionManagerTestWorld();
    const harness = world.sessionFactory();
    const cancel = new AbortController();
    const reason = new Error("cancelled during idle reset");
    const closeFailure = new Error("injected poison-close failure");
    const closeReasons: string[] = [];
    const manager = await world.manager({ ...harness, factory: {
      ...harness.factory,
      async open(input) {
        const resource = await harness.factory.open(input);
        return {
          ...resource,
          async reset(options) {
            if (options.signal === cancel.signal) cancel.abort(reason);
            await resource.reset(options);
          },
          async close(options) {
            closeReasons.push(options.reason);
            if (closure === "unproved" && options.reason === "poisoned") throw closeFailure;
            return resource.close(options);
          },
        };
      },
    } });
    const signal = new AbortController().signal;
    let calls = 0;
    try {
      await manager.withDriver(need, "prod", signal, async () => undefined);
      const lease = manager.withDriver(need, "prod", cancel.signal, async () => { calls++; });
      if (closure === "proved") {
        await assert.rejects(lease, error => error === reason);
        assert.deepEqual(manager.activeSystems(), []);
      } else {
        await assert.rejects(lease, (error: unknown) => error instanceof AggregateError && error.cause === reason
          && error.errors.includes(reason) && error.errors.includes(closeFailure));
        await assert.rejects(manager.withDriver(need, "prod", signal, async () => { calls++; }), /unresolved failed-close proof/);
      }
      assert.equal(calls, 0);
      assert.deepEqual(closeReasons, ["poisoned"]);
      assert.equal(harness.opens(), 1);
    } finally {
      manager.releaseRunConfigFingerprint();
      await manager.closeAll("worker-stop");
    }
  });

  it("refuses handoff when the idle browser fails its check and cannot prove closure", async () => {
    const world = createWorkerSessionManagerTestWorld();
    const harness = world.sessionFactory({ resetFailureAt: 2, closeFailureAt: 1 });
    const manager = await world.manager(harness);
    const signal = new AbortController().signal;
    try {
      await manager.withDriver(need, "prod", signal, async () => undefined);
      const refusedLease = () => manager.withDriver(need, "prod", signal, async () => assert.fail("unproved browser reached the task"));
      await assert.rejects(refusedLease, (error: unknown) => error instanceof AggregateError
        && error.errors[0] instanceof Error && error.errors[0].message === "injected reset failure"
        && error.errors[1] instanceof Error && error.errors[1].message === "injected close failure");
      await assert.rejects(refusedLease, /unresolved failed-close proof/);
      assert.equal(harness.opens(), 1);
      assert.equal(harness.closes(), 1);
    } finally {
      manager.releaseRunConfigFingerprint();
      await manager.closeAll("worker-stop");
    }
  });

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

  it("keeps open sessions for the same execution workflow and parks them before a workflow change", async () => {
    const world = createWorkerSessionManagerTestWorld();
    const harness = world.sessionFactory();
    const manager = await world.manager(harness);
    await manager.withDriver(need, "prod", new AbortController().signal, async () => undefined);
    manager.releaseRunConfigFingerprint();
    await manager.parkForExecution(world.WORKFLOW_ID, taskStoreRegistry);
    manager.configureExecution(world.WORKFLOW_ID, taskStoreRegistry);
    assert.equal(harness.closes(), 0);
    assert.deepEqual(manager.activeSystems(), ["ucpath"]);
    await manager.parkForExecution(childWorkflow, taskStoreRegistry);
    assert.doesNotThrow(() => manager.configureExecution(childWorkflow, taskStoreRegistry));
    assert.equal(harness.opens(), 1);
    assert.equal(harness.closes(), 1);
    assert.deepEqual(manager.activeSystems(), []);
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
