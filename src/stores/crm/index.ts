import { declareDriver, defineBrowserStore } from "../../base/store.js";
import { crmSession } from "./session.js";

export const crmStore = defineBrowserStore("crm", declareDriver("crm", "unwired"), crmSession, {});
