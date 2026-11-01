import { createClonedProfileFixtures } from "../support/helpers/admission-fixture.js";
import assert from "node:assert/strict";
import { afterAll, describe, it } from "vitest";
import { WorkerSessionManager } from "../../src/backend/runtime/workers/worker-sessions.js";
import { taskStoreRegistry } from "../../src/backend/app/registries/task-registry.js";
import type { WorkerBrowserSessionFactory, BrowserScreenshotEvidence } from "../../src/workflow-kit/session.js";
import type { RunBrowserScreenshotCapture } from "../../src/workflow-kit/diagnostics.js";
import { TaskError } from "../../src/workflow-kit/errors.js";
import { BrowserSessionIdSchema, FingerprintSchema, WorkerIdSchema, WorkflowIdSchema, taskId } from "../../src/rules/identity/ids.js";
import { manualClock } from "../../src/rules/time/clock.js";
import { fixtureDuoCeremonyGates } from "../support/helpers/duo-ceremony-fixtures.js";
import { FIXTURE_SESSION_ACQUIRE_MS, ManualScheduler } from "../support/helpers/phase1f-executor-harness.js";

const profileFixtures = createClonedProfileFixtures();
afterAll(() => profileFixtures.close());

const fingerprint = FingerprintSchema.parse("1".repeat(64));
const need = { system: "ucpath", access: "read", session: "reuse-worker" } as const;
const owner = { taskId: taskId("ucpath/search-person-org"), nodeId: "searching", attempt: 1 };
async function world(enabled: boolean, failure?: "unavailable" | "missing" | "persist" | "capture" | "capture-and-close", pause?: () => Promise<void>) {
  const calls: string[] = [];
  const warnings: unknown[] = [];
  const captures: Parameters<RunBrowserScreenshotCapture["capture"]>[0][] = [];
  const screenshotLabels: (readonly string[] | undefined)[] = [];
  const sessionId = BrowserSessionIdSchema.parse("00000000-0000-4000-8000-000000000001");
  const factory: WorkerBrowserSessionFactory = { probeProfile: async () => undefined, async open(input) {
    return { sessionId, system: input.system, instance: input.instance, configFingerprint: input.configFingerprint,
      signInFingerprint: input.configFingerprint, browserMode: input.browserMode, profileRevision: 1,
      acceptDownloads: false, exclusive: false, driver: { system: input.system },
      authentication: { authenticate: async () => "logged-in" as const },
      ...(failure === "missing" ? {} : { screenshot: async (labels?: readonly string[]): Promise<BrowserScreenshotEvidence> => {
        screenshotLabels.push(labels);
        calls.push("capture");
        await pause?.();
        if (failure === "capture" || failure === "capture-and-close") throw new Error("fixture capture failed");
        return failure === "unavailable"
          ? { state: "unavailable", reason: "page-changed", sessionId, pageVersion: 1, observedAt: "2026-08-02T18:00:00.000Z" }
          : { state: "available", bytes: new Uint8Array([137, 80, 78, 71]), width: 1280, height: 720, sessionId, pageVersion: 1, observedAt: "2026-08-02T18:00:00.000Z" };
      } }),
      reset: async () => { calls.push("reset"); },
      close: async () => { if (failure === "capture-and-close") throw new Error("fixture close failed"); return { sessionId, system: input.system, pagesClosed: true as const, contextClosed: true as const }; },
    };
  } };
  const clock = manualClock(new Date("2026-08-02T18:00:00.000Z"));
  const sessions = new WorkerSessionManager({ workerId: WorkerIdSchema.parse("fixture-worker"), workflowId: WorkflowIdSchema.parse("person-lookup"),
    stores: taskStoreRegistry, factory, clock, scheduler: new ManualScheduler(clock), acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
    duoCeremony: await fixtureDuoCeremonyGates(clock, undefined, profileFixtures.create), browserScreenshotCapture: { capture: async context => {
      calls.push("persist"); if (failure === "persist") throw new Error("fixture persistence failed"); captures.push(context);
    } },
  });
  sessions.bindRunConfigFingerprint(fingerprint, "headless", { runId: "00000000-0000-4000-8000-000000000099", descriptorFingerprint: fingerprint, captureBrowserScreenshots: enabled });
  return { sessions, calls, captures, screenshotLabels, warnings, owner: { ...owner, log: { warn: (message: string, fields?: unknown) => { warnings.push({ message, fields }); } } } };
}

describe("task-owned screenshots", () => {
  for (const enabled of [true, false]) it(`captures at the requested point without a lease-end duplicate (enabled=${enabled})`, async () => {
    const { sessions, calls, captures, owner, warnings } = await world(enabled);
    let retained: (() => Promise<void>) | undefined;
    await sessions.withDriver(need, "prod", new AbortController().signal, async (_driver, captureScreenshot) => {
      retained = captureScreenshot;
      calls.push("read"); await captureScreenshot(); calls.push("return");
    }, owner);
    assert.deepEqual(calls, ["read", "capture", "persist", "return", "reset"]);
    assert.deepEqual(captures.map(capture => capture.trigger), [{ kind: "task-point", nodeId: "searching", attempt: 1, boundary: "step" }]);
    assert.deepEqual(warnings, []);
    assert.ok(retained);
    await assert.rejects(retained(), error => error instanceof TaskError && error.code === "BROWSER_SCREENSHOT_CAPTURE_FAILED");
    await sessions.closeAll("worker-stop");
  });
  it("keeps dry-run sample labels on required and failure-diagnostic captures", async () => {
    const { sessions, captures, screenshotLabels, owner } = await world(false);
    const sampleLabels = ["dry-run sample: UCPath transaction number = T000000000000"];
    const primary = new Error("preview preparation failed");
    try {
      await assert.rejects(sessions.withDriver(need, "prod", new AbortController().signal, async (_driver, captureScreenshot) => {
        await captureScreenshot();
        throw primary;
      }, { ...owner, sampleLabels }), error => error === primary);
      assert.deepEqual(screenshotLabels, [sampleLabels, sampleLabels]);
      assert.deepEqual(captures.map(capture => ({ trigger: capture.trigger, sampleLabels: capture.sampleLabels })), [
        { trigger: { kind: "task-point", nodeId: "searching", attempt: 1, boundary: "step" }, sampleLabels },
        { trigger: { kind: "lease-end", outcome: "failed" }, sampleLabels },
      ]);
    } finally { await sessions.closeAll("worker-stop"); }
  });
  it("allows a task-owned lease to defer capture while retaining automatic capture for other leases", async () => {
    const { sessions, captures, owner } = await world(true);
    await sessions.withDriver(need, "prod", new AbortController().signal, async () => {}, owner);
    assert.equal(captures.length, 0);
    await sessions.withDriver(need, "prod", new AbortController().signal, async () => {});
    assert.deepEqual(captures.map(capture => capture.trigger), [{ kind: "lease-end", outcome: "succeeded" }]);
    await sessions.closeAll("worker-stop");
  });
  for (const enabled of [false, true]) {
    for (const failure of ["unavailable", "missing", "persist", "capture"] as const) it(`refuses ${failure} capture without continuing (enabled=${enabled})`, async () => {
      const { sessions, calls, captures, warnings, owner } = await world(enabled, failure);
      let continued = false;
      await assert.rejects(sessions.withDriver(need, "prod", new AbortController().signal, async (_driver, captureScreenshot) => {
        await captureScreenshot();
        continued = true;
        return { status: "found" };
      }, owner), error => {
        const primary = error instanceof AggregateError ? error.cause : error;
        assert.ok(primary instanceof TaskError);
        assert.equal(primary.code, "BROWSER_SCREENSHOT_CAPTURE_FAILED");
        assert.equal(primary.taskId, owner.taskId);
        if (failure !== "unavailable") {
          assert.ok(error instanceof AggregateError);
          assert.equal(error.errors.length, 2);
          assert.equal(error.errors[0], primary);
          assert.match(String(error.errors[1]), failure === "missing" ? /no screenshot capability/ : failure === "persist" ? /fixture persistence failed/ : /fixture capture failed/);
        }
        return true;
      });
      assert.equal(continued, false);
      assert.equal(calls.includes("reset"), false);
      assert.deepEqual(calls, failure === "missing" ? [] : failure === "capture" ? ["capture", "capture"] : ["capture", "persist", "capture", "persist"]);
      assert.deepEqual(captures.map(capture => ({ trigger: capture.trigger, state: capture.screenshot.state })), failure === "unavailable" ? [
        { trigger: { kind: "task-point", nodeId: "searching", attempt: 1, boundary: "step" }, state: "unavailable" },
        { trigger: { kind: "lease-end", outcome: "failed" }, state: "unavailable" },
      ] : []);
      assert.deepEqual(warnings, [{ message: "Screenshot capture unavailable.", fields: {
        code: "BROWSER_SCREENSHOT_CAPTURE_FAILED", boundary: "step", reason: failure === "unavailable" ? "page-changed" : "Error",
      } }]);
      await sessions.closeAll("worker-stop");
    });
  }
});

it("refuses a task capture that resolves after cancellation", async () => {
  let release = (): void => {};
  let started = (): void => {};
  const waiting = new Promise<void>(resolve => { started = resolve; });
  const delayed = new Promise<void>(resolve => { release = resolve; });
  const { sessions, captures, owner } = await world(true, undefined, async () => { started(); await delayed; });
  const controller = new AbortController();
  const operation = sessions.withDriver(need, "prod", controller.signal, async (_driver, captureScreenshot) => { await captureScreenshot(); }, owner);
  await waiting;
  controller.abort();
  release();
  await assert.rejects(operation, /aborted/);
  await Promise.resolve();
  assert.equal(captures.filter(capture => capture.trigger.kind === "task-point").length, 0);
  await sessions.closeAll("worker-stop");
});

it("retains the task failure and failure-diagnostic and cleanup errors together", async () => {
  const { sessions, owner } = await world(true, "capture-and-close");
  const primary = new Error("task operation failed");
  await assert.rejects(sessions.withDriver(need, "prod", new AbortController().signal, async () => {
    throw primary;
  }, owner), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 3);
    assert.equal(error.cause, primary);
    assert.equal(error.errors[0], primary);
    assert.match(String(error.cause), /task operation failed/);
    assert.match(String(error.errors[1]), /fixture capture failed/);
    assert.match(String(error.errors[2]), /fixture close failed/);
    return true;
  });
});
