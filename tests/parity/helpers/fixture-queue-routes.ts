import { Hono } from "hono";
import type { DashboardDayWire } from "../../../src/models/dashboard/projection.js";
import { FIXTURE_DAY } from "./fixture-identity.js";
import { wireError } from "../../support/fixtures/dashboard/fixture-wire-error.js";
export function registerFixtureQueueRoutes({ app, dayWire }: { app: Hono; dayWire: DashboardDayWire }): void {


  app.get("/api/v1/dashboard", (c) => {
    const day = c.req.query("day");
    if (day !== FIXTURE_DAY) {
      return c.json(wireError("TARGET_NOT_FOUND", `the fixture corpus serves only day ${FIXTURE_DAY}`), 404);
    }
    return c.json(dayWire as unknown);
  });
}
