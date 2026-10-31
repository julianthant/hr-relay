import { useState } from "react";
import { Badge } from "../../../../../src/dashboard/ds/ui.js";
import { RunPauseControl, PauseAllQuitControls } from "../../../../../src/dashboard/surfaces/queue/queue-toolbar.js";
import { LogsSurface } from "./control-surfaces.js";

export function ControlPreview() {
  const scenario = new URLSearchParams(location.search).get("state");
  const [request, setRequest] = useState<"pause-pending" | "resume-pending">();
  const [pauseAll, setPauseAll] = useState(false);
  const state = request ?? (scenario === "paused" || scenario === "all-paused" ? "paused" : scenario === "pause-pending" || scenario === "pausing" ? "pause-pending" : scenario === "resume-pending" ? "resume-pending" : scenario === "unavailable" ? "unavailable" : "running");
  const all = pauseAll || scenario === "pausing" ? "pausing" : scenario === "all-paused" ? "paused" : scenario === "closure-unknown" ? "blocked" : scenario === "all-unavailable" ? "unavailable" : "ready";
  const pause = () => { setRequest("pause-pending"); setPauseAll(true); };
  return <LogsSurface title="Alex Morgan" queueLabel="ACTIVE · 2" status={<Badge tone="neutral">{state === "paused" ? "Paused" : state === "pause-pending" ? "Pausing" : state === "resume-pending" ? "Resuming" : state === "unavailable" ? "Pause unavailable" : "Running"}</Badge>} toolbar={<RunPauseControl runLabel="Alex Morgan" state={state} onAction={action => setRequest(action === "pause" ? "pause-pending" : "resume-pending")} />} queueControls={<PauseAllQuitControls state={all} activeCount={2} runs={[{ label: "Alex Morgan", detail: "Person Lookup · Verify employee", id: "PL04236388" }, { label: "EID 10777012", detail: "Separations · Submit termination", id: "SP99300911" }]} onPauseAll={pause} onPauseAndQuit={pause} />}>
    <div className="mb-[var(--ds-space-section)] grid grid-cols-4 gap-2 text-caption"><span>● Read request <small className="block text-ui-muted">14s</small></span><span>◌ Verify employee<small className="block text-ui-muted">{state === "pause-pending" ? "Pauses after this step" : state === "paused" ? "Paused after this step" : "In progress"}</small></span><span className="text-ui-muted">○ Read timecard</span><span className="text-ui-muted">○ Record result</span></div>
    <div className="log-step"><h3>09:31:00{"\u3000"} Verify employee <span className="text-ui-muted">· UCPath</span></h3><p className="mt-4 text-caption text-ui-muted">09:31:04{"\u3000"} Search by EID{"\u3000"} <span className="font-mono text-ui-primary">10773012</span></p><p className="mt-4 text-caption text-ui-muted">09:31:09{"\u3000"} Read job record</p></div>
  </LogsSurface>;
}
