import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it, vi } from "vitest";
import { DASHBOARD_BUILD_COMMAND, writeDashboardBuildIdentity } from "../../../../../src/backend/app/composition/dashboard/build-identity.js";
import { createBundleSetup } from "./bundle-setup.js";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
const roots: string[] = [];
afterEach(() => {
  vi.resetAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const repoRoot = mkdtempSync(join(tmpdir(), "parity-bundle-setup-"));
  roots.push(repoRoot);
  const distDir = join(repoRoot, "dist");
  mkdirSync(distDir);
  mkdirSync(join(repoRoot, "src"));
  mkdirSync(join(repoRoot, "config"));
  for (const file of ["src/app.ts", "config/dashboard-workflow-sources.json", "vite.dashboard.config.ts", "tsconfig.json", "package.json", "package-lock.json"]) {
    writeFileSync(join(repoRoot, file), "{}");
  }
  writeFileSync(join(distDir, "index.html"), "<title>fixture</title>");
  const stamp = writeDashboardBuildIdentity({ repoRoot, distDir });
  const setup = createBundleSetup({
    PARITY_REPO_ROOT: repoRoot, PARITY_DIST_DIR: distDir,
    bundleBuildInput: () => ({ buildScript: DASHBOARD_BUILD_COMMAND }),
    buildArguments: () => ["run", "web:build"],
    buildCommandLabel: () => DASHBOARD_BUILD_COMMAND,
  });
  return { repoRoot, distDir, stamp, setup };
}

it("returns the verified current identity without launching a build", () => {
  const { stamp, setup } = fixture();
  assert.deepEqual(setup.ensureParityBundle(), stamp);
  assert.deepEqual(setup.ensureParityBundle(), stamp);
  assert.equal(vi.mocked(spawnSync).mock.calls.length, 0);
});

for (const changed of ["input", "output"] as const) it(`rechecks ${changed} bytes on the next call and verifies the rebuild`, () => {
  const { repoRoot, distDir, setup, stamp } = fixture();
  assert.deepEqual(setup.ensureParityBundle(), stamp);
  writeFileSync(changed === "input" ? join(repoRoot, "src/app.ts") : join(distDir, "index.html"), "changed");
  vi.mocked(spawnSync).mockImplementation(() => {
    writeDashboardBuildIdentity({ repoRoot, distDir });
    return { pid: 1, output: [], stdout: "", stderr: "", status: 0, signal: null };
  });
  const rebuilt = setup.ensureParityBundle();
  assert.notEqual(changed === "input" ? rebuilt.inputDigest : rebuilt.outputDigest, changed === "input" ? stamp.inputDigest : stamp.outputDigest);
  assert.deepEqual(vi.mocked(spawnSync).mock.calls[0]?.slice(0, 2), ["npm", ["run", "web:build"]]);
  assert.deepEqual(setup.ensureParityBundle(), rebuilt);
  assert.equal(vi.mocked(spawnSync).mock.calls.length, 1);
});

it("refuses a successful build command that leaves the bundle stale", () => {
  const { repoRoot, setup } = fixture();
  writeFileSync(join(repoRoot, "src/app.ts"), "changed");
  vi.mocked(spawnSync).mockReturnValue({ pid: 1, output: [], stdout: "", stderr: "", status: 0, signal: null });
  assert.throws(() => setup.ensureParityBundle(), /dashboard bundle refused: bundle inputs changed after build/u);
});
