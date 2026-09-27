import { Hono } from "hono";
import { FIXTURE_STORAGE_DOCTOR } from "./fixture-storage.js";
export function registerFixtureStorageRoutes({ app }: { app: Hono }): void {

  app.get("/api/v1/storage/doctor/latest", (c) => c.json({ state: "never-run" }));
  app.get("/api/v1/storage/doctor", (c) => c.json(FIXTURE_STORAGE_DOCTOR as unknown));
}
