import { useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";
import type { PreflightCheckWireSchema, PreflightVerdictSchema } from "../../../models/dashboard/bootstrap.js";
import { usePreflightActions } from "../settings/preflight/preflight-actions-model.js";
import { useSettingsClient } from "../settings/editor/settings-client.js";
import type { EditableSettingsState } from "../settings/editor/settings-editor-model.js";
import { useSettingsPreflight } from "../settings/preflight/settings-preflight-model.js";
export type PreflightCheckWire = z.infer<typeof PreflightCheckWireSchema>;
export type PreflightVerdict = z.infer<typeof PreflightVerdictSchema>;
export function preflightVerdict(checks: readonly PreflightCheckWire[]): PreflightVerdict | "unavailable" {
  if (checks.length === 0) return "unavailable";
  if (checks.some(check => check.verdict === "fail")) return "fail";
  if (checks.some(check => check.verdict === "warning")) return "warning";
  return "pass";
}
export { preflightRemedy } from '../settings/preflight/preflight-remedy-model.js';
export function useDoctorPreflight() {
  const actions = usePreflightActions();
  const client = useSettingsClient();
  const [editor, setEditor] = useState<EditableSettingsState>({ state: "loading" });
  const epoch = useRef(0);
  const refresh = useCallback(async () => {
    const started = ++epoch.current;
    try {
      const document = await client.editableSettings();
      if (started === epoch.current) setEditor({ state: "loaded", document });
    } catch {
      if (started === epoch.current) setEditor({ state: "failed", message: "Current settings could not be read." });
    }
  }, [client]);
  useEffect(() => { void refresh(); return () => { epoch.current += 1; }; }, [refresh]);
  return { ...useSettingsPreflight(editor, actions), refresh };
}
