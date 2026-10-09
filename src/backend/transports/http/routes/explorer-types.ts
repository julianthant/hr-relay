import type { ExplorerEditService } from "../../../runs/commands/explorer-edit-service.js";
import type { ExplorerQueryDeps } from "../../../runs/queries/explorer.js";

export interface ExplorerRouteDeps {
  readonly explorer: ExplorerQueryDeps;
  readonly explorerEdits?: Pick<ExplorerEditService, "validate">;
}
