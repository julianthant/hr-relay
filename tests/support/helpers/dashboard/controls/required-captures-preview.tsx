import { Badge } from "../../../../../src/dashboard/ds/ui.js";
import { LogScreenshots, RequiredCaptureStatus } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-screenshots.js";
import { LogsSurface } from "./control-surfaces.js";

export function ControlPreview() {
  const scenario = new URLSearchParams(location.search).get("state");
  const state = scenario === "pre-submit-failed" || scenario === "post-submit-proved" || scenario === "post-submit-unknown" ? scenario : "required";
  return <LogsSurface queueLabel={state === "required" || state === "post-submit-proved" ? "DONE · 1" : "NEEDS YOU · 1"} status={<Badge tone="neutral">{state === "post-submit-unknown" ? "Write parked" : state === "pre-submit-failed" ? "Stopped" : "Done"}</Badge>}
    steps={[{ id: "submit", time: "09:00:02", title: "Submit termination", system: "UCPath", entries: state === "pre-submit-failed" ? [{ id: "stopped", kind: "note", time: "09:00:02", message: "Stopped before submit. No submit was clicked." }] : [{ id: "click", kind: "click", time: "09:00:02", label: "Submit termination" }] }]}>
    <div className="grid grid-cols-2 gap-[var(--ds-space-cozy)]">{state === "pre-submit-failed" ? <RequiredCaptureStatus state={state} /> : <LogScreenshots presentation="submit" screenshots={[{ src: "/logs-preview/ucpath-reason.svg", alt: "UCPath before submit", label: "Before submit", kind: "browser", time: "09:00:01", width: 850, height: 320 }]} />}{state === "required" ? <LogScreenshots presentation="submit" screenshots={[{ src: "/logs-preview/ucpath-submitted.svg", alt: "UCPath after submit", label: "After submit", kind: "browser", time: "09:00:09", width: 850, height: 300 }]} /> : <RequiredCaptureStatus state={state} position="After submit" />}</div>
    {state === "post-submit-proved" && <div className="mt-4 flex flex-wrap items-center gap-2 text-body"><time className="mr-2 font-data text-caption text-ui-muted">09:00:09</time><span>Confirmed in UCPath <span className="font-data text-ui-muted">00481024</span></span><Badge tone="success">Proved</Badge></div>}
  </LogsSurface>;
}
