import { Badge } from "../../../../../src/dashboard/ds/ui.js";
import { FullDryRunPreview } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-sample.js";
import { LogsSurface } from "./control-surfaces.js";

export function ControlPreview() {
  const partial = new URLSearchParams(location.search).get("state") === "unavailable";
  return <LogsSurface queueLabel={partial ? "NEEDS YOU · 1" : "DONE · 1"} status={<><Badge tone="neutral">Dry run</Badge><Badge tone={partial ? "warning" : "success"}>{partial ? "Unavailable" : "Done"}</Badge></>}
    timeline={[{ id: "read", label: "Read request", state: "completed", substeps: [] }, { id: "fill", label: "Fill termination", state: "completed", substeps: [] }, { id: "submit", label: "Submit", state: "skipped", statusLabel: "Not clicked", stepId: "submit", substeps: [] }, { id: "finalize", label: "Finalize in Kuali", state: partial ? "failed" : "completed", stepId: "finalize", substeps: [] }]}
    steps={[{ id: "submit", time: "09:12:40", title: "Submit", system: "UCPath", entries: [{ id: "not-clicked", kind: "note", time: "09:12:40", message: "Not clicked in a dry run." }] }, { id: "finalize", time: "09:12:52", title: "Finalize in Kuali", system: "Kuali", entries: [{ id: "finalized", kind: "note", time: "09:12:52", message: partial ? "Unavailable; this step could not be exercised." : "Filled, not saved." }] }]}>
    <FullDryRunPreview facts={[{ label: "Person verified", value: "Rivera, Alex · 10777012" }, { label: "Fields filled and checked", value: "14" }, ...(!partial ? [{ label: "Transaction number", value: "SIM-48216", sample: true }] : [])]} stages={[
      { id: "read", label: "Read request", state: "exercised", detail: "Person verified." },
      { id: "fill", label: "Fill termination", state: "exercised", detail: "Fields filled and checked." },
      { id: "submit", label: "Submit", state: "not-clicked", detail: "No submit was clicked." },
      { id: "later", label: "Finalize in Kuali", state: partial ? "unavailable" : "exercised", detail: partial ? "This step could not be exercised." : "Filled, not saved." },
      { id: "branch", label: "Optional branch", state: "skipped", detail: "Not applicable." },
    ]} />
  </LogsSurface>;
}
