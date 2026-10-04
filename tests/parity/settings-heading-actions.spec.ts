import { expect, test, type Locator } from "@playwright/test";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "./helpers/fixture-bff.js";
import { startSetupPreflightServer } from "./helpers/fixture-setup-preflight.js";

async function assertHeadingActions(surface: Locator): Promise<void> {
  const heading = surface.locator(".ds-page-heading").first();
  const copy = (await heading.locator(":scope > div").first().boundingBox())!;
  const actions = (await heading.locator(":scope > div").last().boundingBox())!;
  const bounds = (await surface.boundingBox())!;
  expect(actions.x).toBeGreaterThan(copy.x + copy.width);
  expect(Math.abs(actions.y + actions.height / 2 - copy.y - copy.height / 2)).toBeLessThanOrEqual(2);
  expect(Math.abs(actions.x + actions.width - bounds.x - bounds.width)).toBeLessThanOrEqual(2);
  await expect(surface.locator(".diagnostic-toolbar")).toHaveCount(0);
}

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`Storage actions stay beside the heading and retain readback @ ${theme.attribute} ${width}`, async ({ page }) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
      await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?settings=storage`);
      const surface = page.getByRole("region", { name: "Storage checks", exact: true });
      const run = surface.getByRole("button", { name: "Run the read-only storage doctor", exact: true });
      await expect(surface).toContainText("No completed checks in this server session");
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
      await expect(surface).toContainText("Last checked");
      await expect(surface.getByRole("group", { name: "Data store and recovery", exact: true })).not.toContainText("Not checked");
      await expect(run).toBeEnabled();
      await assertHeadingActions(surface);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await test.info().attach(`storage-heading-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
    } finally { await server.close(); }
  });

  test(`Preflight scope and rerun stay beside the heading and retain authority @ ${theme.attribute} ${width}`, async ({ page }) => {
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
      const rerun = heading.getByRole("button", { name: "Run checks again", exact: true });
      await expect(scope).toBeVisible();
      await scope.selectOption(server.scope);
      await expect(surface).toContainText("Readiness unavailable");
      await expect(rerun).toBeEnabled();
      await assertHeadingActions(surface);
      let release: (() => void) | undefined;
      const pending = new Promise<void>(resolve => { release = resolve; });
      await page.route("**/api/v1/preflight/rerun", async route => { await pending; await route.continue(); });
      await rerun.focus();
      await page.keyboard.press("Enter");
      const running = heading.getByRole("button", { name: "Running checks…", exact: true });
      await expect(running).toBeDisabled();
      release!();
      await expect(surface.locator("time")).toHaveAttribute("dateTime", server.now);
      await expect(rerun).toBeEnabled();
      await assertHeadingActions(surface);
      expect(server.requests.some(request => request.method === "POST" && request.path === "/api/v1/preflight/rerun" && request.status === 200)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await test.info().attach(`preflight-heading-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
    } finally { await server.close(); }
  });
}
