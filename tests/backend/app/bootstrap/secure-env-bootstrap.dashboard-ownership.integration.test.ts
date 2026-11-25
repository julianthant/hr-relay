import assert from "node:assert/strict";
import { it } from "vitest";
import { runSecureEnvironmentBootstrap } from "../../../../src/backend/app/bootstrap/secure-env-bootstrap.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { RuntimeAlreadyRunningError, RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

for (const accepted of [false, true]) it(`honors the dashboard admission-ownership acknowledgement: ${accepted}`, async () => {
  const profile = await createBoundProfileFixture({ sharedMachine: true });
  // A port already held is as good for this check: this boot must not listen on it.
  let productionLock: RuntimeLifetimeLock | undefined;
  const argv = [...process.argv];
  try {
    try { productionLock = await RuntimeLifetimeLock.acquire(rebuildRuntimeIsolation.lockPort); }
    catch (error) { if (!(error instanceof RuntimeAlreadyRunningError)) throw error; }
    await runSecureEnvironmentBootstrap(["cli", "dashboard"], {
      installCrashHandlers: () => undefined,
      acquireLifetimeLock: () => RuntimeLifetimeLock.acquire(0),
      acquireAdmission: () => profile.machine,
      assertEnvironment: () => undefined,
      runCli: async (_admission, accept) => { if (accepted) { assert.ok(accept); accept(); } },
    });
    if (accepted) profile.machine.assertLive();
    else assert.throws(() => profile.machine.assertLive(), { message: "runtime-admission: missing or released admission" });
  } finally { process.argv.splice(0, process.argv.length, ...argv); await productionLock?.close(); await profile.close(); }
});
