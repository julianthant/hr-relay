import { Button, dsText } from "../../../ds/ui.js";
import type { SettingsSaveState } from "./settings-attempt-model.js";
export function SettingsSaveFeedback({ save, retry, retryConflict, restartRequired = false }: { save: SettingsSaveState; retry: () => void; retryConflict?: () => void; restartRequired?: boolean }) {
  if (save.state === "idle") return null;
  if (save.state === "saving") return <span role="status" className={dsText.meta}>Saving…</span>;
  if (save.state === "applied") return <span role="status" className={dsText.meta}>{save.replayed ? "Already saved" : "Saved"}{restartRequired ? " · Restart required" : ""}</span>;
  // The outcome itself reaches the operator as a toast; only the retry control lives here.
  if (save.state === "unconfirmed") return <Button size="sm" variant="secondary" onClick={retry}>Retry exact attempt</Button>;
  return retryConflict === undefined ? null : <Button size="sm" variant="secondary" onClick={retryConflict}>Retry edit</Button>;
}
