import assert from "node:assert/strict";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it, vi } from "vitest";
import { composeDashboardRuntime } from "../../../src/backend/app/composition/dashboard/compose.js";
import { composeProfileRuntime } from "../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { systemClock } from "../../../src/rules/time/clock.js";
import { healthyRuntimePreflightRunners } from "../../support/fixtures/preflight-seams.js";
import { createBoundProfileFixture } from "../../support/helpers/admission-fixture.js";

const histogram = vi.hoisted(() => ({
  max: 0,
  enable: vi.fn(),
  disable: vi.fn(),
  reset: vi.fn(),
}));
vi.mock("node:perf_hooks", () => ({ monitorEventLoopDelay: () => histogram }));

describe("default dashboard composition", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it("starts the production monitor when composition leaves the choice unset", async () => {
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
  });
});
