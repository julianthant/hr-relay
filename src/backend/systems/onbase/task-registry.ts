import { declareDriver, defineBrowserStore } from "../../../workflow-kit/task-registry.js";
import { onbaseSession } from "./session.js";

export const onbaseStore = defineBrowserStore(
  "onbase",
  declareDriver("onbase", "unwired"),
  onbaseSession,
  {},
);
