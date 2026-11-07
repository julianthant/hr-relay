import { expect, type Page, type TestInfo } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { FIXTURE_DAY, FIXTURE_NOW } from "./helpers/fixture-identity.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { attachShellA11y } from "./helpers/shell-proof.js";

async function shot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(`U0-${name}.png`), fullPage: true });
}

for (const width of [1280, 1920, 2560]) test(`functional UI fixes at ${width}`, {
  annotation: [{ type: "required-a11y-evidence", description: `functional-ui-${width}.a11y.yml` }],
}, async ({ page }, info) => {
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  const height = width === 1280 ? 720 : width === 1920 ? 1080 : 1440;
  const attemptId = "00000000-0000-4000-8000-000000000099";
  const authorizationUrl = "https://auth.openai.com/api/accounts/authorize?state=synthetic-u0";
  const expiresAt = new Date(Date.parse(FIXTURE_NOW) + 600_000).toISOString();
  const completion = Promise.withResolvers<void>();
  let resumed = false;
  const cancelled: string[] = [], errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.setViewportSize({ width, height });
    await installTheme(page, PARITY_THEMES[0]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.clock.install({ time: new Date(FIXTURE_NOW) });
    await page.route("**/api/v1/settings/chatgpt-account", route => resumed
      ? route.fulfill({ json: { state: "signing-in", attemptId, authorizationUrl, expiresAt, account: { state: "signed-out" } } })
      : route.continue());
    await page.route("**/api/v1/settings/chatgpt-account/sign-in", route => route.fulfill({ json: { state: "started", attemptId, authorizationUrl, expiresAt } }));
    await page.route(`**/api/v1/settings/chatgpt-account/sign-in/${attemptId}`, async route => {
      await completion.promise;
      await route.fulfill({ json: { state: "refused", attemptId, code: "CHATGPT_AUTH_CANCELLED", message: "ChatGPT sign-in was cancelled." } });
    });
    await page.route(`**/api/v1/settings/chatgpt-account/sign-in/${attemptId}/cancel`, async route => {
      cancelled.push(new URL(route.request().url()).pathname);
      resumed = false;
      await route.fulfill({ json: { state: "cancelled", attemptId } });
    });
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, settings: "general" });
    const account = page.getByRole("group", { name: "ChatGPT account", exact: true });
    await account.getByRole("button", { name: "Connect ChatGPT", exact: true }).click();
    await expect(account).toContainText("Waiting for you to finish signing in in your browser");
    await expect(page.getByRole("status", { name: "Loading ChatGPT account", exact: true })).toHaveCount(0);
    const reopen = account.getByRole("link", { name: "Reopen sign-in page", exact: true });
    await expect(reopen).toHaveAttribute("href", authorizationUrl);
    await expect(reopen).toHaveAttribute("rel", "noopener noreferrer");
    const cancel = account.getByRole("button", { name: "Cancel", exact: true });
    await expect(cancel).toBeEnabled();
    await cancel.focus(); await expect(cancel).toBeFocused();
    await shot(page, info, `signing-in-${width}`);
    resumed = true;
    await page.reload();
    await expect(account).toContainText("Waiting for you to finish signing in in your browser");
    await expect(cancel).toBeEnabled();
    await expect(reopen).toHaveAttribute("href", authorizationUrl);
    await expect(reopen).toHaveAttribute("rel", "noopener noreferrer");
    await shot(page, info, `signing-in-reloaded-${width}`);
    await cancel.press("Enter");
    await expect(account.getByRole("button", { name: "Connect ChatGPT", exact: true })).toBeEnabled();
    expect(cancelled).toEqual([`/api/v1/settings/chatgpt-account/sign-in/${attemptId}/cancel`]);
    completion.resolve();
    await expect(account).not.toContainText("Waiting for you");
    await page.unroute(`**/api/v1/settings/chatgpt-account/sign-in/${attemptId}`);

    const expiring = Promise.withResolvers<void>();
    await page.route(`**/api/v1/settings/chatgpt-account/sign-in/${attemptId}`, async route => {
      await expiring.promise;
      await route.abort();
    });
    try {
      await account.getByRole("button", { name: "Connect ChatGPT", exact: true }).click();
      await expect(cancel).toBeEnabled();
      await cancel.focus();
      await page.clock.fastForward(600_000);
      await expect(account).toContainText("Your sign-in attempt expired. Sign in to try again.");
      await expect(account.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
      await expect(account.getByRole("button", { name: "Sign in", exact: true })).toBeFocused();
      await expect(cancel).toHaveCount(0); await expect(reopen).toHaveCount(0);
      await shot(page, info, `sign-in-expired-${width}`);
    } finally { expiring.resolve(); }

    for (const section of ["spreadsheets", "general", "performance", "paths", "routes", "credentials", "keyboard"]) {
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&settings=${section}`);
      const nav = page.getByRole("navigation", { name: "Settings sections", exact: true });
      const current = nav.locator(`[aria-current="${section === "performance" ? "location" : "page"}"]`);
      if (section === "performance") await nav.getByRole("searchbox", { name: "Search settings", exact: true }).fill("Performance");
      await expect(current).toHaveCount(1);
      await expect(current).toHaveAttribute("href", `?settings=${section}`);
      const heading = section === "keyboard" ? "Keyboard shortcuts" : section[0].toUpperCase() + section.slice(1);
      await expect(page.getByRole("heading", { name: heading, level: 1, exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByRole("heading", { name: heading, level: 1, exact: true })).toBeVisible();
      if (section === "performance") await nav.getByRole("searchbox", { name: "Search settings", exact: true }).fill("Performance");
      await expect(current).toHaveCount(1);
      await expect(current).toHaveAttribute("href", `?settings=${section}`);
    }
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&settings=general`);
    await expect(page.getByRole("heading", { name: "General", exact: true })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Settings sections", exact: true });
    await expect(nav.getByRole("link", { name: "General", exact: true })).toHaveAttribute("aria-current", "page");
    await shot(page, info, `settings-general-${width}`);
    const fullHeight = await page.locator(".settings-content").evaluate(element => element.scrollHeight + 80);
    await page.setViewportSize({ width, height: Math.max(height, fullHeight) });
    await shot(page, info, `settings-general-${width}-full`);
    await page.setViewportSize({ width, height });

    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
    const row = page.locator("[data-demo-row-id]").filter({ has: page.getByRole("button", { name: "Attempts for Morrow, Bea", exact: true }) });
    const trigger = row.getByRole("button", { name: "Attempts for Morrow, Bea", exact: true });
    await expect(trigger).toBeVisible();
    const bounds = await trigger.boundingBox(); expect(bounds).not.toBeNull();
    expect(bounds!.width).toBeLessThan(60);
    await page.mouse.click(bounds!.x - 12, bounds!.y + bounds!.height / 2);
    await expect(page.getByRole("menu", { name: /^Attempts for/ })).toHaveCount(0);
    await page.mouse.click(bounds!.x + bounds!.width + 12, bounds!.y + bounds!.height / 2);
    await expect(page.getByRole("menu", { name: /^Attempts for/ })).toHaveCount(0);
    await trigger.click();
    const menu = page.getByRole("menu", { name: "Attempts for Morrow, Bea", exact: true });
    await expect(menu).toBeVisible();
    await expect.poll(async () => { const box = await menu.boundingBox(); return box!.y + box!.height; }).toBeLessThanOrEqual(bounds!.y);
    const menuBounds = await menu.boundingBox();
    expect(menuBounds!.x).toBeGreaterThanOrEqual(0);
    expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(width);
    await shot(page, info, `attempts-${width}`);
    await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
    await trigger.press("ArrowDown"); await expect(menu).toBeVisible();
    await menu.getByRole("menuitemradio").press("Enter");
    await expect(menu).toHaveCount(0);

    await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: "Separations", exact: true }).click();
    const timeline = page.getByRole("navigation", { name: "Run timeline", exact: true });
    await expect(timeline).toBeVisible();
    for (const step of await timeline.getByRole("button").all()) {
      const title = await step.getAttribute("title"); expect(title).toBeTruthy();
      await expect(step).toHaveAccessibleName(new RegExp(`^${title}`));
      const label = step.locator("span").filter({ hasText: title! }).last();
      await expect(label).toHaveText(title!);
      if (await step.isEnabled()) {
        await step.focus();
        await expect(page.getByRole("tooltip")).toContainText(title!);
      }
    }
    await timeline.getByRole("button").first().focus();
    await expect(page.getByRole("tooltip")).toContainText("Read Kuali document");
    await shot(page, info, `step-labels-${width}`);
    await attachShellA11y(page, info, `functional-ui-${width}.a11y.yml`);
    expect(errors).toEqual([]);
  } finally { completion.resolve(); await server.close(); }
});
