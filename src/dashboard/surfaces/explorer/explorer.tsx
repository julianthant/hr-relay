import { useMemo, useState } from "react";
import { useViewState } from "../../app/navigation/view-route-model.js";
import type { DashboardClient } from "../../client/index.js";
import { Button, EmptyState, Notice } from "../../ds/ui.js";
import { useExplorerWiring } from "../../state/explorer-wiring-adapter.js";
import { formatErrorCatalogFailure } from "../../../models/failures/error-catalog.js";
import type { ExplorerWorkflowWire } from "../../../models/dashboard/explorer.js";
import { LoadingRegion, SettingsRowsSkeleton } from "../shared/loading/loading.js";
import type { WorkflowCatalogEntry } from "../workflows/workflow-catalog-model.js";
import { explorerPickerEntries } from "./explorer-picker-model.js";
import { ExplorerPage, ExplorerSpecView } from "./explorer-spec-view.js";

export function WorkflowExplorer({ catalog, client }: { catalog: readonly WorkflowCatalogEntry[]; client?: DashboardClient }) {
  const [chosen, setWorkflowId] = useViewState("explorerWorkflow", catalog.find(entry => entry.source === "served")?.id ?? "");
  const [known, setKnown] = useState<readonly ExplorerWorkflowWire[] | undefined>();
  const workflows = useMemo(() => explorerPickerEntries(catalog, known), [catalog, known]);
  // The choice stands, listed or not: a workflow the wire does not list says so in place; only an empty choice takes the first one.
  const workflowId = chosen !== "" ? chosen : workflows[0]?.id;
  const options = workflowId !== undefined && !workflows.some(entry => entry.id === workflowId) ? [...workflows, { id: workflowId, title: workflowId, depth: 0 }] : workflows;
  const registered = catalog.find(entry => entry.id === workflowId && entry.source === "served");
  const { state, retry, workflows: wire } = useExplorerWiring(client, workflowId, registered?.served?.version);
  if (wire !== undefined && wire !== known) setKnown(wire);
  if (workflowId === undefined) return <EmptyState title="Workflow unavailable" description="No workflow is registered to inspect." />;
  const spec = state.state === "ready" ? state.spec : state.state === "refused" ? state.previous : undefined;
  return <>{state.state === "refused" && spec !== undefined && <Notice tone="warning" title="Workflow definition unavailable" description={formatErrorCatalogFailure(state.failure).text} />}
    {spec !== undefined ? <ExplorerSpecView key={workflowId} spec={spec} workflowId={workflowId} workflows={options} onWorkflow={setWorkflowId} />
      : <ExplorerPage workflowId={workflowId} workflows={options} onWorkflow={setWorkflowId}>
        {state.state === "unavailable" ? <EmptyState title="Workflow unavailable" description={state.reason} />
          : state.state === "refused" ? <EmptyState title="Workflow unavailable" description={formatErrorCatalogFailure(state.failure).text} action={<Button onClick={retry}>Retry</Button>} />
          : <LoadingRegion label="Loading workflow definition"><SettingsRowsSkeleton rows={4} /></LoadingRegion>}
      </ExplorerPage>}</>;
}
