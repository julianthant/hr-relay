import { useState } from "react";
import { Banner, Button, DsBodyScope, PageHeading, TooltipProvider, dsText, useDemoTheme } from "../../../src/dashboard/ds/ui.js";
import { FullDryRunPreview } from "../../../src/dashboard/surfaces/run-detail/logs/log-sample.js";

export function ControlPreview() {
  const { theme } = useDemoTheme();
  const [partial, setPartial] = useState(false);
  return <div data-app-root data-demo-theme={theme}><TooltipProvider><DsBodyScope><main className={`ds-body-stack ${dsText.body}`} style={{ margin: "0 auto", maxWidth: 1000, padding: "var(--ds-space-section)" }}>
    <Banner tone="info" title="UI mock">Synthetic preview accounting. No workflow is executed.</Banner><PageHeading title="Logs" description="Separation · Dry run" />
    <FullDryRunPreview stages={[
      { id: "read", label: "Read person", state: "exercised", detail: "Read and verify the intended person." },
      { id: "first", label: "Separation transaction", state: "exercised", detail: "Read, fill, verify, and capture. Submit was not clicked." },
      { id: "later", label: "Dependent transaction", state: partial ? "unavailable" : "exercised", detail: partial ? "This stage could not be exercised; no completion is claimed." : "Filled and captured using a preview-only dependency.", ...(!partial ? { sample: { label: "Prior transaction number", value: "DRY-RUN-SAMPLE-0001" } } : {}) },
      { id: "branch", label: "Optional branch", state: "skipped", detail: "Not applicable to this example." },
    ]} />
    <Button variant="muted" onClick={() => setPartial(!partial)}>{partial ? "Show full preview" : "Show unavailable stage"}</Button>
  </main></DsBodyScope></TooltipProvider></div>;
}
