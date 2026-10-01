import { declareDriver, defineBrowserStore } from "../../../base/store.js";
import { servicenowSession } from "./session.js";

export const servicenowStore = defineBrowserStore(
  "servicenow",
  declareDriver("servicenow", "unwired"),
  servicenowSession,
  {},
);
