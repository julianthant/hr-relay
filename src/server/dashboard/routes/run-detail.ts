import { readRunDetail } from "../queries/run-detail.js";
import { buildRunAdvisory } from "../queries/advisory.js";
import { SectionUnavailableError } from "../../failures.js";

import type { DashboardApp } from "./api-types.js";
import type { RunDetailRouteDeps } from "./run-detail-types.js";

export function registerRunDetailRoutes(app: DashboardApp, deps: RunDetailRouteDeps): void {
  app.get("/api/v1/runs/:runId", async (c) => c.json(await readRunDetail(deps.runDetail, c.req.param("runId"), c.req.raw.signal)));
  /**
   * Ref operator-trust §4.4's on-demand failure advisory (D178). It is a POST because it
   * SPENDS a provider budget — a GET the surface could prefetch would make a
   * model call every time an operator opened a failed run — and it is
   * deliberately NOT part of the command family: it journals nothing, changes
   * nothing, and returns advice the operator may ignore.
   */
  app.post("/api/v1/runs/:runId/advisory", async (c) => {
    if (deps.advisory === undefined) {
      throw new SectionUnavailableError(
        "the failure advisory is not available: no ai.advisory provider is composed",
      );
    }
    return c.json(await buildRunAdvisory(deps.advisory, c.req.param("runId")));
  });

}
