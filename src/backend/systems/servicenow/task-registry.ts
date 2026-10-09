import { declareDriver, defineBrowserStore } from "../../../workflow-kit/task-registry.js";
import { servicenowSession } from "./session.js";

export const servicenowStore = defineBrowserStore(
  "servicenow",
  declareDriver("servicenow", "unwired"),
  servicenowSession,
  {},
);
