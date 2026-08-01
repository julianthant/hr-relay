import { declareDriver, defineBrowserStore } from "../../base/store.js";
import { newKronosSession } from "./session.js";

export const newKronosStore = defineBrowserStore(
  "new-kronos",
  declareDriver("new-kronos", "unwired"),
  newKronosSession,
  {},
);
