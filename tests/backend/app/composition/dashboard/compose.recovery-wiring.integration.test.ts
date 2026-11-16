import assert from "node:assert/strict";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { it, vi } from "vitest";
import type { RunRecordServiceDependencies } from "../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { composeDashboardRuntime } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { composeProfileRuntime } from "../../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { SERVER_REGISTRY } from "../../../../../src/backend/app/registries/workflow-registry.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { createBoundProfileFixture } from "../../../../support/helpers/admission-fixture.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";

const resolvers = vi.hoisted(() => [] as RunRecordServiceDependencies["resolveDescriptor"][]);
vi.mock("../../../../../src/backend/runs/lifecycle/run-record-service.js", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../../../src/backend/runs/lifecycle/run-record-service.js")>();
  return { ...actual, RunRecordService: class extends actual.RunRecordService {
    constructor(...args: ConstructorParameters<typeof actual.RunRecordService>) {
      super(...args); resolvers.push(args[0].resolveDescriptor);
    }
  } };
});
it("gives the dashboard lifecycle the registered descriptor resolver needed for descendant recovery", async () => {
  const profile = await createBoundProfileFixture();
  const clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(profile.workspace, name));
  const runtime = composeProfileRuntime({ admission: profile.machine, clock, hostFacts: { primaryDisplay: null } });
  const active = runtime.session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: clock.now().toISOString() });
  assert.equal(active.state, "active"); assert.ok(active.state === "active");
  let dashboard: Awaited<ReturnType<typeof composeDashboardRuntime>> | undefined;
  try {
    const before = resolvers.length;
    dashboard = await composeDashboardRuntime({ lifetimeLock: profile.lifetime, admission: profile.machine,
      profile: { runtime, token: active.token }, repoRoot: profile.workspace, clock, isolation: rebuildRuntimeIsolation,
      env: {}, backendPortOverride: 0, frontendPortOverride: 0, preflightRunnerFactory: healthyRuntimePreflightRunners,
      workerProcess: { spawn: () => { throw new Error("descriptor wiring must not launch a worker"); } } });
    const created = resolvers.slice(before);
    assert.equal(created.length, 1);
    const resolve = created[0]; assert.ok(resolve);
    for (const [workflowId, module] of Object.entries(SERVER_REGISTRY)) assert.equal(resolve(workflowId), module.descriptor);
    assert.equal(resolve("unregistered-recovery-child"), undefined);
  } finally {
    try { if (dashboard === undefined) await runtime.close(); else await dashboard.stop(); }
    finally { await profile.close(); }
  }
});
