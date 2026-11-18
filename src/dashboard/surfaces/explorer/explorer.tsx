import { useViewState } from "../../app/navigation/view-route-model.js";
import type { WorkflowCatalogEntry } from "../workflows/workflow-catalog-model.js";
import { useMemo, useState } from "react";
import { Button, EmptyState, Notice } from "../../ds/ui.js";
import { ExplorerTimeline } from "./explorer-flow.js";
import { DEFAULT_SCENARIO, type PreviewScenario } from "./explorer-flow-model.js";
import { explorerWorkflowOptions, explorerRecoveryWorkflow } from "./explorer-workflow-model.js";

import type { DashboardClient } from "../../client/index.js";
import { useExplorerWiring } from "../../state/explorer-wiring-adapter.js";
import { formatErrorCatalogFailure } from "../../../models/failures/error-catalog.js";
export function WorkflowExplorer({ catalog, client }: { catalog: readonly WorkflowCatalogEntry[]; client?: DashboardClient }) {
  const workflows = useMemo(() => explorerWorkflowOptions(catalog), [catalog]);
  const recoveryId = explorerRecoveryWorkflow(catalog);
  const [workflowId, setWorkflowId] = useViewState("explorerWorkflow", recoveryId);
  const served = catalog.find(entry => entry.id === workflowId);
  const [identity, setIdentity] = useState({ client, workflowId, epoch: 0 });
  const [scenario, setScenario] = useState<PreviewScenario>(DEFAULT_SCENARIO);
  const resource = useExplorerWiring(client, served?.id, served?.served?.version);
  if (identity.client !== client || identity.workflowId !== workflowId) {
    setIdentity({ client, workflowId, epoch: identity.epoch + (identity.client !== client ? 1 : 0) }); setScenario(DEFAULT_SCENARIO);
  }
  if (!served) return <EmptyState title="Workflow unavailable" description="Choose a registered workflow to inspect its steps." action={recoveryId === "" ? undefined : <Button onClick={() => setWorkflowId(recoveryId)}>{`Open ${catalog[0]?.label}`}</Button>} />;
  const projection = resource.state === "ready" ? resource.projection : resource.state === "refused" ? resource.previous : undefined;
  const steps = projection !== undefined ? projection.steps : [{ number: 1, title: served.label, parts: [{ kind: "note" as const, text: resource.state === "loading" ? "Loading workflow definition" : resource.state === "unavailable" ? resource.reason : resource.state === "refused" ? formatErrorCatalogFailure(resource.failure).text : "Workflow unavailable" }] }];
  return <>{resource.state === "refused" && projection !== undefined && <Notice tone="warning" title="Workflow definition unavailable" description={formatErrorCatalogFailure(resource.failure).text} />}<ExplorerTimeline key={identity.epoch} workflowId={workflowId} workflows={workflows} onWorkflow={setWorkflowId} title={served.label} steps={steps} scenario={scenario} onScenario={setScenario} onMockChoice={() => undefined}
    sourceFor={field => projection?.sources.get(field.source ?? "")} summary="Registered workflow definition" completion={projection?.completion} stopAfter={projection?.stopAfter} path={{ step: 1, control: "explorer-step-1" }} /></>;
}
