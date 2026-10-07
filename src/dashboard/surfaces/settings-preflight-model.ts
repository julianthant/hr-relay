import { useEffect } from "react";
import { systemClock } from "../../rules/time/clock.js";
import type { PreflightReadinessWire } from "../../models/preflight/preflight-contract.js";
import { usePreflightReadiness } from "../state/preflight-readiness.js";
import { usePreflightScope } from "../state/preflight-client.js";
import type { EditableSettingsState } from "./settings-editor-model.js";
import type { PreflightCheckWire } from "./settings-model.js";

type Report = Extract<PreflightReadinessWire, { state: "present" }>["report"];
export type PreflightRerunState =
  | { readonly state: "idle" | "running" }
  | { readonly state: "completed"; readonly checks: readonly PreflightCheckWire[]; readonly report: Report }
  | { readonly state: "historical"; readonly checks: readonly PreflightCheckWire[]; readonly report: Report; readonly message: string; readonly checking?: boolean }
  | { readonly state: "refused"; readonly message: string };

function checksFrom(report: Report): readonly PreflightCheckWire[] {
  return report.results.map(check => ({
    id: check.check, label: check.check, verdict: check.status, detail: check.summary,
    blocks: check.status === "fail" ? check.blocks : [],
    ...(check.status === "pass" ? {} : { remediation: check.remediation }), checkedAt: report.checkedAt,
  }));
}

export function projectPreflight(state: PreflightReadinessWire | { state: "idle" } | { state: "running"; lastCompleted?: Report }, nowMs: number): PreflightRerunState {
  if (state.state === "idle") return { state: state.state };
  if (state.state === "running") {
    const report = state.lastCompleted;
    return report === undefined || report.results.length === 0 || Date.parse(report.checkedAt) > nowMs
      ? { state: "running" }
      : { state: "historical", message: "Checking current readiness…", report, checks: checksFrom(report), checking: true };
  }
  if (state.state === "unavailable") {
    const report = state.lastCompleted;
    if (report === undefined || report.results.length === 0 || Date.parse(report.checkedAt) > nowMs) return { state: "refused", message: state.reason };
    return { state: "historical", message: state.reason, report, checks: checksFrom(report) };
  }
  if (state.state !== "present") throw new Error("Unknown preflight presentation state");
  const report = state.report;
  // Current readiness expires at 60 seconds; an expired report can remain visible as history.
  const age = nowMs - Date.parse(report.checkedAt);
  if (report.results.length === 0 || age < 0) return { state: "refused", message: "Preflight report is stale or empty. Re-check readiness." };
  if (age >= 60_000) return { state: "historical", message: "Preflight evidence expired; re-check readiness.", report, checks: checksFrom(report) };
  return { state: "completed", report, checks: checksFrom(report) };
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
  useEffect(() => { if (document !== undefined) void read(); }, [document, read]);
  const checkedAt = readiness.state.state === "present" ? readiness.state.report.checkedAt : undefined;
  useEffect(() => {
    if (checkedAt === undefined) return;
    const remaining = Date.parse(checkedAt) + 60_000 - systemClock.nowMs();
    const timer = window.setTimeout(() => { void read(); }, remaining > 0 ? remaining : 60_000);
    return () => { window.clearTimeout(timer); };
  }, [checkedAt, read]);
  const projected = projectPreflight(readiness.state, systemClock.nowMs());
  const preflight: PreflightRerunState = document?.runtimeStatus.state === "restart-required"
    ? projected.state === "historical" ? { ...projected, message: "Settings restart required. Restart the runtime before re-checking." }
      : { state: "refused", message: "Settings restart required. Restart the runtime before re-checking." }
    : editor.state === "failed" ? { state: "refused", message: "Current settings are unavailable. Reload Settings before re-checking." }
    : projected;
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
