import { useState } from "react";
import { Pause, Square } from "lucide-react";
import { ConfirmDialog } from "../../../ds/ui.js";
import type { DashboardActionHandler } from "../../shared/actions/actions.js";
import { queueRowTitle } from "../../queue/queue-model.js";
import { LogHeaderButton } from "./log-action-button.js";
import type { LogSelection } from "./log-selection-model.js";

/** A running batch member is paused or stopped from its own Logs, never from its queue row. Each shows only when the row serves it. */
export function MemberRunControls({ selection, onAction }: { selection: LogSelection; onAction?: DashboardActionHandler }) {
  const [confirming, setConfirming] = useState(false);
  const { row } = selection;
  if (row.parent === null || row.status !== "running") return null;
  const title = queueRowTitle(row);
  const target = { runId: row.runId, expectedVersion: row.rowRevision };
  const pause = row.actions.find(action => action.kind === "command" && action.command === "pause");
  const stop = row.actions.find(action => action.kind === "command" && action.command === "cancel");
  const run = (action: typeof pause) => { if (action !== undefined) void onAction?.(action, target); };
  return <>
    {pause !== undefined && <LogHeaderButton label={`Pause ${title}`} icon={<Pause aria-hidden className="size-4" />} onClick={() => run(pause)} />}
    {stop !== undefined && <LogHeaderButton label={`Stop ${title}`} icon={<Square aria-hidden className="size-4" />} onClick={() => setConfirming(true)} />}
    <ConfirmDialog open={confirming} onOpenChange={setConfirming} title={`Stop ${title}?`} description="It stops after the current step. Saved work stays." confirmLabel="Stop" destructive
      onConfirm={() => { setConfirming(false); run(stop); }} />
  </>;
}
