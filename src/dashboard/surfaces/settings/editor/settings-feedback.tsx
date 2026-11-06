import { Notice, dsText } from "../../../ds/ui.js";
import type { SettingsSaveState } from "./settings-attempt-model.js";
export function SettingsSaveFeedback({ save, protectedStore = false, name: explicitName, retry, retryConflict, restartRequired = false }: { save: SettingsSaveState; protectedStore?: boolean; name?: string; retry: () => void; retryConflict?: () => void; restartRequired?: boolean }) {
  const name = explicitName ?? (protectedStore ? "Credentials" : "Settings");
  if (save.state === "idle") return null;
  if (save.state === "saving") return <span role="status" className={dsText.meta}>Saving…</span>;
  if (save.state === "applied") return <span role="status" className={dsText.meta}>{save.replayed ? "Already saved" : "Saved"}{restartRequired ? " · Restart required" : ""}</span>;
  const retryEdit = retryConflict === undefined ? undefined : { label: "Retry edit", onAction: retryConflict };
  if (save.state === "refused") return <Notice sticky={retryEdit !== undefined} tone="danger" title={`${name} not applied`} description={save.message} action={retryEdit} />;
  if (save.state === "unconfirmed") return <Notice sticky tone="warning" title={`${name} write unconfirmed`} description={save.message} action={{ label: "Retry exact attempt", onAction: retry }} />;
  return <Notice sticky={retryEdit !== undefined} tone="warning" title={`${name} changed`} description={save.message} action={retryEdit} />;
}
