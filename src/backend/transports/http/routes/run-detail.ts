import { z } from "zod";
import { RunIdSchema } from "../../../../rules/identity/ids.js";
import { PositiveIntegerTextSchema, rawRouteQuery } from "./request-parameters.js";
import { readRunDetail } from "../../../runs/queries/run-detail.js";
import { SectionUnavailableError } from "../../../runs/commands/refusals.js";
import { ItemAttemptHistoryRequestSchema } from "../../../../models/dashboard/item-attempt-history.js";

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
    return c.json(await readRunDetail(deps.runDetail, runId, c.req.raw.signal));
  });
  app.get("/api/v1/runs/:runId/attempt-history", async (c) => {
    const { runId } = RunPathSchema.parse(c.req.param());
    const request = AttemptHistoryQuerySchema.parse(rawRouteQuery(c.req.url));
    const query = deps.runDetail.itemAttemptHistory;
    if (query === undefined) throw new SectionUnavailableError("same-item attempt history is not composed");
    return c.json(query.read(runId, request));
  });

}
