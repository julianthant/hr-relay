import { Badge } from "../../../../../src/dashboard/ds/ui.js";
import { FullDryRunPreview } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-sample.js";
import { LogsSurface } from "./control-surfaces.js";

export function ControlPreview() {
  const partial = new URLSearchParams(location.search).get("state") === "unavailable";
  return <LogsSurface queueLabel={partial ? "NEEDS YOU · 1" : "DONE · 1"} status={<><Badge tone="neutral">Dry run</Badge><Badge tone={partial ? "warning" : "success"}>{partial ? "Unavailable" : "Done"}</Badge></>}>
    <div className="mb-[var(--ds-space-section)] grid grid-cols-4 gap-2 text-caption"><span>● Read request</span><span>● Fill termination</span><span className="text-ui-muted">◌ Submit<span className="block">Not clicked</span></span><span>● Finalize in Kuali</span></div>
    <div className="mb-[var(--ds-space-section)] flex flex-col gap-[var(--ds-space-loose)]"><h3>09:12:40{"\u3000"} Submit <span className="text-ui-muted">· UCPath · not clicked in a dry run</span></h3>{!partial && <p className="text-caption text-ui-muted">09:12:41{"\u3000"} Transaction number{"\u3000"} <span className="font-mono text-ui-primary">SIM-48216</span>{"\u3000"}<Badge tone="neutral">Dry-run sample</Badge></p>}<h3>09:12:52{"\u3000"} Finalize in Kuali <span className="text-ui-muted">· {partial ? "unavailable" : "filled, not saved"}</span></h3></div>
    <FullDryRunPreview stages={[
      { id: "read", label: "Read request", state: "exercised", detail: "Person verified." },
      { id: "first", label: "Fill termination", state: "exercised", detail: "Fields filled and checked." },
      { id: "submit", label: "Submit", state: "exercised", detail: "Not clicked." },
      { id: "later", label: "Finalize in Kuali", state: partial ? "unavailable" : "exercised", detail: partial ? "This step could not be exercised." : "Filled, not saved.", ...(!partial ? { sample: { label: "Transaction number", value: "SIM-48216" } } : {}) },
      { id: "branch", label: "Optional branch", state: "skipped", detail: "Not applicable." },
    ]} />
  </LogsSurface>;
}
