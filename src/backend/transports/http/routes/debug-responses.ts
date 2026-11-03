import { randomUUID } from "node:crypto";
import { debugFailureOutcomes } from "../../../../models/events/debug-report.js";
import type { DashboardApp } from "./api-types.js";
import { wireError } from "./failure-status.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";

export function registerDebugResponses(app: DashboardApp, writer: { emit(input: unknown): void }): void {
  app.use("*", async (c, next) => {
    await next();
    if (c.res.ok && c.res.headers.has("content-disposition")) return;
    try {
      let body: unknown;
      try {
        if (c.res.headers.get("content-type")?.startsWith("application/json")) body = await c.res.clone().json();
      } catch {
        writer.emit({ category: "http", phase: "failed", area: "request", code: "DASHBOARD_READ_FAILED", reason: "response-json-invalid",
          correlationId: randomUUID(), method: c.req.method, route: c.req.routePath, status: c.res.status });
        return;
      }
      const failures = debugFailureOutcomes(body, c.res.status);
      for (const failure of failures) writer.emit({ category: "http", phase: "failed", area: "request",
        ...failure, correlationId: failure.correlationId ?? randomUUID(), method: c.req.method, route: c.req.routePath, status: c.res.status });
    } catch {
      return c.json(wireError("LOGGING_UNAVAILABLE", ERROR_CATALOG.LOGGING_UNAVAILABLE.text, false), 500);
    }
  });
}
