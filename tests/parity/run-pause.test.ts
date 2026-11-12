import { expect, test } from "@playwright/test";
import { registerReferenceServers } from "./helpers/reference-harness.js";
const servers = registerReferenceServers(["server"]);

test("Pause and Resume distinguish requests from recorded pauses", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=run-pause`);
  await expect(page.getByRole("button", { name: "Quit Relay", exact: true })).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Workspace", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Run timeline", exact: true }).locator("button > span[aria-hidden]")).toHaveCount(4);
  await expect(page.getByRole("region", { name: "Queue", exact: true }).getByText("Paused", { exact: true }).locator("svg")).toHaveCount(1);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pausing…", exact: true })).toBeDisabled();
  await expect(page.getByRole("status").filter({ hasText: "This step will restart" })).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "Run timeline", exact: true }).getByText("This step will restart", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Selected run logs", exact: true }).getByText("Paused", { exact: true })).toHaveCount(0);
  await page.goto(`${servers.server.baseUrl}/?fixture=run-pause&state=paused`);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resuming…", exact: true })).toBeDisabled();
});
test("Quit confirms and waits for pause and resource settlement", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=run-pause`);
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await page.keyboard.press("Control+q");
  const dialog = page.getByRole("dialog", { name: "Pause all and quit?", exact: true });
  await expect(dialog.getByRole("button", { name: "Keep working", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Pause all runs", exact: true })).toBeFocused();
  await page.keyboard.press("Control+q");
  await dialog.getByRole("button", { name: "Pause all and quit", exact: true }).click();
  await expect(page.getByRole("region", { name: "Selected run logs", exact: true }).getByText("Pauses are not yet confirmed. A save in progress finishes first.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause all runs", exact: true })).toBeDisabled();
  await page.goto(`${servers.server.baseUrl}/?fixture=run-pause&state=closure-unknown`);
  await expect(page.getByRole("region", { name: "Selected run logs", exact: true }).getByText("Closure is unknown. Keep Relay open and check active runs.", { exact: true })).toBeVisible();
});

for (const state of ["running", "pause-pending", "pausing", "paused", "resume-pending", "unavailable", "closure-unknown", "all-paused", "all-unavailable", "quit-confirmation"] as const) test(`run-pause ${state} presentation`, async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=run-pause&state=${state}`);
  if (state === "quit-confirmation") await expect(page.getByRole("dialog", { name: "Pause all and quit?", exact: true })).toBeVisible();
  else await expect(page.getByRole("heading", { name: "Alex Morgan", exact: true, level: 2 })).toBeVisible();
  await expect(page.getByText("UI mock", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Show (ready|blocked|unavailable|exact|paused)/ })).toHaveCount(0);
});
