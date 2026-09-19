import { systemClock } from "../../domain/clock.js";
import { usePreflightReadiness } from "../state/preflight-readiness.js";
import type { EditableSettingsState } from "./settings-editor-model.js";
import type { PreflightCheckWire } from "./settings-model.js";
export function useSettingsPreflight(editor: EditableSettingsState, input: { actorId: string; descriptorFingerprint: string }) {
  const document = editor.state === "loaded" ? editor.document : undefined;
  const readiness = usePreflightReadiness({
    configFingerprint: document?.activeConfigFingerprint ?? "unavailable",
    descriptorFingerprint: input.descriptorFingerprint,
    settingsRevision: document === undefined ? editor.state : JSON.stringify([document.revision, document.runtimeStatus, document.protectedSettings.state === "available" ? document.protectedSettings.readback.revision : "unavailable"]),
  });
  let preflight: PreflightRerunState;
  switch (readiness.state.state) {
    case "idle": preflight = { state: "idle" }; break;
    case "running": preflight = { state: "running" }; break;
    case "unavailable": preflight = { state: "refused", message: readiness.state.reason }; break;
    case "present": {
      const report = readiness.state.report;
      preflight = { state: "completed", checks: report.results.map(check => ({
        id: check.check, label: check.check, verdict: check.status, detail: check.summary,
        blocks: check.status === "fail" ? check.blocks : [],
        ...(check.status === "pass" ? {} : { remediation: check.remediation }), checkedAt: report.checkedAt,
      })) };
      break;
    }
  }
  const rerunPreflight = (): void => {
    if (document === undefined) return;
    if (document.runtimeStatus.state === "restart-required") { readiness.invalidate(); return; }
    void readiness.rerun({
      commandId: crypto.randomUUID(), requestedAt: systemClock.now().toISOString(), requestedBy: input.actorId,
      source: "settings-surface", type: "rerun-preflight",
      target: { expectedConfigFingerprint: document.activeConfigFingerprint, expectedDescriptorFingerprint: input.descriptorFingerprint },
    });
  };
  return { preflight, rerunPreflight };
}
export type PreflightRerunState =
  | { readonly state: "idle" }
  | { readonly state: "running" }
  | { readonly state: "completed"; readonly checks: readonly PreflightCheckWire[] }
  | { readonly state: "refused"; readonly message: string };
