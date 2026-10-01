import { declareDriver, defineBrowserStore } from "../../../base/store.js";
import { onbaseSession } from "./session.js";

export const onbaseStore = defineBrowserStore(
  "onbase",
  declareDriver("onbase", "unwired"),
  onbaseSession,
  {},
);
