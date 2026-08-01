import { declareDriver, defineBrowserStore } from "../../base/store.js";
import { kualiSession } from "./session.js";

export const kualiStore = defineBrowserStore("kuali", declareDriver("kuali", "unwired"), kualiSession, {});
