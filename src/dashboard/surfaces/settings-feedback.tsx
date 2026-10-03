import { useEffect, useState } from "react";
import { Banner, Button, Refusal, dsText } from "../ds/ui.js";
import type { SettingsSaveState } from "./settings-attempt-model.js";
export function SettingsSaveFeedback({ save, protectedStore = false, name: explicitName, retry, retryConflict }: { save: SettingsSaveState; protectedStore?: boolean; name?: string; retry: () => void; retryConflict?: () => void }) {
  const [showApplied, setShowApplied] = useState(true);
  const appliedReplay = save.state === "applied" ? save.replayed : undefined;
  useEffect(() => {
    if (save.state !== "applied") {
      setShowApplied(false);
      return;
    }
    setShowApplied(true);
    const timer = window.setTimeout(() => setShowApplied(false), 2200);
    return () => window.clearTimeout(timer);
  }, [appliedReplay, save.state]);
  const name = explicitName ?? (protectedStore ? "Credentials" : "Settings");
  if (save.state === "idle") return null;
  if (save.state === "saving") return <span role="status" className={dsText.meta}>Saving…</span>;
  if (save.state === "applied") return showApplied ? <span role="status" className={dsText.meta}>{appliedReplay ? "Already saved" : "Saved"}</span> : null;
  if (save.feedback === "chip" && save.state === "refused") return retryConflict === undefined ? null : <Button size="sm" variant="secondary" onClick={retryConflict}>Retry edit</Button>;
  if (save.feedback === "chip" && save.state === "conflict") return retryConflict === undefined ? null : <Button size="sm" variant="secondary" onClick={retryConflict}>Retry edit</Button>;
  if (save.state === "refused") return <Refusal title={`${name} were not applied`} code={save.code ?? "settings-draft-invalid"}>{save.message}{retryConflict !== undefined && <span className="block"><Button size="sm" variant="secondary" onClick={retryConflict}>Retry edit</Button></span>}</Refusal>;
  const title = { unconfirmed: `${name} write unconfirmed`, conflict: `${name} changed` }[save.state];
  return <Banner tone="warning" title={title}>
    <span className="flex flex-col gap-[var(--ds-space-base)]"><span>{save.message}</span>
      {save.state === "unconfirmed" && <span><Button size="sm" variant="secondary" onClick={retry}>Retry exact attempt</Button></span>}
      {save.state === "conflict" && retryConflict !== undefined && <span><Button size="sm" variant="secondary" onClick={retryConflict}>Retry edit</Button></span>}
    </span>
  </Banner>;
}
