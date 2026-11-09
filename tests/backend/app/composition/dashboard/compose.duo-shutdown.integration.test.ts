import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "vitest";
import { composeDashboardApplication } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { acquireEntrypointAdmission } from "../../../../../src/backend/storage/admission/bootstrap-admission.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { assertRuntimeLifetimeHeld, runtimeLifetimeLock } from "../../../../support/helpers/backend/runtime-lifetime.js";
import { syntheticOnboardingDuo } from "../../../../support/helpers/admission-fixture.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";

async function fixture() {
  const lifetime = await runtimeLifetimeLock();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "duo-shutdown-")));
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(root, name));
  const machine = acquireEntrypointAdmission(root, "exclusive", lifetime);
  mkdirSync(join(root, rebuildRuntimeIsolation.processLockRoot), { recursive: true, mode: 0o700 });
  return { root, lifetime, machine };
}

it("awaits the owned Duo provider when the public shell shuts down without a tracked draft", async () => {
  const f = await fixture(), entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  try {
    runtime = await composeDashboardApplication({ lifetimeLock: f.lifetime, admission: f.machine, isolation: rebuildRuntimeIsolation, repoRoot: f.root,
      backendPortOverride: 0, frontendPortOverride: 0, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners,
      onboardingDuo: { ...syntheticOnboardingDuo(), async stop() { entered.resolve(); await release.promise; } } });
    const stopping = runtime.stop();
    await Promise.race([entered.promise, stopping.then(() => { throw new Error("shutdown omitted provider stop"); })]);
    f.machine.assertLive(); await assertRuntimeLifetimeHeld(f.lifetime);
    release.resolve(); await stopping;
    assert.throws(() => f.machine.assertLive());
  } finally { release.resolve(); await runtime?.stop(); f.machine.release(); rmSync(f.root, { recursive: true, force: true }); }
});
