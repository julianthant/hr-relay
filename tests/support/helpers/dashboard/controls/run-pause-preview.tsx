import { useEffect, useState } from "react";
import { Pause } from "lucide-react";
import { Badge } from "../../../../../src/dashboard/ds/ui.js";
import { RunPauseControl, PauseAllQuitControls } from "../../../../../src/dashboard/surfaces/queue/queue-toolbar.js";
import { PAUSE_ALL_PENDING_STATUS, stepInterruptLabel } from "../../../../../src/dashboard/surfaces/shared/status/status-model.js";
import { LogsSurface } from "./control-surfaces.js";

export function ControlPreview() {
  const scenario = new URLSearchParams(location.search).get("state");
  const [request, setRequest] = useState<"pause-pending">();
  const [pauseAll, setPauseAll] = useState(false);
  const [quitRequested, setQuitRequested] = useState(scenario === "quit-confirmation");
  useEffect(() => {
    const quit = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "q") { event.preventDefault(); setQuitRequested(true); } };
    window.addEventListener("keydown", quit);
    return () => window.removeEventListener("keydown", quit);
  }, []);
  const state = request ?? (scenario === "paused" || scenario === "all-paused" ? "paused" : scenario === "pause-pending" || scenario === "pausing" ? "pause-pending" : scenario === "unavailable" ? "unavailable" : "running");
  const all = pauseAll || scenario === "pausing" ? "pausing" : scenario === "all-paused" ? "paused" : scenario === "all-unavailable" ? "unavailable" : "ready";
  const interrupt = state !== "pause-pending" ? undefined : scenario === "pausing" ? { action: "pause" as const, step: "finish-write" as const } : { action: "pause" as const, step: "cancel" as const };
  const stepLabel = state === "paused" ? "Pause recorded. Resume to continue." : stepInterruptLabel(interrupt) ?? "In progress";
  const pause = () => { setRequest("pause-pending"); setPauseAll(true); };
  return <LogsSurface title="Alex Morgan" queueLabel="ACTIVE · 2" status={<Badge tone="neutral" className="border-ui-stroke-control bg-transparent">{state === "paused" && <Pause aria-hidden className="size-3" />}{state === "paused" ? "Paused" : state === "pause-pending" ? "Pausing" : state === "unavailable" ? "Pause unavailable" : "Running"}</Badge>} toolbar={<RunPauseControl runLabel="Alex Morgan" state={state} {...(state === "running" ? { command: "pause" as const } : state === "paused" ? { command: "resume" as const } : {})} interrupt={interrupt} onAction={action => setRequest(action === "pause" ? "pause-pending" : undefined)} />} queueControls={<PauseAllQuitControls state={all} activeCount={2} quitRequested={quitRequested} onQuitDismiss={() => setQuitRequested(false)} onPauseAll={pause} onPauseAndQuit={pause} />}
    timeline={[{ id: "read", label: "Read request", state: "completed", durationLabel: "14s", substeps: [] }, { id: "verify", label: "Verify employee", state: state === "paused" ? "waiting" : "active", statusLabel: stepLabel, stepId: "verify", substeps: [] }, { id: "timecard", label: "Read timecard", state: "pending", substeps: [] }, { id: "result", label: "Record result", state: "pending", substeps: [] }]}
    steps={[{ id: "verify", title: "Verify employee", time: "09:31:00", system: "UCPath", entries: [{ id: "search", kind: "note", time: "09:31:04", message: "Search by EID 10777012" }, { id: "record", kind: "note", time: "09:31:09", message: "Read job record" }, ...(all === "ready" ? [] : [{ id: "pause-state", kind: "note" as const, time: "09:31:10", message: all === "pausing" ? PAUSE_ALL_PENDING_STATUS : all === "paused" ? "All runs paused. Resume them next time." : "Pause all is unavailable. Check the connection." }])] }]} />;
}
