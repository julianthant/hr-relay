import { useCallback, useMemo } from "react";
import { statusCount, workflowStatusCounts, type WorkflowCountWire } from "./shell-model.js";
import { workflowNavigationGroups } from "./workflow-rail-model.js";
import type { WorkflowCatalogEntry } from "../workflows/workflow-catalog-model.js";
import { WorkflowNavigation } from "./workflow-navigation.js";

/** A workflow's running count is only its accessible description ("N running"); no visible pill. */
export function WorkflowRail({ workflows, counts, active, onSelect, collapsed, onStart, canStart }: {
  onStart?: (id: string) => void; canStart?: (id: string) => boolean;
  collapsed?: boolean;
  workflows: readonly WorkflowCatalogEntry[]; counts?: readonly WorkflowCountWire[]; active: string;
  onSelect: (id: string) => void;
}) {
  const entries = workflows;
  const groups = useMemo(() => workflowNavigationGroups(entries), [entries]);
  const running = useCallback((id: string) => {
    return counts ? statusCount(workflowStatusCounts(counts, id), "running") : 0;
  }, [counts]);
  const description = useCallback((id: string) => { const count = running(id); return count > 0 ? `${count} running` : undefined; }, [running]);
  return <WorkflowNavigation label="Workflows" groups={groups} active={active} onSelect={onSelect} description={description} collapsed={collapsed} onStart={onStart} canStart={canStart} />;
}
