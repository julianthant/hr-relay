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
  // The executable declarations intentionally remain under tests/scenario and
  // are loaded only at this outer CLI root. No production module statically
  // depends on a test module, and Vitest still cannot collect these non-test
  // files. ONE entry per workflow that has a T1b pair in the layout (ref
  // guards-and-tests §10.9) — `test-target-registry` (architecture) walks the
  // layout and fails in both directions, so a manifest that lands without a
  // registration here, or a registration that outlives its manifest, is red.
  loadManifest: async (workflow) => {
    const manifests: Readonly<Record<string, () => Promise<unknown>>> = {
      "separations": async () => (await import(
        "../tests/scenario/workflows/separations/dry-run.scenario.js"
      )).SEPARATIONS_DRY_RUN,
      "separations-kuali-finalization": async () => (await import(
        "../tests/scenario/workflows/separations-kuali-finalization/dry-run.scenario.js"
      )).SEPARATIONS_KUALI_FINALIZATION_DRY_RUN,
    };
    const load = manifests[workflow];
    if (load === undefined) {
      // Derived from the map, never authored: a listing that could go stale
      // would send the operator after a workflow this build cannot run.
      throw new Error(
        `unknown dry-run scenario workflow ${workflow}; registered: ${Object.keys(manifests).sort().join(", ")}`,
      );
    }
    return load();
  },
  createRuntime: createProductionDryRunScenarioRuntime,
}));
registerWorkerComposer((runtimeIsolation, args) => composeWorkerRuntime({ isolation: runtimeIsolation, args }));
registerExplainComposer((runtimeIsolation, args) => composeExplainRuntime({ isolation: runtimeIsolation, args }));
registerOcrComposer((args) => composeOcrCommand({ args }));
registerStorageComposer((runtimeIsolation, args) => composeStorageCommand(runtimeIsolation, args));
startRebuildRuntime({ isolation: rebuildRuntimeIsolation });
