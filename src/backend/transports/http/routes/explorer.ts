import { buildWorkflowExplorer } from "../../../runs/queries/explorer.js";
import { SectionUnavailableError } from "../../../runs/commands/refusals.js";

import type { DashboardApp } from "./api-types.js";
import type { ExplorerRouteDeps } from "./explorer-types.js";

export function registerExplorerRoutes(app: DashboardApp, deps: ExplorerRouteDeps): void {
  /** Ref operator-trust –§5.4: exact graph read plus strict safe-edit draft validation. */
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
