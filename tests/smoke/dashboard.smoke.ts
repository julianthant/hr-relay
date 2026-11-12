import { expect, test, type Page } from "@playwright/test";
import { startSeededServer, SEEDED_DAY, type SeededServer } from "../support/helpers/dashboard/served-fixtures/seeded-bff.js";
import { PARITY_DIST_DIR } from "../support/helpers/dashboard/served-fixtures/bundle.js";

let seeded: SeededServer;
test.beforeAll(async () => {
  seeded = await startSeededServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
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

async function expectHeading(page: Page): Promise<void> {
  await expect(page.getByRole("heading").first()).toBeVisible();
}

test("every page the sidebar links to renders its heading without errors", async ({ page }) => {
  const failures = collectFailures(page);
  await page.goto(`${seeded.baseUrl}/?day=${SEEDED_DAY}`);
  await expectHeading(page);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const links = page.locator('a[href^="?settings="]');
  await expect(links.first()).toBeVisible();
  const routes = await links.evaluateAll(anchors => anchors.map(anchor => anchor.getAttribute("href") ?? ""));
  expect(routes.length).toBeGreaterThan(0);

  for (const route of routes) {
    await page.goto(`${seeded.baseUrl}/${route}`);
    await expectHeading(page);
    await page.waitForLoadState("networkidle");
  }
  expect(failures).toEqual([]);
});
