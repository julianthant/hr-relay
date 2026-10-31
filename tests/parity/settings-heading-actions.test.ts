
import { chooseSelect } from "./helpers/select-choice.js";
import { expect, test, type Locator } from "@playwright/test";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { startSetupPreflightServer } from "./helpers/fixture-setup-preflight.js";
import { FIXTURE_STORAGE_DOCTOR } from "./helpers/fixture-storage.js";
import { PreflightReadinessWireSchema } from "../../src/models/preflight/preflight-contract.js";

async function assertHeadingActions(surface: Locator): Promise<void> {
  const heading = surface.locator(".ds-page-heading").first();
  const copy = (await heading.locator(".ds-page-heading-copy").boundingBox())!;
  const actions = (await heading.locator(".ds-page-heading-actions").boundingBox())!;
  const bounds = (await heading.boundingBox())!;
  expect(actions.x).toBeGreaterThan(copy.x + copy.width);
  expect(Math.abs(actions.y + actions.height / 2 - copy.y - copy.height / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs(actions.x + actions.width - bounds.x - bounds.width)).toBeLessThanOrEqual(2);
  await expect(surface.locator(".diagnostic-toolbar")).toHaveCount(0);
}

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`Settings actions center on title-only and described headings @ ${theme.attribute} ${width}`, async ({ page }, _info) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
      await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?settings=spreadsheets`);
      const settings = page.getByRole("region", { name: "Settings", exact: true });
      const body = settings.locator(".settings-tab-body");
      const navigation = settings.getByRole("navigation", { name: "Settings sections", exact: true });
      for (const name of ["Spreadsheets", "Explorer", "Storage checks", "Preflight"]) {
        await navigation.getByRole("link", { name: name === "Storage checks" ? "Storage" : name, exact: true }).click();
        if (name === "Spreadsheets") {
          await expect(body.locator(".hub-sheets-library h1")).toHaveText(name);
          const toolbar = body.locator(".hub-sheets-toolbar"), bounds = (await toolbar.boundingBox())!;
          const actions = toolbar.getByRole("button");
          await expect(actions).toHaveText(["Import spreadsheet", "Create type"]);
          const first = (await actions.first().boundingBox())!, last = (await actions.last().boundingBox())!;
          expect(first.x).toBe(bounds.x); expect(last.x + last.width).toBe(bounds.x + bounds.width); expect(first.y).toBe(last.y);
          await expect(body.locator(".hub-sheets-intro")).toHaveText("Choose, import, and organize your spreadsheet data.");
          continue;
        }
        await expect(body.locator(".ds-page-heading-title").first()).toHaveText(name);
        await expect(body.locator(".ds-page-heading-actions").first()).toBeVisible();
        await assertHeadingActions(body);
        await expect(body.locator(".ds-page-heading-description").first()).toBeVisible();

      }
      expect(errors).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally { await server.close(); }
  });

  test(`Storage actions stay beside the heading and retain readback @ ${theme.attribute} ${width}`, async ({ page }) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
      await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?settings=storage`);
      const surface = page.getByRole("region", { name: "Storage checks", exact: true });
      const run = surface.locator(".ds-page-heading-actions button");
      await expect(surface.getByRole("group", { name: "Data store summary", exact: true })).toContainText("Not checked");
      await expect(surface.getByRole("group", { name: "Storage health checks", exact: true })).toContainText("Not checked");
      await expect(run).toBeEnabled();
      await assertHeadingActions(surface);
      let release: (() => void) | undefined;
      const pending = new Promise<void>(resolve => { release = resolve; });
      await page.route("**/api/v1/storage/doctor", async route => { await pending; await route.continue(); });
      await run.focus();
      await page.keyboard.press("Enter");
      await expect(run).toBeDisabled();
      await expect(run).toHaveText("Running checks…");
      release!();
      await expect(run).toHaveText("Run checks again");
      const summary = surface.getByRole("group", { name: "Data store summary", exact: true });
      const copy = summary.locator(".ds-result-row-copy");
      const status = summary.locator(".ds-result-row-side");
      await expect(copy).toHaveText("Data store available");
      await expect(copy.locator(".ds-field-description")).toHaveCount(0);
      await expect(status).not.toContainText("Showing the last completed read-only check.");
      await expect(status).toContainText("Last checked");
      await expect(status.locator("time")).toHaveAttribute("dateTime", FIXTURE_STORAGE_DOCTOR.checkedAt);
      await expect(surface.locator(":scope > .diagnostic-status")).toHaveCount(0);
      const titleBounds = (await copy.boundingBox())!, statusBounds = (await status.boundingBox())!;
      expect(statusBounds.x).toBeGreaterThan(titleBounds.x + titleBounds.width);
      expect(await status.evaluate(node => getComputedStyle(node).textAlign)).toBe("right");
      await expect(surface.getByRole("group", { name: "Storage health checks", exact: true })).not.toContainText("Not checked");
      await expect(run).toBeEnabled();
      await assertHeadingActions(surface);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    } finally { await server.close(); }
  });

  test(`Preflight scope stays beside the heading and Status rerun retains authority @ ${theme.attribute} ${width}`, async ({ page }) => {
    ensureParityBundle();
    const server = await startSetupPreflightServer("unavailable");
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
      await page.clock.setFixedTime(new Date(server.now));
      await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?settings=preflight`);
      const surface = page.getByRole("region", { name: "Preflight", exact: true });
      const heading = surface.locator(".ds-page-heading");
      const scope = heading.getByRole("combobox", { name: "Check readiness for", exact: true });
      const status = surface.locator(".ds-body-section").filter({ has: page.getByRole("heading", { name: "Status", exact: true }) });
      const rerun = status.getByRole("button", { name: "Run preflight", exact: true });
      await expect(scope).toBeVisible();
      await chooseSelect(scope, server.scope);
      await expect(surface).toContainText("Readiness unavailable");
      await expect(rerun).toBeEnabled();
      await assertHeadingActions(surface);
      let release: (() => void) | undefined;
      const pending = new Promise<void>(resolve => { release = resolve; });
      await page.route("**/api/v1/preflight/rerun", async route => { await pending; await route.continue(); });
      await rerun.focus();
      await page.keyboard.press("Enter");
      const running = status.getByRole("button", { name: "Run preflight", exact: true });
      await expect(running).toBeDisabled();
      release!();
      const summary = surface.getByRole("group", { name: "Readiness summary", exact: true });
      await expect(summary).toBeVisible();
      await expect(rerun).toBeEnabled();
      const readUrl = new URL("/api/v1/preflight", server.baseUrl);
      readUrl.searchParams.set("selection", JSON.stringify({ workflowId: server.scope }));
      const read = await page.context().request.get(readUrl.toString());
      expect(read.ok()).toBe(true);
      const served = PreflightReadinessWireSchema.parse(await read.json());
      expect(served.state).toBe("present");
      if (served.state !== "present") throw new Error("PREFLIGHT_RERUN_REPORT_MISSING");
      expect(served.report.checkedAt).toBe(server.now);
      await expect(summary.locator("time")).toHaveAttribute("dateTime", served.report.checkedAt);
      await expect(surface.locator(".diagnostic-status")).toHaveCount(0);
      await expect(surface.getByRole("heading", { name: "Status", exact: true })).toBeVisible();
      const copy = summary.locator(".ds-result-row-copy"), count = summary.locator(".ds-result-row-side");
      await expect(copy.locator(".ds-field-description")).toHaveCount(0);
      await expect(count).toContainText("Last checked");
      await expect(count.locator("time")).toHaveText("08/03/2026 10:05 AM");
      await expect(summary).not.toContainText("returned checks");
      const copyBounds = (await copy.boundingBox())!, countBounds = (await count.boundingBox())!;
      expect(countBounds.x).toBeGreaterThan(copyBounds.x + copyBounds.width);
      expect(Math.abs(countBounds.y + countBounds.height / 2 - copyBounds.y - copyBounds.height / 2)).toBeLessThanOrEqual(2);
      await assertHeadingActions(surface);
      expect(server.requests.some(request => request.method === "POST" && request.path === "/api/v1/preflight/rerun" && request.status === 200)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

    } finally { await server.close(); }
  });
}
