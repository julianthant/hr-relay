import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { ClearRunHistoryRequestSchema, RUN_HISTORY_REFUSALS, type ClearRunHistoryRequest, type ClearRunHistoryResult, type RunHistoryStatus } from "../../../../models/dashboard/run-history.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { useDashboardClient, useDashboardCommandBinding } from "../../../state/client-context.js";
import { SettingsReadSuperseded, useSettingsRead } from "../../../state/settings-read-model.js";
import { beforeEffectRefusal } from "../../../app/commands/command-result.js";

type HistoryAction = { state: "pending"; checking: boolean; request: ClearRunHistoryRequest }
  | { state: "unknown"; request: ClearRunHistoryRequest }
  | { state: "settled"; result: ClearRunHistoryResult }
  | { state: "failed" };

export function useRunHistory(onCleared?: () => void) {
  const client = useDashboardClient();
  const binding = useDashboardCommandBinding();
  const status = useSettingsRead<RunHistoryStatus>(client, "run-history");
  const action = useSettingsRead<HistoryAction>(client, "clear-run-history");
  const read = useSyncExternalStore(status.subscribe, status.snapshot, status.snapshot);
  const operation = useSyncExternalStore(action.subscribe, action.snapshot, action.snapshot).value;
  const current = useRef({ action, binding, onCleared });
  current.current = { action, binding, onCleared };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const reload = useCallback(() => status.read(() => client.runHistoryStatus(), "STORAGE_AUTHORITY_READ_FAILED").catch((error: unknown) => {
    const retained = status.snapshot();
    if (error instanceof SettingsReadSuperseded) return retained;
    if (retained.state === "failed" && retained.error === error) return retained;
    throw error;
  }), [client, status]);
  const day = binding?.authority.dayState.day;
  const target = binding?.authority.profileTarget;
  useEffect(() => { void reload(); }, [reload, day]);
  const prepare = useCallback(() => target === undefined ? undefined : ClearRunHistoryRequestSchema.parse({ commandId: crypto.randomUUID(), target }), [target]);
  const clear = useCallback(async (confirmed?: ClearRunHistoryRequest) => {
    const previous = action.snapshot().value;
    if (previous?.state === "pending") return;
    const checking = previous?.state === "unknown";
    const request = previous?.state === "unknown" ? previous.request : confirmed;
    if (request === undefined) { action.accept({ state: "failed" }); return; }
    action.accept({ state: "pending", checking, request });
    try {
      const result = await (checking ? client.checkClearRunHistoryResult(request) : client.clearRunHistory(request));
      if (current.current.action !== action) return;
      action.accept({ state: "settled", result });
      if (result.state === "cleared" && mounted.current) {
        current.current.binding?.authority.dayState.refresh();
        current.current.onCleared?.();
      }
      void reload();
    } catch (error) {
      if (current.current.action !== action) return;
      action.accept(!checking && beforeEffectRefusal(error) ? { state: "failed" } : { state: "unknown", request });
    }
  }, [action, client, reload]);
  const available = read.state === "loaded" && read.value.state === "available" ? read.value : undefined;
  const pending = operation?.state === "pending";
  const checking = operation?.state === "pending" && operation.checking;
  const unknown = operation?.state === "unknown";
  const message = checking ? "Checking the recorded clear result…" : pending ? "Clearing run history; cleanup is not complete."
    : unknown ? ERROR_CATALOG.COMMAND_OUTCOME_UNCERTAIN.text
    : operation?.state === "failed" ? ERROR_CATALOG.COMMAND_DISPATCH_FAILED.text
    : operation?.state === "settled" ? operation.result.state === "not-recorded"
      ? "This clear action was not recorded. Review history and confirm Clear run history again to start a new action."
      : operation.result.state === "cleared"
      ? `${operation.result.deletedRuns} finished runs cleared.` : RUN_HISTORY_REFUSALS[operation.result.reason]
    : undefined;
  return { prepare, clear, pending, checking, unknown, message,
    disabled: target === undefined || pending || (!unknown && (available === undefined || available.activeRuns > 0 || available.finishedRuns === 0)),
    description: read.state === "failed" ? ERROR_CATALOG.STORAGE_AUTHORITY_READ_FAILED.text
      : available === undefined ? "Run history is unavailable. Refresh Storage to check again."
      : available.activeRuns > 0 ? RUN_HISTORY_REFUSALS["active-runs"]
      : available.finishedRuns === 0 ? "No finished runs to clear."
      : "Remove all finished runs, logs, screenshots and run evidence. Spreadsheets, settings, credentials and your account are kept.",
  };
}
