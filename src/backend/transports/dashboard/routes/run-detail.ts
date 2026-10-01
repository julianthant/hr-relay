import { resolveOperationSource } from "../../../../server/dashboard/queries/operation-source.js";
import { readRunDetail } from "../../../../server/dashboard/queries/run-detail.js";
import { buildRunAdvisory } from "../../../../server/dashboard/queries/advisory.js";
import { SectionUnavailableError } from "../../../../server/failures.js";
import { ItemAttemptHistoryRequestSchema } from "../../../../domain/dashboard/item-attempt-history.js";

import type { DashboardApp } from "./api-types.js";
import type { RunDetailRouteDeps } from "./run-detail-types.js";

export function registerRunDetailRoutes(app: DashboardApp, deps: RunDetailRouteDeps): void {
  app.get("/api/v1/runs/:runId", async (c) => c.json(await readRunDetail(deps.runDetail, c.req.param("runId"), c.req.raw.signal)));
  app.get("/api/v1/runs/:runId/operation-source", (c) => {
    const request = c.req.query("request");
    if (request === undefined) throw new Error("operation-source-request-required");
    return c.json(resolveOperationSource(deps.runDetail, c.req.param("runId"), JSON.parse(request), c.req.raw.signal));
  });
  app.get("/api/v1/runs/:runId/attempt-history", async (c) => {
    const query = deps.runDetail.itemAttemptHistory;
    if (query === undefined) throw new SectionUnavailableError("same-item attempt history is not composed");
    const limit = c.req.query("limit");
    const cursor = c.req.query("cursor");
    const request = ItemAttemptHistoryRequestSchema.parse({
      ...(limit === undefined ? {} : { limit: Number(limit) }),
      ...(cursor === undefined ? {} : { cursor }),
    });
    return c.json(query.read(c.req.param("runId"), request));
  });
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
