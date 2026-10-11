import { Hono } from "hono";
import type { FixtureDashboardProfile } from "../../../fixtures/dashboard/fixture-profile.js";
import { FIXTURE_START_PLAN } from "../../../fixtures/dashboard/fixture-start.js";
export function registerFixtureStartRoutes({ app, profile }: { app: Hono; profile: FixtureDashboardProfile }): void {


  app.post("/api/v1/start-plans", (c) => c.json((profile.startPlan ?? FIXTURE_START_PLAN) as unknown));
}
