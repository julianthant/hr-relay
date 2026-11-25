import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, vi } from "vitest";

it.each(["staging", "development"])("initializes %s without probing a legacy production checkout", async profile => {
  vi.stubEnv("RELAY_RUNTIME_PROFILE", profile);
  vi.resetModules();
  const root = realpathSync(mkdtempSync(join(tmpdir(), "relay-profile-fixture-")));
  try {
    const { prepareApplicationDataWorkspace } = await import("../../../../src/backend/app/composition/storage-compose.js");
    const { RuntimeLifetimeLock } = await import("../../../../src/backend/storage/admission/lifetime-lock.js");
    const source = join(root, "legacy"), target = join(root, "isolated");
    // Any attempt to look up the old checkout's .tracker below this file fails with ENOTDIR.
    writeFileSync(source, "synthetic checkout");
    const lifetime = await RuntimeLifetimeLock.acquire(0);
    try {
      await prepareApplicationDataWorkspace(source, target, lifetime, { primaryDisplay: null });
      assert.deepEqual(readdirSync(target), []);
    } finally { await lifetime.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.resetModules(); }
});
