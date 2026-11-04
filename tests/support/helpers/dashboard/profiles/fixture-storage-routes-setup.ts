import { Hono } from "hono";
import { ClearRunHistoryRequestSchema, type ClearRunHistoryResult } from "../../../../../src/models/dashboard/run-history.js";
import type * as FixtureStorageTypes from "../../../fixtures/dashboard/fixture-storage.js";


export function createFixtureStorageRoutesSetup({ FIXTURE_STORAGE_DOCTOR }: {
  FIXTURE_STORAGE_DOCTOR: typeof FixtureStorageTypes.FIXTURE_STORAGE_DOCTOR;
}) {
  function registerFixtureStorageRoutes({ app, runHistory }: { app: Hono; runHistory?: "ready" | "active" | "empty" }): void {
    let finishedRuns = runHistory === "empty" ? 0 : 3;
    const settled = new Map<string, ClearRunHistoryResult>();
    app.get("/api/v1/storage/run-history", c => c.json(runHistory === undefined ? { state: "unavailable" }
      : { state: "available", finishedRuns, activeRuns: runHistory === "active" ? 1 : 0 }));
    app.post("/api/v1/storage/run-history/clear", async c => {
      const { commandId } = ClearRunHistoryRequestSchema.parse(await c.req.json());
      const result = settled.get(commandId) ?? (runHistory === undefined || runHistory === "active"
        ? { state: "refused" as const, commandId, reason: runHistory === "active" ? "active-runs" as const : "unavailable" as const }
        : { state: "cleared" as const, commandId, deletedRuns: finishedRuns });
      settled.set(commandId, result);
      if (result.state === "cleared") finishedRuns = 0;
      return c.json(result);
    });

    app.get("/api/v1/storage/doctor/latest", (c) => c.json({ state: "never-run" }));
    app.get("/api/v1/storage/doctor", (c) => c.json(FIXTURE_STORAGE_DOCTOR as unknown));
  }

  return { registerFixtureStorageRoutes };
}
