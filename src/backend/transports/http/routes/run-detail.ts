import { z } from "zod";
import { RunIdSchema } from "../../../../rules/identity/ids.js";
import { PositiveIntegerTextSchema, rawRouteQuery } from "./request-parameters.js";
import { readRunAttemptHistoryBody, readRunDetailBody, readRunLogSearchBody } from "../../../runs/queries/run-detail.js";
import { SectionUnavailableError } from "../../../runs/commands/refusals.js";
import { ItemAttemptHistoryRequestSchema } from "../../../../models/dashboard/item-attempt-history.js";
import { RunLogSearchQuerySchema } from "../../../../models/dashboard/run-detail.js";

import type { DashboardApp } from "./api-types.js";
import type { RunDetailRouteDeps } from "./run-detail-types.js";

const RunPathSchema = z.strictObject({ runId: RunIdSchema });
const AttemptHistoryQuerySchema = z.strictObject({
  limit: PositiveIntegerTextSchema.optional(),
  cursor: ItemAttemptHistoryRequestSchema.shape.cursor,
}).pipe(ItemAttemptHistoryRequestSchema);

export function registerRunDetailRoutes(app: DashboardApp, deps: RunDetailRouteDeps): void {
  app.get("/api/v1/runs/:runId", async (c) => {
    const { runId } = RunPathSchema.parse(c.req.param());
    return c.body(await readRunDetailBody(deps.runDetail, runId, c.req.raw.signal, c.req.header("x-relay-tab")), 200, { "Content-Type": "application/json" });
  });
  app.get("/api/v1/runs/:runId/attempt-history", async (c) => {
    const { runId } = RunPathSchema.parse(c.req.param());
    const request = AttemptHistoryQuerySchema.parse(rawRouteQuery(c.req.url));
    if (deps.runDetail.itemAttemptHistory === undefined) throw new SectionUnavailableError("same-item attempt history is not composed");
    return c.body(await readRunAttemptHistoryBody(
      deps.runDetail, runId, request, c.req.raw.signal, c.req.header("x-relay-tab"),
    ), 200, { "Content-Type": "application/json" });
  });
  app.get("/api/v1/runs/:runId/log-search", async (c) => {
    const { runId } = RunPathSchema.parse(c.req.param());
    const { q } = z.strictObject({ q: RunLogSearchQuerySchema }).parse(rawRouteQuery(c.req.url));
    return c.body(await readRunLogSearchBody(deps.runDetail, runId, q, c.req.raw.signal, c.req.header("x-relay-tab")),
      200, { "Content-Type": "application/json" });
  });

}
