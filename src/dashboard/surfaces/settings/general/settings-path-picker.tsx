import { useEffect, useRef, useState } from "react";
import type { NativePathField } from "../../../../domain/dashboard/native-path-picker.js";
import { PathControl } from "../../../ds/ui.js";
import { useDashboardClient } from "../../../state/client-context.js";

export function SettingsPathPicker({ field, label, value, disabled, onSelected }: {
  field: NativePathField; label: string; value: string; disabled: boolean; onSelected: (path: string) => void;
}) {
  const client = useDashboardClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const active = useRef(true);
  const currentValue = useRef(value);
  currentValue.current = value;
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const pick = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const response = await client.pickSettingsPath({ field, initialPath: value });
      if (!active.current) return;
      if (response.state === "selected" && currentValue.current === value) onSelected(response.path);
      else if (response.state === "unavailable") setError({
        busy: "Another path picker is already open.",
        timeout: "The path picker timed out. Try again.",
        "unsupported-platform": "The path picker is unavailable on this host.",
        "dialog-failed": "The path picker could not be opened. Try again.",
      }[response.reason]);
    } catch {
      if (active.current) setError("The path picker could not be opened. Try again.");
    } finally {
      if (active.current) setBusy(false);
    }
  };
  return <div className="settings-path-picker">
    <PathControl value={value} label={label} onChange={() => { void pick(); }} disabled={disabled} busy={busy} />
    {error !== undefined && <p role="alert" className="settings-path-picker-error">{error}</p>}
  </div>;
}
