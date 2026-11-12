import { expect, test, type Page } from "@playwright/test";
import { startSeededServer, SEEDED_DAY, type SeededServer } from "../support/helpers/dashboard/served-fixtures/seeded-bff.js";
import { MOCK_DIST_DIR } from "../support/helpers/dashboard/served-fixtures/bundle.js";

let seeded: SeededServer;
test.beforeAll(async () => {
  seeded = await startSeededServer({ distDir: MOCK_DIST_DIR, bundle: { proof: "working-tree" }, productApp: true });
});
test.afterAll(async () => { await seeded.close(); });

function collectFailures(page: Page): string[] {
  const failures: string[] = [];
  page.on("console", message => { if (message.type() === "error") failures.push(`console: ${message.text()}`); });
  page.on("pageerror", error => failures.push(`pageerror: ${error.message}`));
  page.on("requestfailed", request => failures.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ""}`));
  page.on("response", response => { if (response.status() >= 400) failures.push(`http ${response.status()}: ${response.url()}`); });
  return failures;
}

// The destination's own h1; the shell's h2s stay mounted on every page and must not satisfy this.
async function expectPageHeading(page: Page, label: string): Promise<void> {
  await expect(page.getByRole("heading", { level: 1, name: new RegExp(`^${label}`, "i") })).toBeVisible();
}

test("every page the sidebar links to renders its heading without errors", async ({ page }) => {
  const failures = collectFailures(page);
  await page.goto(`${seeded.baseUrl}/?day=${SEEDED_DAY}`);
  await expect(page.getByRole("complementary", { name: "Workspace" })).toBeVisible();

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const links = page.locator('a[href^="?settings="]');
  await expect(links.first()).toBeVisible();
  const routes = await links.evaluateAll(anchors => anchors.map(anchor => ({ href: anchor.getAttribute("href") ?? "", label: anchor.textContent?.trim() ?? "" })));
  expect(routes.length).toBeGreaterThan(0);

  for (const { href: route, label } of routes) {
    await page.locator(`a[href="${route}"]`).click();
    await expect(page).toHaveURL(new RegExp(`[?&]${route.slice(1)}(&|$)`));
    await expectPageHeading(page, label);
    await page.waitForTimeout(500);
  }
  expect(failures).toEqual([]);
});
