import { RerunValuesRequestSchema } from "../../../../models/dashboard/rerun-values.js";
import type { DashboardApp } from "./api-types.js";
import type { composeDataQueries } from "../../../app/composition/dashboard/data.js";
import { RunIdSchema } from "../../../../rules/identity/ids.js";

/** Handle the data members of the existing section route before trust dispatch. */
export function registerDataRoutes(
  app: DashboardApp,
  queries: () => ReturnType<typeof composeDataQueries>,
): void {
  app.get("/api/v1/runs/:runId/rerun-values", (c) => {
    c.header("cache-control", "no-store");
    c.header("x-content-type-options", "nosniff");
    const versions = c.req.queries("expectedVersion");
    if (versions === undefined || versions.length !== 1 || !/^[1-9]\d*$/u.test(versions[0] ?? ""))
      return c.json({ error: "RERUN_VALUES_REQUEST_INVALID" }, 400);
    const request = RerunValuesRequestSchema.safeParse({ runId: c.req.param("runId"), expectedVersion: Number(versions[0]) });
    if (!request.success) return c.json({ error: "RERUN_VALUES_REQUEST_INVALID" }, 400);
    const response = queries().rerunValues(request.data);
    if (response.state === "available") return c.json(response);
    return c.json(response, response.code === "target-not-found" ? 404 : response.code === "target-deleted" ? 410 : 409);
  });
  app.get("/api/v1/runs/:runId/:section", async (c, next) => {
    const section = c.req.param("section");
    if (section !== "context-data" && section !== "context-attempts") return next();
    const runId = RunIdSchema.parse(c.req.param("runId"));
    return c.json(section === "context-data" ? queries().contextData(runId) : queries().contextAttempts(runId));
  });
}
