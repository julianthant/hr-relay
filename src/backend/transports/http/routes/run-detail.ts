import { readRunAttemptHistoryBody, readRunDetailBody } from "../../../runs/queries/run-detail.js";
import { SectionUnavailableError } from "../../../runs/commands/refusals.js";
import { ItemAttemptHistoryRequestSchema } from "../../../../models/dashboard/item-attempt-history.js";

import type { DashboardApp } from "./api-types.js";
import type { RunDetailRouteDeps } from "./run-detail-types.js";

export function registerRunDetailRoutes(app: DashboardApp, deps: RunDetailRouteDeps): void {
  app.get("/api/v1/runs/:runId", async (c) => c.body(await readRunDetailBody(
    deps.runDetail, c.req.param("runId"), c.req.raw.signal, c.req.header("x-relay-tab"),
  ), 200, { "Content-Type": "application/json" }));
  app.get("/api/v1/runs/:runId/attempt-history", async (c) => {
    if (deps.runDetail.itemAttemptHistory === undefined) throw new SectionUnavailableError("same-item attempt history is not composed");
    const limit = c.req.query("limit");
    const cursor = c.req.query("cursor");
    const request = ItemAttemptHistoryRequestSchema.parse({
      ...(limit === undefined ? {} : { limit: Number(limit) }),
      ...(cursor === undefined ? {} : { cursor }),
    });
    return c.body(await readRunAttemptHistoryBody(
      deps.runDetail, c.req.param("runId"), request, c.req.raw.signal, c.req.header("x-relay-tab"),
    ), 200, { "Content-Type": "application/json" });
  });

}
