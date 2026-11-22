import { useMemo, useState } from "react";
import { useViewState } from "../../app/navigation/view-route-model.js";
import type { DashboardClient } from "../../client/index.js";
import { Button, EmptyState, Notice } from "../../ds/ui.js";
import { useExplorerWiring } from "../../state/explorer-wiring-adapter.js";
import { formatErrorCatalogFailure } from "../../../models/failures/error-catalog.js";
import type { ExplorerWorkflowWire } from "../../../models/dashboard/explorer.js";
import { LoadingRegion } from "../shared/loading/loading.js";
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
  // One page heading and picker stay mounted around the body. The first read shows nothing below them: run options and steps differ per workflow, so no guessed frame stands in.
  const spec = state.state === "ready" ? state.spec : state.state === "refused" ? state.previous : undefined;
  return <>{state.state === "refused" && spec !== undefined && <Notice tone="warning" title="Workflow definition unavailable" description={formatErrorCatalogFailure(state.failure).text} />}
    <ExplorerPage workflowId={workflowId} workflows={workflows} onWorkflow={setWorkflowId}>
      {spec !== undefined ? <ExplorerSpecView key={workflowId} spec={spec} onWorkflow={setWorkflowId} />
        : state.state === "unavailable" ? <EmptyState title="Workflow unavailable" description={state.reason} />
        : state.state === "refused" ? <EmptyState title="Workflow unavailable" description={formatErrorCatalogFailure(state.failure).text} action={<Button onClick={retry}>Retry</Button>} />
        : <LoadingRegion label="Loading workflow definition">{null}</LoadingRegion>}
    </ExplorerPage></>;
}
