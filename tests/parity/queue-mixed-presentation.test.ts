import { createHash } from "node:crypto";
import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { DashboardDayWireSchema } from "../../src/models/dashboard/projection.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { assertThemeApplied, installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { FIXTURE_DAY_WIRE } from "./helpers/fixture-queue.js";
import { failOnPageErrors } from "./helpers/reference-harness.js";


for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  const a11yName = `dashboard-${theme.attribute}-${width}.a11y.yml`;

test(`approved mixed queue and navbar @ ${theme.attribute}-${width}`, { annotation: [{ type: "required-a11y-evidence", description: a11yName }] }, async ({ page }, info) => {
    const errors = failOnPageErrors(page);
    const done = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.surfaceKind === "single" && row.status === "done");
    const running = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.surfaceKind === "single" && row.status === "running");
    const operation = FIXTURE_DAY_WIRE.queueSurfaces.find(row => row.surfaceKind === "operation" && row.memberRunIds.length === 3);
    if (done === undefined || running === undefined || operation === undefined || operation.surfaceKind !== "operation") throw new Error("mixed queue fixtures incomplete");
    const dayWire = DashboardDayWireSchema.parse({ ...FIXTURE_DAY_WIRE, queueSurfaces: FIXTURE_DAY_WIRE.queueSurfaces.map(row =>
      row.runId === done.runId ? { ...row, endedAt: { state: "absent", reason: "Historical end not retained" } } : row) });
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, dayWire });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 900 });
      await installTheme(page, theme);
      await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
      await assertThemeApplied(page, theme);
      const queue = page.getByRole("region", { name: "Queue", exact: true });
      await expect(queue.getByRole("button", { name: /^What is this row/u })).toHaveCount(0);
      for (const status of ["awaiting-approval", "blocked"] as const) {
        const surface = dayWire.queueSurfaces.find(row => row.surfaceKind === "single" && row.status === status);
        if (surface === undefined || surface.liveMessage.state !== "present") throw new Error(`missing ${status} message fixture`);
        const row = queue.locator(`[data-demo-row-id='${surface.runId}']`);
        const badgeColor = await row.locator("[data-slot=badge]").last().evaluate(element => getComputedStyle(element).color);
        await expect(row.getByText(surface.liveMessage.value, { exact: true })).toHaveCSS("color", badgeColor);
      }
      const run = queue.locator(`[data-demo-row-id='${running.runId}']`);
      await run.scrollIntoViewIfNeeded();
      const progress = run.locator("[data-queue-progress]");
      await expect(progress.locator(":scope > span")).toHaveCount(running.pipeline.length);
      await expect(run).toContainText(`${running.pipeline.filter(step => step.state === "done").length} / ${running.pipeline.length} steps`);
      const measurements = await run.evaluate(element => {
        const body = element.querySelector<HTMLElement>("[data-queue-body]")!;
        const title = element.querySelector<HTMLElement>("[data-demo-row-title]")!;
        const bar = element.querySelector<HTMLElement>("[data-queue-progress]")!;
        const label = bar.nextElementSibling!;
        return { top: getComputedStyle(body).paddingTop, font: getComputedStyle(title).fontSize,
          titleLeft: title.getBoundingClientRect().left, barLeft: bar.getBoundingClientRect().left,
          barBottom: bar.getBoundingClientRect().bottom, labelTop: label.getBoundingClientRect().top,
          mainIcon: body.firstElementChild?.firstElementChild?.querySelectorAll("svg").length };
      });
      expect(measurements.top).toBe("14px");
      expect(measurements.font).toBe("14px");
      expect(measurements.titleLeft).toBe(measurements.barLeft);
      expect(measurements.barBottom).toBeLessThan(measurements.labelTop);
      expect(measurements.mainIcon).toBe(0);
      await expect(run.locator(".animate-spin")).toHaveCount(1);
      const group = queue.locator(`[data-demo-row-id='${operation.runId}']`);
      await group.scrollIntoViewIfNeeded();
      await expect(group.locator("[data-queue-member-count]")).toHaveText(`${operation.memberRollup.terminal}/${operation.memberRollup.total}`);
      const table = group.getByRole("table", { name: `Members of ${operation.title}` });
      await expect(table.getByRole("columnheader", { name: "Name", exact: true })).toBeVisible();
      await expect(table.getByRole("columnheader", { name: "Status", exact: true })).toBeVisible();
      await expect(table.locator("tbody tr")).toHaveCount(3);
      for (const row of await table.locator("tbody tr").all()) {
        await expect(row.locator("td:last-child")).not.toBeEmpty();
        await expect(row.locator("td:first-child svg").first()).toBeVisible();
      }
      const visibleMemberBounds = await table.evaluate(element => ({
        bottom: element.parentElement!.getBoundingClientRect().bottom,
        rows: [...element.querySelectorAll("tbody tr")].map(row => row.getBoundingClientRect().bottom),
      }));
      for (const bottom of visibleMemberBounds.rows) expect(bottom).toBeLessThanOrEqual(visibleMemberBounds.bottom);
      const large = queue.getByRole("table", { name: "Members of Onboarding cohort — July stragglers", exact: true });
      await large.scrollIntoViewIfNeeded();
      const compactBounds = await large.evaluate(element => ({
        bottom: element.parentElement!.getBoundingClientRect().bottom,
        viewport: { top: element.parentElement!.getBoundingClientRect().top, height: element.parentElement!.getBoundingClientRect().height, clientHeight: element.parentElement!.clientHeight, scrollHeight: element.parentElement!.scrollHeight, maxHeight: getComputedStyle(element.parentElement!).maxHeight },
        rowRects: [...element.querySelectorAll("tbody tr")].map(row => ({ top: row.getBoundingClientRect().top, bottom: row.getBoundingClientRect().bottom, height: row.getBoundingClientRect().height })),
        rows: [...element.querySelectorAll("tbody tr")].map(row => row.getBoundingClientRect().bottom),
      }));
      await info.attach("compact-member-geometry", { body: JSON.stringify(compactBounds), contentType: "application/json" });
      expect(compactBounds.rows.filter(bottom => bottom <= compactBounds.bottom).length, JSON.stringify(compactBounds)).toBe(4);
      await group.scrollIntoViewIfNeeded();
      const finished = queue.locator(`[data-demo-row-id='${done.runId}']`);
      await expect(finished).not.toContainText("duration unknown");
      const attempt = run.getByRole("button", { name: `Attempts for ${running.title}`, exact: true });
      await attempt.scrollIntoViewIfNeeded();
      await attempt.focus();
      await page.keyboard.press("Enter");
      const menu = page.getByRole("menu", { name: `Attempts for ${running.title}`, exact: true });
      await expect(menu).toBeVisible();
      await expect(menu.getByRole("menuitemradio", { name: /^#1 /u })).toHaveAttribute("aria-checked", "true");
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(attempt).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      const tree = await page.locator("body").ariaSnapshot();
      info.annotations.push({ type: `a11y-attachment-sha256:${a11yName}`, description: createHash("sha256").update(tree).digest("hex") });
      await info.attach(a11yName, { body: tree, contentType: "text/yaml" });
      expect(errors).toEqual([]);
    } finally { await server.close(); }
  });
}
