import { attachShellA11y } from "./helpers/shell-proof.js";
import { expect, test } from "@playwright/test";
import { captureParityPair } from "./helpers/capture.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";
import { REFERENCES, registerReferenceServers } from "./helpers/reference-harness.js";
const servers = registerReferenceServers(["server"]);

test("App data stays fixed, copy works and restore requires confirmation", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(`${servers.server.baseUrl}/?fixture=fixed-backup`);
  await expect(page.getByRole("textbox", { name: "Data path", exact: true })).toHaveAttribute("readonly", "");
  await expect(page.getByRole("button", { name: /Change (Data|Evidence)/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Copy data path", exact: true }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("~/Library/Application Support/Relay/people/am");
  await page.getByRole("button", { name: "Back up now", exact: true }).click();
  await expect(page.getByText("Backing up; verification is pending.", { exact: true })).toBeVisible();
  await expect(page.getByText("Backup complete and verified.", { exact: true })).toHaveCount(0);
  await page.goto(`${servers.server.baseUrl}/?fixture=fixed-backup`);
  await page.getByRole("button", { name: "Restore…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Restore from backup", exact: true });
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Restore…", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Restore…", exact: true }).click();
  await dialog.getByRole("radio", { name: "Oct 28, 2026 · 6:40 PM", exact: true }).check();
  await dialog.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-selected-backup", "manual");
  await expect(page.getByText("Restoring your data; replacement is not complete.", { exact: true })).toBeVisible();
  await page.goto(`${servers.server.baseUrl}/?fixture=fixed-backup&state=blocked`);
  await expect(page.getByRole("button", { name: "Restore…", exact: true })).toBeDisabled();
  await expect(page.getByText("Stop all runs before restoring.", { exact: true })).toBeVisible();
});
test("Folders read failure stays in its card and retries", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=fixed-backup&state=read-failure`);
  await expect(page.getByText("Couldn’t load your folders", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Data path", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("button", { name: "Change Documents", exact: true })).toBeVisible();
});
test("Clipboard failure stays visible and leaves paths selectable", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("denied")) } }); });
  await page.goto(`${servers.server.baseUrl}/?fixture=fixed-backup`);
  await page.getByRole("button", { name: "Copy data path", exact: true }).click();
  await expect(page.getByText("The path couldn’t be copied. Select and copy it from the field.", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Data path", exact: true })).toHaveValue("~/Library/Application Support/Relay/people/am");
});

for (const height of [720, 860]) for (const state of ["ready", "backing-up", "backup-complete", "restore-confirmation", "restoring", "blocked", "unavailable", "read-failure"] as const) test(`fixed-backup ${state} presentation ${height}`, { annotation: [{ type: "required-a11y-evidence", description: `fixed-backup-${state}-${height}.a11y.yml` }] }, async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height });
  await page.goto(`${servers.server.baseUrl}/?fixture=fixed-backup&state=${state}`);
  await expect(page.getByRole("heading", { name: "Paths", exact: true, level: 1 })).toBeVisible();
  if (state === "restore-confirmation") await page.getByRole("button", { name: "Restore…", exact: true }).click();
  await expect(page.getByText("UI mock", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Show (ready|blocked|unavailable|exact|paused)/ })).toHaveCount(0);
  await captureParityPair(page, REFERENCES, {
    stateId: `fixed-backup-${state}`, viewport: `1280x${height}`, theme: "graphite-warm",
    adapter: "fixture", fixtureId: "fixed-backup", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
  await attachShellA11y(page, info, `fixed-backup-${state}-${height}.a11y.yml`);
});
