import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { WorkerSessionManager } from "../../src/backend/runtime/workers/worker-sessions.js";
import { taskStoreRegistry } from "../../src/backend/app/registries/task-registry.js";
import type { WorkerBrowserSessionFactory, BrowserScreenshotEvidence } from "../../src/workflow-kit/session.js";
import type { RunBrowserScreenshotCapture } from "../../src/workflow-kit/diagnostics.js";
import { TaskError } from "../../src/workflow-kit/errors.js";
import { BrowserSessionIdSchema, FingerprintSchema, WorkerIdSchema, WorkflowIdSchema, taskId } from "../../src/rules/identity/ids.js";
import { manualClock } from "../../src/rules/time/clock.js";
import { fixtureDuoCeremonyGates } from "../support/helpers/duo-ceremony-fixtures.js";
import { FIXTURE_SESSION_ACQUIRE_MS, ManualScheduler } from "../support/helpers/phase1f-executor-harness.js";

const fingerprint = FingerprintSchema.parse("1".repeat(64));
const need = { system: "ucpath", access: "read", session: "reuse-worker" } as const;
const owner = { taskId: taskId("ucpath/search-person-org"), nodeId: "searching", attempt: 1 };
function world(enabled: boolean, failure?: "unavailable" | "missing" | "persist" | "capture" | "capture-and-close", pause?: () => Promise<void>) {
  const calls: string[] = [];
  const captures: Parameters<RunBrowserScreenshotCapture["capture"]>[0][] = [];
  const sessionId = BrowserSessionIdSchema.parse("00000000-0000-4000-8000-000000000001");
  const factory: WorkerBrowserSessionFactory = { async open(input) {
    return { sessionId, system: input.system, instance: input.instance, configFingerprint: input.configFingerprint,
      signInFingerprint: input.configFingerprint, browserMode: input.browserMode, profileRevision: 1,
      acceptDownloads: false, exclusive: false, driver: { system: input.system },
      authentication: { authenticate: async () => "logged-in" as const },
      ...(failure === "missing" ? {} : { screenshot: async (): Promise<BrowserScreenshotEvidence> => {
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
    duoCeremony: fixtureDuoCeremonyGates(clock), browserScreenshotCapture: { capture: async context => {
      calls.push("persist"); if (failure === "persist") throw new Error("fixture persistence failed"); captures.push(context);
    } },
  });
  sessions.bindRunConfigFingerprint(fingerprint, "headless", { runId: "00000000-0000-4000-8000-000000000099", descriptorFingerprint: fingerprint, captureBrowserScreenshots: enabled });
  return { sessions, calls, captures };
}

describe("task-owned screenshots", () => {
  for (const enabled of [true, false]) it(`captures at the requested point without a lease-end duplicate (enabled=${enabled})`, async () => {
    const { sessions, calls, captures } = world(enabled);
    let retained: (() => Promise<void>) | undefined;
    await sessions.withDriver(need, "prod", new AbortController().signal, async (_driver, captureScreenshot) => {
      retained = captureScreenshot;
      calls.push("read"); await captureScreenshot(); calls.push("return");
    }, owner);
    assert.deepEqual(calls, enabled ? ["read", "capture", "persist", "return", "reset"] : ["read", "return", "reset"]);
    assert.deepEqual(captures.map(capture => capture.trigger), enabled ? [{ kind: "task-point", nodeId: "searching", attempt: 1 }] : []);
    assert.ok(retained);
    await assert.rejects(retained(), error => error instanceof TaskError && error.code === "BROWSER_SCREENSHOT_CAPTURE_FAILED");
    await sessions.closeAll("worker-stop");
  });
  it("allows a task-owned lease to defer capture while retaining automatic capture for other leases", async () => {
    const { sessions, captures } = world(true);
    await sessions.withDriver(need, "prod", new AbortController().signal, async () => {}, owner);
    assert.equal(captures.length, 0);
    await sessions.withDriver(need, "prod", new AbortController().signal, async () => {});
    assert.deepEqual(captures.map(capture => capture.trigger), [{ kind: "lease-end", outcome: "succeeded" }]);
    await sessions.closeAll("worker-stop");
  });
  for (const failure of ["unavailable", "missing", "persist", "capture"] as const) it(`fails loudly for ${failure}`, async () => {
    const { sessions } = world(true, failure);
    await assert.rejects(sessions.withDriver(need, "prod", new AbortController().signal, async (_driver, captureScreenshot) => {
      await captureScreenshot();
    }, owner), error => {
      const primary = error instanceof AggregateError ? error.cause : error;
      return primary instanceof TaskError && primary.code === "BROWSER_SCREENSHOT_CAPTURE_FAILED";
    });
    await sessions.closeAll("worker-stop");
  });
});

it("refuses a task capture that resolves after cancellation", async () => {
  let release = (): void => {};
  let started = (): void => {};
  const waiting = new Promise<void>(resolve => { started = resolve; });
  const delayed = new Promise<void>(resolve => { release = resolve; });
  const { sessions, captures } = world(true, undefined, async () => { started(); await delayed; });
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

it("retains capture and failure-diagnostic and cleanup errors together", async () => {
  const { sessions } = world(true, "capture-and-close");
  await assert.rejects(sessions.withDriver(need, "prod", new AbortController().signal, async (_driver, captureScreenshot) => {
    await captureScreenshot();
  }, owner), error => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors.length, 3);
    assert.ok(error.cause instanceof TaskError && error.cause.code === "BROWSER_SCREENSHOT_CAPTURE_FAILED");
    assert.match(String(error.errors[1]), /fixture capture failed/);
    assert.match(String(error.errors[2]), /fixture close failed/);
    return true;
  });
});
