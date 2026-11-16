import { buildWorkflowExplorer } from "../../../runs/queries/explorer.js";
import type { DashboardApp } from "./api-types.js";
import type { ExplorerRouteDeps } from "./explorer-types.js";

export function registerExplorerRoutes(app: DashboardApp, deps: ExplorerRouteDeps): void {
  app.get("/api/v1/explorer", (c) => c.json(buildWorkflowExplorer(deps.explorer)));
}
