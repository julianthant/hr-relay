import type { FixtureDashboardProfile } from "./fixture-profile.js";
import { Hono } from "hono";
export function registerFixtureShellRoutes({ app, profile }: { app: Hono; profile: FixtureDashboardProfile }): void {


  app.get("/api/v1/bootstrap", (c) => c.json(profile.bootstrap as unknown));
}
