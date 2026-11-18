import { useCallback, useMemo } from "react";
import { statusCount, workflowStatusCounts, type WorkflowCountWire } from "./shell-model.js";
import { workflowNavigationGroups } from "./workflow-rail-model.js";
import type { WorkflowCatalogEntry } from "../workflows/workflow-catalog-model.js";
import { WorkflowNavigation } from "./workflow-navigation.js";
import { Skeleton } from "../../ds/ui.js";

/** Each workflow shows one number: its runs running now, as a pill at the row's far right (a corner badge on the minimized tile); nothing at 0. */
export function WorkflowRail({ workflows, counts, active, onSelect, collapsed, countsLoading = false }: {
  collapsed?: boolean; countsLoading?: boolean;
  workflows: readonly WorkflowCatalogEntry[]; counts?: readonly WorkflowCountWire[]; active: string;
  onSelect: (id: string) => void;
}) {
  const entries = workflows;
  const groups = useMemo(() => workflowNavigationGroups(entries), [entries]);
  const running = useCallback((id: string) => {
    return counts ? statusCount(workflowStatusCounts(counts, id), "running") : 0;
  }, [counts]);
  const metadata = useCallback((id: string) => {
    const count = running(id);
    const pending = countsLoading && counts === undefined;
    return <span className="workflow-rail-running">{pending && <Skeleton className="h-5 w-8 rounded-full" />}{count > 0 && <span title="Running now" className="inline-flex h-5 items-center gap-1 rounded-full bg-ui-positive/15 px-1.5 text-caption font-medium tabular-nums text-ui-positive">
      <span aria-hidden className="size-1.5 rounded-full bg-current motion-safe:animate-pulse" />{count}</span>}</span>;
  }, [running, countsLoading, counts]);
  const description = useCallback((id: string) => { const count = running(id); return count > 0 ? `${count} running` : undefined; }, [running]);
  return <WorkflowNavigation label="Workflows" groups={groups} active={active} onSelect={onSelect} metadata={metadata} description={description} collapsed={collapsed} />;
}
