import { Hono } from "hono";
import { FIXTURE_EXPLORER_WIRE } from "./fixture-explorer.js";
export function registerFixtureExplorerRoutes({ app }: { app: Hono }): void {



  app.get("/api/v1/explorer", (c) => c.json(FIXTURE_EXPLORER_WIRE as unknown));

}
