/** Diagnostics smoke: a read the page cancels itself is no failure, and every other failed request still is. */
import type { Page } from "@playwright/test";
import { DashboardPage } from "../support/helpers/dashboard/smoke/dashboard-page.js";
import type { SeededServer } from "../support/helpers/dashboard/served-fixtures/seeded-bff.js";
import { expect, test, watchPageDiagnostics } from "../support/helpers/dashboard/smoke/smoke-fixtures.js";

const isSearchRead = (url: string | URL): boolean => new URL(url).pathname === "/api/v1/search";

async function openSearch(page: Page, seeded: SeededServer): Promise<void> {
  await new DashboardPage(page, seeded).open();
  await page.getByRole("button", { name: "Search", exact: true }).click();
}

test("closing search while its read is open records no failure", async ({ context, seeded }) => {
  const page = await context.newPage();
  const seen = await watchPageDiagnostics(page);
  const held = Promise.withResolvers<void>();
  await page.route(isSearchRead, () => held.promise);
  const read = page.waitForRequest(request => isSearchRead(request.url()));
  await openSearch(page, seeded);
  const request = await read;
  const failed = page.waitForEvent("requestfailed", candidate => candidate === request);
  await page.keyboard.press("Escape");
  expect((await failed).failure()?.errorText).toBe("net::ERR_ABORTED");
  await expect.poll(() => [...seen]).toEqual([]);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

for (const [code, errorText] of [["aborted", "net::ERR_ABORTED"], ["failed", "net::ERR_FAILED"]] as const) {
  test(`a search read that fails with ${errorText} outside the page's control is recorded`, async ({ context, seeded }) => {
    const page = await context.newPage();
    const seen = await watchPageDiagnostics(page);
    await page.route(isSearchRead, route => route.abort(code));
    await openSearch(page, seeded);
    await expect(page.getByText("Search is unavailable. Reopen it and try again.")).toBeVisible();
    expect(seen).toContainEqual(expect.stringMatching(new RegExp(`^requestfailed: http://127\\.0\\.0\\.1:\\d+/api/v1/search\\?\\S+ ${errorText}$`, "u")));
  });
}
