import type { Clock } from "../../../../rules/time/clock.js";
import type { Fingerprint } from "../../../../rules/identity/ids.js";
import { READABLE_WORKFLOW_MODULES, readPendingImplBindings } from "../../registries/workflow-registry.js";
import { buildUiTaskLinks } from "../../../systems/ui-task-links.js";
import { EXPLORER_SOURCE_ROOT, readScenarioSources, registerExplorerCatalog, type ExplorerModuleView } from "../../../runs/queries/explorer.js";
import type { ExplorerRouteDeps } from "../../../transports/http/routes/explorer-types.js";

const registered = new Map<Fingerprint, ExplorerRouteDeps>();

export function composeExplorer(input: { clock: Clock; descriptorSetHash: Fingerprint },
  modules: readonly ExplorerModuleView[] = READABLE_WORKFLOW_MODULES): ExplorerRouteDeps {
  const processCatalog = modules === READABLE_WORKFLOW_MODULES;
  const retained = processCatalog ? registered.get(input.descriptorSetHash) : undefined;
  if (retained !== undefined) return retained;
  const deps = Object.freeze({ explorer: registerExplorerCatalog({ ...input, modules,
    pendingImplBindings: readPendingImplBindings(EXPLORER_SOURCE_ROOT), uiTaskLinks: buildUiTaskLinks(),
    listScenarioSources: () => readScenarioSources(EXPLORER_SOURCE_ROOT) }) });
  if (processCatalog) registered.set(input.descriptorSetHash, deps);
  return deps;
}
