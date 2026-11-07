import { Hono } from "hono";
import type { FixtureDashboardProfile } from "../../../fixtures/dashboard/fixture-profile.js";
import type * as FixtureStartTypes from "../../../fixtures/dashboard/fixture-start.js";


export function createFixtureStartRoutesSetup({ FIXTURE_START_PLAN }: {
  FIXTURE_START_PLAN: typeof FixtureStartTypes.FIXTURE_START_PLAN;
}) {
  function registerFixtureStartRoutes({ app, profile }: { app: Hono; profile: FixtureDashboardProfile }): void {


    app.post("/api/v1/start-plans", (c) => c.json((profile.startPlan ?? FIXTURE_START_PLAN) as unknown));
  }

  return { registerFixtureStartRoutes };
}
