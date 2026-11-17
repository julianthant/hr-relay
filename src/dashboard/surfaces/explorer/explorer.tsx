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
  const first = catalog.find(entry => entry.source === "served")?.id ?? "";
  const [chosen, setWorkflowId] = useViewState("explorerWorkflow", first);
  const registered = catalog.find(entry => entry.id === chosen && entry.source === "served");
  const { state, retry, workflows: wire } = useExplorerWiring(client, chosen, registered?.served?.version);
  const [known, setKnown] = useState<readonly ExplorerWorkflowWire[] | undefined>(wire);
  if (wire !== undefined && wire !== known) setKnown(wire);
  const workflows = useMemo(() => explorerPickerEntries(catalog, known), [catalog, known]);
  const workflowId = known === undefined && chosen !== "" ? chosen : workflows.some(entry => entry.id === chosen) ? chosen : workflows[0]?.id;
  if (workflowId === undefined) return <EmptyState title="Workflow unavailable" description="No workflow is registered to inspect." />;
  if (workflowId !== chosen) return <EmptyState title="Workflow unavailable" description="Choose a registered workflow to inspect its steps." action={<Button onClick={() => setWorkflowId(workflowId)}>Open {workflows[0].title}</Button>} />;
  const spec = state.state === "ready" ? state.spec : state.state === "refused" ? state.previous : undefined;
  return <>{state.state === "refused" && spec !== undefined && <Notice tone="warning" title="Workflow definition unavailable" description={formatErrorCatalogFailure(state.failure).text} />}
    {spec !== undefined ? <ExplorerSpecView key={workflowId} spec={spec} workflowId={workflowId} workflows={workflows} onWorkflow={setWorkflowId} />
      : <ExplorerPage workflowId={workflowId} workflows={workflows} onWorkflow={setWorkflowId}>
        {state.state === "unavailable" ? <EmptyState title="Workflow unavailable" description={state.reason} />
          : state.state === "refused" ? <EmptyState title="Workflow unavailable" description={formatErrorCatalogFailure(state.failure).text} action={<Button onClick={retry}>Retry</Button>} />
          : <LoadingRegion label="Loading workflow definition"><SettingsRowsSkeleton rows={4} /></LoadingRegion>}
      </ExplorerPage>}</>;
}
