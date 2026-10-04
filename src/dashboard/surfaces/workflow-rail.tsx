import { Workflow } from "lucide-react";
import { dsFocus } from "../ds/ui.js";
import { activeCount, workflowCount, workflowStatusCounts, type WorkflowCountWire, type WorkflowBootstrapPrimitive } from "./shell-model.js";
import { WORKFLOW_RAIL_PREVIEWS } from "./workflow-rail-model.js";

export function WorkflowRail({ workflows, counts, active, preview, onSelect, onPreview }: {
  workflows: readonly WorkflowBootstrapPrimitive[]; counts?: readonly WorkflowCountWire[]; active: string; preview: string | null;
  onSelect: (id: string) => void; onPreview: (id: string) => void;
}) {
  const entries = [...workflows.map(flow => ({ id: String(flow.id), label: flow.label, category: WORKFLOW_RAIL_PREVIEWS.find(preview => preview.id === flow.id)?.category ?? flow.categoryId, mock: false })),
    ...WORKFLOW_RAIL_PREVIEWS.filter(flow => !workflows.some(served => served.id === flow.id)).map(flow => ({ ...flow, mock: true }))];
  const groups = [...new Set(entries.map(flow => flow.category))];
  return <nav aria-label="Workflows" className="workflow-rail">
    <h2>Workflows</h2>
    <div className="workflow-rail-groups">{groups.map(group => <div key={group} className="workflow-rail-group"><h3>{group}</h3>
      {entries.filter(flow => flow.category === group).map(flow => <button key={flow.id} type="button"
        aria-current={(preview ?? active) === flow.id ? "page" : undefined}
        aria-label={`${flow.label}${flow.mock ? " · layout preview" : ""}`} className={dsFocus}
        onClick={() => flow.mock ? onPreview(flow.id) : onSelect(flow.id)}>
        <Workflow aria-hidden className="size-3.5 shrink-0" /><span className="truncate">{flow.label}</span>
        {!flow.mock && <span className="ml-auto text-caption tabular-nums text-ui-muted" aria-label={counts ? `${activeCount(workflowStatusCounts(counts, flow.id))} active of ${workflowCount(counts, flow.id)} in ${flow.label}` : `Counts unavailable in ${flow.label}`} title={counts ? "Active / all runs today" : "Counts unavailable"}>{counts ? `${activeCount(workflowStatusCounts(counts, flow.id))} · ${workflowCount(counts, flow.id)}` : "…"}</span>}
        {flow.mock && <span className="ml-auto text-[10px] text-ui-muted">Preview</span>}
      </button>)}
    </div>)}</div>
  </nav>;
}
