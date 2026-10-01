import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_IDS } from "./helpers/fixture-queue.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";

function surfaceRequests(page: Page): string[] {
  const requests: string[] = [];
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET" || /\/api\/v1\/(?:explorer|activity|reports\/activity|exports|runs\/[^/]+)(?:\/|$)/u.test(path)) requests.push(`${request.method()} ${path}`);
  });
  return requests;
}

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`shared dashboard, Activity and Explorer action bar @ ${theme.attribute} ${width}`, async ({ page }) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
      await installTheme(page, theme);
      const dimensions: unknown[] = [];
      for (const [path, label] of [[`/?day=${FIXTURE_DAY}`, "Queue actions"], ["/?activity=", "Activity actions"], ["/?explore=fixture-ui-explorer", "Explorer actions"]]) {
        await page.goto(`${server.baseUrl}${path}`);
        const bar = page.getByRole("group", { name: label, exact: true });
        await expect(bar).toBeVisible();
        dimensions.push(await bar.evaluate(node => {
          const row = getComputedStyle(node);
          const frame = getComputedStyle(node.parentElement!);
          return { height: node.getBoundingClientRect().height, padding: row.paddingInline, gap: row.gap, radius: frame.borderRadius, border: frame.borderTopWidth };
        }));
        if (label === "Queue actions") {
          await bar.getByRole("button", { name: "Select", exact: true }).click();
          await expect(page.getByRole("button", { name: /^Select all \d+ in view$/ })).toBeVisible();
          await bar.getByRole("button", { name: "Select", exact: true }).click();
          await expect(page.getByRole("button", { name: /^Select all \d+ in view$/ })).toHaveCount(0);
        }
      }
      expect(dimensions[1]).toEqual(dimensions[0]);
      expect(dimensions[2]).toEqual(dimensions[0]);
    } finally { await server.close(); }
  });

  const evidence = `activity-presentation-${theme.attribute}-${width}.a11y.yml`;
  test(`Activity A local presentation @ ${theme.attribute} ${width}`, { annotation: [{ type: "required-a11y-evidence", description: evidence }] }, async ({ page }) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
      await installTheme(page, theme);
      const requests = surfaceRequests(page);
      await page.goto(`${server.baseUrl}/?activity=`);
      const surface = page.getByRole("region", { name: "Activity report", exact: true });
      const metrics = surface.getByLabel("Activity summary");
      await expect(metrics).toContainText("38");
      await expect(metrics).toContainText("36 measured · 4 unmeasured");
      await expect(surface.getByRole("row", { name: "Separations Version 2.1 24 3 2 29" })).toBeVisible();
      await expect(surface).toContainText("35 of 38 completed");
      const performance = surface.getByRole("table", { name: "Run performance", exact: true });
      await expect(performance.getByRole("row", { name: /Completion rate/ })).toContainText("95%");
      await expect(performance.getByRole("row", { name: /Longest run/ })).toContainText("4m 41s");
      await expect(performance.getByRole("row", { name: /Total measured runtime/ })).toContainText("1h 21m");
      await expect(performance.getByRole("row", { name: /Most common failure/ })).toContainText("Document read timeout");
      const chart = surface.getByRole("group", { name: /runs? across.*interval/ });
      await expect(chart).toBeVisible();
      await expect(surface.getByRole("group", { name: "Activity actions", exact: true })).toBeVisible();
      const outcomes = surface.getByRole("table", { name: "Workflow outcomes", exact: true });
      const outcomeBounds = await outcomes.boundingBox();
      const chartSection = chart.locator("..").locator("..");
      const chartBounds = await chartSection.boundingBox();
      expect(outcomeBounds).not.toBeNull();
      expect(chartBounds).not.toBeNull();
      expect(Math.abs(outcomeBounds!.width - chartBounds!.width)).toBeLessThanOrEqual(2);
      expect(await outcomes.locator("..").evaluate(node => getComputedStyle(node).borderTopStyle)).toBe("solid");
      const transactions = surface.getByRole("table", { name: "Confirmed transactions", exact: true });
      const coverage = surface.getByRole("table", { name: "Evidence coverage", exact: true });
      const transactionsBounds = (await transactions.boundingBox())!;
      const coverageBounds = (await coverage.boundingBox())!;
      expect(coverageBounds.y).toBeGreaterThan(transactionsBounds.y + transactionsBounds.height);
      expect(coverageBounds.x).toBe(transactionsBounds.x);
      expect(coverageBounds.width).toBe(transactionsBounds.width);
      expect(await coverage.locator("..").evaluate(node => getComputedStyle(node).backgroundColor)).toBe(await transactions.locator("..").evaluate(node => getComputedStyle(node).backgroundColor));
      const bars = chart.getByRole("button");
      const barSize = (await bars.nth(3).locator(":scope > span").first().boundingBox())!;
      const bandSize = (await bars.nth(3).boundingBox())!;
      expect(barSize.width / bandSize.width).toBeGreaterThan(.65);
      expect(barSize.width / bandSize.width).toBeLessThan(.9);
      expect((await chart.boundingBox())!.height).toBeGreaterThanOrEqual(160);
      if (width === 1440) expect((await chart.boundingBox())!.height).toBeGreaterThan(160);
      for (const [index, day, count] of [[0, 20, 0], [3, 23, 7], [5, 25, 9], [6, 26, 9]]) {
        const bar = bars.nth(index);
        await bar.hover();
        const tooltip = chart.getByRole("tooltip");
        await expect(tooltip).toHaveText(`Sep ${day}${count} runs`);
        const tipBounds = (await tooltip.boundingBox())!;
        const barBounds = (await bar.boundingBox())!;
        const plotBounds = (await chart.boundingBox())!;
        const anchor = barBounds.x + barBounds.width / 2;
        const expectedLeft = Math.max(plotBounds.x, Math.min(anchor - tipBounds.width / 2, plotBounds.x + plotBounds.width - tipBounds.width));
        expect(Math.abs(tipBounds.x - expectedLeft)).toBeLessThanOrEqual(1);
        await expect(bar).toHaveAttribute("aria-describedby", await tooltip.getAttribute("id") as string);
      }
      await page.mouse.move(0, 0);
      await bars.last().focus();
      await surface.getByRole("combobox", { name: "Report period" }).selectOption("today");
      await expect(bars).toHaveCount(24);
      await expect(chart.getByRole("tooltip")).toContainText("Sep 26");
      await expect(chart.getByRole("tooltip")).toContainText("0 runs");
      const solo = (await bars.first().boundingBox())!;
      const soloTip = (await chart.getByRole("tooltip").boundingBox())!;
      const hourlyPlot = (await chart.boundingBox())!;
      const hourlyLeft = Math.max(hourlyPlot.x, Math.min(solo.x + solo.width / 2 - soloTip.width / 2, hourlyPlot.x + hourlyPlot.width - soloTip.width));
      expect(Math.abs(soloTip.x - hourlyLeft)).toBeLessThanOrEqual(1);
      await surface.getByRole("combobox", { name: "Report period" }).selectOption("this-week");
      await expect(bars).toHaveCount(7);
      await bars.nth(3).focus();
      await expect(chart.getByRole("tooltip")).toHaveText("Sep 237 runs");
      await page.keyboard.press("ArrowRight");
      await expect(bars.nth(4)).toBeFocused();
      await expect(chart.getByRole("tooltip")).toHaveText("Sep 246 runs");
      await page.keyboard.press("Home");
      await expect(bars.first()).toBeFocused();
      await expect(chart.getByRole("tooltip")).toHaveText("Sep 200 runs");
      await page.keyboard.press("Escape");
      await expect(chart.getByRole("tooltip")).toHaveCount(0);
      await surface.getByRole("combobox", { name: "Report period" }).selectOption("last-3-months");
      expect(await bars.count()).toBeGreaterThan(7);
      const denseBar = (await bars.first().locator(":scope > span").first().boundingBox())!;
      const denseBand = (await bars.first().boundingBox())!;
      expect(denseBar.width / denseBand.width).toBeGreaterThan(.65);
      expect(denseBar.width / denseBand.width).toBeLessThan(.9);
      await bars.first().hover();
      await expect(chart.getByRole("tooltip")).toContainText("0 runs");
      await surface.getByRole("combobox", { name: "Report period" }).selectOption("this-week");
      await surface.getByRole("heading", { name: "Activity", exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await metrics.evaluate(node => getComputedStyle(node).gridTemplateColumns.split(" ").length)).toBe(4);
      expect((await metrics.boundingBox())!.height).toBeLessThan(130);
      const snapshot = await surface.ariaSnapshot();
      test.info().annotations.push({ type: `a11y-attachment-sha256:${evidence}`, description: createHash("sha256").update(snapshot).digest("hex") });
      await test.info().attach(evidence, { body: snapshot, contentType: "text/yaml" });
      await test.info().attach(evidence.replace(".a11y.yml", ".png"), { body: await page.screenshot(), contentType: "image/png" });
      await surface.getByRole("combobox", { name: "Activity sample data" }).selectOption("incomplete");
      await expect(surface).toContainText("Volume unavailable");
      await expect(surface.getByLabel("Activity summary")).toContainText("Unavailable");
      await expect(surface).toContainText("Readback verifiedUnavailable");
      await expect(performance.getByRole("row", { name: /Longest run/ })).toContainText("Unavailable");
      await expect(performance.getByRole("row", { name: /Total measured runtime/ })).toContainText("Unavailable");
      await expect(performance.getByRole("row", { name: /Most common failure/ })).toContainText("Unavailable");
      await surface.getByRole("combobox", { name: "Activity sample data" }).selectOption("empty");
      await expect(surface).toContainText("No workflow activity in this period");
      await expect(surface).toContainText("No runs in this period");
      await expect(performance.getByRole("row", { name: /Completion rate/ })).toContainText("No finished runs");
      await expect(performance.getByRole("row", { name: /Total measured runtime/ })).toContainText("0s");
      await expect(performance.getByRole("row", { name: /Most common failure/ })).toContainText("No failures");
      await surface.getByRole("combobox", { name: "Activity sample data" }).selectOption("loading");
      await expect(surface.getByRole("status", { name: "Loading activity report" })).toBeVisible();
      await expect(surface.getByRole("button", { name: "Export report", exact: true })).toBeDisabled();
      await surface.getByRole("combobox", { name: "Activity sample data" }).selectOption("unavailable");
      await expect(surface.getByRole("alert")).toContainText("Activity unavailable");
      await surface.getByRole("combobox", { name: "Activity sample data" }).selectOption("normal");
      await surface.getByRole("button", { name: "Export report", exact: true }).click();
      await page.getByRole("button", { name: "CSV", exact: true }).click();
      await expect(surface.getByRole("status")).toHaveText("Export is not connected yet.");
      await page.keyboard.press("Escape");
      expect(requests).toEqual([]);
    } finally { await server.close(); }
  });

  const logsEvidence = `logs-presentation-${theme.attribute}-${width}.a11y.yml`;
  test(`approved Logs local presentation @ ${theme.attribute} ${width}`, { annotation: [{ type: "required-a11y-evidence", description: logsEvidence }] }, async ({ page }) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
      await installTheme(page, theme);
      const requests = surfaceRequests(page);
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&run=${FIXTURE_IDS.doneRun}`);
      const surface = page.getByRole("region", { name: "Selected run logs", exact: true });
      await expect(surface.getByRole("heading", { name: "Separations · Alex Morgan", exact: true })).toBeVisible();
      await expect(surface.getByRole("heading", { name: "Reconcile dates", exact: true })).toHaveCount(0);
      await expect(surface.locator('[data-log-field="compute"]')).toHaveCount(0);
      await expect(surface.getByRole("button", { name: "Rerun", exact: true })).toHaveCount(0);
      await expect(surface.getByRole("tab")).toHaveCount(0);
      const table = surface.locator('[data-log-field="fill"]').first().locator("..").locator("..");
      expect(await table.evaluate(node => getComputedStyle(node).backgroundColor)).toBe(theme.attribute === "dark" ? "rgb(43, 43, 43)" : "rgb(244, 244, 244)");
      const snapshot = await surface.ariaSnapshot();
      test.info().annotations.push({ type: `a11y-attachment-sha256:${logsEvidence}`, description: createHash("sha256").update(snapshot).digest("hex") });
      await test.info().attach(logsEvidence, { body: snapshot, contentType: "text/yaml" });
      await test.info().attach(logsEvidence.replace(".a11y.yml", ".png"), { body: await page.screenshot(), contentType: "image/png" });
      await surface.getByRole("searchbox", { name: "Search logs" }).fill("save and submit");
      await expect(surface.getByRole("heading", { name: "File termination", exact: true })).toBeVisible();
      const shot = surface.getByRole("button", { name: "Enlarge screenshot captured at 09:32:37" });
      await expect(shot).toBeVisible();
      await shot.scrollIntoViewIfNeeded();
      await expect(shot.locator("img")).toHaveJSProperty("naturalWidth", 850);
      expect(await shot.evaluate(node => node.closest("section")?.querySelector("figure") === node.closest("figure"))).toBe(true);
      await shot.click();
      await expect(page.getByRole("dialog", { name: "Screenshot", exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(shot).toBeFocused();
      await surface.getByRole("searchbox", { name: "Search logs" }).fill("unmatched");
      await expect(surface.getByRole("heading", { name: "No matching actions" })).toBeVisible();
      await surface.getByRole("region", { name: "Run logs", exact: true }).getByRole("button", { name: "Clear search", exact: true }).click();
      await expect(surface.getByRole("searchbox", { name: "Search logs" })).toHaveValue("");
      await surface.getByRole("combobox", { name: "Logs sample data" }).selectOption("empty");
      await expect(surface.getByRole("heading", { name: "No actions yet" })).toBeVisible();
      await expect(surface.getByRole("button", { name: "Copy logs" })).toBeDisabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(requests).toEqual([]);
    } finally { await server.close(); }
  });
}

test("Activity custom dates apply only on confirmation; dismissals restore focus", async ({ page }) => {
  ensureParityBundle();
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  try {
    const requests = surfaceRequests(page);
    await page.goto(`${server.baseUrl}/?activity=`);
    const period = page.getByRole("combobox", { name: "Report period" });
    await period.selectOption("custom");
    const calendar = page.getByRole("dialog", { name: "Select report dates", exact: true });
    await expect(calendar).toBeVisible();
    await calendar.getByRole("button", { name: /Friday, September 25, 2026/ }).click();
    await expect(calendar.getByRole("button", { name: "Apply range" })).toBeDisabled();
    await expect(page).toHaveURL(/activity=$/);
    await calendar.getByRole("button", { name: /Saturday, September 26, 2026/ }).click();
    await calendar.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page).toHaveURL(/activity=$/);
    const trigger = page.getByRole("button", { name: /Select report dates:/ });
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.getByRole("heading", { name: "Activity", exact: true }).click();
    await expect(calendar).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await calendar.getByRole("button", { name: /Friday, September 25, 2026/ }).click();
    await calendar.getByRole("button", { name: /Saturday, September 26, 2026/ }).click();
    await calendar.getByRole("button", { name: "Apply range" }).click();
    await expect(page).toHaveURL(/activity=2026-09-25\.\.2026-09-26/);
    await expect(period).toHaveValue("custom");
    await expect(page.getByLabel("Activity summary")).toContainText("of 18 runs");
    await period.selectOption("today");
    await expect(page.getByLabel("Activity summary")).toContainText("of 9 runs");
    expect(requests).toEqual([]);
  } finally { await server.close(); }
});
