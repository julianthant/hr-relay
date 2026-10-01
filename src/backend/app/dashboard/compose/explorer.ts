import { readCommittedUiCatalog } from "../../../runs/dashboard/queries/ui-catalog.js";
import type { AuthorityDatabase } from "../../../../infra/sqlite/authority-database.js";
import type { Clock } from "../../../../domain/clock.js";
import type { Fingerprint } from "../../../../domain/ids.js";
import { WORKFLOW_MODULES, readPendingImplBindings } from "../../control/workflow-registry.js";
import { buildSafeUiCatalog } from "../../../systems/ucpath/driver/catalog.js";
import { createExplorerEditService } from "../../../runs/dashboard/commands/explorer-edit-service.js";
import { EXPLORER_SOURCE_ROOT, readScenarioSources } from "../../../runs/dashboard/queries/explorer.js";
import type { ExplorerRouteDeps } from "../../../transports/dashboard/routes/explorer-types.js";

/** Graph and validation share one captured SQLite view; the kernel supplies writes. */
export function composeExplorer(input: { database: AuthorityDatabase; clock: Clock; descriptorSetHash: Fingerprint }) {
  const { database, clock, descriptorSetHash } = input;
  const overrides = database.authority.explorerOverrides;
  const explorer = { clock, descriptorSetHash, modules: WORKFLOW_MODULES,
    pendingImplBindings: readPendingImplBindings(EXPLORER_SOURCE_ROOT), uiCatalog: buildSafeUiCatalog(),
    listScenarioSources: () => readScenarioSources(EXPLORER_SOURCE_ROOT), overrides };
  const readOverrides = () => database.withAuthorityReadSnapshot(() => overrides.readAll());
  const routes: ExplorerRouteDeps = {
    uiCatalog: { readCatalogJson: () => readCommittedUiCatalog(EXPLORER_SOURCE_ROOT) },
    explorer: { ...explorer, overrides: { readAll: readOverrides } },
    explorerEdits: { validate(input) {
      const captured = readOverrides();
      const reader = { readAll: () => captured, read: (workflowId: string) => captured.find(entry => entry.workflowId === workflowId) };
      return createExplorerEditService({ explorer: { ...explorer, overrides: reader }, overrides: reader }).validate(input);
    } },
  };
  return Object.freeze({ routes, executor: createExplorerEditService({ explorer, overrides }) });
}
