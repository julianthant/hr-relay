import { Terminal } from "lucide-react";
import { IconButton, Tooltip } from "../../ds/ui.js";
import { AddWorkers } from "./add-workers.js";
import { SESSIONS_CONSOLE_ID, useSessionsState } from "./sessions-context.js";

/** The sidebar footer's right end: the Sessions console toggle, dotted while workers wait or run, and Add workers. */
export function SessionRailControls({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data, addable, commands } = useSessionsState();
  const workers = data.state === "ready" ? data.workers : [];
  // Blue while any worker runs, green while workers only wait for runs.
  const dot = workers.some(worker => worker.state === "running") ? "running" : workers.some(worker => worker.state === "idle") ? "idle" : undefined;
  return <>
    <Tooltip side="right" content="Sessions console">
      <span className="relative inline-flex">
        <IconButton variant="ghost" size="sm" label="Sessions console" title="" aria-expanded={open} aria-controls={SESSIONS_CONSOLE_ID} onClick={() => onOpenChange(!open)} icon={<Terminal aria-hidden className="size-4" />} />
        {dot !== undefined && <span aria-hidden data-sessions-dot={dot} className="session-rail-dot" />}
      </span>
    </Tooltip>
    <AddWorkers data={data} workflows={addable} operations={commands.operations} onAdd={commands.add} onAdded={() => onOpenChange(true)} />
  </>;
}
