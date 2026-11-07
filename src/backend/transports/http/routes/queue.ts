import { z } from "zod";
const DayQuerySchema = z.iso.date();

import type { DashboardApp } from "./api-types.js";
import type { QueueRouteDeps } from "./queue-types.js";

export function registerQueueRoutes(app: DashboardApp, deps: QueueRouteDeps): void {
  app.post("/api/v1/rerun-warnings", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(deps.startPlans.previewWarnings(await c.req.json()));
  });
  app.get("/api/v1/dashboard", (c) => {
    const day = DayQuerySchema.parse(c.req.query("day"));
    return c.json(deps.queue.day(day));
  });

  app.post("/api/v1/start-plans", async (c) => {
    const body: unknown = await c.req.json();
    await deps.startPlans.prepare?.(body, c.req.raw.signal);
    return c.json(deps.startPlans.plan(body));
  });

}
