/** Analytics fixtures for the state gallery: the sample report as the page's report hook, with the outcomes of an export, a slow read and a
 * browse that the page waits on. The real page runs unchanged on it. Browser-safe. */
import { useCallback, useMemo } from "react";
import type { ActivityReportHook } from "../../../../src/dashboard/surfaces/activity/activity.js";
import { activityDrilldown, type ActivityBrowse } from "../../../../src/dashboard/surfaces/activity/activity-drilldown-model.js";
import { ACTIVITY_SAMPLE_RANGE, activitySample, type ActivitySampleState } from "./activity-sample.js";

export const ANALYTICS_STORY_TODAY = "2026-09-26";
export const ANALYTICS_STORY_RANGE = `${ACTIVITY_SAMPLE_RANGE.from}..${ACTIVITY_SAMPLE_RANGE.to}`;

/** What an export comes back as: it never answers, or it fails. */
export type AnalyticsExport = "never" | "fail";

export interface AnalyticsStoryOptions {
  readonly scenario?: ActivitySampleState;
  readonly export?: AnalyticsExport;
  /** The report on screen is the sample period while the period asked for is read: the page holds it, marked Updating, and opens nothing. */
  readonly held?: true;
  /** A browse that is read and not yet answered. */
  readonly browsePending?: true;
  /** What the page says under the toolbar after an action. */
  readonly notice?: string;
}

export function analyticsStoryReport(options: AnalyticsStoryOptions = {}): ActivityReportHook {
  const { scenario = "normal", held = false, browsePending = false, notice = "" } = options;
  return (_client, range, browse: ActivityBrowse | null, _sources, enabled) => {
    const data = useMemo(() => activitySample(enabled && !held ? range : ACTIVITY_SAMPLE_RANGE, scenario), [enabled, range]);
    const browsed = useMemo(() => browse === null || data.state !== "loaded" || data.report.runs === undefined || browsePending ? undefined : activityDrilldown(data.report.runs, browse), [browse, data]);
    const exportCsv = useCallback((): ReturnType<ReturnType<ActivityReportHook>["exportCsv"]> =>
      options.export === "never" ? new Promise(() => undefined) : Promise.reject(new Error("The export did not complete.")), []);
    return useMemo(() => ({ data, ...(browsed === undefined ? {} : { browse: browsed }), pending: held || browsePending, exportReady: !held && !browsePending, notice, exportCsv }), [data, browsed, exportCsv]);
  };
}
