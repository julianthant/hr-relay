
import { useState } from "react";
import { systemClock } from "../../domain/clock.js";
import { usePreflightClient as useDashboardClient } from "../state/preflight-client.js";
import type { EditableSettingsState } from "./settings-editor-model.js";
import type { PreflightCheckWire } from "./settings-model.js";
export function useSettingsPreflight(editor: EditableSettingsState, input: { actorId: string; descriptorFingerprint: string }) {
  const client = useDashboardClient();
  const [preflight, setPreflight] = useState<PreflightRerunState>({ state: "idle" });
  const rerunPreflight = (): void => {
    if (editor.state !== "loaded") return;
    if (editor.document.runtimeStatus.state === "restart-required") {
      setPreflight({ state: "refused", message: "Restart is required before rerunning preflight; the current runtime still has the previous settings." });
      return;
    }
    setPreflight({ state: "running" });
    client.rerunPreflight({
      commandId: crypto.randomUUID(),
      requestedAt: systemClock.now().toISOString(),
      requestedBy: input.actorId,
      source: "settings-surface",
      type: "rerun-preflight",
      target: {
        expectedConfigFingerprint: editor.document.activeConfigFingerprint,
        expectedDescriptorFingerprint: input.descriptorFingerprint,
      },
    }).then(
      (result) => setPreflight({
        state: "completed",
        checks: result.report.results.map((check) => ({
          id: check.check,
          label: check.check,
          verdict: check.status === "pass" ? "pass" : check.status,
          detail: check.summary,
          blocks: check.status === "fail" ? check.blocks : [],
          ...(check.status === "pass" ? {} : { remediation: check.status === "warning" ? check.remediation : check.remediation }),
          checkedAt: result.report.checkedAt,
        })),
      }),
      (caught: unknown) => setPreflight({ state: "refused", message: caught instanceof Error ? caught.message : String(caught) }),
    );
  };
  return { preflight, rerunPreflight };
}




export type PreflightRerunState =
  | { readonly state: "idle" }
  | { readonly state: "running" }
  | { readonly state: "completed"; readonly checks: readonly PreflightCheckWire[] }
  | { readonly state: "refused"; readonly message: string };
