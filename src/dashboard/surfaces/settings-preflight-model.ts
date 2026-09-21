import { useEffect } from "react";
import { systemClock } from "../../domain/clock.js";
import type { PreflightReadinessWire } from "../../domain/preflight-contract.js";
import { usePreflightReadiness } from "../state/preflight-readiness.js";
import { usePreflightScope } from "../state/preflight-client.js";
import type { EditableSettingsState } from "./settings-editor-model.js";
import type { PreflightCheckWire } from "./settings-model.js";

type Report = Extract<PreflightReadinessWire, { state: "present" }>["report"];
export type PreflightRerunState =
  | { readonly state: "idle" | "running" }
  | { readonly state: "completed"; readonly checks: readonly PreflightCheckWire[]; readonly report: Report }
  | { readonly state: "refused"; readonly message: string };

export function projectPreflight(state: PreflightReadinessWire | { state: "idle" | "running" }, nowMs: number): PreflightRerunState {
  if (state.state === "idle" || state.state === "running") return { state: state.state };
  if (state.state === "unavailable") return { state: "refused", message: state.reason };
  if (state.state !== "present") throw new Error("Unknown preflight presentation state");
  const report = state.report;
  // Display expiry follows the released 60-second admission contract; only server re-check can restore it.
  const age = nowMs - Date.parse(report.checkedAt);
  if (report.results.length === 0 || age < 0 || age >= 60_000) return { state: "refused", message: "Preflight report is stale or empty. Re-check readiness." };
  return { state: "completed", report, checks: report.results.map(check => ({
    id: check.check, label: check.check, verdict: check.status, detail: check.summary,
    blocks: check.status === "fail" ? check.blocks : [],
    ...(check.status === "pass" ? {} : { remediation: check.remediation }), checkedAt: report.checkedAt,
  })) };
}
export function useSettingsPreflight(editor: EditableSettingsState, input: { actorId: string; descriptorFingerprint: string }) {
  const scope = usePreflightScope();
  const document = editor.state === "loaded" ? editor.document : undefined;
  const descriptorFingerprint = scope.workflow?.descriptorFingerprint ?? input.descriptorFingerprint;
  const readiness = usePreflightReadiness({
    configFingerprint: document?.activeConfigFingerprint ?? "unavailable", descriptorFingerprint,
    ...(scope.workflow === undefined ? {} : { selection: { workflowId: scope.workflow.id } }),
    settingsRevision: document === undefined ? editor.state : JSON.stringify([document.revision, document.runtimeStatus, document.protectedSettings.state === "available" ? document.protectedSettings.readback.revision : "unavailable"]),
  });
  const ready = document !== undefined && document.runtimeStatus.state === "current";
  const read = readiness.read;
  useEffect(() => { if (ready) void read(); }, [ready, read]);
  const checkedAt = readiness.state.state === "present" ? readiness.state.report.checkedAt : undefined;
  useEffect(() => {
    if (checkedAt === undefined) return;
    const remaining = Date.parse(checkedAt) + 60_000 - systemClock.nowMs();
    const timer = window.setTimeout(() => { void read(); }, remaining > 0 ? remaining : 60_000);
    return () => { window.clearTimeout(timer); };
  }, [checkedAt, read]);
  const preflight: PreflightRerunState = document?.runtimeStatus.state === "restart-required"
    ? { state: "refused", message: "Settings restart required. Restart the runtime before re-checking." }
    : editor.state === "failed" ? { state: "refused", message: "Current settings are unavailable. Reload Settings before re-checking." }
    : projectPreflight(readiness.state, systemClock.nowMs());
  const rerunPreflight = (): void => {
    if (!ready || document === undefined) return;
    void readiness.rerun({
      commandId: crypto.randomUUID(), requestedAt: systemClock.now().toISOString(), requestedBy: input.actorId,
      source: "settings-surface", type: "rerun-preflight",
      target: { expectedConfigFingerprint: document.activeConfigFingerprint, expectedDescriptorFingerprint: descriptorFingerprint,
        ...(scope.workflow === undefined ? {} : { selection: { workflowId: scope.workflow.id } }) },
    });
  };
  return { preflight, rerunPreflight };
}
