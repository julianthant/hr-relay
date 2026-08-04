import { rebuildRuntimeIsolation } from "./config/runtime-isolation.js";
import {
  registerDashboardComposer,
  registerWorkerComposer,
  startRebuildRuntime,
} from "./core/runtime-composition.js";
import { composeDashboardRuntime } from "./server/dashboard/compose.js";
import { composeWorkerRuntime } from "./server/worker/compose.js";

registerDashboardComposer((runtimeIsolation) => composeDashboardRuntime({ isolation: runtimeIsolation }));
registerWorkerComposer((runtimeIsolation, args) => composeWorkerRuntime({ isolation: runtimeIsolation, args }));
startRebuildRuntime({ isolation: rebuildRuntimeIsolation });
