import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../../models/failures/error-catalog.js";
import { useEffect, useMemo, useRef, useState } from "react";
import type { NativePathField } from "../../../../models/dashboard/native-path-picker.js";
import { Button, Tooltip, TooltipProvider, useFieldControl } from "../../../ds/ui.js";
import { useDashboardClient, useDashboardCommandBinding } from "../../../state/client-context.js";

export function SettingsPathPicker({ field, label, value, disabled, onSelected }: {
  field: NativePathField; label: string; value: string; disabled: boolean; onSelected: (path: string) => void;
}) {
  const control = useFieldControl();
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
  const folder = value.replace(/[\\/]+$/u, "").split(/[\\/]/u).pop() || value;
  return <div className="settings-path-picker">
    <div className="ds-path-control">
      <TooltipProvider delayDuration={250}>
        <Tooltip content={<span className="break-all whitespace-normal">{value}</span>}>
          <span className="ds-path-value ds-path-basename" tabIndex={0} aria-label={value}>{folder}</span>
        </Tooltip>
      </TooltipProvider>
      <Button id={control.id} aria-label={`Change ${label}`} size="md" variant="secondary" onClick={() => { void pick(); }} disabled={disabled} loading={busy}>Change</Button>
    </div>
    {error !== undefined && <p role="alert" className="settings-path-picker-error">{error}</p>}
  </div>;
}
