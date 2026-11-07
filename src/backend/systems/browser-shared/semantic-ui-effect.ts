import type { BrowserSystemId } from "../../../rules/identity/ids.js";
import { CRM_UI_REGISTRY } from "../crm/driver/ui-registry.js";
import { KUALI_UI_REGISTRY } from "../kuali/driver/ui-registry.js";
import { NEW_KRONOS_UI_REGISTRY } from "../new-kronos/driver/ui-registry.js";
import { UCPATH_UI_REGISTRY } from "../ucpath/driver/ui-registry.js";

/** Only registered semantic elements classify an interaction. */
export function registeredUiEffect(system: BrowserSystemId, targetId: string): "observe" | "navigate" | "prepare" | "external-commit" | undefined {
  switch (system) {
    case "crm": return CRM_UI_REGISTRY.elements.find(element => element.id === targetId)?.effect;
    case "kuali": return KUALI_UI_REGISTRY.elements.find(element => element.id === targetId)?.effect;
    case "new-kronos": return NEW_KRONOS_UI_REGISTRY.elements.find(element => element.id === targetId)?.effect;
    case "ucpath": return UCPATH_UI_REGISTRY.elements.find(element => element.id === targetId)?.effect;
    default: return undefined;
  }
}

export function registeredUiSensitivity(system: BrowserSystemId, targetId: string): "public" | "hr" | "restricted" | undefined {
  switch (system) {
    case "crm": return CRM_UI_REGISTRY.elements.find(element => element.id === targetId)?.sensitivity;
    case "kuali": return KUALI_UI_REGISTRY.elements.find(element => element.id === targetId)?.sensitivity;
    case "new-kronos": return NEW_KRONOS_UI_REGISTRY.elements.find(element => element.id === targetId)?.sensitivity;
    case "ucpath": return UCPATH_UI_REGISTRY.elements.find(element => element.id === targetId)?.sensitivity;
    default: return undefined;
  }
}
