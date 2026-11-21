import { z } from "zod";
import { PositiveIntegerTextSchema, rawRouteQuery, RunSectionQuerySchema } from "./request-parameters.js";
import { RerunValuesRequestSchema } from "../../../../models/dashboard/rerun-values.js";
import type { DashboardApp } from "./api-types.js";
import type { composeDataQueries } from "../../../app/composition/dashboard/data.js";
import { RunIdSchema } from "../../../../rules/identity/ids.js";

const RerunValuesRouteSchema = z.strictObject({
  path: RerunValuesRequestSchema.pick({ runId: true }),
  query: z.strictObject({ expectedVersion: PositiveIntegerTextSchema.pipe(RerunValuesRequestSchema.shape.expectedVersion) }),
});

const ContextSectionPathSchema = z.strictObject({
  runId: RunIdSchema,
  section: z.enum(["context-data", "context-attempts"]),
});

/** Handle the data members of the existing section route before trust dispatch. */
export function registerDataRoutes(
  app: DashboardApp,
  queries: () => ReturnType<typeof composeDataQueries>,
): void {
  app.get("/api/v1/runs/:runId/rerun-values", (c) => {
    c.header("cache-control", "no-store");
    c.header("x-content-type-options", "nosniff");
    const request = RerunValuesRouteSchema.safeParse({ path: c.req.param(), query: rawRouteQuery(c.req.url) });
    if (!request.success) return c.json({ error: "RERUN_VALUES_REQUEST_INVALID" }, 400);
    const response = queries().rerunValues({ ...request.data.path, ...request.data.query });
    if (response.state === "available") return c.json(response);
    return c.json(response, response.code === "target-not-found" ? 404 : response.code === "target-deleted" ? 410 : 409);
  });
  app.get("/api/v1/runs/:runId/:section", async (c, next) => {
    const path = c.req.param();
    if (path.section !== "context-data" && path.section !== "context-attempts") return next();
    const { runId, section } = ContextSectionPathSchema.parse(path);
    RunSectionQuerySchema.parse(rawRouteQuery(c.req.url));
    return c.json(section === "context-data" ? queries().contextData(runId) : queries().contextAttempts(runId));
  });
}
