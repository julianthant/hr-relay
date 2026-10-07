import { z } from "zod";
import { selectionDownload } from "../../../runs/exports/selection-download.js";
import { ActivitySnapshotTokenSchema } from "../../../../models/dashboard/activity-selection.js";
import { activityReportCsv, activityReportCsvFileName } from "../../../runs/queries/activity-export.js";

import type { DashboardApp } from "./api-types.js";
import type { ActivityRouteDeps } from "./activity-types.js";

export function registerActivityRoutes(app: DashboardApp, deps: ActivityRouteDeps): void {
  app.get("/api/v1/reports/activity", (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (from === undefined || to === undefined) {
      // A missing range is NOT "today" or "this month": an aggregate over a
      // window the caller never named is a number nobody asked for.
      throw new Error("an activity report requires both from= and to= as YYYY-MM-DD");
    }
    const parameters=[...new URL(c.req.url).searchParams];
    if(new Set(parameters.map(([key])=>key)).size!==parameters.length)throw new Error("activity-report-duplicate-query");
    z.strictObject({from:z.iso.date(),to:z.iso.date()}).parse(Object.fromEntries(parameters));
    return c.json(deps.activity.read(from, to));
  });

  /**
   * The same report as a file (D240). It refuses a missing bound in the SAME
   * words as the JSON route above — an export is the one copy that gets mailed
   * on, so a window it defaulted silently would travel further than a page that
   * did. The artifact carries its own caveats; see `activity-export.ts`.
   */
  app.get("/api/v1/reports/activity.csv", (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (from === undefined || to === undefined) {
      throw new Error("an activity report requires both from= and to= as YYYY-MM-DD");
    }
    const parameters=[...new URL(c.req.url).searchParams];
    if(new Set(parameters.map(([key])=>key)).size!==parameters.length)throw new Error("activity-export-duplicate-query");
    const selection=z.strictObject({from:z.iso.date(),to:z.iso.date(),snapshot:ActivitySnapshotTokenSchema}).parse(Object.fromEntries(parameters));
    const report = deps.activity.readSelected(from, to, selection.snapshot);
    return selectionDownload(activityReportCsv(report),activityReportCsvFileName(report),"text/csv; charset=utf-8",selection.snapshot);
  });

}
