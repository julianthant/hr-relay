import { Hono } from "hono";
import type * as FixtureStorageTypes from "../../../fixtures/dashboard/fixture-storage.js";


export function createFixtureStorageRoutesSetup({ FIXTURE_STORAGE_DOCTOR }: {
  FIXTURE_STORAGE_DOCTOR: typeof FixtureStorageTypes.FIXTURE_STORAGE_DOCTOR;
}) {
  function registerFixtureStorageRoutes({ app }: { app: Hono }): void {

    app.get("/api/v1/storage/doctor/latest", (c) => c.json({ state: "never-run" }));
    app.get("/api/v1/storage/doctor", (c) => c.json(FIXTURE_STORAGE_DOCTOR as unknown));
  }

  return { registerFixtureStorageRoutes };
}
