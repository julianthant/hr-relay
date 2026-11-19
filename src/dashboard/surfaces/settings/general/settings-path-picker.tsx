import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../../models/failures/error-catalog.js";
import { useEffect, useMemo, useRef, useState } from "react";
import type { NativePathField } from "../../../../models/dashboard/native-path-picker.js";
import { PathControl } from "../../../ds/ui.js";
import { useDashboardClient, useDashboardCommandBinding } from "../../../state/client-context.js";

export function SettingsPathPicker({ field, label, value, disabled, onSelected }: {
  field: NativePathField; label: string; value: string; disabled: boolean; onSelected: (path: string) => void;
}) {
  const client = useDashboardClient();
  const binding = useDashboardCommandBinding();
  const request = useMemo(() => ({ client, scope: binding?.scope, field, value, disabled }), [client, binding?.scope, field, value, disabled]);
  const currentRequest = useRef(request);
  currentRequest.current = request;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);
  const pick = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const response = await client.pickSettingsPath({ field, initialPath: value });
      if (!active.current || currentRequest.current !== request) return;
      if (response.state === "selected" && !disabled) onSelected(response.path);
      else if (response.state === "unavailable") setError(formatErrorCatalogFailure(createErrorCatalogFailure({
        busy: "SETTINGS_PATH_PICKER_BUSY" as const,
        timeout: "SETTINGS_PATH_PICKER_TIMEOUT" as const,
        "unsupported-platform": "SETTINGS_PATH_PICKER_UNSUPPORTED" as const,
        "dialog-failed": "SETTINGS_PATH_PICKER_FAILED" as const,
      }[response.reason], {})).text);
    } catch {
      if (active.current && currentRequest.current === request) setError(formatErrorCatalogFailure(createErrorCatalogFailure("SETTINGS_PATH_PICKER_FAILED", {})).text);
    } finally {
      if (active.current) setBusy(false);
    }
  };
  return <div className="settings-path-picker">
    <PathControl value={value} label={label} onChange={() => { void pick(); }} disabled={disabled} busy={busy} />
    {error !== undefined && <p role="alert" className="settings-path-picker-error">{error}</p>}
  </div>;
}
