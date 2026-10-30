import { expect, test } from "@playwright/test";
import { captureParityPair } from "./helpers/capture.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";
import { REFERENCES, registerReferenceServers } from "./helpers/reference-harness.js";

const servers = registerReferenceServers(["server"]);

test("Delete account requires explicit confirmation and never claims pending erasure is complete", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=delete-account`);
  await page.getByRole("button", { name: "Delete account", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Delete account?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep account" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Delete account", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Delete account", exact: true }).click();
  await page.getByRole("button", { name: "Delete account permanently" }).click();
  await expect(page.getByRole("button", { name: "Deleting…", exact: true })).toBeDisabled();
  await expect(page.getByText("Deletion is not complete.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Show blocked" }).click();
  await expect(page.getByText("Account deletion blocked", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete account", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Show unavailable" }).click();
  await expect(page.getByRole("button", { name: "Delete account", exact: true })).toBeDisabled();
});

for (const state of ["ready", "confirmation", "blocked", "closure-blocked", "deleting", "unavailable"] as const) test(`Delete account ${state} presentation`, async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=delete-account`);
  if (state === "confirmation") await page.getByRole("button", { name: "Delete account", exact: true }).click();
  else await page.getByRole("button", { name: `Show ${state}`, exact: true }).click();
  await captureParityPair(page, REFERENCES, {
    stateId: `delete-account-${state}`, viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "delete-account", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
});
