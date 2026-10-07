import { declareDriver, defineBrowserStore } from "../../../workflow-kit/task-registry.js";
import { oldKronosSession } from "./session.js";

export const oldKronosStore = defineBrowserStore(
  "old-kronos",
  declareDriver("old-kronos", "unwired"),
  oldKronosSession,
  {},
);
