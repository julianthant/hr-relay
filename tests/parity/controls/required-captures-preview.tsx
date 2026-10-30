import { useState } from "react";
import { Banner, Button, DsBodyScope, PageHeading, TooltipProvider, dsText, useDemoTheme } from "../../../src/dashboard/ds/ui.js";
import { RequiredCaptureStatus } from "../../../src/dashboard/surfaces/run-detail/logs/log-screenshots.js";
export function ControlPreview() {
  const { theme } = useDemoTheme();
  const [state, setState] = useState<"required" | "pre-submit-failed" | "post-submit-unknown" | "post-submit-proved">("required");
  return <div data-app-root data-demo-theme={theme}><TooltipProvider><DsBodyScope><main className={`ds-body-stack ${dsText.body}`} style={{ margin: "0 auto", maxWidth: 900, padding: "var(--ds-space-section)" }}>
    <Banner tone="info" title="UI mock">No browser capture or submit is attempted.</Banner><PageHeading title="Screenshots" description="Run options and Logs" /><RequiredCaptureStatus state={state} />
    <div className="flex gap-2">{(["required", "pre-submit-failed", "post-submit-unknown", "post-submit-proved"] as const).map(value => <Button key={value} variant="muted" onClick={() => setState(value)}>Show {value}</Button>)}</div>
  </main></DsBodyScope></TooltipProvider></div>;
}
