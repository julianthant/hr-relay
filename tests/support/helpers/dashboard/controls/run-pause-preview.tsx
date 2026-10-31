import { useEffect, useState } from "react";
import { Pause } from "lucide-react";
import { Badge } from "../../../../../src/dashboard/ds/ui.js";
import { RunPauseControl, PauseAllQuitControls } from "../../../../../src/dashboard/surfaces/queue/queue-toolbar.js";
import { LogsSurface } from "./control-surfaces.js";

export function ControlPreview() {
  const scenario = new URLSearchParams(location.search).get("state");
  const [request, setRequest] = useState<"pause-pending" | "resume-pending">();
  const [pauseAll, setPauseAll] = useState(false);
  const [quitRequested, setQuitRequested] = useState(scenario === "quit-confirmation");
  useEffect(() => {
    const quit = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "q") { event.preventDefault(); setQuitRequested(true); } };
    window.addEventListener("keydown", quit);
    return () => window.removeEventListener("keydown", quit);
  }, []);
  const state = request ?? (scenario === "paused" || scenario === "all-paused" ? "paused" : scenario === "pause-pending" || scenario === "pausing" ? "pause-pending" : scenario === "resume-pending" ? "resume-pending" : scenario === "unavailable" ? "unavailable" : "running");
  const all = pauseAll || scenario === "pausing" ? "pausing" : scenario === "all-paused" ? "paused" : scenario === "closure-unknown" ? "blocked" : scenario === "all-unavailable" ? "unavailable" : "ready";
  const pause = () => { setRequest("pause-pending"); setPauseAll(true); };
  return <LogsSurface title="Alex Morgan" queueLabel="ACTIVE · 2" status={<Badge tone="neutral" className="border-ui-stroke-control bg-transparent">{state === "paused" && <Pause aria-hidden className="size-3" />}{state === "paused" ? "Paused" : state === "pause-pending" ? "Pausing" : state === "resume-pending" ? "Resuming" : state === "unavailable" ? "Pause unavailable" : "Running"}</Badge>} toolbar={<RunPauseControl runLabel="Alex Morgan" state={state} onAction={action => setRequest(action === "pause" ? "pause-pending" : "resume-pending")} />} queueControls={<PauseAllQuitControls state={all} activeCount={2} quitRequested={quitRequested} onQuitDismiss={() => setQuitRequested(false)} runs={[{ label: "Alex Morgan", detail: "Person Lookup · Verify employee", id: "PL04236388" }, { label: "EID 10777012", detail: "Separations · Submit termination", id: "SP99300911" }]} onPauseAll={pause} onPauseAndQuit={pause} />}
    timeline={[{ id: "read", label: "Read request", state: "completed", durationLabel: "14s", substeps: [] }, { id: "verify", label: "Verify employee", state: state === "paused" ? "waiting" : "active", statusLabel: state === "paused" ? "Paused after this step" : state === "pause-pending" ? "Pauses after this step" : "In progress", stepId: "verify", substeps: [] }, { id: "timecard", label: "Read timecard", state: "pending", substeps: [] }, { id: "result", label: "Record result", state: "pending", substeps: [] }]}
    steps={[{ id: "verify", title: "Verify employee", time: "09:31:00", system: "UCPath", entries: [{ id: "search", kind: "note", time: "09:31:04", message: "Search by EID 10773012" }, { id: "record", kind: "note", time: "09:31:09", message: "Read job record" }, ...(all === "ready" ? [] : [{ id: "pause-state", kind: "note" as const, time: "09:31:10", message: all === "pausing" ? "Finishing current steps; pauses and shutdown are not yet confirmed." : all === "paused" ? "All runs paused. Resume them next time." : all === "blocked" ? "Closure is unknown. Keep Relay open and check active runs." : "Pause all is unavailable. Check the connection." }])] }]} />;
}
