import { resolveOperationSource } from "../../../runs/queries/operation-source.js";
import { readRunDetail } from "../../../runs/queries/run-detail.js";
import { SectionUnavailableError } from "../../../runs/commands/refusals.js";
import { ItemAttemptHistoryRequestSchema } from "../../../../models/dashboard/item-attempt-history.js";

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

}
