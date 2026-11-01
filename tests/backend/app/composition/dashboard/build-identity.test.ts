import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { it } from "vitest";
import { assertDashboardBuildCurrent, computeDashboardBuildInputDigest, dashboardBuildState, PARITY_BUILD_COMMAND, writeDashboardBuildIdentity } from "../../../../../src/backend/app/composition/dashboard/build-identity.js";

it("invalidates a parity bundle when an imported control fixture changes, without changing production inputs", () => {
  const root = mkdtempSync(join(tmpdir(), "relay-parity-inputs-"));
  try {
    const fixture = "tests/support/helpers/dashboard/controls/example-preview.tsx";
    for (const name of ["src/entry.ts", "config/dashboard-workflow-sources.json", "vite.dashboard.config.ts", "tsconfig.json", "package.json", "package-lock.json", "vite.parity.config.ts", "tests/parity/app-entry.tsx", "tests/parity/helpers/workflow-composition.ts", fixture]) {
      const path = join(root, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "initial input");
    }
    const distDir = join(root, "dist", "parity-dashboard");
    mkdirSync(distDir, { recursive: true });
    writeFileSync(join(distDir, "index.html"), "<title>Control preview</title>");
    const productionDigest = computeDashboardBuildInputDigest(root);
    const parityDigest = computeDashboardBuildInputDigest(root, PARITY_BUILD_COMMAND);
    writeDashboardBuildIdentity({ repoRoot: root, distDir, buildScript: PARITY_BUILD_COMMAND });
    assert.equal(dashboardBuildState({ repoRoot: root, distDir, buildScript: PARITY_BUILD_COMMAND }).state, "current");

    writeFileSync(join(root, fixture), "changed control fixture");
    assert.notEqual(computeDashboardBuildInputDigest(root, PARITY_BUILD_COMMAND), parityDigest);
    assert.equal(computeDashboardBuildInputDigest(root), productionDigest);
    assert.deepEqual(dashboardBuildState({ repoRoot: root, distDir, buildScript: PARITY_BUILD_COMMAND }), { state: "stale", reason: "bundle inputs changed after build" });
    assert.throws(() => assertDashboardBuildCurrent({ repoRoot: root, distDir, buildScript: PARITY_BUILD_COMMAND }), /bundle inputs changed after build/u);

    writeDashboardBuildIdentity({ repoRoot: root, distDir, buildScript: PARITY_BUILD_COMMAND });
    assert.equal(assertDashboardBuildCurrent({ repoRoot: root, distDir, buildScript: PARITY_BUILD_COMMAND }).inputDigest, computeDashboardBuildInputDigest(root, PARITY_BUILD_COMMAND));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
