import { Hono } from "hono";
import { FIXTURE_EXPLORER_WIRE } from "../../../fixtures/dashboard/fixture-explorer.js";
export function registerFixtureExplorerRoutes({ app }: { app: Hono }): void {


  /** The read-only Explorer reference route serves the REAL projection. */
  app.get("/api/v1/explorer", (c) => c.json(FIXTURE_EXPLORER_WIRE as unknown));
}
