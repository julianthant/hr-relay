import { useCallback, useMemo } from "react";
import { statusCount, workflowStatusCounts, type WorkflowCountWire } from "./shell-model.js";
import { workflowNavigationGroups } from "./workflow-rail-model.js";
import type { WorkflowCatalogEntry } from "../workflows/workflow-catalog-model.js";
import { WorkflowNavigation } from "./workflow-navigation.js";
import { decisionMock, MOCK_RAIL_RUNNING } from "../run-detail/decision-mock/decision-mock-model.js";
import { mockLogsScene } from "../assistant/assistant-mock-frames.js";

/** Each workflow shows one number: its runs running now, as a pill left of the name; nothing at 0. */
export function WorkflowRail({ workflows, counts, previewCounts, active, preview, onSelect, onPreview }: {
  workflows: readonly WorkflowCatalogEntry[]; counts?: readonly WorkflowCountWire[]; previewCounts?: readonly WorkflowCountWire[]; active: string; preview: string | null;
  onSelect: (id: string) => void; onPreview: (id: string) => void;
}) {
  const entries = workflows;
  const groups = useMemo(() => workflowNavigationGroups(entries), [entries]);
  const choose = useCallback((id: string) => entries.find(flow => flow.id === id)?.source === "preview" ? onPreview(id) : onSelect(id), [entries, onPreview, onSelect]);
  const running = useCallback((id: string) => {
    if (decisionMock() ?? mockLogsScene()) return MOCK_RAIL_RUNNING[id] ?? 0;
    const source = entries.find(flow => flow.id === id)?.source === "preview" ? previewCounts : counts;
    return source ? statusCount(workflowStatusCounts(source, id), "running") : 0;
  }, [entries, counts, previewCounts]);
  const metadata = useCallback((id: string) => {
    const count = running(id);
    return <span className="workflow-rail-running">{count > 0 && <span title="Running now" className="inline-flex h-5 items-center gap-1 rounded-full bg-ui-positive/15 px-1.5 text-caption font-medium tabular-nums text-ui-positive">
      <span aria-hidden className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" />{count}</span>}</span>;
  }, [running]);
  const description = useCallback((id: string) => { const count = running(id); return count > 0 ? `${count} running` : undefined; }, [running]);
  return <WorkflowNavigation label="Workflows" groups={groups} active={preview ?? active} onSelect={choose} metadata={metadata} description={description} />;
}
