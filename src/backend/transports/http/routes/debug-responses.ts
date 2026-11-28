import { randomUUID } from "node:crypto";
import { debugFailureOutcomes } from "../../../../models/events/debug-report.js";
import type { DashboardApp } from "./api-types.js";
import { wireError } from "./failure-status.js";
import { ERROR_CATALOG } from "../../../../models/failures/error-catalog.js";
import { DashboardClientDisconnectedError } from "../http-server.js";

const causeRows = new WeakMap<Request, () => Promise<void>>();
/** Cause rows follow their request's outcome event, so the outcome stays the first diagnostic for its code. */
export function afterRequestOutcome(request: Request, emit: () => Promise<void>): void { causeRows.set(request, emit); }

export function registerDebugResponses(app: DashboardApp, writer: { emit(input: unknown): unknown }): void {
  app.use("*", async (c, next) => {
    await next();
    if (c.res.ok && c.res.headers.has("content-disposition")) return;
    const outcome = async (): Promise<void> => {
      if (c.req.raw.signal.reason instanceof DashboardClientDisconnectedError) {
        await writer.emit({ category: "http", phase: "failed", area: "request", code: "INTERNAL_FAILURE", reason: "request-disconnected",
          correlationId: randomUUID(), method: c.req.method, route: c.req.routePath });
        return;
      }
      if (c.res.ok && c.req.method === "GET" && c.req.routePath !== "/api/v1/preflight") return;
      let body: unknown;
      try {
        if (c.res.headers.get("content-type")?.startsWith("application/json")) body = await c.res.clone().json();
      } catch {
        await writer.emit({ category: "http", phase: "failed", area: "request", code: "DASHBOARD_READ_FAILED", reason: "response-json-invalid",
          correlationId: randomUUID(), method: c.req.method, route: c.req.routePath, status: c.res.status });
        return;
      }
      const failures = debugFailureOutcomes(body, c.res.status, c.req.method === "GET" ? c.req.routePath : undefined);
      await Promise.all(failures.map(failure => writer.emit({ category: "http", phase: "failed", area: "request",
        ...failure, correlationId: failure.correlationId ?? randomUUID(), method: c.req.method, route: c.req.routePath, status: c.res.status })));
    };
    try {
      await outcome();
      await causeRows.get(c.req.raw)?.();
    } catch {
      c.res = c.json(wireError("LOGGING_UNAVAILABLE", ERROR_CATALOG.LOGGING_UNAVAILABLE.text, false), 500);
    }
  });
}
