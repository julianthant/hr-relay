import { declareDriver, defineBrowserStore } from "../../../workflow-kit/task-registry.js";
import { sharepointSession } from "./session.js";

export const sharepointStore = defineBrowserStore(
  "sharepoint",
  declareDriver("sharepoint", "unwired"),
  sharepointSession,
  {},
);
