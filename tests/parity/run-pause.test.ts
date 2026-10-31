import { attachShellA11y } from "./helpers/shell-proof.js";
import { expect, test } from "@playwright/test";
import { captureParityPair } from "./helpers/capture.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";
import { REFERENCES, registerReferenceServers } from "./helpers/reference-harness.js";
const servers = registerReferenceServers(["server"]);

test("Pause and Resume distinguish requests from recorded pauses", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=run-pause`);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("button", { name: "Pausing…", exact: true })).toBeDisabled();
  await expect(page.getByRole("status")).toContainText("Pause is not yet recorded.");
  await expect(page.getByRole("region", { name: "Selected run logs", exact: true }).getByText("Paused", { exact: true })).toHaveCount(0);
  await page.goto(`${servers.server.baseUrl}/?fixture=run-pause&state=paused`);
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resuming…", exact: true })).toBeDisabled();
});
test("Quit confirms and waits for pause and resource settlement", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=run-pause`);
  await page.getByRole("button", { name: "Quit Relay", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Pause all and quit?", exact: true });
  await expect(dialog.getByRole("button", { name: "Keep working", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Quit Relay", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Quit Relay", exact: true }).click();
  await dialog.getByRole("button", { name: "Pause all and quit", exact: true }).click();
  await expect(page.getByText("Finishing current steps; pauses and shutdown are not yet confirmed.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause all", exact: true })).toBeDisabled();
  await page.goto(`${servers.server.baseUrl}/?fixture=run-pause&state=closure-unknown`);
  await expect(page.getByText("Closure is unknown. Keep Relay open and check active runs.", { exact: true })).toBeVisible();
});

for (const state of ["running", "pause-pending", "pausing", "paused", "resume-pending", "unavailable", "closure-unknown", "all-paused", "all-unavailable", "quit-confirmation"] as const) test(`run-pause ${state} presentation`, { annotation: [{ type: "required-a11y-evidence", description: `run-pause-${state}.a11y.yml` }] }, async ({ page }, info) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=run-pause&state=${state}`);
  await expect(page.getByRole("heading", { name: "Alex Morgan", exact: true, level: 2 })).toBeVisible();
  if (state === "quit-confirmation") await page.getByRole("button", { name: "Quit Relay", exact: true }).click();
  await expect(page.getByText("UI mock", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Show (ready|blocked|unavailable|exact|paused)/ })).toHaveCount(0);
  await captureParityPair(page, REFERENCES, {
    stateId: `run-pause-${state}`, viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "run-pause", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
  await attachShellA11y(page, info, `run-pause-${state}.a11y.yml`);
});
