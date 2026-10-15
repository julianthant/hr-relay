import { z } from "zod";
import { ActivityPopulationRangeSchema, ActivityPopulationTokenSchema, ActivityPopulationBrowseSchema, ActivityPopulationSelectedRequestSchema, ActivityPopulationSelectionSchema, ActivityPopulationSelectedReadSchema } from "../../../../models/dashboard/activity-population.js";
import { ActivityPopulationError } from "../../../runs/queries/activity-population.js";
import { ActivitySnapshotError } from "../../../runs/queries/activity-selection.js";
import { DashboardReadFailedError } from "../../../runs/commands/refusals.js";
import { selectionDownload } from "../../../runs/exports/selection-download.js";
import { ActivitySnapshotTokenSchema } from "../../../../models/dashboard/activity-selection.js";
import { activityReportCsv, activityReportCsvFileName } from "../../../runs/queries/activity-export.js";

import type { DashboardApp } from "./api-types.js";
import type { ActivityRouteDeps } from "./activity-types.js";

function populationParameters(url: string): Record<string, string> {
  const parameters = [...new URL(url).searchParams];
  if (new Set(parameters.map(([key]) => key)).size !== parameters.length) throw new ActivityPopulationError("ACTIVITY_POPULATION_RANGE_INVALID");
  return Object.fromEntries(parameters);
}

function populationFailure(error: unknown): never {
  if (error instanceof ActivityPopulationError || error instanceof ActivitySnapshotError) throw error;
  throw new DashboardReadFailedError(error);
}

export function registerActivityRoutes(app: DashboardApp, deps: ActivityRouteDeps): void {
  app.get("/api/v1/reports/activity", (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (from === undefined || to === undefined) {
      throw new Error("an activity report requires both from= and to= as YYYY-MM-DD");
    }
    const parameters=[...new URL(c.req.url).searchParams];
    if(new Set(parameters.map(([key])=>key)).size!==parameters.length)throw new Error("activity-report-duplicate-query");
    z.strictObject({from:z.iso.date(),to:z.iso.date()}).parse(Object.fromEntries(parameters));
    return c.json(deps.activity.read(from, to));
  });


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

  app.get("/api/v1/reports/activity/population", (c) => {
    try {
      const range = ActivityPopulationRangeSchema.safeParse(populationParameters(c.req.url));
      if (!range.success) throw new ActivityPopulationError("ACTIVITY_POPULATION_RANGE_INVALID");
      return c.json(ActivityPopulationSelectionSchema.parse(deps.activityPopulation.read(range.data)));
    } catch (error) { populationFailure(error); }
  });

  app.get("/api/v1/reports/activity/population/selected", (c) => {
    try {
      const parameters = populationParameters(c.req.url);
      const range = ActivityPopulationRangeSchema.safeParse({ from: parameters.from, to: parameters.to });
      if (!range.success) throw new ActivityPopulationError("ACTIVITY_POPULATION_RANGE_INVALID");
      const token = ActivityPopulationTokenSchema.safeParse(parameters.snapshot);
      if (!token.success) throw new ActivitySnapshotError("ACTIVITY_SNAPSHOT_INVALID_OR_EXPIRED");
      let browse: unknown;
      if (parameters.browse !== undefined) {
        try { browse = JSON.parse(parameters.browse); }
        catch { throw new ActivityPopulationError("ACTIVITY_POPULATION_BROWSE_INVALID"); }
        if (!ActivityPopulationBrowseSchema.safeParse(browse).success) throw new ActivityPopulationError("ACTIVITY_POPULATION_BROWSE_INVALID");
      }
      const parsed = z.strictObject({ from: z.string(), to: z.string(), snapshot: z.string(), browse: z.string().optional() }).safeParse(parameters);
      if (!parsed.success) throw new ActivityPopulationError("ACTIVITY_POPULATION_BROWSE_INVALID");
      const request = ActivityPopulationSelectedRequestSchema.parse({ ...range.data, snapshot: token.data, ...(browse === undefined ? {} : { browse }) });
      return c.json(ActivityPopulationSelectedReadSchema.parse(deps.activityPopulation.readSelected(range.data, request.snapshot, request.browse)));
    } catch (error) { populationFailure(error); }
  });

  app.get("/api/v1/reports/activity/population.csv", (c) => {
    try {
      const parameters = populationParameters(c.req.url);
      const range = ActivityPopulationRangeSchema.safeParse({ from: parameters.from, to: parameters.to });
      if (!range.success) throw new ActivityPopulationError("ACTIVITY_POPULATION_RANGE_INVALID");
      const token = ActivityPopulationTokenSchema.safeParse(parameters.snapshot);
      if (!token.success) throw new ActivitySnapshotError("ACTIVITY_SNAPSHOT_INVALID_OR_EXPIRED");
      if (!z.strictObject({ from: z.string(), to: z.string(), snapshot: z.string() }).safeParse(parameters).success) throw new ActivityPopulationError("ACTIVITY_POPULATION_RANGE_INVALID");
      const exported = deps.activityPopulation.exportSelected(range.data, token.data);
      return selectionDownload(exported.csv, exported.filename, exported.mediaType, token.data);
    } catch (error) { populationFailure(error); }
  });

}
