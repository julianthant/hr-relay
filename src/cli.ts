import { fileURLToPath } from "node:url";
import { rebuildRuntimeIsolation } from "./backend/app/config/runtime-isolation.js";
import {
  registerDashboardComposer,
  registerExplainComposer,
  registerOcrComposer,
  registerStorageComposer,
  registerTestDataComposer,
  registerWorkerComposer,
  startRebuildRuntime,
} from "./backend/app/composition/runtime-composition.js";
import { composeDashboardApplication } from "./backend/app/composition/dashboard/compose.js";
import { createProfileSettingsProcesses } from "./backend/app/composition/dashboard/profile-settings-processes.js";
import { listDryRunScenarioWorkflows, loadDryRunScenarioManifest } from "./backend/app/dry-run/manifests.js";
import { parseDryRunScenarioManifest } from "./models/trust/dry-run-scenario.js";
import { composeTestDataCommand } from "./backend/app/test-data/compose.js";
import { composeExplainRuntime } from "./backend/app/composition/explain-compose.js";
import { composeOcrCommand } from "./backend/transports/cli/ocr.js";
import { composeTransactionExportCommand } from "./backend/transports/cli/transactions.js";
import { composeStorageCommand, detachedShutdownBackup } from "./backend/app/composition/storage-compose.js";
import { productionWorkerLaunch } from "./backend/app/composition/dashboard/worker-process.js";
import { composeWorkerRuntime } from "./backend/app/composition/worker-compose.js";
import type { RuntimeAdmission } from "./backend/storage/admission/admission.js";
import { RuntimeLifetimeLock } from "./backend/storage/admission/lifetime-lock.js";
import type { RuntimeLifetime } from "./backend/app/bootstrap/secure-env-bootstrap.js";

/** Compose and start one admitted CLI invocation; secure bootstrap awaits it, so a shutdown failure reaches the entrypoint. */
/** The checkout that owns this cli module, never the caller's CWD. */
const REPOSITORY_ROOT = fileURLToPath(new URL("..", import.meta.url));

export async function runCli(admission: RuntimeAdmission, acceptDashboardAdmission: (() => void) | undefined, lifetime: RuntimeLifetime): Promise<void> {
  admission.assertLive();
  if (process.argv[2] === "storage" && process.argv[3] === "transactions") {
    process.stdout.write(composeTransactionExportCommand(admission, process.argv.slice(4)));
    return;
  }
  registerDashboardComposer(async (runtimeIsolation, options) => {
    if (!(lifetime.lock instanceof RuntimeLifetimeLock)) throw new Error("dashboard-runtime-lifetime-lock-required");
    const application = await composeDashboardApplication({ admission, isolation: runtimeIsolation, repoRoot: REPOSITORY_ROOT, frontend: options.frontend,
      lifetimeLock: lifetime.lock, copySignin: lifetime.copySignin, profileSettingsProcesses: createProfileSettingsProcesses,
      shutdownBackup: detachedShutdownBackup(productionWorkerLaunch(REPOSITORY_ROOT, undefined, options.frontend === "vite-dev")) });
    acceptDashboardAdmission?.();
    return application;
  });
  registerTestDataComposer((runtimeIsolation, args) => composeTestDataCommand(admission,runtimeIsolation, args, REPOSITORY_ROOT, {
    loadManifests: async () => Promise.all(listDryRunScenarioWorkflows().map(async (workflow) =>
      parseDryRunScenarioManifest(await loadDryRunScenarioManifest(workflow)))),
  }));
  registerWorkerComposer(async (runtimeIsolation, args) => {
    const report = await composeWorkerRuntime({ admission, isolation: runtimeIsolation, repoRoot: REPOSITORY_ROOT, args,
      lifetimeLock: lifetime.lock, stopSignal: lifetime.parentSignal });
    if (report.closure === "unproved") process.exitCode = 1;
    return report;
  });
  registerExplainComposer((runtimeIsolation, args) => composeExplainRuntime({ admission, isolation: runtimeIsolation, args }));
  registerOcrComposer((args) => composeOcrCommand({ args }));
  registerStorageComposer((runtimeIsolation, args) => composeStorageCommand(runtimeIsolation, args, undefined, REPOSITORY_ROOT, admission));
  await startRebuildRuntime({ isolation: rebuildRuntimeIsolation });
}
