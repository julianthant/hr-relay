import assert from "node:assert/strict";
import { resolve } from "node:path";
import { afterEach,it,vi } from "vitest";
import { runSecureEnvironmentBootstrap } from "../../../../src/backend/app/bootstrap/secure-env-bootstrap.js";
import { AutomaticPersonRepairRefusedError,prepareApplicationDataWorkspace,RegisteredPersonUpgradeRefusedError } from "../../../../src/backend/app/composition/storage-compose.js";
import { probePrimaryDisplay } from "../../../../src/backend/app/host/primary-display.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { HOST_PRIMARY_DISPLAY_ENV } from "../../../../src/models/config/host-display.js";

vi.mock("../../../../src/backend/app/composition/storage-compose.js", { spy: true });
vi.mock("../../../../src/backend/app/host/primary-display.js", { spy: true });
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it("plans layout with the published dashboard host display and a canonical source workspace", async () => {
  vi.stubEnv(HOST_PRIMARY_DISPLAY_ENV, undefined);
  vi.mocked(probePrimaryDisplay).mockReturnValue({ state: "detected", screenWidth: 1512, screenHeight: 982, source: "system_profiler" });
  const stopped = new Error("fixture-layout-stop"), lifetime = await RuntimeLifetimeLock.acquire(0);
  vi.mocked(prepareApplicationDataWorkspace).mockImplementation(async (source, _target, lock, facts) => {
    assert.equal(source, resolve(source)); assert.equal(lock, lifetime); lock.assertHeld();
    assert.deepEqual(facts.primaryDisplay, { screenWidth: 1512, screenHeight: 982 });
    throw stopped;
  });
  try {
    await assert.rejects(runSecureEnvironmentBootstrap(["cli", "dashboard"], { acquireLifetimeLock: async () => lifetime }),
      error => error instanceof Error && error.cause === stopped);
    assert.equal(vi.mocked(prepareApplicationDataWorkspace).mock.calls.length, 1);
    assert.equal(vi.mocked(probePrimaryDisplay).mock.calls.length, 1);
  } finally { await lifetime.close(); }
});

it.each([
  new RegisteredPersonUpgradeRefusedError(new Error("fixture-upgrade-refused")),
  new AutomaticPersonRepairRefusedError(new Error("fixture-repair-refused")),
])("retains $code through first-launch layout preparation", async stopped => {
  const lifetime = await RuntimeLifetimeLock.acquire(0);
  vi.mocked(prepareApplicationDataWorkspace).mockRejectedValue(stopped);
  try {
    await assert.rejects(runSecureEnvironmentBootstrap(["cli", "dashboard"], { acquireLifetimeLock: async () => lifetime }), error => error === stopped);
    assert.equal(vi.mocked(prepareApplicationDataWorkspace).mock.calls.length, 1);
  } finally { await lifetime.close(); }
});
