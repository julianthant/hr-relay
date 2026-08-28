import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { manualClock } from "../../src/domain/clock.js";
import { resolveConfig } from "../../src/domain/config/resolve.js";
import { executePreflightRunner, requiredPreflightChecks } from "../../src/domain/preflight.js";
import { createDashboardPreflightRunners } from "../../src/server/preflight/dashboard-runners.js";
import { PreflightCheckIdSchema } from "../../src/domain/runtime-dependencies.js";
import { NOW } from "./fixtures/phase1c-contract-fixtures.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("dashboard preflight runners", () => {
  it("implements every dashboard.serve check from observable runtime boundaries", async () => {
    const root = mkdtempSync(join(tmpdir(), "hrauto-dashboard-preflight-"));
    roots.push(root);
    const stateRoot = join(root, ".tracker-rebuild");
    const artifactRoot = join(stateRoot, "artifacts");
    mkdirSync(artifactRoot, { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({
      name: "preflight-fixture",
      version: "0.1.0",
      engines: { node: ">=26.0.0" },
    }));
    writeFileSync(join(root, "package-lock.json"), JSON.stringify({
      name: "preflight-fixture",
      version: "0.1.0",
      lockfileVersion: 3,
    }));
    const authorityHealth = {
      check: PreflightCheckIdSchema.parse("authority.health"),
      kind: "io" as const,
      async run() {
        return { check: "authority.health" as const, state: "healthy" as const, summary: "authority is healthy" };
      },
    };
    const runners = createDashboardPreflightRunners({
      repoRoot: root,
      config: resolveConfig({}, {}, manualClock(new Date(NOW))),
      stateRoot,
      artifactRoot,
      backendPort: 0,
      frontendPort: 0,
      authorityHealth,
      listLiveWorkerProcesses: () => [],
    });

    const observations = await Promise.all(runners.runners.map((runner) =>
      executePreflightRunner(runner, new AbortController().signal, manualClock(new Date(NOW)))));

    assert.deepEqual(observations.map(({ check }) => check), requiredPreflightChecks(["dashboard.serve"]));
    assert.equal(observations.every(({ state }) => state === "healthy"), true);
  });
});
