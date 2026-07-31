import { rebuildRuntimeIsolation } from "./config/runtime-isolation.js";
import { startRebuildRuntime } from "./core/runtime-composition.js";

startRebuildRuntime({ isolation: rebuildRuntimeIsolation });
