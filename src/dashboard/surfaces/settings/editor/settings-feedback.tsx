import { Button, Notice, dsText } from "../../../ds/ui.js";
import { settingsSaveProblem, type SettingsSaveState } from "./settings-attempt-model.js";
export function SettingsSaveFeedback({ save, protectedStore = false, retryConflict, restartRequired = false }: { save: SettingsSaveState; protectedStore?: boolean; retryConflict?: () => void; restartRequired?: boolean }) {
  if (save.state === "idle") return null;
  if (save.state === "saving") return null;
  if (save.state === "applied") return <span role="status" className={dsText.meta}>{save.replayed ? "Already saved" : "Saved"}{restartRequired ? " · Restart required" : ""}</span>;
  const problem = settingsSaveProblem(save, protectedStore);
  if (problem === undefined) return null;
  const action = retryConflict === undefined ? undefined : { label: "Retry edit", onAction: retryConflict };
  return <><Notice sticky {...problem} />{action && <Button size="sm" variant="secondary" className="self-start" onClick={action.onAction}>{action.label}</Button>}</>;
}
