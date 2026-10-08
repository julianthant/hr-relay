import type { RuntimeAdmission } from "../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { copyFileSync, cpSync, mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manualClock } from "../../../src/rules/time/clock.js";
import { composeDashboardRuntime } from "../../../src/backend/app/composition/dashboard/compose.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { PARITY_DIST_DIR, PARITY_REPO_ROOT, assertServedBundle } from "./bundle.js";

/** Real composition and command routes on a private, disposable authority. */
export async function startSettingsActivationServer() {
  assertServedBundle(PARITY_DIST_DIR, { proof: "working-tree" });
  const root = mkdtempSync(join(realpathSync(tmpdir()), "settings-desktop-"));
  let admission: RuntimeAdmission | undefined;
  try {
    for (const name of ["package.json", "package-lock.json", "vite.dashboard.config.ts", "tsconfig.json"])
      copyFileSync(join(PARITY_REPO_ROOT, name), join(root, name));
    cpSync(join(PARITY_REPO_ROOT, "src"), join(root, "src"), { recursive: true });
    mkdirSync(join(root, "dist")); cpSync(PARITY_DIST_DIR, join(root, "dist", "dashboard"), { recursive: true });
    admission = acquireEntrypointAdmission(root, "shared");
    if (admission.stateRoot !== join(root, ".tracker") || admission.artifactRoot !== join(root, ".tracker", "artifacts")) throw new Error("SETTINGS_FIXTURE_ADMISSION_ROOT_MISMATCH");
    const runtime = await composeDashboardRuntime({ admission, isolation: rebuildRuntimeIsolation, repoRoot: root,
      env: { HRAUTO_HOST_PRIMARY_DISPLAY: "2560x1440" }, clock: manualClock(new Date("2026-09-09T12:00:00.000Z")),
      backendPortOverride: 0, frontendPortOverride: 0, frontend: "built-bundle" });
    return { url: `http://127.0.0.1:${String(runtime.port)}`, root,
      stop: async () => { try { await runtime.stop(); } finally { admission?.release(); rmSync(root, { recursive: true, force: true }); } } };
  } catch (error) { admission?.release(); rmSync(root, { recursive: true, force: true }); throw error; }
}
