import { Badge } from "../../../../../src/dashboard/ds/ui.js";
import { LogScreenshots, RequiredCaptureStatus } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-screenshots.js";
import { LogsSurface } from "./control-surfaces.js";

export function ControlPreview() {
  const scenario = new URLSearchParams(location.search).get("state");
  const state = scenario === "pre-submit-failed" || scenario === "post-submit-proved" || scenario === "post-submit-unknown" ? scenario : "required";
  return <LogsSurface queueLabel={state === "required" || state === "post-submit-proved" ? "DONE · 1" : "NEEDS YOU · 1"} status={<Badge tone="neutral">{state === "post-submit-unknown" ? "Write parked" : state === "pre-submit-failed" ? "Stopped" : "Done"}</Badge>}>
    <h3 className="mb-[var(--ds-space-loose)] font-medium">09:00:02{"\u3000"} Submit termination <span className="text-ui-muted">· UCPath</span></h3>
    <div className="grid grid-cols-2 gap-[var(--ds-space-cozy)]"><section><h4 className="mb-2 text-caption text-ui-muted">Before submit</h4>{state === "pre-submit-failed" ? <RequiredCaptureStatus state={state} /> : <LogScreenshots screenshots={[{ src: "/logs-preview/ucpath-reason.svg", alt: "UCPath before submit", label: "Before submit", kind: "browser", time: "09:00:01", width: 850, height: 320 }]} />}</section><section><h4 className="mb-2 text-caption text-ui-muted">After submit</h4>{state === "required" ? <LogScreenshots screenshots={[{ src: "/logs-preview/ucpath-submitted.svg", alt: "UCPath after submit", label: "After submit", kind: "browser", time: "09:00:09", width: 850, height: 300 }]} /> : state === "pre-submit-failed" ? <div className="log-capture-unavailable">Not captured · submit was not clicked.</div> : <RequiredCaptureStatus state={state} />}</section></div>
    {state === "post-submit-proved" && <p className="mt-[var(--ds-space-section)]">09:00:09{"\u3000"} Confirmed in UCPath{"\u3000"} <span className="font-mono">00481024</span>{"\u3000"}<Badge tone="success">Proved</Badge></p>}
  </LogsSurface>;
}
