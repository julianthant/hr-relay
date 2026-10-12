import { FIXTURE_ACTIVITY_REPORT } from "../../../fixtures/dashboard/fixture-activity.js";
import { FIXTURE_ACTIVITY_UNAVAILABLE_RANGE } from "../../../fixtures/dashboard/fixture-activity.js";
import { FIXTURE_ACTIVITY_UNAVAILABLE_REPORT } from "../../../fixtures/dashboard/fixture-activity.js";
import { wireError } from "../../../fixtures/dashboard/fixture-wire-error.js";
import { Hono } from "hono";
import { createHash } from "node:crypto";
import { selectionDownload } from "../../../../../src/backend/runs/exports/selection-download.js";
import { activityReportCsv, activityReportCsvFileName } from "../../../../../src/backend/runs/queries/activity-export.js";

export function createFixtureActivityRoutesSetup() {
  function registerFixtureActivityRoutes({ app }: { app: Hono }): void {

    app.get("/api/v1/reports/activity", (c) => {
      const from = c.req.query("from");
      const to = c.req.query("to");
      if (from === undefined || to === undefined) {
        return c.json(wireError("ACTIVITY_RANGE_REQUIRED", "an activity report requires from= and to="), 400);
      }
      const report = from === FIXTURE_ACTIVITY_UNAVAILABLE_RANGE.from && to === FIXTURE_ACTIVITY_UNAVAILABLE_RANGE.to
        ? FIXTURE_ACTIVITY_UNAVAILABLE_REPORT
        : FIXTURE_ACTIVITY_REPORT;
      return c.json({...report,snapshot:{from:report.from,to:report.to,generatedAt:report.generatedAt,expiresAt:"2099-01-01T00:00:00.000Z",sourceIdentity:"a".repeat(64),authorityGeneration:1,reportDigest:createHash("sha256").update(JSON.stringify(report)).digest("hex"),token:"as1.fixture.selection"}});
    });


    app.get("/api/v1/reports/activity.csv", (c) => {
      const from = c.req.query("from");
      const to = c.req.query("to");
      if (from === undefined || to === undefined) {
        return c.json(wireError("ACTIVITY_RANGE_REQUIRED", "an activity report requires from= and to="), 400);
      }
      const report = from === FIXTURE_ACTIVITY_UNAVAILABLE_RANGE.from && to === FIXTURE_ACTIVITY_UNAVAILABLE_RANGE.to
        ? FIXTURE_ACTIVITY_UNAVAILABLE_REPORT
        : FIXTURE_ACTIVITY_REPORT;
      if(c.req.query("snapshot")!=="as1.fixture.selection")return c.json(wireError("SELECTION_REQUIRED","review the report first"),409);
      return selectionDownload(activityReportCsv(report),activityReportCsvFileName(report),"text/csv; charset=utf-8","as1.fixture.selection");
    });
  }

  return { registerFixtureActivityRoutes };
}
