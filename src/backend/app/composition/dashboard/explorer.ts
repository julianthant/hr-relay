import type { Clock } from "../../../../rules/time/clock.js";
import type { Fingerprint } from "../../../../rules/identity/ids.js";
import { WORKFLOW_MODULES, readPendingImplBindings } from "../../registries/workflow-registry.js";
import { buildUiTaskLinks } from "../../../systems/ui-task-links.js";
import { EXPLORER_SOURCE_ROOT, readScenarioSources } from "../../../runs/queries/explorer.js";
import type { ExplorerRouteDeps } from "../../../transports/http/routes/explorer-types.js";

export function composeExplorer(input: { clock: Clock; descriptorSetHash: Fingerprint }): ExplorerRouteDeps {
  return { explorer: { ...input, modules: WORKFLOW_MODULES,
    pendingImplBindings: readPendingImplBindings(EXPLORER_SOURCE_ROOT), uiTaskLinks: buildUiTaskLinks(),
    listScenarioSources: () => readScenarioSources(EXPLORER_SOURCE_ROOT) } };
}
