import type { QueueSurfaceWire } from "../../queue/queue-model.js";
import type { DashboardActionHandler } from "../../shared/actions/actions.js";

export type LogSelection = Readonly<{ row: QueueSurfaceWire; workflowLabel: string }>;

/** The Logs menu offers Rerun when the row serves a rerun action and the panel can dispatch it. */
export function rerunAction(selection: LogSelection | undefined, onAction?: DashboardActionHandler): { readonly label: string; readonly run: () => void } | undefined {
  const action = selection?.row.actions.find(candidate => candidate.kind === "navigation" && candidate.navigate.kind === "rerun");
  if (selection === undefined || action === undefined || onAction === undefined) return undefined;
  const target = { runId: selection.row.runId, expectedVersion: selection.row.rowRevision };
  return { label: action.label, run: () => onAction(action, target) };
}
