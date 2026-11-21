import { writeFile } from "node:fs/promises";
import type { Locator, Page } from "@playwright/test";
import { analyticsPeriodLabel, shiftDate } from "../../src/dashboard/surfaces/activity/analytics-model.js";
import { encodeEditableWorkbook, WorkbookImportResultSchema } from "../../src/models/dashboard/workbooks.js";
import { importWorkbook } from "../../src/rules/spreadsheets/workbook-io.js";
import { DESKTOP_VIEWPORTS } from "../support/helpers/dashboard/smoke/dashboard-page.js";
import { holdDashboardSkeletonRead, SKELETON_READ_HOLD_MS } from "../support/helpers/dashboard/smoke/hold-dashboard-skeleton-read.js";
import { expect, test } from "../support/helpers/dashboard/smoke/smoke-fixtures.js";

const SKELETON = '[data-slot="skeleton"]';
const SHEETS = 'section[aria-label="Spreadsheets"]';
const FILE_DIALOG = '[role="dialog"]';
const RUN_PANEL = '[aria-label="Selected run logs"]';
const QUEUE = '[aria-label="Queue"]';
const SETTINGS_FORM = '#dashboard-settings-content .settings-compact-form';
const RUNS_SECTION = '.ds-body-section:has(> figure[aria-label="Runs per day"])';
const REPORT = 'section[aria-label="Analytics report"]';
const REPORT_TOOLBAR = `${REPORT} .ds-toolbar-row`;
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
  return page.evaluateHandle(({ trigger, event, scene, skeleton, report, toolbar, runs }) => {
    let start: number | undefined;
    let animation = 0;
    let fixedElement: Element | undefined;
    const visible = (element: Element) => element.getClientRects().length > 0
      && element.checkVisibility({ visibilityProperty: true, opacityProperty: true });
    const find = (selector: string | undefined) => selector === undefined ? undefined
      : [...document.querySelectorAll(selector)].find(visible);
    const findTarget = (target: ElementTarget | undefined) => target === undefined ? undefined
      : [...document.querySelectorAll(target.selector)].find(element => (target.text === undefined || element.textContent?.trim() === target.text) && visible(element));
    const rect = (selector: string | undefined) => {
      const bounds = find(selector)?.getBoundingClientRect();
      if (bounds === undefined) return undefined;
      const { x, y, width, height } = bounds;
      return { x, y, width, height };
    };
    const initialRuns = scene.analyticsPeriod === undefined ? undefined : rect(runs);
    const sample = () => {
      const at = performance.now();
      const skeletons = [...document.querySelectorAll(skeleton)].filter(visible);
      const outside = skeletons.filter(element => scene.pendingRegion === undefined || !element.closest(scene.pendingRegion));
      const sessions = document.querySelector('.session-pill-counts');
      const sessionText = sessions !== null && visible(sessions) ? sessions.textContent?.trim() : undefined;
      const currentFixedElement = findTarget(scene.keep);
      fixedElement ??= currentFixedElement;
      return {
        at, skeletons: skeletons.length, outside: outside.length,
        outsideRegions: [...new Set(outside.map(element => element.closest('[data-loading-layout], section[aria-label], aside[aria-label]')?.getAttribute('aria-label') ?? 'unnamed'))],
        pendingBounds: rect(scene.bounds?.pending), settledBounds: rect(scene.bounds?.settled),
        kept: currentFixedElement !== undefined && currentFixedElement === fixedElement,
        focused: scene.focus !== undefined && document.activeElement?.matches(scene.focus) === true,
        sessionText,
        feedback: findTarget(scene.feedback) !== undefined,
        analytics: scene.analyticsPeriod === undefined ? undefined : {
          period: find(`${runs} figure .text-control`)?.textContent?.trim(),
          updating: findTarget({ selector: `${toolbar} [role="status"]`, text: "Updating" }) !== undefined,
          exportLocked: findTarget({ selector: `${toolbar} button:disabled`, text: "Export" }) !== undefined,
          drillInAvailable: findTarget({ selector: `${report} a`, text: "Open runs" }) !== undefined,
          runsBounds: rect(runs),
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
        return { start, frames, initialRuns, viewport: { width: innerWidth, height: innerHeight }, theme: document.documentElement.dataset.demoTheme };
      },
    };
  }, { trigger, event, scene, skeleton: SKELETON, report: REPORT, toolbar: REPORT_TOOLBAR, runs: RUNS_SECTION });
}

async function measure(
  page: Page, trigger: Locator | null, act: () => Promise<unknown>, settled: () => Promise<unknown>,
  scene: Scene = {}, hold?: Hold, event = trigger === null ? "popstate" : "click",
) {
  await expect(page.locator(SKELETON).first()).toBeHidden();
  const frames = await startFrames(page, trigger === null ? null : await trigger.elementHandle(), event, scene);
  const stopFrames = () => frames.evaluate(recorder => recorder.finish());
  let result: Awaited<ReturnType<typeof stopFrames>>;
  const readTiming = () => hold?.evaluate(value => value);
  let timing: Awaited<ReturnType<typeof readTiming>>;
  try {
    await act();
    // A held read can settle outside the measured component. Require the hold to actually release.
    if (hold !== undefined && scene.feedback === undefined) {
      await expect.poll(() => hold.evaluate(value => value.releasedAt), { timeout: 8_000 }).toBeDefined();
    }
    await settled();
  } finally {
    result = await stopFrames();
    timing = await readTiming();
    await writeFile(test.info().outputPath("measurements.json"), JSON.stringify({ test: test.info().title, ...result, timing }, null, 2));
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
    expect.soft(firstSkeleton?.at, "first skeleton at or after 300 ms").toBeGreaterThanOrEqual(start + 300);
    expect.soft(firstSkeleton?.at, "first skeleton by 500 ms on the CI runner").toBeLessThanOrEqual(start + 500);
    expect.soft(samples.filter(frame => frame.outside > 0), "skeletons stay inside the waiting region").toHaveLength(0);
  }
  if (scene.feedback !== undefined) {
    expect.soft(samples.find(frame => frame.feedback)?.at, "date feedback within one second").toBeLessThanOrEqual(start + 1_000);
    expect.soft(timing?.requestedAt, "no day stream opened for the refused date").toBeUndefined();
  } else if (hold !== undefined) {
    const { requestedAt, withheldAt, releasedAt } = timing ?? {};
    expect(withheldAt, "matched read or snapshot").toBeDefined();
    expect(releasedAt, "withheld data was released").toBeDefined();
    if (withheldAt === undefined || releasedAt === undefined) throw new Error("Read hold timing is missing");
    expect.soft(releasedAt - withheldAt).toBeGreaterThanOrEqual(SKELETON_READ_HOLD_MS);
    const pendingFrames = samples.filter(frame => frame.at >= (requestedAt ?? withheldAt) && frame.at < releasedAt);
    expect.soft(pendingFrames.length, "sampled during the hold").toBeGreaterThan(0);
    if (scene.pendingRegion !== undefined) expect.soft(firstSkeleton?.at, "skeleton arrives while the read is pending").toBeLessThan(releasedAt);
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
      const updating = pendingFrames.find(frame => frame.analytics?.updating);
      expect.soft(updating?.at, "Updating appears at or after 300 ms").toBeGreaterThanOrEqual(start + 300);
      expect.soft(updating?.at, "Updating appears by 500 ms on the CI runner").toBeLessThanOrEqual(start + 500);
      expect.soft(pendingFrames.filter(frame => frame.analytics?.period !== scene.analyticsPeriod), "prior report keeps its own period").toHaveLength(0);
      expect.soft(pendingFrames.filter(frame => !frame.analytics?.exportLocked || frame.analytics.drillInAvailable),
        "Export and Open runs stay locked during the read").toHaveLength(0);
      expect.soft(result.initialRuns, "prior Runs section bounds").toBeDefined();
      for (const key of ["x", "y", "width", "height"] as const) {
        const before = result.initialRuns?.[key];
        expect.soft(pendingFrames.filter(frame => Math.abs((frame.analytics?.runsBounds?.[key] ?? Infinity) - (before ?? 0)) > 1),
          `held Runs section ${key} within one CSS pixel`).toHaveLength(0);
      }
      expect.soft(samples.at(-1)?.analytics?.updating, "Updating clears on settlement").toBe(false);
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

for (const viewport of DESKTOP_VIEWPORTS) {
  test.describe(`dashboard skeletons at ${viewport.width}x${viewport.height}`, () => {
    test.skip(process.env.RELAY_DASHBOARD_SKELETON_EVIDENCE !== "1", "runs in the dedicated dashboard evidence workflow");
    test.use({ viewport, colorScheme: "dark" });
    test.beforeEach(async ({ dashboard }) => {
      await dashboard.open();
      await expect(dashboard.queue.locator(`[role="button"][data-demo-row-id="${dashboard.runId("doneRun")}"]`)).toBeVisible();
    });

    for (const surface of ["Settings", "Spreadsheets", "Explorer", "Analytics", "Run logs"] as const) {
      test(`${surface} settles without an immediate-read skeleton`, async ({ dashboard, page }) => {
        const runId = dashboard.runId("doneRun");
        const control = surface === "Run logs" ? dashboard.queue.locator(`[role="button"][data-demo-row-id="${runId}"]`)
          : (surface === "Settings" ? page : dashboard.workflows).getByRole("button", { name: surface, exact: true });
        const content = {
          Settings: page.locator('[data-settings-path="appearance.theme"]'),
          Spreadsheets: page.getByText("No spreadsheets yet", { exact: true }),
          Explorer: page.locator("#explorer-step-1"),
          Analytics: page.getByRole("figure", { name: "Runs per day" }),
          "Run logs": dashboard.runPanel.getByRole("region", { name: "Run logs" }),
        }[surface];
        await measure(page, control, () => control.click(), () => expect(content).toBeVisible());
      });
    }

    test("a held Settings read measures the fixed form", async ({ page }) => {
      const open = page.getByRole("button", { name: "Settings", exact: true });
      const hold = await holdDashboardSkeletonRead(page, { pathname: "/api/v1/settings/editable" });
      await measure(page, open, () => open.click(), () => expect(page.locator('[data-settings-path="appearance.theme"]')).toBeVisible(), {
        pendingRegion: SETTINGS_FORM, bounds: { pending: SETTINGS_FORM, settled: `form.settings-compact-form` },
      }, hold);
    });

    test("a held first Explorer read uses no guessed-height skeleton", async ({ dashboard, page }) => {
      const open = dashboard.workflows.getByRole("button", { name: "Explorer", exact: true });
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

    test("a held first Analytics read uses no guessed-height skeleton", async ({ dashboard, page }) => {
      const open = dashboard.workflows.getByRole("button", { name: "Analytics", exact: true });
      const hold = await holdDashboardSkeletonRead(page, { pathname: "/api/v1/reports/activity/population" });
      await measure(page, open, () => open.click(), () => expect(page.locator(RUNS_SECTION)).toBeVisible(), {}, hold);
    });

    test("switching to an uncached 90-day report keeps the previous Analytics report visible", async ({ dashboard, page, seeded }) => {
      await dashboard.openDataPage("Analytics");
      const chart = page.getByRole("figure", { name: "Runs per day" });
      const exportButton = page.getByRole("button", { name: "Export", exact: true });
      const to = seeded.day;
      const from = shiftDate(to, -89);
      const priorPeriod = analyticsPeriodLabel({ from: shiftDate(to, -6), to });
      await expect(chart.getByText(priorPeriod, { exact: true })).toBeVisible();
      await expect(exportButton).toBeEnabled();
      await page.getByRole("button", { name: "Show Person Lookup details" }).click();
      await expect(page.getByRole("link", { name: "Open runs", exact: true })).toBeVisible();
      const selectRange = page.getByRole("group", { name: "Report period" }).getByText("90d", { exact: true });
      const hold = await holdDashboardSkeletonRead(page, { pathname: "/api/v1/reports/activity/population", query: { from, to } });
      await measure(page, selectRange, () => selectRange.click(), async () => {
        await expect(chart.getByText(analyticsPeriodLabel({ from, to }), { exact: true })).toBeVisible();
        await expect(exportButton).toBeEnabled();
      }, { analyticsPeriod: priorPeriod }, hold);
    });

    test("a held catalog read uses no guessed-height skeleton", async ({ dashboard, page }) => {
      const open = dashboard.workflows.getByRole("button", { name: "Spreadsheets", exact: true });
      const hold = await holdDashboardSkeletonRead(page, { pathname: "/api/v1/workbooks/catalog" });
      await measure(page, open, () => open.click(), () => expect(page.getByText("No spreadsheets yet", { exact: true })).toBeVisible(), {}, hold);
    });

    test("a held large sheet read reserves the grid and keeps the sheet heading mounted", async ({ dashboard, page, seeded }) => {
      const libraryId = await seedRoster(page, seeded.baseUrl);
      await dashboard.openDataPage("Spreadsheets");
      const open = page.getByRole("listitem", { name: SHEET_NAME });
      const versions = page.getByRole("button", { name: "Versions, now v1" });
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
        keep: { selector: `${SHEETS} h1`, text: SHEET_NAME }, focus: `${SHEETS} [aria-label="Versions, now v1"]`,
      }, hold);
    });

    test("a held file read reserves the picked-file row in the import dialog", async ({ dashboard, page }) => {
      await dashboard.openDataPage("Spreadsheets");
      await expect(page.getByText("No spreadsheets yet", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Import", exact: true }).first().click();
      const dialog = page.getByRole("dialog", { name: "Import a spreadsheet" });
      const input = dialog.locator('input[type="file"]');
      const hold = await holdDashboardSkeletonRead(page, { fileName: FILE_NAME });
      const loading = `${FILE_DIALOG} [data-loading-layout]`;
      const fileRow = `${FILE_DIALOG} div:has(> button[aria-label="Remove file"])`;
      await measure(page, input,
        () => input.setInputFiles({ name: FILE_NAME, mimeType: "text/csv", buffer: Buffer.from(CSV) }),
        () => expect(dialog.getByRole("button", { name: "Remove file" })).toBeVisible(), {
          pendingRegion: loading, bounds: { pending: loading, settled: fileRow },
        }, hold, "change");
    });

    test("a held run read stays inside the selected run panel", async ({ dashboard, page }) => {
      const runId = dashboard.runId("doneRun");
      const row = dashboard.queue.locator(`[role="button"][data-demo-row-id="${runId}"]`);
      const hold = await holdDashboardSkeletonRead(page, { pathname: `/api/v1/runs/${runId}` });
      await measure(page, row, () => row.click(), () => expect(dashboard.runPanel.getByRole("region", { name: "Run logs" })).toBeVisible(), {
        pendingRegion: RUN_PANEL, bounds: { pending: RUN_PANEL, settled: RUN_PANEL },
      }, hold);
    });

    test("a held day snapshot confines the skeleton to the queue", async ({ dashboard, page, seeded }) => {
      const day = shiftDate(seeded.day, -1);
      const hold = await holdDashboardSkeletonRead(page, { day });
      await measure(page, null, () => navigate(page, { day }), async () => {
        await expect(page.getByRole("status", { name: "Loading queue" })).toBeHidden();
        await expect(dashboard.queue).toBeVisible();
      }, { pendingRegion: QUEUE, bounds: { pending: QUEUE, settled: QUEUE }, checkSessionBar: true }, hold);
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
}
