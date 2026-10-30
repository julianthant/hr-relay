import { useState } from "react";
import { Banner, Button, DsBodyScope, PageHeading, TooltipProvider, dsText, useDemoTheme } from "../../../../../src/dashboard/ds/ui.js";
import { RunPauseControl, PauseAllQuitControls } from "../../../../../src/dashboard/surfaces/queue/queue-toolbar.js";

export function ControlPreview() {
  const { theme } = useDemoTheme();
  const [state, setState] = useState<"running" | "pause-pending" | "paused" | "resume-pending" | "unavailable">("running");
  const [all, setAll] = useState<"ready" | "pausing" | "paused" | "blocked" | "unavailable">("ready");
  return <div data-app-root data-demo-theme={theme}><TooltipProvider><DsBodyScope><main className={`ds-body-stack ${dsText.body}`} style={{ margin: "0 auto", maxWidth: 800, padding: "var(--ds-space-section)" }}>
    <Banner tone="info" title="UI mock">No run or shutdown commands are dispatched.</Banner><PageHeading title="Run controls" description="Example run · Person Lookup" />
    <RunPauseControl runLabel="Example run" state={state} onAction={action => setState(action === "pause" ? "pause-pending" : "resume-pending")} />
    <PauseAllQuitControls state={all} activeCount={2} onPauseAll={() => { setState("pause-pending"); setAll("pausing"); }} onPauseAndQuit={() => { setState("pause-pending"); setAll("pausing"); }} />
    <div className="flex flex-wrap gap-2">{(["running", "paused", "unavailable"] as const).map(value => <Button key={value} variant="muted" onClick={() => setState(value)}>Show {value}</Button>)}<Button variant="muted" onClick={() => setAll("blocked")}>Show closure unknown</Button><Button variant="muted" onClick={() => setAll("unavailable")}>Show all unavailable</Button><Button variant="muted" onClick={() => { setAll("paused"); setState("paused"); }}>Record mock pauses</Button></div>
  </main></DsBodyScope></TooltipProvider></div>;
}
