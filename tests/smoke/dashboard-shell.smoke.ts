/** Shell smoke: every sidebar destination, the collapsed sidebar, search, notifications and browser history on the seeded backend. */
import type { Page, Request } from "@playwright/test";
import { DATA_PAGE_LABELS, DESKTOP_VIEWPORTS, WORKFLOW_LABELS } from "../support/helpers/dashboard/smoke/dashboard-page.js";
import { expect, SEEDED_PREFERENCE_WRITE, test } from "../support/helpers/dashboard/smoke/smoke-fixtures.js";

/** Search reads each query after a pause, and closing or retyping cancels the read still open; a step waits for the read it started. */
function nextSearchRead(page: Page): Promise<Request> {
  return page.waitForEvent("requestfinished", request => new URL(request.url()).pathname === "/api/v1/search");
}

async function openSearch(page: Page): Promise<void> {
  const read = nextSearchRead(page);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await read;
}

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

test("the collapsed sidebar still opens a workflow and a data page", async ({ dashboard, failures, page }) => {
  failures.allow(SEEDED_PREFERENCE_WRITE, "the seeded backend cannot save the chosen workflow");
  await dashboard.open();
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await dashboard.openWorkflow("Separations");
  await dashboard.openDataPage("Explorer");
  await page.getByRole("button", { name: "Close settings" }).click();
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeVisible();
});

test("search lists runs for a workflow name and opens the chosen run", async ({ dashboard, page }) => {
  await dashboard.open();
  await openSearch(page);
  const query = page.getByRole("combobox", { name: "Search Relay" });
  await expect(query).toBeFocused();
  await query.fill("person");
  const result = page.getByRole("listbox", { name: "Results" }).getByRole("option", { name: /Done/ });
  await expect(result).toHaveCount(1);
  await result.click();
  await dashboard.expectRunOpen(dashboard.runId("doneRun"));
});

test("search keeps focus and typing after ArrowDown", async ({ dashboard, page }) => {
  await dashboard.open();
  await openSearch(page);
  const query = page.getByRole("combobox", { name: "Search Relay" });
  await query.press("ArrowDown");
  await expect(query).toBeFocused();
  await page.keyboard.type("person");
  await expect(query).toHaveValue("person");
});

test("search shows the empty state for a query with no match", async ({ dashboard, page }) => {
  await dashboard.open();
  await openSearch(page);
  const query = page.getByRole("combobox", { name: "Search Relay" });
  await query.fill("no such thing anywhere");
  await expect(page.getByRole("status").filter({ hasText: "No matches" })).toBeVisible();
});

test("Escape closes search when the query is empty", async ({ dashboard, page }) => {
  await dashboard.open();
  await openSearch(page);
  const query = page.getByRole("combobox", { name: "Search Relay" });
  await expect(query).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(query).toBeHidden();
});

test("Escape clears a populated search, then closes it", async ({ dashboard, page }) => {
  await dashboard.open();
  await openSearch(page);
  const dialog = page.getByRole("dialog", { name: "Search Relay" });
  const query = dialog.getByRole("combobox", { name: "Search Relay" });
  const populated = nextSearchRead(page);
  await query.fill("person");
  await expect(query).toHaveValue("person");
  await populated;
  const cleared = nextSearchRead(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeVisible();
  await expect(query).toHaveValue("");
  await cleared;
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("the bell opens notifications in a popover and the sidebar keeps its workflows", async ({ dashboard, page }) => {
  await dashboard.open();
  await page.getByRole("button", { name: /^Notifications, \d+ unread$/ }).click();
  const popover = page.getByRole("dialog", { name: "Notifications" });
  await expect(popover).toBeVisible();
  // The popover is modal, so the sidebar leaves the accessibility tree while it is open; it must still be drawn.
  await expect(page.locator(".workflow-rail")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();
  await expect(dashboard.workflows).toBeVisible();
});

test("Back, Forward and Reload follow the URL", async ({ dashboard, failures, page }) => {
  failures.allow(SEEDED_PREFERENCE_WRITE, "the seeded backend cannot save the chosen workflow");
  await dashboard.open();
  await dashboard.openWorkflow("Separations");
  await dashboard.openDataPage("Analytics");
  // Opening Settings lands on General, then the section link adds its own entry.
  await dashboard.settleReads();
  await page.goBack();
  await expect(dashboard.pageHeading("General")).toBeVisible();
  await dashboard.settleReads();
  await page.goBack();
  await expect(dashboard.pageHeading("Separations queue")).toBeVisible();
  await dashboard.settleReads();
  await page.goForward();
  await dashboard.settleReads();
  await page.goForward();
  await expect(dashboard.pageHeading("Analytics")).toBeVisible();
  await dashboard.settleReads();
  await page.reload();
  await expect(dashboard.pageHeading("Analytics")).toBeVisible();
});
