import { z } from "zod";
import { etag } from "hono/etag";
const DayQuerySchema = z.iso.date();

import type { DashboardApp } from "./api-types.js";
import type { QueueRouteDeps } from "./queue-types.js";

export function registerQueueRoutes(app: DashboardApp, deps: QueueRouteDeps): void {
  app.post("/api/v1/rerun-warnings", async (c) => {
    c.header("Cache-Control", "no-store");
    return c.json(deps.startPlans.previewWarnings(await c.req.json()));
  });
  // The body is already the wire's JSON; the ETag is its digest, so an unchanged day answers 304.
  app.get("/api/v1/dashboard", etag(), async (c) => {
    const day = DayQuerySchema.parse(c.req.query("day"));
    const served = await deps.queue.day(day, { tab: c.req.header("x-relay-tab"), signal: c.req.raw.signal });
    return new Response(typeof served === "string" ? served : JSON.stringify(served), { headers: { "Content-Type": "application/json", "Cache-Control": "private, no-cache" } });
  });

  app.post("/api/v1/start-plans", async (c) => {
    const body: unknown = await c.req.json();
    await deps.startPlans.prepare?.(body, c.req.raw.signal);
    return c.json(deps.startPlans.plan(body));
  });

}
