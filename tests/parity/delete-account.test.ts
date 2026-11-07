import { attachShellA11y } from "./helpers/shell-proof.js";
import { expect, test } from "@playwright/test";
import { captureParityPair } from "./helpers/capture.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";
import { REFERENCES, registerReferenceServers } from "./helpers/reference-harness.js";
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

for (const state of ["ready", "confirmation", "deleting", "unavailable"] as const) test(`delete-account ${state} presentation`, { annotation: [{ type: "required-a11y-evidence", description: `delete-account-${state}.a11y.yml` }] }, async ({ page }, info) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=delete-account&state=${state}`);
  await expect(page.getByRole("heading", { name: "General", exact: true, level: 1 })).toBeVisible();
  if (state === "confirmation") await page.getByRole("button", { name: "Delete account", exact: true }).click();
  await expect(page.getByText("UI mock", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Show (ready|blocked|unavailable|exact|paused)/ })).toHaveCount(0);
  await captureParityPair(page, REFERENCES, {
    stateId: `delete-account-${state}`, viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "delete-account", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
  await attachShellA11y(page, info, `delete-account-${state}.a11y.yml`);
});
