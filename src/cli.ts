import { rebuildRuntimeIsolation } from "./config/runtime-isolation.js";
import {
  registerDashboardComposer,
  registerDryRunScenarioComposer,
  registerExplainComposer,
  registerOcrComposer,
  registerStorageComposer,
  registerWorkerComposer,
  startRebuildRuntime,
} from "./core/runtime-composition.js";
import { composeDashboardRuntime } from "./server/dashboard/compose.js";
import { composeDryRunScenarioCommand } from "./server/dry-run-scenario/compose.js";
import { createProductionDryRunScenarioRuntime } from "./server/dry-run-scenario/runtime.js";
import { composeExplainRuntime } from "./server/explain/compose.js";
import { composeOcrCommand } from "./server/ocr/compose.js";
import { composeStorageCommand } from "./server/storage/compose.js";
import { composeWorkerRuntime } from "./server/worker/compose.js";

registerDashboardComposer((runtimeIsolation) => composeDashboardRuntime({ isolation: runtimeIsolation }));
registerDryRunScenarioComposer((runtimeIsolation, args) => composeDryRunScenarioCommand({
  isolation: runtimeIsolation,
  args,
  // The executable declaration intentionally remains under tests/scenario and
  // is loaded only at this outer CLI root. No production module statically
  // depends on a test module, and Vitest still cannot collect this non-test file.
  loadManifest: async (workflow) => {
    if (workflow !== "separations-kuali-finalization") {
      throw new Error(
        `unknown dry-run scenario workflow ${workflow}; registered: separations-kuali-finalization`,
      );
    }
    const declaration = await import(
      "../tests/scenario/workflows/separations-kuali-finalization/dry-run.scenario.js"
    );
    return declaration.SEPARATIONS_KUALI_FINALIZATION_DRY_RUN;
  },
  createRuntime: createProductionDryRunScenarioRuntime,
}));
registerWorkerComposer((runtimeIsolation, args) => composeWorkerRuntime({ isolation: runtimeIsolation, args }));
registerExplainComposer((runtimeIsolation, args) => composeExplainRuntime({ isolation: runtimeIsolation, args }));
registerOcrComposer((args) => composeOcrCommand({ args }));
registerStorageComposer((runtimeIsolation, args) => composeStorageCommand(runtimeIsolation, args));
startRebuildRuntime({ isolation: rebuildRuntimeIsolation });
