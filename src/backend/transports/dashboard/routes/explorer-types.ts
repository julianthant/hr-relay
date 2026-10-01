import type { UiCatalogQueryDeps } from "../../../runs/dashboard/queries/ui-catalog.js";
import type { ExplorerEditService } from "../../../runs/dashboard/commands/explorer-edit-service.js";
import type { ExplorerQueryDeps } from "../../../runs/dashboard/queries/explorer.js";

export interface ExplorerRouteDeps {
  readonly uiCatalog: UiCatalogQueryDeps;
  readonly explorer: ExplorerQueryDeps;
  readonly explorerEdits?: Pick<ExplorerEditService, "validate">;
}
