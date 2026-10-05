import { useCallback, useMemo } from "react";
import { activeCount, workflowCount, workflowStatusCounts, type WorkflowCountWire, type WorkflowBootstrapPrimitive } from "./shell-model.js";
import { WORKFLOW_RAIL_PREVIEWS, workflowNavigationGroups, workflowRailCategory } from "./workflow-rail-model.js";
import { WorkflowNavigation } from "./workflow-navigation.js";

export function WorkflowRail({ workflows, counts, active, preview, onSelect, onPreview }: {
  workflows: readonly WorkflowBootstrapPrimitive[]; counts?: readonly WorkflowCountWire[]; active: string; preview: string | null;
  onSelect: (id: string) => void; onPreview: (id: string) => void;
}) {
  const entries = useMemo(() => [...workflows.map(flow => ({ id: String(flow.id), label: flow.label, categoryId: workflowRailCategory(String(flow.id), flow.categoryId), role: flow.role, mock: false })),
    ...WORKFLOW_RAIL_PREVIEWS.filter(flow => !workflows.some(served => served.id === flow.id)).map(flow => ({ ...flow, categoryId: flow.category, role: { kind: "standalone" as const }, mock: true }))], [workflows]);
  const groups = useMemo(() => workflowNavigationGroups(entries), [entries]);
  const choose = useCallback((id: string) => entries.find(flow => flow.id === id)?.mock ? onPreview(id) : onSelect(id), [entries, onPreview, onSelect]);
  const metadata = useCallback((id: string) => {
    const flow = entries.find(flow => flow.id === id);
    if (!flow || flow.mock) return undefined;
    return <span className="workflow-rail-meta ml-auto text-caption tabular-nums text-ui-muted" aria-label={counts ? `${activeCount(workflowStatusCounts(counts, id))} active of ${workflowCount(counts, id)} in ${flow.label}` : `Counts unavailable in ${flow.label}`} title={counts ? "Active / all runs today" : "Counts unavailable"}>{counts ? `${activeCount(workflowStatusCounts(counts, id))} · ${workflowCount(counts, id)}` : "…"}</span>;
  }, [entries, counts]);
  return <WorkflowNavigation label="Workflows" groups={groups} active={preview ?? active} onSelect={choose} metadata={metadata} />;
}
