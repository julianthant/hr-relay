import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../../src/domain/clock.js";
import {
  createPreflightAuthority,
  executePreflightRunner,
  requiredPreflightChecks,
} from "../../../src/domain/preflight.js";
import { createDashboardPreflightRunners } from "../../../src/server/dashboard/preflight-runners.js";

const roots: string[] = [];
const CLOCK = manualClock(new Date("2026-08-28T09:00:00.000-07:00"));
const FINGERPRINT = "a".repeat(64);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("dashboard preflight runner composition", () => {
  it("owns the exact dashboard registry subset and executes its local pure/filesystem/process detectors", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-dashboard-preflight-"));
    roots.push(root);
    const stateRoot = join(root, ".tracker-rebuild");
    const artifactRoot = join(stateRoot, "artifacts");
    const processLockRoot = join(stateRoot, "locks");
    mkdirSync(artifactRoot, { recursive: true });
    const runners = createDashboardPreflightRunners({
      repoRoot: process.cwd(),
      stateRoot,
      artifactRoot,
      processLockRoot,
      backendPort: 0,
      frontendPort: 0,
      backendOwned: () => false,
      configFingerprint: FINGERPRINT,
      authorityDoctorOptions: {
        stateRoot,
        authorityPath: join(stateRoot, "state.db"),
        backupDirectory: join(stateRoot, "backups", "authority"),
        maxBackupAgeMs: 60_000,
        busyTimeoutMs: 100,
      },
      clock: CLOCK,
    });

    assert.deepEqual(runners.map(({ check }) => check), requiredPreflightChecks(["dashboard.serve"]));
    assert.doesNotThrow(() => createPreflightAuthority({
      configFingerprint: FINGERPRINT,
      requestedCapabilities: ["dashboard.serve"],
      runners,
      clock: CLOCK,
    }));
    const localChecks = new Set(["runtime.compatibility", "config.valid", "filesystem.health", "process.orphans"]);
    for (const runner of runners.filter(({ check }) => localChecks.has(check))) {
      const observation = await executePreflightRunner(runner, new AbortController().signal, CLOCK);
      assert.equal(observation.state, "healthy", runner.check);
    }
  });
});
