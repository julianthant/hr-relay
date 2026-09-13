import { ActivityReportWireSchema,type ActivityReportWire } from "../../domain/dashboard/activity.js";
import { parseOrThrow } from "./query-parse.js";
import type { DashboardTransport } from "./transport.js";


export interface ActivityQueries {

  /**
   * The Activity report over an explicit range (2i-G, D180). Both bounds are
   * required — an aggregate over a window the caller never named is a number
   * nobody asked for.
   */
  activityReport(from: string, to: string): Promise<ActivityReportWire>;

  /**
   * Where the same report's CSV lives (D240). A URL rather than a promise of
   * bytes: the browser downloads it from a link, so nothing here holds the
   * artifact in memory, and the export refuses a missing bound exactly as the
   * report route does — which is why both bounds are required here too.
   */
  activityExportUrl(from: string, to: string): string;
}

export function createActivityQueries(transport: DashboardTransport): ActivityQueries { return Object.freeze({

    async activityReport(from: string, to: string): Promise<ActivityReportWire> {
      const path = `/api/v1/reports/activity?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
      return parseOrThrow(ActivityReportWireSchema, `GET ${path}`, await transport.requestJson(path));
    },

    activityExportUrl(from: string, to: string): string {
      return transport.resolveUrl(
        `/api/v1/reports/activity.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
    }
}); }
