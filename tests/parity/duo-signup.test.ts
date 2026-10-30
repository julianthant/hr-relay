import { attachShellA11y } from "./helpers/shell-proof.js";
import { expect, test } from "@playwright/test";
import { captureParityPair } from "./helpers/capture.js";
import { FIXTURE_APP_VERSION, FIXTURE_DAY, FIXTURE_DESCRIPTOR_HASH } from "./helpers/fixture-identity.js";
import { REFERENCES, registerReferenceServers } from "./helpers/reference-harness.js";
const servers = registerReferenceServers(["server"]);
test("Sign-up needs both verified methods and keeps virtual Touch ID separate from Security key", async ({ page }) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=duo-signup`);
  const finish = page.getByRole("button", { name: "Finish", exact: true });
  await expect(finish).toBeDisabled();
  await page.getByRole("button", { name: "Add Touch ID", exact: true }).click();
  await expect(finish).toBeDisabled();
  await expect(page.getByText("Pending", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Verify mock Touch ID", exact: true }).click();
  await page.getByRole("button", { name: "Show virtual platform", exact: true }).click();
  await expect(page.getByText("Chromium supplies a virtual platform authenticator", { exact: false })).toBeVisible();
  await expect(finish).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add Security key", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Verify mock both", exact: true }).click();
  await expect(finish).toBeEnabled(); await finish.click();
  await expect(page.getByText("Finishing sign-up", { exact: true })).toBeVisible();
  await expect(finish).toBeDisabled();
  await page.getByRole("button", { name: "Reset mock", exact: true }).click();
  await page.getByRole("button", { name: "Show unknown", exact: true }).click();
  await expect(finish).toBeDisabled();
  await expect(page.getByText("Enrollment outcome unknown", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show unavailable", exact: true }).click();
  await expect(finish).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add Security key", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Back to login", exact: true }).click();
  await expect(page.getByText("Cancelling sign-up", { exact: true })).toBeVisible();
});

for (const [state, actions] of [
  ["idle", []],
  ["pending", ["Add Touch ID"]],
  ["touch-complete", ["Verify mock Touch ID"]],
  ["both-complete", ["Verify mock both"]],
  ["unknown", ["Show unknown"]],
  ["unavailable", ["Show unavailable"]],
  ["virtual", ["Show virtual platform"]],
  ["finishing", ["Verify mock both", "Finish"]],
  ["cancelling", ["Back to login"]],
] as const) test(`duo-signup ${state} presentation`, { annotation: [{ type: "required-a11y-evidence", description: `duo-signup-${state}.a11y.yml` }] }, async ({ page }, info) => {
  await page.goto(`${servers.server.baseUrl}/?fixture=duo-signup`);
  await expect(page.getByRole("heading", { name: "Set up Duo", exact: true, level: 1 })).toBeVisible();
  for (const name of actions) await page.getByRole("button", { name, exact: true }).click();
  await captureParityPair(page, REFERENCES, {
    stateId: `duo-signup-${state}`, viewport: "1280x720", theme: "graphite-warm",
    adapter: "fixture", fixtureId: "duo-signup", descriptorHash: FIXTURE_DESCRIPTOR_HASH,
    appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: "default",
  });
  await attachShellA11y(page, info, `duo-signup-${state}.a11y.yml`);
});
