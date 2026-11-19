import { useCallback, useMemo } from "react";
import { statusCount, workflowStatusCounts, type WorkflowCountWire } from "./shell-model.js";
import { flatWorkflowGroup } from "./workflow-rail-model.js";
import type { WorkflowCatalogEntry } from "../workflows/workflow-catalog-model.js";
import { WorkflowNavigation } from "./workflow-navigation.js";
import { ChartNoAxesColumn, ListTree, Table2, type LucideIcon } from "lucide-react";
import { NavRow, Skeleton, Tooltip, dsFocus, dsIcon } from "../../ds/ui.js";
import type { DataPage } from "../../app/navigation/url-state.js";

const DATA_ROWS: readonly { readonly page: DataPage; readonly label: string; readonly Icon: LucideIcon }[] = [
  { page: "spreadsheets", label: "Spreadsheets", Icon: Table2 },
  { page: "explorer", label: "Explorer", Icon: ListTree },
  { page: "activity", label: "Analytics", Icon: ChartNoAxesColumn },
];

export const dataRowId = (page: DataPage): string => `rail-data-${page}`;

/** The data pages sit under the workflows; opening one swaps the main region and leaves the rail in place. */
function DataSection({ current, onOpen, collapsed }: { current?: DataPage; onOpen: (page: DataPage) => void; collapsed?: boolean }) {
  return <section aria-label="Data" className="workflow-rail-group">{!collapsed && <h3>Data</h3>}
    <ul className="m-0 list-none p-0">{DATA_ROWS.map(({ page, label, Icon }) => <li key={page}>{collapsed
      ? <Tooltip side="right" content={label}><button id={dataRowId(page)} type="button" aria-label={label} aria-current={current === page ? "page" : undefined} className={dsFocus} onClick={() => onOpen(page)}><Icon aria-hidden className={dsIcon.md} /></button></Tooltip>
      : <NavRow id={dataRowId(page)} icon={<Icon />} label={label} selected={current === page} onClick={() => onOpen(page)} />}</li>)}</ul>
  </section>;
}

/** Each workflow shows one number: its runs running now, as a pill at the row's far right (a corner badge on the minimized tile); nothing at 0. */
export function WorkflowRail({ workflows, counts, active, onSelect, collapsed, countsLoading = false, dataPage, onDataPage }: {
  collapsed?: boolean; countsLoading?: boolean; dataPage?: DataPage; onDataPage: (page: DataPage) => void;
  workflows: readonly WorkflowCatalogEntry[]; counts?: readonly WorkflowCountWire[]; active: string;
  onSelect: (id: string) => void;
}) {
  const entries = workflows;
  const groups = useMemo(() => flatWorkflowGroup(entries), [entries]);
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
  return <WorkflowNavigation label="Workflows" groups={groups} active={dataPage === undefined ? active : ""} onSelect={onSelect} metadata={metadata} description={description} collapsed={collapsed}
    footer={<DataSection current={dataPage} onOpen={onDataPage} collapsed={collapsed} />} />;
}
