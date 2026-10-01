import type { UiCatalogQueryDeps } from "../../../../server/dashboard/queries/ui-catalog.js";
import type { ExplorerEditService } from "../../../../server/dashboard/commands/explorer-edit-service.js";
import type { ExplorerQueryDeps } from "../../../../server/dashboard/queries/explorer.js";

export interface ExplorerRouteDeps {
  readonly uiCatalog: UiCatalogQueryDeps;
  readonly explorer: ExplorerQueryDeps;
  readonly explorerEdits?: Pick<ExplorerEditService, "validate">;
}
