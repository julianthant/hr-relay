import { buildUiCatalogWire } from "../../../../server/dashboard/queries/ui-catalog.js";
import { buildWorkflowExplorer } from "../../../../server/dashboard/queries/explorer.js";
import { SectionUnavailableError } from "../../../../server/failures.js";

import type { DashboardApp } from "./api-types.js";
import type { ExplorerRouteDeps } from "./explorer-types.js";

export function registerExplorerRoutes(app: DashboardApp, deps: ExplorerRouteDeps): void {
  app.get("/api/v1/ui-catalog", (c) => c.json(buildUiCatalogWire(deps.uiCatalog)));
  /** Ref operator-trust §5.2–§5.4: exact graph read plus strict safe-edit draft validation. */
  app.get("/api/v1/explorer", (c) => c.json(buildWorkflowExplorer(deps.explorer)));
  app.post("/api/v1/explorer/validate", async (c) => {
    if (deps.explorerEdits === undefined) {
      throw new SectionUnavailableError("Explorer safe-edit authority is not composed in this process");
    }
    const result = deps.explorerEdits.validate(await c.req.json());
    const status = result.state === "conflict" ? 409
      : result.state === "ready-to-apply" ? 200 : 422;
    return c.json(result, status);
  });

}
