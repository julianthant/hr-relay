import { declareDriver, defineBrowserStore } from "../../../workflow-kit/task-registry.js";
import { i9Session } from "./session.js";

export const i9Store = defineBrowserStore("i9", declareDriver("i9", "unwired"), i9Session, {});
