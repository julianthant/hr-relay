import { Banner, Button, Refusal, dsText } from "../ds/ui.js";
import type { SettingsSaveState } from "./settings-attempt-model.js";
export function SettingsSaveFeedback({ save, protectedStore = false, retry, retryConflict }: { save: SettingsSaveState; protectedStore?: boolean; retry: () => void; retryConflict?: () => void }) {
  const name = protectedStore ? "Credentials" : "Settings";
  if (save.state === "idle") return null;
  if (save.state === "saving") return <span role="status" className={dsText.meta}>Saving…</span>;
  if (save.state === "applied") return <span role="status" className={dsText.meta}>{save.replayed ? "Already saved" : "Saved"}</span>;
  if (save.state === "refused") return <Refusal title={`${name} were not applied`} code={save.code ?? "settings-draft-invalid"}>{save.message}</Refusal>;
  const title = { unconfirmed: `${name} write unconfirmed`, conflict: `${name} changed` }[save.state];
  return <Banner tone="warning" title={title}>
    <span className="flex flex-col gap-[var(--ds-space-base)]"><span>{save.message}</span>
      {save.state === "unconfirmed" && <span><Button size="sm" variant="secondary" onClick={retry}>Retry exact attempt</Button></span>}
      {save.state === "conflict" && retryConflict !== undefined && <span><Button size="sm" variant="secondary" onClick={retryConflict}>Retry edit</Button></span>}
    </span>
  </Banner>;
}
