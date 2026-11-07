import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { useEffect } from "react";
import { systemClock } from "../../../../rules/time/clock.js";
import type { PreflightReadinessWire } from "../../../../models/preflight/preflight-contract.js";
import type { PreflightReadinessState } from "../../../client/queries/preflight-state.js";
import { useDashboardCommandBinding } from "../../../state/client-context.js";
import { usePreflightReadiness } from "./preflight-readiness.js";
import { usePreflightScope } from "./preflight-client.js";
import type { EditableSettingsState } from "../editor/settings-editor-model.js";
import type { PreflightCheckWire } from "../settings-model.js";

type Report = Extract<PreflightReadinessWire, { state: "present" }>["report"];
export type PreflightRerunState =
  | { readonly state: "idle" | "running" }
  | { readonly state: "completed"; readonly checks: readonly PreflightCheckWire[]; readonly report: Report }
  | { readonly state: "historical"; readonly checks: readonly PreflightCheckWire[]; readonly report: Report; readonly message: string }
  | { readonly state: "refreshing"; readonly checks: readonly PreflightCheckWire[]; readonly report: Report; readonly previousMessage?: string }
  | { readonly state: "refused"; readonly message: string };

function checksFrom(report: Report): readonly PreflightCheckWire[] {
  return report.results.map(check => ({
    id: check.check, label: check.check, verdict: check.status, detail: check.summary,
    blocks: check.status === "fail" ? check.blocks : [],
    ...(check.status === "pass" ? {} : { remediation: check.remediation }), checkedAt: report.checkedAt,
  }));
}

export function projectPreflight(state: PreflightReadinessState, nowMs: number): PreflightRerunState {
  if (state.state === "idle") return { state: state.state };
  if (state.state === "running") {
    const report = state.lastCompleted;
    if (report === undefined || report.results.length === 0 || Date.parse(report.checkedAt) > nowMs) return { state: "running" };
    const previous = projectPreflight(state.previous ?? { state: "present", report }, nowMs);
    return { state: "refreshing", report, checks: checksFrom(report),
      ...(previous.state === "historical" ? { previousMessage: previous.message } : {}) };
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
  if (report.results.length === 0 || age < 0) return { state: "refused", message: ERROR_CATALOG.PREFLIGHT_REPORT_INVALID.text };
  if (age >= 60_000) return { state: "historical", message: ERROR_CATALOG.PREFLIGHT_EVIDENCE_EXPIRED.text, report, checks: checksFrom(report) };
  return { state: "completed", report, checks: checksFrom(report) };
}
export function useSettingsPreflight(editor: EditableSettingsState, input: { actorId: string; descriptorFingerprint: string }) {
  const scope = usePreflightScope();
  const binding = useDashboardCommandBinding();
  const nowMs = binding === undefined ? systemClock.nowMs() : Date.parse(binding.authority.nowIso);
  const document = editor.state === "loaded" ? editor.document : undefined;
  const descriptorFingerprint = scope.workflow?.descriptorFingerprint ?? input.descriptorFingerprint;
  const readiness = usePreflightReadiness({
    actorId: input.actorId, selectedScope: scope.selected,
    configFingerprint: document?.activeConfigFingerprint ?? "unavailable", descriptorFingerprint,
    ...(scope.workflow === undefined ? {} : { selection: { workflowId: scope.workflow.id } }),
    settingsRevision: JSON.stringify([scope.selected, scope.state, document === undefined ? editor.state : [document.revision, document.runtimeStatus, document.protectedSettings.state === "available" ? document.protectedSettings.readback.revision : "unavailable"]]),
  }, document === undefined || scope.state !== "ready");
  const ready = document !== undefined && document.runtimeStatus.state === "current" && scope.state === "ready";
  const read = readiness.read;
  useEffect(() => { if (document !== undefined && scope.state === "ready") void read(); }, [document, read, scope.state]);
  const checkedAt = readiness.state.state === "present" ? readiness.state.report.checkedAt : undefined;
  useEffect(() => {
    if (checkedAt === undefined) return;
    const remaining = Date.parse(checkedAt) + 60_000 - nowMs;
    const timer = window.setTimeout(() => { void read(); }, remaining > 0 ? remaining : 60_000);
    return () => { window.clearTimeout(timer); };
  }, [checkedAt, read, nowMs]);
  const projected = projectPreflight(readiness.state, nowMs);
  const preflight: PreflightRerunState = scope.state === "unavailable"
    ? { state: "refused", message: ERROR_CATALOG.PREFLIGHT_SCOPE_UNAVAILABLE.text }
    : scope.state !== "ready" ? { state: "idle" }
    : document?.runtimeStatus.state === "restart-required"
    ? projected.state === "historical" ? { ...projected, message: ERROR_CATALOG.PREFLIGHT_SETTINGS_RESTART_REQUIRED.text }
      : { state: "refused", message: ERROR_CATALOG.PREFLIGHT_SETTINGS_RESTART_REQUIRED.text }
    : editor.state === "failed" ? { state: "refused", message: ERROR_CATALOG.PREFLIGHT_SETTINGS_UNAVAILABLE.text }
    : projected;
  const rerunPreflight = (): void => {
    if (!ready || document === undefined) return;
    void readiness.rerun({
      commandId: crypto.randomUUID(), requestedAt: new Date(nowMs).toISOString(), requestedBy: input.actorId,
      source: "settings-surface", type: "rerun-preflight",
      target: { expectedConfigFingerprint: document.activeConfigFingerprint, expectedDescriptorFingerprint: descriptorFingerprint,
        ...(scope.workflow === undefined ? {} : { selection: { workflowId: scope.workflow.id } }) },
    });
  };
  return { preflight, rerunPreflight };
}
