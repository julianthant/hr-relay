import type { DashboardApp } from "./api-types.js";
import type { composeDataQueries } from "../compose/data.js";
import { RunIdSchema } from "../../../domain/ids.js";

/** Handle the data members of the existing section route before trust dispatch. */
export function registerDataRoutes(
  app: DashboardApp,
  queries: () => ReturnType<typeof composeDataQueries>,
): void {
  app.get("/api/v1/runs/:runId/:section", async (c, next) => {
    const section = c.req.param("section");
    if (section !== "context-data" && section !== "context-attempts") return next();
    const runId = RunIdSchema.parse(c.req.param("runId"));
    return c.json(section === "context-data" ? queries().contextData(runId) : queries().contextAttempts(runId));
  });
}
