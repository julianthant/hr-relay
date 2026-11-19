/** Shell smoke: every sidebar destination, the collapsed sidebar, search, notifications and browser history on the seeded backend. */
import { DATA_PAGE_LABELS, DESKTOP_VIEWPORTS, WORKFLOW_LABELS } from "../support/helpers/dashboard/smoke/dashboard-page.js";
import { expect, SEEDED_PREFERENCE_WRITE, test } from "../support/helpers/dashboard/smoke/smoke-fixtures.js";

for (const viewport of DESKTOP_VIEWPORTS) {
  test.describe(`shell at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test("every workflow and data page renders its heading without sideways scroll", async ({ dashboard, failures }) => {
      failures.allow(SEEDED_PREFERENCE_WRITE, "the seeded backend cannot save the chosen workflow");
      await dashboard.open();
      for (const label of WORKFLOW_LABELS) {
        await dashboard.openWorkflow(label);
        await dashboard.expectNoSidewaysScroll();
      }
      for (const label of DATA_PAGE_LABELS) {
        await dashboard.openDataPage(label);
        await dashboard.expectNoSidewaysScroll();
      }
    });
  });
}

test("the collapsed sidebar still reaches every destination", async ({ dashboard, failures, page }) => {
  failures.allow(SEEDED_PREFERENCE_WRITE, "the seeded backend cannot save the chosen workflow");
  await dashboard.open();
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await dashboard.openWorkflow("Separations");
  await dashboard.openDataPage("Explorer");
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeVisible();
});

test("search lists runs for a workflow name and opens the chosen run", async ({ dashboard, page, seeded }) => {
  await dashboard.open();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const query = page.getByRole("combobox", { name: "Search Relay" });
  await expect(query).toBeFocused();
  await query.fill("person");
  const result = page.getByRole("listbox", { name: "Results" }).getByRole("option", { name: /Done/ });
  await expect(result).toHaveCount(1);
  await result.click();
  await expect(page).toHaveURL(new RegExp(`[?&]run=${seeded.runIds.doneRun}(&|$)`));
  await expect(dashboard.runPanel).toBeVisible();
});

test("search with no match says so and closes on Escape", async ({ dashboard, page }) => {
  await dashboard.open();
  const opener = page.getByRole("button", { name: "Search", exact: true });
  await opener.click();
  const query = page.getByRole("combobox", { name: "Search Relay" });
  await query.fill("no such thing anywhere");
  await expect(page.getByText("No matches")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(query).toBeHidden();
});

test("the first Escape clears a search query and the second closes search", async ({ dashboard, page }) => {
  test.fail(true, "One Escape closes search with a query typed; the documented behaviour clears the query first.");
  await dashboard.open();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  const query = page.getByRole("combobox", { name: "Search Relay" });
  await query.fill("person");
  await page.keyboard.press("Escape");
  await expect(query).toBeVisible();
  await expect(query).toHaveValue("");
});

test("the bell swaps the sidebar to notifications and back", async ({ dashboard, page }) => {
  await dashboard.open();
  const bell = page.getByRole("button", { name: /^Notifications, \d+ unread$/ });
  await bell.click();
  await expect(page.getByRole("heading", { level: 2, name: "Notifications" })).toBeVisible();
  await bell.click();
  await expect(dashboard.workflows).toBeVisible();
});

test("Back, Forward and Reload follow the URL", async ({ dashboard, failures, page }) => {
  failures.allow(SEEDED_PREFERENCE_WRITE, "the seeded backend cannot save the chosen workflow");
  await dashboard.open();
  await dashboard.openWorkflow("Separations");
  await dashboard.openDataPage("Analytics");
  await page.goBack();
  await expect(dashboard.pageHeading("Separations queue")).toBeVisible();
  await page.goForward();
  await expect(dashboard.pageHeading("Analytics")).toBeVisible();
  await page.reload();
  await expect(dashboard.pageHeading("Analytics")).toBeVisible();
});
