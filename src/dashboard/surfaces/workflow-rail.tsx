import { useCallback, useMemo } from "react";
import { activeCount, workflowCount, workflowStatusCounts, type WorkflowCountWire, type WorkflowBootstrapPrimitive } from "./shell-model.js";
import { WORKFLOW_RAIL_PREVIEWS, workflowNavigationGroups, workflowRailCategory } from "./workflow-rail-model.js";
import { WorkflowNavigation } from "./workflow-navigation.js";

export function WorkflowRail({ workflows, counts, previewCounts, active, preview, onSelect, onPreview }: {
  workflows: readonly WorkflowBootstrapPrimitive[]; counts?: readonly WorkflowCountWire[]; previewCounts?: readonly WorkflowCountWire[]; active: string; preview: string | null;
  onSelect: (id: string) => void; onPreview: (id: string) => void;
}) {
  const entries = useMemo(() => [...workflows.map(flow => ({ id: String(flow.id), label: flow.label, categoryId: workflowRailCategory(String(flow.id), flow.categoryId), role: flow.role, mock: false })),
    ...WORKFLOW_RAIL_PREVIEWS.filter(flow => !workflows.some(served => served.id === flow.id)).map(flow => ({ ...flow, categoryId: flow.category, role: { kind: "standalone" as const }, mock: true }))], [workflows]);
  const groups = useMemo(() => workflowNavigationGroups(entries), [entries]);
  const choose = useCallback((id: string) => entries.find(flow => flow.id === id)?.mock ? onPreview(id) : onSelect(id), [entries, onPreview, onSelect]);
  const metadata = useCallback((id: string) => {
    const flow = entries.find(flow => flow.id === id);
    if (!flow) return undefined;
    const source = flow.mock ? previewCounts : counts;
    return <span className="workflow-rail-meta ml-auto shrink-0 whitespace-nowrap text-caption tabular-nums text-ui-muted" aria-label={source ? `${activeCount(workflowStatusCounts(source, id))} active of ${workflowCount(source, id)} in ${flow.label}` : `Counts unavailable in ${flow.label}`} title={source ? "Active / all runs today" : "Counts unavailable"}>{source ? `${activeCount(workflowStatusCounts(source, id))} · ${workflowCount(source, id)}` : "…"}</span>;
  }, [entries, counts, previewCounts]);
  return <WorkflowNavigation label="Workflows" groups={groups} active={preview ?? active} onSelect={choose} metadata={metadata} />;
}
