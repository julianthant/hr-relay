import { rebuildRuntimeIsolation } from "./config/runtime-isolation.js";
import { startRebuildRuntime } from "./core/runtime-composition.js";
import { composeDashboardRuntime } from "./server/dashboard/compose.js";

startRebuildRuntime({
  isolation: rebuildRuntimeIsolation,
  dashboard: (isolation) => composeDashboardRuntime({ isolation }),
});
