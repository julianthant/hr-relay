import { dsText } from "../../../ds/ui.js";
import type { SettingsSaveState } from "./settings-attempt-model.js";
/** A save that did not land is toasted once by its model; only a landed save shows here. */
export function SettingsSaveFeedback({ save, restartRequired = false }: { save: SettingsSaveState; restartRequired?: boolean }) {
  if (save.state !== "applied") return null;
  return <span role="status" className={dsText.meta}>{save.replayed ? "Already saved" : "Saved"}{restartRequired ? " · Restart required" : ""}</span>;
}
