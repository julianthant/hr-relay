import { Hono } from "hono";
import { FIXTURE_EXPLORER_WIRE,FIXTURE_UI_CATALOG_WIRE } from "./fixture-explorer.js";
export function registerFixtureExplorerRoutes({ app }: { app: Hono }): void {


  /**
   * The two read-only reference routes (2i-G). Both serve the REAL projection
   * — see `fixture-explorer.ts` for why these fixtures are not hand-written.
   */
  app.get("/api/v1/explorer", (c) => c.json(FIXTURE_EXPLORER_WIRE as unknown));

  app.get("/api/v1/ui-catalog", (c) => c.json(FIXTURE_UI_CATALOG_WIRE as unknown));
}
