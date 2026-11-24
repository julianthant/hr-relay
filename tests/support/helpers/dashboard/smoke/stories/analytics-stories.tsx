/** Analytics surface stories: the report's read, the periods and workflow filter, the sections it shows, every run list the drilldown
 * opens, a run's logs, and the export. The real page runs on the sample report; the drilldown is the page's own model over it. */
import type { Page } from "@playwright/test";
import { useState } from "react";
import { ERROR_CATALOG } from "../../../../../../src/models/failures/error-catalog.js";
import { ActivityReport } from "../../../../../../src/dashboard/surfaces/activity/activity.js";
import type { ActivityBrowse, ActivityDrilldownData } from "../../../../../../src/dashboard/surfaces/activity/activity-drilldown-model.js";
import type { ActivityViewState } from "../../../../../../src/dashboard/surfaces/activity/activity-view-model.js";
import type { ViewRoute } from "../../../../../../src/dashboard/app/navigation/view-route-model.js";
import { ANALYTICS_STORY_RANGE, ANALYTICS_STORY_TODAY, analyticsStoryReport, type AnalyticsStoryOptions } from "../../../../fixtures/dashboard/analytics-story-fixtures.js";
import type { ActivitySampleState } from "../../../../fixtures/dashboard/activity-sample.js";
import { withKnownBreaks } from "../known-breaks.js";
import { defineSurface, type Story } from "../story-catalogue.js";
import { StoryFrame } from "./story-frame.js";
import { ViewNavigationHost } from "./view-navigation-host.js";

interface Scene {
  readonly report?: AnalyticsStoryOptions;
  readonly range?: string;
  readonly browse?: ActivityBrowse;
  readonly play?: (page: Page) => Promise<void>;
  readonly story?: Partial<Story>;
}

function AnalyticsStoryPage({ scene }: { scene: Scene }) {
  const [range, setRange] = useState(scene.range ?? ANALYTICS_STORY_RANGE);
  const [useReport] = useState(() => analyticsStoryReport(scene.report));
  const initial: ViewRoute = scene.browse === undefined ? {} : { activityBrowse: scene.browse };
  return <StoryFrame><ViewNavigationHost initial={initial}><main className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
    <ActivityReport range={range} onRange={setRange} today={ANALYTICS_STORY_TODAY} useReport={useReport} />
  </main></ViewNavigationHost></StoryFrame>;
}

const READY = '[aria-label="Analytics report"] >> text="Runs"';
function scene(title: string, input: Scene = {}): Story {
  return { title, render: () => <AnalyticsStoryPage scene={input} />, ready: READY, ...(input.play === undefined ? {} : { play: input.play }), ...input.story };
}

/** The period choice is a visually hidden radio inside its label, so a person presses the label. */
const period = (name: string) => async (page: Page): Promise<void> => { await page.locator("label", { hasText: name }).first().click(); };
const click = (name: string | RegExp, role: "button" | "link" | "radio" | "menuitemradio" = "button") => async (page: Page): Promise<void> => {
  await page.getByRole(role, { name, exact: typeof name === "string" }).first().click();
};
const then = (...steps: readonly ((page: Page) => Promise<void>)[]) => async (page: Page): Promise<void> => { for (const step of steps) await step(page); };
const RUNS = '[aria-label="Analytics runs"]';
const browse = (selection: Partial<ActivityBrowse>): ActivityBrowse => ({ metric: "completed", page: 0, ...selection });
const drill = (title: string, selection: Partial<ActivityBrowse>, ready: string, extra: Partial<Scene> = {}): Story =>
  scene(title, { browse: browse(selection), story: { ready: `${RUNS} >> ${ready}` }, ...extra });

const VIEW = {
  loaded: scene("The report for the week"),
  loading: scene("The report being read", { report: { scenario: "loading" }, story: { ready: 'text="Analytics"', slowFetch: { region: '[aria-label="Loading analytics report"]' } } }),
  unavailable: scene("The report could not be read", { report: { scenario: "unavailable" }, story: { ready: 'text="Couldn\'t load Analytics."' } }),
} satisfies Record<ActivityViewState["state"], Story>;

type ReportContents = Exclude<ActivitySampleState, "normal" | "loading" | "unavailable">;
const CONTENTS = {
  empty: scene("A period with no runs", { report: { scenario: "empty" }, story: { ready: 'text="No runs in this period"' } }),
  incomplete: scene("A report with no times or evidence", { report: { scenario: "incomplete" }, story: { ready: 'text="Runs"' } }),
} satisfies Record<ReportContents, Story>;

/** Combinations a person meets choosing a period, a workflow or a row. */
type View = "range-30d" | "range-90d" | "range-refused" | "period-updating" | "one-workflow" | "workflow-details";
const PICK = {
  "range-30d": scene("The last 30 days", { play: period("30d"), story: { ready: 'text="Runs"' } }),
  "range-90d": scene("The last 90 days", { play: period("90d"), story: { ready: 'text="Runs"' } }),
  "range-refused": scene("An address with a date range that is not valid", { range: "later..earlier", story: { ready: 'text="That date range is not valid. Pick a period above."' } }),
  "period-updating": scene("The next period read while the last one stays", { range: "2026-08-28..2026-09-26", report: { held: true }, story: { ready: '[data-analytics-stale]' } }),
  "one-workflow": scene("One workflow chosen", { play: then(click("By workflow"), click("Separations", "menuitemradio")), story: { ready: 'button:has-text("Separations")' } }),
  "workflow-details": scene("A workflow row opened", { play: click("Show Separations details"), story: { ready: 'text="Open runs"' } }),
} satisfies Record<View, Story>;

const METRIC = {
  completed: drill("Completed runs of a workflow", { workflow: "sample-separations" }, '[aria-label="Search runs"]'),
  outstanding: drill("Outstanding runs", { metric: "outstanding" }, '[aria-label="Search runs"]'),
  failed: drill("Failed runs", { metric: "failed" }, '[aria-label="Search runs"]'),
  timed: drill("Runs with a recorded time", { metric: "timed" }, '[aria-label="Search runs"]'),
} satisfies Record<ActivityBrowse["metric"], Story>;

const LIST = {
  loaded: drill("A page of runs", { workflow: "sample-person-lookup" }, '[aria-label="Search runs"]'),
  unavailable: drill("A workflow with no runs in the period", { workflow: "nowhere" }, 'text="This workflow has no runs in the selected period."'),
} satisfies Record<ActivityDrilldownData["state"], Story>;

/** Combinations a person meets browsing a list: searching, ordering, paging, opening a run, and waiting. */
type Browse = "search" | "search-none" | "ordered" | "second-page" | "run-open" | "run-missing" | "page-missing" | "reading" | "outstanding-status";
const BROWSE = {
  search: drill("A search that matches some runs", { query: "morgan" }, 'text=/ of \\d+ runs/'),
  "search-none": drill("A search that matches nothing", { query: "zzz" }, 'text="No runs match your search."'),
  ordered: drill("Runs ordered by duration, longest first", { sort: { column: "duration", direction: "descending" } }, '[aria-label="Run order"]'),
  "second-page": drill("The second page of runs", { page: 1 }, 'text=/21–\\d+ of/'),
  "run-open": drill("One run's logs", { workflow: "sample-person-lookup", run: "activity-sample-29" }, 'text="Run input"'),
  "run-missing": drill("A run that is not in the result", { run: "nowhere" }, 'text="This run is not part of the selected Analytics result."'),
  "page-missing": scene("A page past the last one", { browse: browse({ page: 9 }), story: { ready: 'text="This page is unavailable."' } }),
  reading: scene("A list being read", { browse: browse({}), report: { browsePending: true }, story: { ready: '[aria-label="Loading Analytics runs"]', slowFetch: { region: '[aria-label="Loading Analytics runs"]' } } }),
  "outstanding-status": drill("Outstanding runs show their status", { metric: "outstanding" }, 'text="Status"'),
} satisfies Record<Browse, Story>;

type Export = "exporting" | "failed";
const EXPORT = {
  exporting: scene("An export waiting on its file", { report: { export: "never" }, play: click("Export"), story: { ready: 'button[aria-busy="true"]' } }),
  failed: scene("An export that did not complete", { report: { export: "fail" }, play: click("Export"), story: { ready: `text="${ERROR_CATALOG.DASHBOARD_READ_FAILED.text}"` } }),
} satisfies Record<Export, Story>;

const AUDIT_FIXES = "#532";
const KNOWN_BREAKS = {
  "browse/ordered": ["named-and-focusable"],
  "browse/outstanding-status": ["named-and-focusable"],
  "browse/page-missing": ["named-and-focusable"],
  "browse/reading": ["named-and-focusable"],
  "browse/run-missing": ["named-and-focusable"],
  "browse/run-open": ["named-and-focusable"],
  "browse/search": ["named-and-focusable"],
  "browse/search-none": ["named-and-focusable"],
  "browse/second-page": ["named-and-focusable"],
  "contents/incomplete": ["named-and-focusable"],
  "export/exporting": ["named-and-focusable"],
  "export/failed": ["named-and-focusable"],
  "list/loaded": ["named-and-focusable"],
  "list/unavailable": ["named-and-focusable"],
  "metric/completed": ["named-and-focusable"],
  "metric/failed": ["named-and-focusable"],
  "metric/outstanding": ["named-and-focusable"],
  "metric/timed": ["named-and-focusable"],
  "pick/one-workflow": ["named-and-focusable"],
  "pick/period-updating": ["named-and-focusable"],
  "pick/range-30d": ["named-and-focusable"],
  "pick/range-90d": ["named-and-focusable"],
  "pick/workflow-details": ["named-and-focusable", "no-banned-text"],
  "view/loaded": ["named-and-focusable"],
} as const;

export const ANALYTICS_STORIES = withKnownBreaks(
  defineSurface("analytics", { view: VIEW, contents: CONTENTS, pick: PICK, metric: METRIC, list: LIST, browse: BROWSE, export: EXPORT }),
  "analytics", AUDIT_FIXES, KNOWN_BREAKS);
