import { rebuildRuntimeIsolation } from "./config/runtime-isolation.js";
import {
  registerActivityPersonPseudonymComposer,
  registerDashboardComposer,
  registerDryRunScenarioComposer,
  registerExplainComposer,
  registerOcrComposer,
  registerStorageComposer,
  registerWorkerComposer,
  startRebuildRuntime,
} from "./core/runtime-composition.js";
import { composeDashboardRuntime } from "./server/dashboard/compose.js";
import { composeActivityPersonPseudonymBackfillCommand } from "./server/activity-person-pseudonym-backfill/compose.js";
import { composeDryRunScenarioCommand } from "./server/dry-run-scenario/compose.js";
import { loadDryRunScenarioManifest } from "./server/dry-run-scenario/manifests.js";
import { createProductionDryRunScenarioRuntime } from "./server/dry-run-scenario/runtime.js";
import { composeExplainRuntime } from "./server/explain/compose.js";
import { composeOcrCommand } from "./server/ocr/compose.js";
import { composeStorageCommand } from "./server/storage/compose.js";
import { composeWorkerRuntime } from "./server/worker/compose.js";

/**
 * Compose and start one admitted CLI invocation. Secure bootstrap is the sole
 * caller, and it AWAITS this promise: for `dashboard` the promise is the
 * runtime's whole lifetime (it settles only after the composed runtime stopped),
 * so a shutdown failure reaches the entrypoint instead of vanishing.
 */
export async function runCli(): Promise<void> {
  registerDashboardComposer((runtimeIsolation) => composeDashboardRuntime({ isolation: runtimeIsolation }));
  registerActivityPersonPseudonymComposer((runtimeIsolation, args) =>
    composeActivityPersonPseudonymBackfillCommand({ isolation: runtimeIsolation, args }));
  registerDryRunScenarioComposer((runtimeIsolation, args) => composeDryRunScenarioCommand({
    isolation: runtimeIsolation,
    args,
    // The manifest registration itself lives in ./server/dry-run-scenario/manifests.js
    // (ref guards-and-tests §10.9) — `test-target-registry` (architecture) reads
    // that file's own source and walks the layout, failing in both directions,
    // so a manifest that lands without a registration there, or a registration
    // that outlives its manifest, is red.
    loadManifest: loadDryRunScenarioManifest,
    createRuntime: createProductionDryRunScenarioRuntime,
  }));
  registerWorkerComposer((runtimeIsolation, args) => composeWorkerRuntime({ isolation: runtimeIsolation, args }));
  registerExplainComposer((runtimeIsolation, args) => composeExplainRuntime({ isolation: runtimeIsolation, args }));
  registerOcrComposer((args) => composeOcrCommand({ args }));
  registerStorageComposer((runtimeIsolation, args) => composeStorageCommand(runtimeIsolation, args));
  await startRebuildRuntime({ isolation: rebuildRuntimeIsolation });
}
