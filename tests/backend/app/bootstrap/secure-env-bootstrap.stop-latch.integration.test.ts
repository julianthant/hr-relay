import assert from "node:assert/strict";
import { it } from "vitest";
import { runSecureEnvironmentBootstrap } from "../../../../src/backend/app/bootstrap/secure-env-bootstrap.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { createBoundProfileFixture } from "../../../support/helpers/admission-fixture.js";

it("latches a stop signal across admitted dashboard boot and releases the latch afterwards", async () => {
  const profile = await createBoundProfileFixture({ sharedMachine: true });
  const argv = [...process.argv];
  const baseline = { SIGINT: process.listeners("SIGINT"), SIGTERM: process.listeners("SIGTERM") };
  let latched = false;
  try {
    await runSecureEnvironmentBootstrap(["cli", "dashboard"], {
      acquireLifetimeLock: () => RuntimeLifetimeLock.acquire(0),
      installCrashHandlers: () => undefined,
      acquireAdmission: () => profile.machine,
      assertEnvironment: () => undefined,
      runCli: async (_admission, _accept, lifetime) => {
        const added = process.listeners("SIGTERM").filter(listener => !baseline.SIGTERM.includes(listener));
        assert.ok(added.length > 0, "a stop signal must be owned while the dashboard boots");
        assert.equal(lifetime.parentSignal.aborted, false);
        for (const listener of added) (listener as (signal: NodeJS.Signals) => void)("SIGTERM");
        latched = lifetime.parentSignal.aborted;
      },
    });
    assert.equal(latched, true);
    assert.deepEqual(process.listeners("SIGINT"), baseline.SIGINT);
    assert.deepEqual(process.listeners("SIGTERM"), baseline.SIGTERM);
  } finally { process.argv.splice(0, process.argv.length, ...argv); await profile.close(); }
});
