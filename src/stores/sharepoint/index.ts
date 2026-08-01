import { declareDriver, defineBrowserStore } from "../../base/store.js";
import { sharepointSession } from "./session.js";

export const sharepointStore = defineBrowserStore(
  "sharepoint",
  declareDriver("sharepoint", "unwired"),
  sharepointSession,
  {},
);
