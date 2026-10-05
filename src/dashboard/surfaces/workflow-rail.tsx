import { useCallback, useMemo } from "react";
import { activeCount, workflowCount, workflowStatusCounts, type WorkflowCountWire } from "./shell-model.js";
import { workflowNavigationGroups } from "./workflow-rail-model.js";
import type { WorkflowCatalogEntry } from "./workflow-catalog-model.js";
import { WorkflowNavigation } from "./workflow-navigation.js";

export function WorkflowRail({ workflows, counts, previewCounts, active, preview, onSelect, onPreview }: {
  workflows: readonly WorkflowCatalogEntry[]; counts?: readonly WorkflowCountWire[]; previewCounts?: readonly WorkflowCountWire[]; active: string; preview: string | null;
  onSelect: (id: string) => void; onPreview: (id: string) => void;
}) {
  const entries = workflows;
  const groups = useMemo(() => workflowNavigationGroups(entries), [entries]);
  const choose = useCallback((id: string) => entries.find(flow => flow.id === id)?.source === "preview" ? onPreview(id) : onSelect(id), [entries, onPreview, onSelect]);
  const metadata = useCallback((id: string) => {
    const flow = entries.find(flow => flow.id === id);
    if (!flow) return undefined;
    const source = flow.source === "preview" ? previewCounts : counts;
    return <span className="workflow-rail-meta ml-auto shrink-0 whitespace-nowrap text-caption tabular-nums text-ui-muted" aria-label={source ? `${activeCount(workflowStatusCounts(source, id))} active of ${workflowCount(source, id)} in ${flow.label}` : `Counts unavailable in ${flow.label}`} title={source ? "Active / all runs today" : "Counts unavailable"}>{source ? `${activeCount(workflowStatusCounts(source, id))} · ${workflowCount(source, id)}` : "…"}</span>;
  }, [entries, counts, previewCounts]);
  return <WorkflowNavigation label="Workflows" groups={groups} active={preview ?? active} onSelect={choose} metadata={metadata} />;
}
