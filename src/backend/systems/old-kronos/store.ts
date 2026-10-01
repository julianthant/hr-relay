import { declareDriver, defineBrowserStore } from "../../../base/store.js";
import { oldKronosSession } from "./session.js";

export const oldKronosStore = defineBrowserStore(
  "old-kronos",
  declareDriver("old-kronos", "unwired"),
  oldKronosSession,
  {},
);
