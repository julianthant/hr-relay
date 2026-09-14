import { Banner, Button, Refusal } from "../ds/ui.js";
import type { SettingsSaveState } from "./settings-attempt-model.js";
export function SettingsSaveFeedback({ save, protectedStore = false, retry }: { save: SettingsSaveState; protectedStore?: boolean; retry: () => void }) {
  const name = protectedStore ? "Credentials" : "Settings";
  if (save.state === "idle" || save.state === "saving") return null;
  if (save.state === "applied") return <Banner tone="success" title={save.replayed ? `${name} already applied` : `${name} applied`}>
    {protectedStore ? "Credential presence and revision confirmed. Changes apply at the next use." : "Saved settings are active for new runs. Existing runs keep their original settings."}
  </Banner>;
  if (save.state === "refused") return <Refusal title={`${name} were not applied`} code={save.code ?? "settings-draft-invalid"}>{save.message}</Refusal>;
  return <Banner tone="warning"
    title={save.state === "unconfirmed" ? `${name} write unconfirmed` : save.state === "conflict" ? `${name} changed` : `${name} were not applied`}>
    <span className="flex flex-col gap-[var(--ds-space-base)]"><span>{save.message}</span>
      {save.state === "unconfirmed" && <span><Button size="sm" variant="secondary" onClick={retry}>Retry exact attempt</Button></span>}
    </span>
  </Banner>;
}
