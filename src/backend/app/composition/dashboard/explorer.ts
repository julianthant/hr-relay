import type { AuthorityDatabase } from "../../../storage/sqlite/authority-database.js";
import type { Clock } from "../../../../rules/time/clock.js";
import type { Fingerprint } from "../../../../rules/identity/ids.js";
import { WORKFLOW_MODULES, readPendingImplBindings } from "../../registries/workflow-registry.js";
import { buildUiTaskLinks } from "../../../systems/ui-task-links.js";
import { createExplorerEditService } from "../../../runs/commands/explorer-edit-service.js";
import { EXPLORER_SOURCE_ROOT, readScenarioSources } from "../../../runs/queries/explorer.js";
import type { ExplorerRouteDeps } from "../../../transports/http/routes/explorer-types.js";

/** Graph and validation share one captured SQLite view; the kernel supplies writes. */
export function composeExplorer(input: { database: AuthorityDatabase; clock: Clock; descriptorSetHash: Fingerprint }) {
  const { database, clock, descriptorSetHash } = input;
  const overrides = database.authority.explorerOverrides;
  const explorer = { clock, descriptorSetHash, modules: WORKFLOW_MODULES,
    pendingImplBindings: readPendingImplBindings(EXPLORER_SOURCE_ROOT), uiTaskLinks: buildUiTaskLinks(),
    listScenarioSources: () => readScenarioSources(EXPLORER_SOURCE_ROOT), overrides };
  const readOverrides = () => database.withAuthorityReadSnapshot(() => overrides.readAll());
  const routes: ExplorerRouteDeps = {
    explorer: { ...explorer, overrides: { readAll: readOverrides } },
    explorerEdits: { validate(input) {
      const captured = readOverrides();
      const reader = { readAll: () => captured, read: (workflowId: string) => captured.find(entry => entry.workflowId === workflowId) };
      return createExplorerEditService({ explorer: { ...explorer, overrides: reader }, overrides: reader }).validate(input);
    } },
  };
  return Object.freeze({ routes, executor: createExplorerEditService({ explorer, overrides }) });
}
