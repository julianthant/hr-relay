import { composeDashboardApplication } from "../../../src/backend/app/composition/dashboard/compose.js";
import { startRebuildRuntime } from "../../../src/backend/app/composition/runtime-composition.js";
import { initializeRegisteredPersonStores } from "../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../src/backend/app/config/runtime-isolation.js";
import { profileBrowserClosure } from "../../../src/backend/runtime/browser/profile-browser-closure.js";
import { acquireDashboardEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { healthyRuntimePreflightRunners } from "../fixtures/preflight-seams.js";
import { fixtureWorkerLaunch } from "../helpers/backend/dashboard-child-world.js";

// The dashboard entry as secure bootstrap runs it, on a fixture workspace with OS-assigned ports and fixture pool workers; it owns the real SIGINT/SIGTERM.
const [workspace, barrier] = process.argv.slice(2);
if (workspace === undefined || barrier === undefined) throw new Error("dashboard-signal-child requires <workspace> <barrier>");
const lifetime = await RuntimeLifetimeLock.acquire(0);
try {
  await initializeRegisteredPersonStores(workspace, lifetime, { primaryDisplay: null });
  const admission = await acquireDashboardEntrypointAdmission(profileBrowserClosure, workspace, "shared", lifetime);
  process.stdout.write(`LIFETIME LOCK ${String(lifetime.port)}\n`);
  await startRebuildRuntime({ isolation: rebuildRuntimeIsolation, args: ["dashboard"],
    dashboard: () => composeDashboardApplication({ admission, isolation: rebuildRuntimeIsolation, repoRoot: workspace, lifetimeLock: lifetime,
      backendPortOverride: 0, frontendPortOverride: 0, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners,
      workerProcess: { launch: fixtureWorkerLaunch(lifetime, barrier) } }) });
} finally { await lifetime.close(); }
