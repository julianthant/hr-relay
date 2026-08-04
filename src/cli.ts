import { rebuildRuntimeIsolation } from "./config/runtime-isolation.js";
import {
  registerDashboardComposer,
  registerExplainComposer,
  registerWorkerComposer,
  startRebuildRuntime,
} from "./core/runtime-composition.js";
import { composeDashboardRuntime } from "./server/dashboard/compose.js";
import { composeExplainRuntime } from "./server/explain/compose.js";
import { composeWorkerRuntime } from "./server/worker/compose.js";

registerDashboardComposer((runtimeIsolation) => composeDashboardRuntime({ isolation: runtimeIsolation }));
registerWorkerComposer((runtimeIsolation, args) => composeWorkerRuntime({ isolation: runtimeIsolation, args }));
registerExplainComposer((runtimeIsolation, args) => composeExplainRuntime({ isolation: runtimeIsolation, args }));
startRebuildRuntime({ isolation: rebuildRuntimeIsolation });
