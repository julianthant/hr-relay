import { useCallback, useMemo } from "react";
import { activeCount, workflowCount, workflowStatusCounts, type WorkflowCountWire } from "./shell-model.js";
import { workflowNavigationGroups } from "./workflow-rail-model.js";
import type { WorkflowCatalogEntry } from "../workflows/workflow-catalog-model.js";
import { WorkflowNavigation } from "./workflow-navigation.js";
import { MOCK_RAIL_RUNNING, railVariant } from "../run-detail/decision-mock/decision-mock-model.js";

export function WorkflowRail({ workflows, counts, previewCounts, active, preview, onSelect, onPreview }: {
  workflows: readonly WorkflowCatalogEntry[]; counts?: readonly WorkflowCountWire[]; previewCounts?: readonly WorkflowCountWire[]; active: string; preview: string | null;
  onSelect: (id: string) => void; onPreview: (id: string) => void;
}) {
  const entries = workflows;
  const variant = railVariant();
  const groups = useMemo(() => workflowNavigationGroups(entries), [entries]);
  const choose = useCallback((id: string) => entries.find(flow => flow.id === id)?.source === "preview" ? onPreview(id) : onSelect(id), [entries, onPreview, onSelect]);
  const metadata = useCallback((id: string) => {
    const flow = entries.find(flow => flow.id === id);
    if (!flow) return undefined;
    if (variant) {
      const running = MOCK_RAIL_RUNNING[id] ?? 0;
      return <span className="workflow-rail-running">{running > 0 && <span title="Running now" className="inline-flex h-5 items-center gap-1 rounded-full bg-ui-positive/15 px-1.5 text-caption font-medium tabular-nums text-ui-positive">
        <span aria-hidden className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" />{running}</span>}</span>;
    }
    const source = flow.source === "preview" ? previewCounts : counts;
    return <span className="workflow-rail-meta ml-auto shrink-0 whitespace-nowrap text-caption tabular-nums text-ui-muted" aria-label={source ? `${activeCount(workflowStatusCounts(source, id))} active of ${workflowCount(source, id)} in ${flow.label}` : `Counts unavailable in ${flow.label}`} title={source ? "Active / all runs today" : "Counts unavailable"}>{source ? `${activeCount(workflowStatusCounts(source, id))} · ${workflowCount(source, id)}` : "…"}</span>;
  }, [entries, counts, previewCounts, variant]);
  return <WorkflowNavigation variant={variant} label="Workflows" groups={groups} active={preview ?? active} onSelect={choose} metadata={metadata} />;
}
