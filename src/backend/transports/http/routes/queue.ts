import { createHash } from "node:crypto";
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
  // The body is already the wire's JSON. Its ETag is set here, in the request's turn, so the middleware only compares it.
  app.get("/api/v1/dashboard", etag(), async (c) => {
    const day = DayQuerySchema.parse(c.req.query("day"));
    const served = await deps.queue.day(day, { tab: c.req.header("x-relay-tab"), signal: c.req.raw.signal });
    const body = typeof served === "string" ? served : JSON.stringify(served);
    return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "private, no-cache",
      ETag: `"${createHash("sha256").update(body).digest("base64url")}"` } });
  });

  app.post("/api/v1/start-plans", async (c) => {
    const body: unknown = await c.req.json();
    const { startPlans } = deps;
    if (startPlans.prepareAndPlan !== undefined) return c.json(await startPlans.prepareAndPlan(body, c.req.raw.signal));
    await startPlans.prepare?.(body, c.req.raw.signal);
    return c.json(startPlans.plan(body));
  });

}
