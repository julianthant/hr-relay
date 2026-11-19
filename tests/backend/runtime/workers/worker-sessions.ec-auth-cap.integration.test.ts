import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { WorkerSessionManager, type WorkerBrowserSessionFactory, type WorkerSessionEvent } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { DuoTerminalRefusalError } from "../../../../src/backend/systems/browser-shared/login-contract.js";
import { WorkflowIdSchema, taskId } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createWorkerSessionManagerTestWorld } from "../../../support/helpers/backend/worker-session-manager-world.js";
import { ManualScheduler } from "../../../support/helpers/phase1f-executor-harness.js";

const world = createWorkerSessionManagerTestWorld();
const signal = new AbortController().signal;
const need = { system: "ucpath", access: "read", session: "reuse-worker" } as const;
const clock = manualClock(new Date("2026-08-02T18:00:00.000Z"));
const context = { runId: "00000000-0000-4000-8000-000000000099", descriptorFingerprint: world.RUN_FINGERPRINT };

function manager(factory: WorkerBrowserSessionFactory, events: WorkerSessionEvent[] = [], workflow = "emergency-contact") {
  const sessions = new WorkerSessionManager({
    workflowId: WorkflowIdSchema.parse(workflow), workerId: world.WORKER_ID,
    stores: taskStoreRegistry, clock, scheduler: new ManualScheduler(clock), acquireDeadlineMs: 30_000,
    factory, duoCeremony: { openGate: () => ({
      retainedForRecovery: () => true, dispose: () => undefined,
      withCeremony: async () => { throw new Error("unexpected ceremony in synthetic authentication"); },
    }) }, browserScreenshotCapture: { capture: async () => undefined }, onEvent: event => events.push(event),
  });
  sessions.configureExecution(WorkflowIdSchema.parse("person-lookup"), taskStoreRegistry);
  sessions.bindRunConfigFingerprint(world.RUN_FINGERPRINT, "headless", context);
  return sessions;
}

describe("Emergency Contact worker claim authentication", () => {
  it("keeps the authenticated CRM session after its required capture fails", async () => {
    const harness = world.sessionFactory();
    const events: WorkerSessionEvent[] = [];
    const sessions = manager({ ...harness.factory, open: async input => {
      const resource = await harness.factory.open(input);
      return { ...resource, screenshot: async () => ({
        sessionId: resource.sessionId, observedAt: clock.now().toISOString(), pageVersion: 1,
        state: "unavailable", reason: "verification-failed",
      }) };
    } }, events);
    const crm = { ...need, system: "crm" } as const;
    try {
      await sessions.withDriver(need, "prod", signal, async () => undefined);
      await assert.rejects(sessions.withDriver(crm, "prod", signal, async (_driver, capture) => capture(), {
        taskId: taskId("crm/search-onboarding-records"), nodeId: "lookup", attempt: 1, log: { warn: () => undefined },
      }), { code: "BROWSER_SCREENSHOT_CAPTURE_FAILED" });
      await sessions.withDriver(crm, "prod", signal, async () => undefined);
      const starts = events.filter(event => event.type === "browser-session:start").map(event => event.system);
      assert.deepEqual(starts, ["ucpath", "crm"]);
      assert.equal(harness.logins(), 2);
      assert.equal(harness.closes(), 0);
    } finally { sessions.releaseRunConfigFingerprint(); await sessions.closeAll("worker-stop"); }
  });

  it("refuses a fresh acquisition after a guarded Duo recovery also fails in this claim", async () => {
    const harness = world.sessionFactory();
    const turns: string[] = [];
    const loginFailure = new Error("synthetic login failure");
    const sessions = manager({ ...harness.factory,
      discardProfile: async () => { turns.push("discard"); return { profileDirectory: "/fixture/profile" }; },
      open: async input => {
        const resource = await harness.factory.open(input);
        return { ...resource, authentication: { authenticate: async (): Promise<"logged-in"> => {
          turns.push("authenticate");
          if (turns.length === 1) throw new DuoTerminalRefusalError("ucpath", "fixture refusal", "https://duosecurity.com/");
          if (turns.length === 3) throw loginFailure;
          return "logged-in";
        } } };
      },
    });
    const lease = () => sessions.withDriver(need, "prod", signal, async () => assert.fail("failed login cannot drive"));
    try {
      await assert.rejects(lease(), error => error === loginFailure);
      await assert.rejects(lease(), error => error === loginFailure);
      assert.deepEqual(turns, ["authenticate", "discard", "authenticate"]);
      assert.equal(harness.opens(), 2);
      sessions.releaseRunConfigFingerprint();
      sessions.bindRunConfigFingerprint(world.RUN_FINGERPRINT, "headless", context);
      await sessions.withDriver(need, "prod", signal, async () => undefined);
      assert.equal(harness.opens(), 3);
    } finally { sessions.releaseRunConfigFingerprint(); await sessions.closeAll("worker-stop"); }
  });

  it("retains a healthy transaction session after a required capture fails before submit", async () => {
    const harness = world.sessionFactory({ screenshotFailure: true });
    const sessions = manager(harness.factory);
    const transaction = { ...need, access: "transaction" } as const;
    const owner = { taskId: taskId("ucpath/save-emergency-contact"), nodeId: "update", attempt: 1, log: { warn: () => undefined } };
    try {
      await assert.rejects(sessions.withTransactionDriver(transaction, "prod", signal,
        async (_driver, _ownership, capture) => capture("before-submit"), owner),
      error => error instanceof AggregateError && error.cause instanceof Error && error.cause.message.includes("BROWSER_SCREENSHOT_CAPTURE_FAILED"));
      await sessions.withDriver(need, "prod", signal, async () => undefined, owner);
      assert.equal(harness.opens(), 1);
      assert.equal(harness.closes(), 0);
    } finally { sessions.releaseRunConfigFingerprint(); await sessions.closeAll("worker-stop"); }
  });

  it("propagates a broken session's reset and capture errors without reacquiring in the claim", async () => {
    const harness = world.sessionFactory({ resetFailureAt: 1, screenshotFailure: true });
    const sessions = manager(harness.factory);
    const read = () => sessions.withDriver(need, "prod", signal, async () => undefined);
    try {
      let failure: AggregateError | undefined;
      await assert.rejects(read(), error => {
        assert.ok(error instanceof AggregateError);
        assert.match(String(error.cause), /screenshot persistence failure/);
        assert.ok(error.errors.some(cause => String(cause).includes("reset failure")));
        failure = error;
        return true;
      });
      await assert.rejects(read(), error => error === failure);
      assert.equal(harness.opens(), 1);
      assert.equal(harness.closes(), 1);
    } finally { sessions.releaseRunConfigFingerprint(); await sessions.closeAll("worker-stop"); }
  });

  it("refuses a second acquisition of the same system before replacing the held browser", async () => {
    const harness = world.sessionFactory();
    const sessions = manager(harness.factory);
    try {
      await sessions.withDriver(need, "prod", signal, async () => undefined);
      await assert.rejects(sessions.withDriver({ ...need, session: "fresh" }, "prod", signal, async () => undefined),
        /already acquired/);
      assert.equal(harness.opens(), 1);
      assert.equal(harness.closes(), 0);
    } finally { sessions.releaseRunConfigFingerprint(); await sessions.closeAll("worker-stop"); }
  });

  it("preserves poison-close and reacquisition for an independent Person Lookup worker", async () => {
    const harness = world.sessionFactory();
    const sessions = manager(harness.factory, [], "person-lookup");
    try {
      await assert.rejects(sessions.withDriver(need, "prod", signal, async () => { throw new Error("read failed"); }), /read failed/);
      assert.equal(harness.closes(), 1);
      await sessions.withDriver(need, "prod", signal, async () => undefined);
      assert.equal(harness.opens(), 2);
    } finally { sessions.releaseRunConfigFingerprint(); await sessions.closeAll("worker-stop"); }
  });
});
