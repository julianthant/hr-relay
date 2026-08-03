import { rebuildRuntimeIsolation } from "./config/runtime-isolation.js";
import { registerDashboardComposer, startRebuildRuntime } from "./core/runtime-composition.js";
import { composeDashboardRuntime } from "./server/dashboard/compose.js";

registerDashboardComposer((runtimeIsolation) => composeDashboardRuntime({ isolation: runtimeIsolation }));
startRebuildRuntime({ isolation: rebuildRuntimeIsolation });
