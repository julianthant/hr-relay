import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { z } from "zod";
import type { PreflightCheckWireSchema, PreflightVerdictSchema } from "../../../models/dashboard/bootstrap.js";
import { usePreflightActions } from "../settings/preflight/preflight-actions-model.js";
import { useDashboardCommandBinding } from "../../state/client-context.js";
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
  const binding = useDashboardCommandBinding();
  const request = useMemo(() => ({ client, actorId: actions.actorId, descriptor: actions.descriptorFingerprint, authority: binding?.authority.epoch }), [client, actions.actorId, actions.descriptorFingerprint, binding?.authority.epoch]);
  const current = useRef(request);
  current.current = request;
  const [observed, setObserved] = useState<{ request: typeof request; editor: EditableSettingsState }>({ request, editor: { state: "loading" } });
  const editor: EditableSettingsState = observed.request === request ? observed.editor : { state: "loading" };
  const epoch = useRef(0);
  const refresh = useCallback(async () => {
    if (current.current !== request) return;
    const started = ++epoch.current;
    try {
      const document = await client.editableSettings();
      if (current.current === request && started === epoch.current) setObserved({ request, editor: { state: "loaded", document } });
    } catch {
      if (current.current === request && started === epoch.current) setObserved({ request, editor: { state: "failed", message: "Current settings could not be read." } });
    }
  }, [client, request]);
  useEffect(() => { void refresh(); return () => { epoch.current += 1; }; }, [refresh]);
  return { ...useSettingsPreflight(editor, actions), refresh };
}
