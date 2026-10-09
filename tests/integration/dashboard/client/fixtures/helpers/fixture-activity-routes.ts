import { createHash } from "node:crypto";
import { selectionDownload } from "../../../../../../src/backend/runs/exports/selection-download.js";
import { wireError } from "../../../../../support/fixtures/dashboard/fixture-wire-error.js";
import { Hono } from "hono";
import {
activityReportCsv,
activityReportCsvFileName,
} from "../../../../../../src/backend/runs/queries/activity-export.js";
import {
FIXTURE_ACTIVITY_REPORT,
FIXTURE_ACTIVITY_UNAVAILABLE_RANGE,
FIXTURE_ACTIVITY_UNAVAILABLE_REPORT
} from "../../../../../support/fixtures/dashboard/fixture-archive.js";
export function registerFixtureActivityRoutes({ app }: { app: Hono }): void {

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

  /**
   * D240's export, over the SAME fixture payload. The parity lane never clicks
   * it, and it is here anyway: a fixture server that answered the report and
   * 404'd its export would make the Export button dead in the one environment
   * the surface is photographed in, which is a surface state nobody would
   * notice until an operator pressed it.
   */
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
