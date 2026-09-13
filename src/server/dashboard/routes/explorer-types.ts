import type { UiCatalogQueryDeps } from "../queries/ui-catalog.js";
import type { ExplorerEditService } from "../commands/explorer-edit-service.js";
import type { ExplorerQueryDeps } from "../queries/explorer.js";

export interface ExplorerRouteDeps {
  readonly uiCatalog: UiCatalogQueryDeps;
  readonly explorer: ExplorerQueryDeps;
  readonly explorerEdits?: Pick<ExplorerEditService, "validate">;
}
