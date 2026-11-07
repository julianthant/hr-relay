import { Hono } from "hono";
import type * as FixtureExplorerTypes from "../../../fixtures/dashboard/fixture-explorer.js";


export function createFixtureExplorerRoutesSetup({ FIXTURE_EXPLORER_WIRE }: {
  FIXTURE_EXPLORER_WIRE: typeof FixtureExplorerTypes.FIXTURE_EXPLORER_WIRE;
}) {
  function registerFixtureExplorerRoutes({ app }: { app: Hono }): void {


    /** The read-only Explorer reference route serves the REAL projection. */
    app.get("/api/v1/explorer", (c) => c.json(FIXTURE_EXPLORER_WIRE as unknown));
  }

  return { registerFixtureExplorerRoutes };
}
