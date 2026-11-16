import { useState } from "react";
import { Pause, Square } from "lucide-react";
import { ConfirmDialog } from "../../../ds/ui.js";
import type { DashboardActionHandler } from "../../shared/actions/actions.js";
import { queueRowTitle } from "../../queue/queue-model.js";
import { LogFooterButton } from "./log-action-button.js";
import type { LogSelection } from "./log-selection-model.js";

/** A running batch member is paused or stopped from its own Logs, never from its queue row. The preview shows both; served Logs show each only when the row serves it. */
export function MemberRunControls({ selection, onAction, preview = false }: { selection: LogSelection; onAction?: DashboardActionHandler; preview?: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const { row } = selection;
  if (row.parent === null || row.status !== "running") return null;
  const title = queueRowTitle(row);
  const target = { runId: row.runId, expectedVersion: row.rowRevision };
  const pause = row.actions.find(action => action.kind === "command" && action.command === "pause");
  const stop = row.actions.find(action => action.kind === "command" && action.command === "cancel");
  const run = (action: typeof pause) => { if (action !== undefined) onAction?.(action, target); };
  return <>
    {(preview || pause !== undefined) && <LogFooterButton label={`Pause ${title}`} icon={<Pause aria-hidden className="size-4" />} onClick={() => run(pause)} />}
    {(preview || stop !== undefined) && <LogFooterButton label={`Stop ${title}`} icon={<Square aria-hidden className="size-4" />} onClick={() => setConfirming(true)} />}
    <ConfirmDialog open={confirming} onOpenChange={setConfirming} title={`Stop ${title}?`} description="Relay stops this run after its current step. Nothing already saved is undone." confirmLabel="Stop" destructive
      onConfirm={() => { setConfirming(false); run(stop); }} />
  </>;
}
