import { expect, test, type Page } from "@playwright/test";
import { gotoAppState } from "./helpers/app-driver.js";
import { FIXTURE_ACTIVITY_RANGE } from "./helpers/fixture-archive.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { ANCHORS,SCENES } from "./helpers/reference-activity-scenes.js";
import { registerReferenceServers } from "./helpers/reference-harness.js";
import { registerReferenceScenes } from "./helpers/reference-scenes.js";
const servers = registerReferenceServers(["server"]);
registerReferenceScenes(SCENES, () => servers.server, ANCHORS);

async function openActivity(page: Page) {
  await gotoAppState(page, servers.server.baseUrl, {
    day: FIXTURE_DAY,
    activity: `${FIXTURE_ACTIVITY_RANGE.from}..${FIXTURE_ACTIVITY_RANGE.to}`,
  });
  await expect(page.getByRole("group", { name: "Range-wide report totals" })).toBeVisible();
}

function collectActivityRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", request => {
    if (new URL(request.url()).pathname === "/api/v1/reports/activity") urls.push(request.url());
  });
  return urls;
}

test("[A3] Activity presets show exact applied dates without a calendar trigger", async ({ page }) => {
  await openActivity(page);
  const period = page.getByRole("combobox", { name: "Report period" });
  const heading = page.locator(".activity-report-heading");
  expect(await period.locator("option").allTextContents()).toEqual([
    "This week", "Today", "Last month", "Last 3 months", "Last 6 months", "Last year", "Custom range",
  ]);
  await expect(page.getByText("Period", { exact: true })).toHaveCount(0);
  await expect(heading.getByRole("heading", { name: "Activity" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export report" })).toBeVisible();

  for (const preset of [
    { value: "this-week", range: "2026-08-02..2026-08-03", label: "Aug 2 – Aug 3, 2026" },
    { value: "today", range: "2026-08-03..2026-08-03", label: "Aug 3, 2026" },
    { value: "last-month", range: "2026-07-04..2026-08-03", label: "Jul 4 – Aug 3, 2026" },
    { value: "last-3-months", range: "2026-05-04..2026-08-03", label: "May 4 – Aug 3, 2026" },
    { value: "last-6-months", range: "2026-02-04..2026-08-03", label: "Feb 4 – Aug 3, 2026" },
    { value: "last-year", range: "2025-08-04..2026-08-03", label: "Aug 4, 2025 – Aug 3, 2026" },
  ]) {
    await period.selectOption(preset.value);
    await expect(page).toHaveURL(new RegExp(`activity=${preset.range.replaceAll(".", "\\.")}(?:&|$)`));
    await expect(period).toHaveValue(preset.value);
    await expect(heading.getByText(preset.label, { exact: true })).toBeVisible();
    await expect(heading.getByRole("button", { name: /^Select report dates:/u })).toHaveCount(0);
    await expect(heading).not.toContainText("runs in this period");
  }
});

test("[A3] Custom range stays draft until Apply; Cancel, Escape, outside, preset change, and reload preserve the applied range", async ({ page }) => {
  await openActivity(page);
  const period = page.getByRole("combobox", { name: "Report period" });
  const requests = collectActivityRequests(page);
  await period.selectOption("this-week");
  await expect(page).toHaveURL(/activity=2026-08-02\.\.2026-08-03/u);
  await expect.poll(() => requests.length).toBe(1);

  await period.selectOption("custom");
  const picker = page.getByRole("dialog", { name: "Select report dates" });
  const apply = picker.getByRole("button", { name: "Apply range" });
  await expect(picker).toBeVisible();
  const reportToday = picker.locator(".activity-range-calendar-report-today .range-calendar__cell-button");
  await expect(reportToday).toHaveText("3");
  await expect(reportToday).toHaveCSS("outline-style", "solid");
  await expect(apply).toBeEnabled();
  await picker.getByRole("button", { name: /Wednesday, August 5, 2026/u }).click();
  await expect(apply).toBeDisabled();
  await expect(page).toHaveURL(/activity=2026-08-02\.\.2026-08-03/u);
  await picker.getByRole("button", { name: "Cancel" }).click();
  await expect(picker).toHaveCount(0);
  await expect(period).toHaveValue("this-week");
  await expect(period).toBeFocused();
  expect(requests).toHaveLength(1);

  await period.selectOption("custom");
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: /Wednesday, August 5, 2026/u }).click();
  await picker.getByRole("button", { name: /Friday, August 7, 2026/u }).click();
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(page).toHaveURL(/activity=2026-08-05\.\.2026-08-07/u);
  await expect(page.getByRole("button", { name: "Select report dates: Aug 5 – Aug 7, 2026" })).toBeVisible();
  await expect.poll(() => requests.length).toBe(2);

  await page.reload();
  await expect(page.locator("[data-parity-ready='true']")).toBeVisible();
  await expect(page.getByRole("button", { name: "Select report dates: Aug 5 – Aug 7, 2026" })).toBeVisible();
  await expect(page.getByText("activity-request-identity-mismatch", { exact: true })).toBeVisible();

  const dateTrigger = page.getByRole("button", { name: "Select report dates: Aug 5 – Aug 7, 2026" });
  await dateTrigger.click();
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: /Monday, August 10, 2026/u }).click();
  await expect(apply).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(picker).toHaveCount(0);
  await expect(page).toHaveURL(/activity=2026-08-05\.\.2026-08-07/u);
  await expect(dateTrigger).toBeFocused();
  await expect.poll(() => requests.length).toBe(3);

  await dateTrigger.click();
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: /Wednesday, August 12, 2026/u }).click();
  await page.locator(".activity-report-heading h1").click();
  await expect(picker).toHaveCount(0);
  await expect(page).toHaveURL(/activity=2026-08-05\.\.2026-08-07/u);
  await expect(dateTrigger).toBeFocused();
  await expect.poll(() => requests.length).toBe(3);

  await dateTrigger.click();
  await expect(picker).toBeVisible();
  await picker.getByRole("button", { name: /Friday, August 14, 2026/u }).click();
  await period.selectOption("today");
  await expect(picker).toHaveCount(0);
  await expect(period).toHaveValue("today");
  await expect(page).toHaveURL(/activity=2026-08-03\.\.2026-08-03/u);
  await expect.poll(() => requests.length).toBe(4);
});

test("[A3] Keyboard users can select and apply a range", async ({ page }) => {
  await openActivity(page);
  const trigger = page.getByRole("button", { name: /^Select report dates:/u });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const picker = page.getByRole("dialog", { name: "Select report dates" });
  await expect(picker).toBeVisible();

  let focusedCell = false;
  for (let attempt = 0; attempt < 12 && !focusedCell; attempt += 1) {
    focusedCell = await page.evaluate(() => document.activeElement?.closest(".range-calendar__cell") !== null);
    if (!focusedCell) await page.keyboard.press("Tab");
  }
  expect(focusedCell).toBe(true);
  const focusedCalendarCell = picker.locator(".activity-range-calendar .range-calendar__cell[data-focus-visible='true']");
  await expect(focusedCalendarCell).toHaveCount(1);
  await expect(focusedCalendarCell).toHaveCSS("outline-style", "solid");
  await expect(focusedCalendarCell).toHaveCSS("outline-width", "2px");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  const apply = picker.getByRole("button", { name: "Apply range" });
  await expect(apply).toBeEnabled();

  let applyFocused = false;
  for (let attempt = 0; attempt < 8 && !applyFocused; attempt += 1) {
    applyFocused = await apply.evaluate(element => element === document.activeElement);
    if (!applyFocused) await page.keyboard.press("Tab");
  }
  expect(applyFocused).toBe(true);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/activity=\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}/u);
  await expect(picker).toHaveCount(0);
});

test("[A3] Invalid URL ranges remain refused until an explicit selection", async ({ page }) => {
  await gotoAppState(page, servers.server.baseUrl, {
    day: FIXTURE_DAY,
    activity: "2026-08-08..2026-08-03",
  });
  await expect(page.getByRole("button", { name: "Select report dates: Invalid report span" })).toBeVisible();
  await expect(page.getByText(/Choose valid From and To dates/u)).toBeVisible();
  await expect(page).toHaveURL(/activity=2026-08-08\.\.2026-08-03/u);

  await page.getByRole("combobox", { name: "Report period" }).selectOption("today");
  await expect(page).toHaveURL(/activity=2026-08-03\.\.2026-08-03/u);
});
