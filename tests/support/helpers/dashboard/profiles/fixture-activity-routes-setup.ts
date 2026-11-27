import { FIXTURE_ACTIVITY_REPORT } from "../../../fixtures/dashboard/fixture-activity.js";
import { FIXTURE_ACTIVITY_UNAVAILABLE_RANGE } from "../../../fixtures/dashboard/fixture-activity.js";
import { FIXTURE_ACTIVITY_UNAVAILABLE_REPORT } from "../../../fixtures/dashboard/fixture-activity.js";
import { wireError } from "../../../fixtures/dashboard/fixture-wire-error.js";
import { Hono } from "hono";
import { createHash } from "node:crypto";

export function createFixtureActivityRoutesSetup() {
  function registerFixtureActivityRoutes({ app }: { app: Hono }): void {

    app.get("/api/v1/reports/activity", (c) => {
      const from = c.req.query("from");
      const to = c.req.query("to");
      if (from === undefined || to === undefined) {
        return c.json(wireError("SCHEMA_INVALID", "an activity report requires both from= and to= as YYYY-MM-DD"), 400);
      }
      const report = from === FIXTURE_ACTIVITY_UNAVAILABLE_RANGE.from && to === FIXTURE_ACTIVITY_UNAVAILABLE_RANGE.to
        ? FIXTURE_ACTIVITY_UNAVAILABLE_REPORT
        : FIXTURE_ACTIVITY_REPORT;
      return c.json({...report,snapshot:{from:report.from,to:report.to,generatedAt:report.generatedAt,expiresAt:"2099-01-01T00:00:00.000Z",sourceIdentity:"a".repeat(64),authorityGeneration:1,reportDigest:createHash("sha256").update(JSON.stringify(report)).digest("hex"),token:"as1.fixture.selection"}});
    });

  }

  return { registerFixtureActivityRoutes };
}
