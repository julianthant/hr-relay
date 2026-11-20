import assert from "node:assert/strict";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it, vi } from "vitest";
import { composeDashboardRuntime } from "../../../src/backend/app/composition/dashboard/compose.js";
import { composeProfileRuntime } from "../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { startLoopDelayMonitor } from "../../../src/backend/logs/loop-delay.js";
import { systemClock } from "../../../src/rules/time/clock.js";
import { healthyRuntimePreflightRunners } from "../../support/fixtures/preflight-seams.js";
import { createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";
import { scaledMs } from "../../support/time-scale.js";

const histogram = vi.hoisted(() => ({
  max: 0,
  enable: vi.fn(),
  disable: vi.fn(),
  reset: vi.fn(),
}));
vi.mock("node:perf_hooks", () => ({ monitorEventLoopDelay: () => histogram }));

it("stops sampling and delivers the original writer failure to the owner", () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  histogram.disable.mockClear();
  try {
    const failure = new Error("timeline append failed");
    const faults: unknown[] = [];
    const deps = {
      clock: systemClock,
      debugEvents: { emit() { throw failure; } },
      onFault(error: unknown) { faults.push(error); },
    };
    const monitor = startLoopDelayMonitor(deps);
    histogram.max = 250_000_000;
    vi.advanceTimersByTime(1000);

    assert.equal(vi.getTimerCount(), 0);
    assert.equal(histogram.disable.mock.calls.length, 1);
    assert.equal(faults.length, 1);
    assert.equal(faults[0], failure);
    monitor.stop();
  } finally {
    histogram.max = 0;
    vi.useRealTimers();
  }
});

it("keeps the writer and reporting failures for shutdown when fault reporting fails", () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  try {
    const writerFailure = new Error("timeline append failed");
    const reportingFailure = new Error("emergency diagnostic append failed");
    const deps = {
      clock: systemClock,
      debugEvents: { emit() { throw writerFailure; } },
      onFault() { throw reportingFailure; },
    };
    const monitor = startLoopDelayMonitor(deps);
    histogram.max = 250_000_000;
    vi.advanceTimersByTime(1000);

    assert.equal(vi.getTimerCount(), 0);
    assert.throws(() => monitor.stop(), error => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [writerFailure, reportingFailure]);
      assert.equal(error.cause, writerFailure);
      return true;
    });
  } finally {
    histogram.max = 0;
    vi.useRealTimers();
  }
});

describe("default dashboard composition", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    histogram.max = 0;
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it("publishes a measured stall when composition leaves the monitor choice unset", async () => {
    const profile = await createBoundProfileFixture();
    cleanups.push(() => profile.close());
    for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(profile.workspace, name));
    const runtime = composeProfileRuntime({ admission: profile.machine, clock: systemClock, hostFacts: { primaryDisplay: null } });
    cleanups.push(() => runtime.close());
    const active = runtime.session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: systemClock.now().toISOString() });
    assert.equal(active.state, "active");
    if (active.state !== "active") throw new Error("fixture-profile-sign-in-refused");
    histogram.enable.mockClear();
    const dashboard = await composeDashboardRuntime({
      lifetimeLock: profile.lifetime, admission: profile.machine, profile: { runtime, token: active.token },
      repoRoot: profile.workspace, clock: systemClock, isolation: rebuildRuntimeIsolation, env: {},
      backendPortOverride: 0, frontendPortOverride: 0, preflightRunnerFactory: healthyRuntimePreflightRunners,
    });
    cleanups.push(() => dashboard.stop());
    assert.equal(histogram.enable.mock.calls.length, 1);

    const timeline = runtime.selectedContext(active.token).database.authority.timelineEvents;
    const after = timeline.highWaterMark();
    histogram.max = 275_000_000;
    await vi.waitFor(() => {
      const stall = timeline.page({ after }).find(record => record.payload.kind === "debug"
        && record.payload.event.reason === "event-loop-stall");
      assert.ok(stall?.payload.kind === "debug", "expected a persisted event-loop stall");
      assert.equal(stall.payload.event.category, "boot");
      assert.equal(stall.payload.event.phase, "settled");
      assert.equal(stall.payload.event.area, "event-loop");
      assert.equal(stall.payload.event.durationMs, 275);
    }, { timeout: scaledMs(3_000) });
  });
});
