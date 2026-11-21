import { useMemo, useState } from "react";
import { useViewState } from "../../app/navigation/view-route-model.js";
import type { DashboardClient } from "../../client/index.js";
import { Button, Card, Chip, EmptyState, Notice, Skeleton } from "../../ds/ui.js";
import { useExplorerWiring } from "../../state/explorer-wiring-adapter.js";
import { formatErrorCatalogFailure } from "../../../models/failures/error-catalog.js";
import type { ExplorerWorkflowWire } from "../../../models/dashboard/explorer.js";
import { LoadingRegion, SkeletonText } from "../shared/loading/loading.js";
import type { WorkflowCatalogEntry } from "../workflows/workflow-catalog-model.js";
import { explorerMainWorkflowId, explorerPickerEntries } from "./explorer-picker-model.js";
import { ExplorerPage, ExplorerSpecView } from "./explorer-spec-view.js";

export function WorkflowExplorer({ catalog, client }: { catalog: readonly WorkflowCatalogEntry[]; client?: DashboardClient }) {
  const [chosen, setWorkflowId] = useViewState("explorerWorkflow", catalog.find(entry => entry.source === "served")?.id ?? "");
  const [known, setKnown] = useState<readonly ExplorerWorkflowWire[] | undefined>();
  const workflows = useMemo(() => explorerPickerEntries(catalog), [catalog]);
  // A choice that is not a main workflow (a saved view or link to a sub-workflow) shows the main workflow that starts it.
  const workflowId = explorerMainWorkflowId(chosen, workflows, known);
  const registered = catalog.find(entry => entry.id === workflowId && entry.source === "served");
  const { state, retry, workflows: wire } = useExplorerWiring(client, workflowId, registered?.served?.version);
  if (wire !== undefined && wire !== known) setKnown(wire);
  if (workflowId === undefined) return <EmptyState title="Workflow unavailable" description="No workflow is registered to inspect." />;
  const spec = state.state === "ready" ? state.spec : state.state === "refused" ? state.previous : undefined;
  return <>{state.state === "refused" && spec !== undefined && <Notice tone="warning" title="Workflow definition unavailable" description={formatErrorCatalogFailure(state.failure).text} />}
    {spec !== undefined ? <ExplorerSpecView key={workflowId} spec={spec} workflowId={workflowId} workflows={workflows} onWorkflow={setWorkflowId} />
      : <ExplorerPage workflowId={workflowId} workflows={workflows} onWorkflow={setWorkflowId}>
        {state.state === "unavailable" ? <EmptyState title="Workflow unavailable" description={state.reason} />
          : state.state === "refused" ? <EmptyState title="Workflow unavailable" description={formatErrorCatalogFailure(state.failure).text} action={<Button onClick={retry}>Retry</Button>} />
          : <ExplorerSkeleton />}
      </ExplorerPage>}</>;
}

/** The spec as it loads, shaped like the default Person Lookup down to the first screen's edge: two rows of run options,
 * the note above the steps, the browser sessions step, then a step with its description, check, cards and click line. */
function ExplorerSkeleton() {
  const STEP = "grid min-w-0 grid-cols-[2.75rem_minmax(0,1fr)] gap-x-3 border-b border-ui-stroke py-5 first:pt-0 last:border-b-0";
  const line = (width: string) => <div className="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-3 py-1 text-body"><Skeleton className="size-3.5 translate-y-0.5" /><SkeletonText className={width} /></div>;
  const card = (rows: number) => <Card className="overflow-hidden">
    <div className="flex min-h-11 items-center gap-2.5 border-b border-ui-stroke px-3 py-2.5"><Skeleton className="size-4 shrink-0" /><SkeletonText className="w-56 text-control" /></div>
    <div className="px-3">{Array.from({ length: rows }, (_, row) => <div key={row} className="flex items-center justify-between gap-3 border-b border-ui-stroke py-2.5 text-body last:border-b-0"><SkeletonText className="w-32" /><SkeletonText className="w-24" /></div>)}</div>
  </Card>;
  return <LoadingRegion label="Loading workflow definition"><div aria-hidden>
    <div className="mb-4 mt-6"><h2 className="m-0 mb-4 text-section"><SkeletonText className="w-28" /></h2>
      <div className="grid grid-cols-4 gap-4">{Array.from({ length: 8 }, (_, option) => <div key={option} className="flex min-w-0 flex-col gap-1.5"><SkeletonText className="w-24 text-body" /><Skeleton className="h-[var(--ds-h-md)] w-full" /></div>)}</div>
    </div>
    <div className="mb-6 border-b border-ui-stroke pb-4">{line("w-72")}</div>
    <div>
      <div className={STEP}><SkeletonText className="w-4 pt-0.5 text-caption" />
        <div className="min-w-0"><SkeletonText className="mb-4 w-48 text-heading" /><div className="flex gap-2"><Chip><SkeletonText className="w-12" /></Chip><Chip><SkeletonText className="w-10" /></Chip></div></div></div>
      <div className={STEP}><SkeletonText className="w-4 pt-0.5 text-caption" />
        <div className="min-w-0"><SkeletonText className="mb-4 w-48 text-heading" />
          <div className="flex min-w-0 flex-col gap-3"><SkeletonText className="w-3/5 text-body" />{line("w-48")}{card(1)}<div className="flex items-center gap-2 text-body"><Skeleton className="size-3.5 shrink-0" /><SkeletonText className="w-24" /></div>{card(3)}</div></div></div>
    </div>
  </div></LoadingRegion>;
}
