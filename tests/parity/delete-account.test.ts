import { expect, test } from "@playwright/test";
import { registerReferenceServers } from "./helpers/reference-harness.js";
const servers = registerReferenceServers(["server"]);

test("Delete account confirms, restores focus and keeps pending erasure explicit", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=delete-account`);
  await page.getByRole("button", { name: "Delete account", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Delete Alex Morgan’s account?", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete account", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Delete account", exact: true }).click();
  await dialog.getByRole("button", { name: "Delete account", exact: true }).click();
  await expect(page.getByRole("button", { name: "Deleting…", exact: true })).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("Deleting your account; erasure is not complete.");
  await page.goto(`${servers.server.baseUrl}/?fixture=delete-account&state=unavailable`);
  await expect(page.getByRole("button", { name: "Delete account", exact: true })).toBeDisabled();
  await expect(page.getByText(/blocked|Resolve the unknown submission/)).toHaveCount(0);
});

for (const state of ["ready", "confirmation", "deleting", "unavailable"] as const) test(`delete-account ${state} presentation`, async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=delete-account&state=${state}`);
  await expect(page.getByRole("heading", { name: "General", exact: true, level: 1 })).toBeVisible();
  if (state === "confirmation") await page.getByRole("button", { name: "Delete account", exact: true }).click();
  await expect(page.getByText("UI mock", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Show (ready|blocked|unavailable|exact|paused)/ })).toHaveCount(0);
});
