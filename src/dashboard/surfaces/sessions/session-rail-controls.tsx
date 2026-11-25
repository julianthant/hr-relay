import { useEffect, useRef } from "react";
import { SquareTerminal } from "lucide-react";
import { IconButton, Tooltip } from "../../ds/ui.js";
import { AddWorkers } from "./add-workers.js";
import { SESSIONS_CONSOLE_ID, useSessionsState } from "./sessions-context.js";
import type { SessionsViewState } from "./sessions-view-model.js";
import "./sessions.css";

/** The Sessions console toggle, dotted while workers wait or run; opening from here moves focus into the console. */
export function ConsoleToggle({ data, open, onOpenChange }: { data: SessionsViewState; open: boolean; onOpenChange: (open: boolean) => void }) {
  const workers = data.state === "ready" ? data.workers : [];
  // Blue while any worker runs, green while workers only wait for runs.
  const dot = workers.some(worker => worker.state === "running") ? "running" : workers.some(worker => worker.state === "idle") ? "idle" : undefined;
  // Only a click here moves focus: a console restored from the URL or opened by Add workers leaves it alone.
  const focusOnOpen = useRef(false);
  useEffect(() => {
    if (!open || !focusOnOpen.current) return;
    focusOnOpen.current = false;
    document.getElementById(SESSIONS_CONSOLE_ID)?.focus({ preventScroll: true });
  }, [open]);
  return <Tooltip side="right" content="Sessions console">
    <span className="relative inline-flex">
      <IconButton variant="ghost" size="sm" label="Sessions console" title="" aria-expanded={open} aria-controls={SESSIONS_CONSOLE_ID} onClick={() => { focusOnOpen.current = !open; onOpenChange(!open); }} icon={<SquareTerminal aria-hidden className="size-4" />} />
      {dot !== undefined && <span aria-hidden data-sessions-dot={dot} className="session-rail-dot" />}
    </span>
  </Tooltip>;
}

/** The sidebar footer's right end: the Sessions console toggle and Add workers. */
export function SessionRailControls({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { data, addable, commands } = useSessionsState();
  return <>
    <ConsoleToggle data={data} open={open} onOpenChange={onOpenChange} />
    <AddWorkers data={data} workflows={addable} operations={commands.operations} onAdd={commands.add} onAdded={() => onOpenChange(true)} />
  </>;
}
