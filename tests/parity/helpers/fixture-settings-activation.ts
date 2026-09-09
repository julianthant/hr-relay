import { copyFileSync, mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manualClock } from "../../../src/domain/clock.js";
import { composeDashboardRuntime } from "../../../src/server/dashboard/compose.js";
import { rebuildRuntimeIsolation } from "../../../src/config/runtime-isolation.js";
import { PARITY_DIST_DIR, PARITY_REPO_ROOT, assertServedBundle } from "./bundle.js";

/** Real composition and command routes on a private, disposable authority. */
export async function startSettingsActivationServer() {
  assertServedBundle(PARITY_DIST_DIR, { proof: "working-tree" });
  const root = mkdtempSync(join(tmpdir(), "settings-desktop-"));
  try {
    for (const name of ["package.json", "package-lock.json"]) copyFileSync(join(PARITY_REPO_ROOT, name), join(root, name));
    mkdirSync(join(root, "dist")); symlinkSync(PARITY_DIST_DIR, join(root, "dist", "dashboard"));
    const runtime = await composeDashboardRuntime({ isolation: rebuildRuntimeIsolation, repoRoot: root,
      env: { HRAUTO_HOST_PRIMARY_DISPLAY: "2560x1440" }, clock: manualClock(new Date("2026-09-09T12:00:00.000Z")),
      backendPortOverride: 0, frontendPortOverride: 0, frontend: "built-bundle" });
    return { url: `http://127.0.0.1:${String(runtime.port)}`, root,
      stop: async () => { await runtime.stop(); rmSync(root, { recursive: true, force: true }); } };
  } catch (error) { rmSync(root, { recursive: true, force: true }); throw error; }
}
