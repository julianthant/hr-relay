import { writeFile } from "node:fs/promises";
import type { Locator, Page } from "@playwright/test";
import { analyticsPeriodLabel, shiftDate } from "../../src/dashboard/surfaces/activity/analytics-model.js";
import { encodeEditableWorkbook, WorkbookImportResultSchema } from "../../src/models/dashboard/workbooks.js";
import { importWorkbook } from "../../src/rules/spreadsheets/workbook-io.js";
import { DESKTOP_VIEWPORTS, type DashboardPage } from "../support/helpers/dashboard/smoke/dashboard-page.js";
import { holdDashboardSkeletonRead, openWithColdSettingsHold, SKELETON_READ_HOLD_MS } from "../support/helpers/dashboard/smoke/hold-dashboard-skeleton-read.js";
import { expect, test } from "../support/helpers/dashboard/smoke/smoke-fixtures.js";

const SKELETON = '[data-slot="skeleton"]';
const SHEETS = 'section[aria-label="Spreadsheets"]';
const RUN_PANEL = '[aria-label="Selected run logs"]';
const QUEUE = '[aria-label="Queue"]';
const RUN_LOADING = `${RUN_PANEL} div:has(> [aria-label="Loading logs"])`;
const RUN_SETTLED = `${RUN_PANEL} [role="region"][aria-label="Run logs"]`;
const QUEUE_LOADING = `${QUEUE} [aria-label="Loading queue"]`;
const QUEUE_SETTLED = `${QUEUE} .queue-filter-content`;
const SETTINGS_FORM = '#dashboard-settings-content .settings-compact-form';
const REPORT = 'section[aria-label="Analytics report"]';
const RUNS_SECTION = `${REPORT} section[aria-label="Runs"]`;
const REPORT_TOOLBAR = `${REPORT} .ds-toolbar-row`;
const OPEN_RUNS = { selector: `${REPORT} button`, text: "Open runs" };
const THEME_FIELD = '[data-settings-path="appearance.theme"]';
const DATE_FEEDBACK = "Choose a valid date";
const FILE_NAME = "Synthetic roster.csv";
const SHEET_NAME = "Synthetic roster";
const CSV = ["Employee ID,Name", ...Array.from({ length: 60 }, (_, row) => `S${row},Sample ${row}`)].join("\n");

type Hold = Awaited<ReturnType<typeof holdDashboardSkeletonRead>>;
type ElementTarget = { selector: string; text?: string };
type Scene = {
  pendingRegion?: string;
  bounds?: { pending: string; settled: string };
  keep?: ElementTarget;
  focus?: string;
  checkSessionBar?: boolean;
  feedback?: ElementTarget;
  analyticsPeriod?: string;
};

function startFrames(page: Page, trigger: Awaited<ReturnType<Locator["elementHandle"]>> | null, event: string, scene: Scene) {
  return page.evaluateHandle(({ trigger, event, scene, skeleton, report, toolbar, runs, openRuns }) => {
    let start: number | undefined;
    let animation = 0;
    const visible = (element: Element) => element.getClientRects().length > 0
      && element.checkVisibility({ visibilityProperty: true, opacityProperty: true });
    const find = (selector: string | undefined) => selector === undefined ? undefined
      : [...document.querySelectorAll(selector)].find(visible);
    const findTarget = (target: ElementTarget | undefined) => target === undefined ? undefined
      : [...document.querySelectorAll(target.selector)].find(element => (target.text === undefined || element.textContent?.trim() === target.text) && visible(element));
    const rect = (element: Element | undefined | null, origin?: DOMRect) => {
      const bounds = element?.getBoundingClientRect();
      if (bounds === undefined) return undefined;
      const { x, y, width, height } = bounds;
      return { x: x - (origin?.x ?? 0), y: y - (origin?.y ?? 0), width, height };
    };
    const analyticsBoxes = (link: Element | undefined) => {
      const origin = find(report)?.getBoundingClientRect();
      return { runs: rect(find(runs), origin), details: rect(link?.closest("tr"), origin), action: rect(link, origin) };
    };
    let fixedElement = findTarget(scene.keep);
    const initialAnalytics = scene.analyticsPeriod === undefined ? undefined : analyticsBoxes(findTarget(openRuns));
    const sample = () => {
      const at = performance.now();
      const skeletons = [...document.querySelectorAll(skeleton)].filter(visible);
      const outside = skeletons.filter(element => scene.pendingRegion === undefined || !element.closest(scene.pendingRegion));
      // The console starts closed, so the footer's Add workers control carries the Sessions state.
      const sessions = document.querySelector('.workspace-rail-icons');
      const sessionText = sessions === null || !visible(sessions) ? undefined
        : sessions.querySelector('[aria-label="Sessions are loading"]') ? "Loading"
        : sessions.querySelector('[aria-label="Sessions are unavailable"]') ? "Unavailable" : "Ready";
      const currentFixedElement = findTarget(scene.keep);
      fixedElement ??= currentFixedElement;
      const drillIn = scene.analyticsPeriod === undefined ? undefined : findTarget(openRuns);
      return {
        at, skeletons: skeletons.length, outside: outside.length,
        outsideRegions: [...new Set(outside.map(element => element.closest('[data-loading-layout], section[aria-label], aside[aria-label]')?.getAttribute('aria-label') ?? 'unnamed'))],
        pendingBounds: rect(find(scene.bounds?.pending)), settledBounds: rect(find(scene.bounds?.settled)),
        kept: currentFixedElement !== undefined && currentFixedElement === fixedElement,
        focused: scene.focus !== undefined && document.activeElement?.matches(scene.focus) === true,
        sessionText,
        feedback: findTarget(scene.feedback) !== undefined,
        analytics: scene.analyticsPeriod === undefined ? undefined : {
          period: find(`${toolbar} [data-analytics-period]`)?.textContent?.trim(),
          reading: findTarget({ selector: `${toolbar} [data-analytics-reading] > *` }) !== undefined,
          exportLocked: findTarget({ selector: `${toolbar} button:disabled`, text: "Export" }) !== undefined,
          drillInLocked: drillIn instanceof HTMLButtonElement && drillIn.disabled,
          bounds: analyticsBoxes(drillIn),
        },
      };
    };
    const frames: ReturnType<typeof sample>[] = [];
    const frame = () => { frames.push(sample()); animation = requestAnimationFrame(frame); };
    const startSampling = () => {
      start = performance.now();
      animation = requestAnimationFrame(frame);
    };
    (trigger ?? window).addEventListener(event, startSampling, { capture: true, once: true });
    return {
      async finish() {
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        cancelAnimationFrame(animation);
        return { start, frames, initialAnalytics, viewport: { width: innerWidth, height: innerHeight }, theme: document.documentElement.dataset.demoTheme };
      },
    };
  }, { trigger, event, scene, skeleton: SKELETON, report: REPORT, toolbar: REPORT_TOOLBAR, runs: RUNS_SECTION, openRuns: OPEN_RUNS });
}

async function measure(
  page: Page, trigger: Locator | null, act: () => Promise<unknown>, settled: () => Promise<unknown>,
  scene: Scene = {}, hold?: Hold, event = trigger === null ? "popstate" : "click",
) {
  await expect(page.locator(SKELETON).first()).toBeHidden();
  const frames = await startFrames(page, trigger === null ? null : await trigger.elementHandle(), event, scene);
  const stopFrames = () => frames.evaluate(recorder => recorder.finish());
  let result: Awaited<ReturnType<typeof stopFrames>>;
  const readTiming = () => hold?.evaluate(read => read.timing);
  let timing: Awaited<ReturnType<typeof readTiming>>;
  let actionEvidence: unknown;
  try {
    actionEvidence = await act();
    // A held read can settle outside the measured component. Require the hold to actually release.
    if (hold !== undefined && scene.feedback === undefined) {
      await expect.poll(() => hold.evaluate(read => read.timing.releasedAt), { timeout: 8_000 }).toBeDefined();
    }
    await settled();
  } finally {
    result = await stopFrames();
    timing = await readTiming();
    await writeFile(test.info().outputPath("measurements.json"), JSON.stringify({ test: test.info().title, ...result, timing, actionEvidence }, null, 2));
    console.log(measurementLine(result, timing));
  }

  const { start, frames: samples } = result;
  expect(result.theme).toBe("dark");
  expect(result.viewport).toEqual(page.viewportSize());
  expect(start, `browser received ${event}`).toBeDefined();
  if (start === undefined) throw new Error(`Missing ${event} timestamp`);
  expect(samples.length, "sampled browser frames").toBeGreaterThan(0);
  const firstSkeleton = samples.find(frame => frame.skeletons > 0);
  if (scene.pendingRegion === undefined) {
    expect.soft(samples.filter(frame => frame.skeletons > 0), "no skeleton frame").toHaveLength(0);
  } else {
    expect.soft(samples.filter(frame => frame.outside > 0), "skeletons stay inside the waiting region").toHaveLength(0);
  }
  if (scene.feedback !== undefined) {
    expect.soft(samples.find(frame => frame.feedback)?.at, "date feedback within one second").toBeLessThanOrEqual(start + 1_000);
    expect.soft(timing?.requestedAt, "no day stream opened for the refused date").toBeUndefined();
  } else if (hold !== undefined) {
    const { requestedAt, withheldAt, windowStartedAt, releasedAt } = timing ?? {};
    if (requestedAt === undefined || withheldAt === undefined || windowStartedAt === undefined || releasedAt === undefined) {
      throw new Error("Missing timestamps for the matched read, hold window or release");
    }
    expect.soft(releasedAt - windowStartedAt, "minimum hold window").toBeGreaterThanOrEqual(SKELETON_READ_HOLD_MS);
    // The page is pending from the operator's action; the held request itself goes out a few milliseconds later.
    const pendingAt = start;
    const pendingFrames = samples.filter(frame => frame.at >= pendingAt && frame.at < releasedAt);
    expect.soft(pendingFrames.length, "sampled during the hold").toBeGreaterThan(0);
    const checkAppearance = (firstAt: number | undefined, indicator: string) => {
      expect.soft(firstAt, `${indicator} at least 300 ms into the pending state`).toBeGreaterThanOrEqual(pendingAt + 300);
      expect.soft(firstAt, `${indicator} by 500 ms on the CI runner`).toBeLessThanOrEqual(pendingAt + 500);
      expect.soft(firstAt, `${indicator} before release`).toBeLessThan(releasedAt);
    };
    if (scene.pendingRegion !== undefined) checkAppearance(firstSkeleton?.at, "first skeleton");
    if (scene.bounds !== undefined) {
      const pending = samples.findLast(frame => frame.skeletons > 0 && frame.at < releasedAt)?.pendingBounds;
      const loaded = samples.at(-1)?.settledBounds;
      expect.soft(pending, "pending region bounds").toBeDefined();
      expect.soft(loaded, "settled region bounds").toBeDefined();
      if (pending !== undefined && loaded !== undefined) {
        for (const key of ["x", "y", "width", "height"] as const) {
          expect.soft(Math.abs(pending[key] - loaded[key]), `region ${key} within one CSS pixel`).toBeLessThanOrEqual(1);
        }
      }
    }
    if (scene.analyticsPeriod !== undefined) {
      checkAppearance(samples.find(frame => frame.analytics?.reading)?.at, "Spinner beside the date");
      expect.soft(pendingFrames.filter(frame => frame.analytics?.period !== scene.analyticsPeriod), "prior report keeps its own period").toHaveLength(0);
      expect.soft(pendingFrames.filter(frame => !frame.analytics?.exportLocked || !frame.analytics.drillInLocked),
        "Export and Open runs stay locked during the read").toHaveLength(0);
      for (const part of ["runs", "details", "action"] as const) {
        const before = result.initialAnalytics?.[part];
        expect.soft(before, `settled Analytics ${part} bounds`).toBeDefined();
        if (before === undefined) continue;
        for (const key of ["x", "y", "width", "height"] as const) {
          expect.soft(pendingFrames.filter(frame => Math.abs((frame.analytics?.bounds[part]?.[key] ?? Infinity) - before[key]) > 1),
            `held Analytics ${part} ${key} within one CSS pixel`).toHaveLength(0);
        }
      }
      expect.soft(samples.at(-1)?.analytics?.reading, "Spinner clears on settlement").toBe(false);
    }
  }
  if (scene.keep !== undefined) {
    const firstKept = samples.find(frame => frame.kept);
    expect.soft(samples.some(frame => frame.kept && frame.at < (timing?.releasedAt ?? Infinity)), "fixed element mounted before settlement").toBe(true);
    expect.soft(samples.filter(frame => frame.at >= (firstKept?.at ?? start) && !frame.kept),
      "fixed frame stayed mounted through settlement").toHaveLength(0);
  }
  if (scene.focus !== undefined) {
    const firstFocused = samples.find(frame => frame.focused);
    expect.soft(firstFocused?.at, "focus was set while the read was pending").toBeLessThan(timing?.releasedAt ?? start);
    expect.soft(samples.filter(frame => frame.at >= (firstFocused?.at ?? start) && !frame.focused), "focus stayed through settlement").toHaveLength(0);
  }
  if (scene.checkSessionBar) {
    expect.soft(samples.every(frame => frame.sessionText !== undefined && frame.sessionText !== "Loading"
      && (scene.feedback !== undefined || frame.sessionText !== "Unavailable")), "Sessions bar stays settled").toBe(true);
  }
  expect.soft(samples.at(-1)?.skeletons, "no skeleton left after settlement").toBe(0);
}

type Box = { width: number; height: number } | undefined;
/** One log line per case: the CI job log is the evidence. */
function measurementLine(result: { start?: number; viewport: { width: number; height: number }; frames: readonly { at: number; skeletons: number; feedback: boolean; pendingBounds?: Box; settledBounds?: Box }[] },
  timing: { releasedAt?: number } | undefined) {
  const { start = 0, frames } = result;
  const pendingAt = start;
  const skeletons = frames.filter(frame => frame.skeletons > 0);
  const ms = (at: number | undefined, from: number) => at === undefined ? "none" : `+${Math.round(at - from)}ms`;
  const size = (box: Box) => box === undefined ? "-" : `${Math.round(box.width)}x${box.height}`;
  return [`SKELETON ${result.viewport.width}x${result.viewport.height}`, test.info().title,
    `skeletonFrames=${skeletons.length}/${frames.length}`, `firstSkeleton=${ms(skeletons[0]?.at, pendingAt)}`,
    `hold=${timing?.releasedAt === undefined ? "none" : `${Math.round(timing.releasedAt - pendingAt)}ms`}`,
    `pending=${size(skeletons.at(-1)?.pendingBounds)}`, `settled=${size(frames.at(-1)?.settledBounds)}`,
    `feedback=${ms(frames.find(frame => frame.feedback)?.at, start)}`].join(" | ");
}

function navigate(page: Page, params: Record<string, string>) {
  return page.evaluate(next => {
    const url = new URL(location.href);
    for (const [key, value] of Object.entries(next)) url.searchParams.set(key, value);
    const state: unknown = history.state;
    history.replaceState(state, "", url);
    window.dispatchEvent(new PopStateEvent("popstate", { state }));
  }, params);
}

async function seedRoster(page: Page, baseUrl: string) {
  const workbook = await importWorkbook(FILE_NAME, new TextEncoder().encode(CSV).buffer);
  const response = await page.request.post(`${baseUrl}/api/v1/workbooks/import`, {
    headers: { origin: baseUrl }, data: { workbook: encodeEditableWorkbook({ ...workbook, name: SHEET_NAME }) },
  });
  expect(response.status(), "seeded workbook import").toBe(201);
  return WorkbookImportResultSchema.parse(await response.json()).workbook.libraryId;
}

/** Data pages are Settings sections: open Settings, then measure the section link. */
async function dataPageLink(page: Page, label: string) {
  const sections = page.getByRole("navigation", { name: "Settings sections" });
  if (!(await sections.isVisible())) await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(sections).toBeVisible();
  return sections.getByRole("link", { name: label, exact: true });
}

function seededQueueCard(dashboard: DashboardPage, runId: string) {
  return dashboard.queue.locator(`[role="group"][data-demo-row-id="${runId}"]`);
}

for (const viewport of DESKTOP_VIEWPORTS) {
  test.describe(`dashboard skeletons at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport, colorScheme: "dark" });

    test("a held cold Settings read measures the fixed General form", async ({ dashboard, page, seeded }) => {
      const hold = await openWithColdSettingsHold(page, seeded.baseUrl, () => dashboard.open());
      await expect(seededQueueCard(dashboard, dashboard.runId("doneRun"))).toBeVisible();
      // Boot takes the stream row, so the first Settings read starts with the opening below.
      const open = page.getByRole("button", { name: "Settings", exact: true });
      const themeField = page.locator(THEME_FIELD);
      await measure(page, open, async () => {
        await open.click();
        await expect(dashboard.pageHeading("General")).toBeVisible();
        await expect(themeField).toBeHidden();
        await hold.evaluate(read => read.startWindow());
      }, () => expect(themeField).toBeVisible(), {
        pendingRegion: SETTINGS_FORM, bounds: { pending: SETTINGS_FORM, settled: "form.settings-compact-form" },
      }, hold);
    });

    test.describe("after dashboard boot", () => {
      test.beforeEach(async ({ dashboard }) => {
        await dashboard.open();
        await expect(seededQueueCard(dashboard, dashboard.runId("doneRun"))).toBeVisible();
      });

      // The first Settings opening is recorded unprimed; the warm one reopens it after a close.
      for (const surface of ["first Settings", "warm Settings", "Spreadsheets", "Explorer", "Analytics", "Run logs"] as const) {
        test(`${surface} settles without an immediate-read skeleton`, async ({ dashboard, page }) => {
          const runId = dashboard.runId("doneRun");
          const control = surface === "Run logs" ? seededQueueCard(dashboard, runId).locator("button[data-queue-open]")
            : surface.endsWith("Settings") ? page.getByRole("button", { name: "Settings", exact: true }) : await dataPageLink(page, surface);
          const content = {
            "first Settings": page.locator(THEME_FIELD),
            "warm Settings": page.locator(THEME_FIELD),
            Spreadsheets: page.getByText("No spreadsheets yet", { exact: true }),
            Explorer: page.locator("#explorer-step-1"),
            Analytics: page.getByRole("figure", { name: "Runs per day" }),
            "Run logs": dashboard.runPanel.getByRole("region", { name: "Run logs" }),
          }[surface];
          if (surface === "warm Settings") {
            await control.click();
            await expect(content).toBeVisible();
            await page.getByRole("button", { name: /^(Back to dashboard|Close settings)$/ }).click();
            await expect(content).toBeHidden();
          }
          const activate = () => surface === "Run logs" ? control.press("Enter") : control.click();
          await measure(page, control, activate, () => expect(content).toBeVisible());
        });
      }

      test("a held first Explorer read uses no guessed-height skeleton", async ({ page }) => {
        const open = await dataPageLink(page, "Explorer");
        const picker = page.getByRole("combobox", { name: "Explorer workflow" });
        const pickerSelector = 'button[aria-label="Explorer workflow"]';
        const hold = await holdDashboardSkeletonRead(page, { pathname: "/api/v1/explorer" });
        await measure(page, open, async () => {
          await open.click();
          await picker.focus();
        }, async () => {
          await expect(page.locator("#explorer-step-1")).toBeVisible();
          await expect(picker).toBeFocused();
        }, { keep: { selector: pickerSelector }, focus: pickerSelector }, hold);
      });

      test("a held first Analytics read uses no guessed-height skeleton", async ({ page }) => {
        const open = await dataPageLink(page, "Analytics");
        const hold = await holdDashboardSkeletonRead(page, { pathname: "/api/v1/reports/activity/population" });
        await measure(page, open, () => open.click(), () => expect(page.locator(RUNS_SECTION)).toBeVisible(), {}, hold);
      });

      test("switching to an uncached 90-day report keeps the previous Analytics report visible", async ({ dashboard, page, seeded }) => {
        await dashboard.openDataPage("Analytics");
        const exportButton = page.getByRole("button", { name: "Export", exact: true });
        const to = seeded.day;
        const from = shiftDate(to, -89);
        const priorPeriod = analyticsPeriodLabel({ from: shiftDate(to, -6), to });
        await expect(page.locator(REPORT_TOOLBAR).getByText(priorPeriod, { exact: true })).toBeVisible();
        await expect(exportButton).toBeEnabled();
        await page.getByRole("button", { name: "Show Person Lookup details" }).click();
        const openRuns = page.getByRole("button", { name: "Open runs", exact: true });
        const drillIn = page.getByRole("region", { name: "Analytics runs" });
        await expect(openRuns).toBeVisible();
        await expect(openRuns).toBeEnabled();
        const selectRange = page.getByRole("group", { name: "Report period" }).getByText("90d", { exact: true });
        const hold = await holdDashboardSkeletonRead(page, { pathname: "/api/v1/reports/activity/population", query: { from, to } });
        await measure(page, selectRange, async () => {
          await selectRange.click();
          await expect(openRuns).toBeDisabled({ timeout: 1_500 });
          // A real pointer cannot reach this link. Dispatch a click to exercise its handler too.
          const attempt = await openRuns.evaluate(async link => {
            const url = location.href;
            const clickedAt = performance.now();
            link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
            await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
            return { clickedAt, stayedOnReport: location.href === url };
          });
          const { requestedAt, releasedAt } = await hold.evaluate(read => read.timing);
          expect.soft(requestedAt, "read began before the disabled click").toBeLessThanOrEqual(attempt.clickedAt);
          expect.soft(releasedAt, "read still pending after the disabled click").toBeUndefined();
          expect.soft(attempt.stayedOnReport, "disabled click leaves the report URL intact").toBe(true);
          await expect.soft(drillIn).toBeHidden();
          return attempt;
        }, async () => {
          await expect(page.locator(REPORT_TOOLBAR).getByText(analyticsPeriodLabel({ from, to }), { exact: true })).toBeVisible();
          await expect(exportButton).toBeEnabled();
          await expect(openRuns).toBeEnabled();
          expect(await openRuns.evaluate(link => link.tabIndex), "restored link is keyboard reachable").toBe(0);
        }, { analyticsPeriod: priorPeriod, keep: OPEN_RUNS }, hold);
        await openRuns.click();
        await expect(drillIn).toBeVisible();
      });

      test("a held catalog read uses no guessed-height skeleton", async ({ page }) => {
        const open = await dataPageLink(page, "Spreadsheets");
        const hold = await holdDashboardSkeletonRead(page, { pathname: "/api/v1/workbooks/catalog" });
        await measure(page, open, () => open.click(), () => expect(page.getByText("No spreadsheets yet", { exact: true })).toBeVisible(), {}, hold);
      });

      test("a held large sheet read reserves the grid and keeps the sheet heading mounted", async ({ dashboard, page, seeded }) => {
        const libraryId = await seedRoster(page, seeded.baseUrl);
        await dashboard.openDataPage("Spreadsheets");
        const open = page.getByRole("listitem", { name: SHEET_NAME });
        const versions = page.getByRole("button", { name: "Versions, now Original version" });
        const loading = `[aria-label="Opening ${SHEET_NAME}"]`;
        const hold = await holdDashboardSkeletonRead(page, { pathname: `/api/v1/workbooks/${encodeURIComponent(libraryId)}` });
        await measure(page, open, async () => {
          await open.click();
          await versions.focus();
        }, async () => {
          await expect(page.getByRole("searchbox", { name: "Search this sheet" })).toBeVisible();
          await expect(versions).toBeFocused();
        }, {
          pendingRegion: loading, bounds: { pending: loading, settled: `${SHEETS} section[aria-label="Preview"]` },
          keep: { selector: `${SHEETS} h1`, text: SHEET_NAME }, focus: `${SHEETS} [aria-label="Versions, now Original version"]`,
        }, hold);
      });

      test("a held file read reserves the draft page's grid", async ({ dashboard, page }) => {
        await dashboard.openDataPage("Spreadsheets");
        await expect(page.getByText("No spreadsheets yet", { exact: true })).toBeVisible();
        const input = page.locator('input[type="file"][aria-label="Spreadsheet file"]').first();
        const hold = await holdDashboardSkeletonRead(page, { fileName: FILE_NAME });
        const loading = `${SHEETS} [aria-label="Opening ${SHEET_NAME}"]`;
        await measure(page, input,
          () => input.setInputFiles({ name: FILE_NAME, mimeType: "text/csv", buffer: Buffer.from(CSV) }),
          () => expect(page.getByRole("searchbox", { name: "Search this sheet" })).toBeVisible(), {
            pendingRegion: loading, bounds: { pending: loading, settled: `${SHEETS} section[aria-label="Preview"]` },
          }, hold, "change");
      });

      test("a held run read stays inside the selected run panel", async ({ dashboard, page }) => {
        const runId = dashboard.runId("doneRun");
        const open = seededQueueCard(dashboard, runId).locator("button[data-queue-open]");
        const hold = await holdDashboardSkeletonRead(page, { run: runId });
        await measure(page, open, () => open.press("Enter"), () => expect(dashboard.runPanel.getByRole("region", { name: "Run logs" })).toBeVisible(), {
          pendingRegion: RUN_PANEL, bounds: { pending: RUN_LOADING, settled: RUN_SETTLED },
        }, hold);
      });

      test("a held day snapshot confines the skeleton to the queue", async ({ dashboard, page, seeded }) => {
        const day = shiftDate(seeded.day, -1);
        const hold = await holdDashboardSkeletonRead(page, { day });
        await measure(page, null, () => navigate(page, { day }), async () => {
          await expect(page.getByRole("status", { name: "Loading queue" })).toBeHidden();
          await expect(dashboard.queue).toBeVisible();
        }, { pendingRegion: QUEUE, bounds: { pending: QUEUE_LOADING, settled: QUEUE_SETTLED }, checkSessionBar: true }, hold);
      });

      for (const day of ["2099-01-01", "invalid-date"]) {
        test(`${day} promptly shows date feedback without loading the rail or Sessions bar`, async ({ page }) => {
          const hold = await holdDashboardSkeletonRead(page, { day });
          const feedback = page.getByText(DATE_FEEDBACK, { exact: true });
          await measure(page, null, () => navigate(page, { day }), () => expect(feedback).toBeVisible(), {
            feedback: { selector: ".dashboard-queue-column span", text: DATE_FEEDBACK }, checkSessionBar: true,
          }, hold);
        });
      }
    });
  });
}
